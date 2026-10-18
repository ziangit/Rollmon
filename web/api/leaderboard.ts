// Leaderboard API (docs/ROADMAP.md §7): GET lists the top entries, POST
// submits a run proof, which is replayed and scored server-side before it is
// stored. The handler is pure (request/response records) so it is testable;
// entry.ts wires it to Vercel's Node runtime and a Neon Postgres store.
import type {IncomingMessage, ServerResponse} from 'node:http';
import {InvalidProofError, verifyRun} from '../app/verify.ts';
import type {GameContext} from '../app/session.ts';

export interface Entry {
  id: number;
  name: string;
  score: number;
  wins: number;
  battles: number;
  team: string[];
  handicap: number;
  createdAt: string;
}

export interface NewEntry {
  name: string;
  score: number;
  wins: number;
  battles: number;
  seed: number;
  team: string[];
  handicap: number;
  summary: string;
  proof: unknown;
  token: string | null;
}

export class DuplicateRunError extends Error {}

export interface Store {
  top(limit: number): Promise<Entry[]>;
  insert(entry: NewEntry): Promise<{id: number; rank: number}>;
}

export interface ApiRequest { method: string; path: string; query: URLSearchParams; body: string | null }
export interface ApiResponse { status: number; body: unknown }

export const MAX_BODY_BYTES = 512 * 1024;
export const NAME_MAX = 24;
const DEFAULT_LIMIT = 50, MAX_LIMIT = 100;

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

export function createLeaderboardApi(opts: {store: () => Promise<Store | null>; ctx: GameContext}): (req: ApiRequest) => Promise<ApiResponse> {
  return async (req) => {
    if (req.path !== '/api/leaderboard') return {status: 404, body: {error: 'not found'}};
    const store = await opts.store();
    if (req.method === 'GET') {
      if (req.query.get('health') !== null) return {status: 200, body: {ok: true, configured: !!store}};
      if (!store) return {status: 503, body: {error: 'leaderboard not configured'}};
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.get('limit')) || DEFAULT_LIMIT));
      return {status: 200, body: {entries: await store.top(limit)}};
    }
    if (req.method === 'POST') {
      if (!store) return {status: 503, body: {error: 'leaderboard not configured'}};
      if (!req.body || req.body.length > MAX_BODY_BYTES) return {status: 413, body: {error: 'submission too large or empty'}};
      let payload: {name?: unknown; proof?: unknown; token?: unknown};
      try { payload = JSON.parse(req.body); } catch { return {status: 400, body: {error: 'body is not JSON'}}; }
      const name = cleanName(payload.name);
      if (!name) return {status: 400, body: {error: `name must be 1–${NAME_MAX} characters`}};
      const token = typeof payload.token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(payload.token) ? payload.token : null;
      let run;
      try { run = verifyRun(opts.ctx, payload.proof); } catch (err) {
        if (err instanceof InvalidProofError) return {status: 422, body: {error: `run did not verify: ${err.message}`}};
        throw err;
      }
      const seed = (payload.proof as {seed: number}).seed;
      try {
        const {id, rank} = await store.insert({
          name, score: run.score.total, wins: run.score.wins, battles: run.results.length, seed, team: run.team,
          handicap: run.score.handicap, summary: run.summary, proof: payload.proof, token,
        });
        return {status: 201, body: {id, rank, score: run.score.total, wins: run.score.wins}};
      } catch (err) {
        if (err instanceof DuplicateRunError) return {status: 409, body: {error: 'this run was already submitted'}};
        throw err;
      }
    }
    return {status: 405, body: {error: 'method not allowed'}};
  };
}

/* ---- Neon Postgres store (serverless HTTP driver; DATABASE_URL from the Vercel Neon integration) */

export const SCHEMA = [
  `create table if not exists leaderboard (
     id bigserial primary key,
     created_at timestamptz not null default now(),
     name text not null,
     score integer not null,
     wins smallint not null,
     battles smallint not null,
     seed bigint not null,
     team text[] not null,
     handicap real not null,
     summary text not null,
     proof jsonb not null,
     token text
   )`,
  'create index if not exists leaderboard_rank_idx on leaderboard (score desc, created_at asc)',
  'create unique index if not exists leaderboard_run_idx on leaderboard (seed, token) where token is not null',
];

export async function neonStore(url: string): Promise<Store> {
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(url);
  for (const stmt of SCHEMA) await sql.query(stmt);
  type Row = {id: string | number; name: string; score: number; wins: number; battles: number; team: string[]; handicap: number; created_at: string};
  const toEntry = (r: Row): Entry => ({id: Number(r.id), name: r.name, score: r.score, wins: r.wins, battles: r.battles, team: r.team, handicap: r.handicap, createdAt: new Date(r.created_at).toISOString()});
  return {
    async top(limit) {
      const rows = await sql.query('select id, name, score, wins, battles, team, handicap, created_at from leaderboard order by score desc, created_at asc limit $1', [limit]) as Row[];
      return rows.map(toEntry);
    },
    async insert(e) {
      let rows: {id: string | number; created_at: string}[];
      try {
        rows = await sql.query(
          'insert into leaderboard (name, score, wins, battles, seed, team, handicap, summary, proof, token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, created_at',
          [e.name, e.score, e.wins, e.battles, e.seed, e.team, e.handicap, e.summary, JSON.stringify(e.proof), e.token],
        ) as typeof rows;
      } catch (err) {
        if (/leaderboard_run_idx|duplicate key/.test((err as Error).message)) throw new DuplicateRunError('duplicate run');
        throw err;
      }
      const [{id, created_at}] = rows;
      const [{rank}] = await sql.query('select count(*) + 1 as rank from leaderboard where score > $1 or (score = $1 and created_at < $2)', [e.score, created_at]) as {rank: string | number}[];
      return {id: Number(id), rank: Number(rank)};
    },
  };
}

/* ---- Node http adapter (Vercel Node runtime) */

const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'};

export function nodeHandler(api: (req: ApiRequest) => Promise<ApiResponse>): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      let body: string | null = null;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_BODY_BYTES) { send(413, {error: 'submission too large'}); return; }
          chunks.push(chunk as Buffer);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      const out = await api({method: req.method ?? 'GET', path: url.pathname.replace(/\/$/, ''), query: url.searchParams, body});
      send(out.status, out.body);
    } catch (err) {
      console.error(err);
      send(500, {error: 'internal error'});
    }
  };
}
