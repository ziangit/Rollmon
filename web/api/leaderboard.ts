// Leaderboard + accounts API (docs/ROADMAP.md §7). GET /api/leaderboard lists
// each player's best verified run; POST submits a run proof, which is replayed
// and scored server-side before it is stored under the signed-in account.
// /api/auth/{register,login,logout,me} are the Showdown-style accounts
// (auth.ts). The handler is pure (request/response records) so it is testable;
// entry.ts wires it to Vercel's Node runtime and a Neon Postgres store.
import type {IncomingMessage, ServerResponse} from 'node:http';
import {InvalidProofError, verifyRun} from '../app/verify.ts';
import type {GameContext} from '../app/session.ts';
import {
  NameTakenError, PASSWORD_MAX, PASSWORD_MIN, NAME_MAX, SESSION_COOKIE, SIGNUPS_PER_IP_PER_DAY,
  cleanName, cookieValue, hashPassword, ipHash, readSession, sessionCookie, sessionToken, validPassword, verifyPassword,
  type User, type UserRecord, type UserStore,
} from './auth.ts';

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
  userId: number;
  name: string;
  score: number;
  wins: number;
  battles: number;
  seed: number;
  team: string[];
  handicap: number;
  summary: string;
  proof: unknown;
}

export class DuplicateRunError extends Error {}

export interface Store extends UserStore {
  /** The top entries, one per player (their highest score). */
  top(limit: number): Promise<Entry[]>;
  /** Stores the run; `best` is the player's highest score after it and `rank` that score's place among players. */
  insert(entry: NewEntry): Promise<{id: number; rank: number; best: number}>;
}

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string | null;
  cookie?: string | null;
  ip?: string | null;
}
export interface ApiResponse { status: number; body: unknown; setCookie?: string }

export const MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 50, MAX_LIMIT = 100;
const DAY_MS = 86_400_000;

export interface ApiOptions {
  store: () => Promise<Store | null>;
  ctx: GameContext;
  /** Signs session cookies and hashes addresses; without it accounts are off and scores cannot be posted. */
  secret?: string;
  now?: () => number;
}

export function createApi(opts: ApiOptions): (req: ApiRequest) => Promise<ApiResponse> {
  const now = opts.now ?? Date.now;
  const secret = opts.secret || null;
  const session = (req: ApiRequest): User | null => (secret ? readSession(secret, cookieValue(req.cookie, SESSION_COOKIE), now()) : null);
  const parse = <T>(req: ApiRequest, max = MAX_BODY_BYTES): T | ApiResponse => {
    if (!req.body || req.body.length > max) return {status: 413, body: {error: 'body too large or empty'}};
    try { return JSON.parse(req.body) as T; } catch { return {status: 400, body: {error: 'body is not JSON'}}; }
  };
  const isResponse = (v: unknown): v is ApiResponse => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;

  async function auth(req: ApiRequest, op: string): Promise<ApiResponse> {
    if (op === 'me' && req.method === 'GET') return {status: 200, body: {user: session(req), accounts: !!secret}};
    if (req.method !== 'POST') return {status: 405, body: {error: 'method not allowed'}};
    if (op === 'logout') return {status: 204, body: null, setCookie: sessionCookie(null)};
    if (op !== 'register' && op !== 'login') return {status: 404, body: {error: 'not found'}};
    const store = await opts.store();
    if (!store || !secret) return {status: 503, body: {error: 'accounts not configured'}};
    const payload = parse<{name?: unknown; password?: unknown}>(req, 4096);
    if (isResponse(payload)) return payload;
    const name = cleanName(payload.name);
    if (!name) return {status: 400, body: {error: `name must be 1–${NAME_MAX} characters with at least one letter or digit`}};
    if (!validPassword(payload.password)) return {status: 400, body: {error: `password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`}};
    const existing = await store.userByNameId(name.id);
    if (op === 'register') {
      const ip = ipHash(secret, req.ip);
      if (ip && await store.signupsSince(ip, new Date(now() - DAY_MS)) >= SIGNUPS_PER_IP_PER_DAY) {
        return {status: 429, body: {error: 'too many accounts were created from this network today; try again tomorrow'}};
      }
      if (existing) return {status: 409, body: {error: 'that name is taken'}};
      let user: User;
      try {
        user = await store.createUser({name: name.name, nameId: name.id, passwordHash: await hashPassword(payload.password), ipHash: ip});
      } catch (err) {
        if (err instanceof NameTakenError) return {status: 409, body: {error: 'that name is taken'}};
        throw err;
      }
      return {status: 201, body: {user: {name: user.name}}, setCookie: sessionCookie(sessionToken(secret, user, now()))};
    }
    if (!existing || !(await verifyPassword(payload.password, existing.passwordHash))) return {status: 401, body: {error: 'wrong name or password'}};
    const user = {id: existing.id, name: existing.name};
    return {status: 200, body: {user: {name: user.name}}, setCookie: sessionCookie(sessionToken(secret, user, now()))};
  }

  return async (req) => {
    const authOp = /^\/api\/auth\/([a-z]+)$/.exec(req.path);
    if (authOp) return auth(req, authOp[1]);
    if (req.path !== '/api/leaderboard') return {status: 404, body: {error: 'not found'}};
    const store = await opts.store();
    if (req.method === 'GET') {
      if (req.query.get('health') !== null) return {status: 200, body: {ok: true, configured: !!store, accounts: !!secret}};
      if (!store) return {status: 503, body: {error: 'leaderboard not configured'}};
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.get('limit')) || DEFAULT_LIMIT));
      return {status: 200, body: {entries: await store.top(limit)}};
    }
    if (req.method === 'POST') {
      if (!store) return {status: 503, body: {error: 'leaderboard not configured'}};
      const user = session(req);
      if (!user) return {status: 401, body: {error: 'sign in to post your score'}};
      const payload = parse<{proof?: unknown}>(req);
      if (isResponse(payload)) return payload;
      let run;
      try { run = verifyRun(opts.ctx, payload.proof); } catch (err) {
        if (err instanceof InvalidProofError) return {status: 422, body: {error: `run did not verify: ${err.message}`}};
        throw err;
      }
      const seed = (payload.proof as {seed: number}).seed;
      try {
        const {id, rank, best} = await store.insert({
          userId: user.id, name: user.name, score: run.score.total, wins: run.score.wins, battles: run.results.length, seed, team: run.team,
          handicap: run.score.handicap, summary: run.summary, proof: payload.proof,
        });
        return {status: 201, body: {id, rank, best, score: run.score.total, wins: run.score.wins}};
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
  `create table if not exists users (
     id bigserial primary key,
     created_at timestamptz not null default now(),
     name text not null,
     name_id text not null unique,
     password_hash text not null,
     ip_hash text
   )`,
  'create index if not exists users_signup_idx on users (ip_hash, created_at)',
  `create table if not exists leaderboard (
     id bigserial primary key,
     created_at timestamptz not null default now(),
     user_id bigint not null references users (id),
     name text not null,
     score integer not null,
     wins smallint not null,
     battles smallint not null,
     seed bigint not null,
     team text[] not null,
     handicap real not null,
     summary text not null,
     proof jsonb not null
   )`,
  // Migration from the pre-accounts table (anonymous rows keyed by a browser token).
  'alter table leaderboard add column if not exists user_id bigint references users (id)',
  'delete from leaderboard where user_id is null',
  'alter table leaderboard alter column user_id set not null',
  'alter table leaderboard drop column if exists token',
  'drop index if exists leaderboard_run_idx',
  'create index if not exists leaderboard_rank_idx on leaderboard (score desc, created_at asc)',
  'create index if not exists leaderboard_user_idx on leaderboard (user_id, score desc, created_at asc)',
  'create unique index if not exists leaderboard_user_run_idx on leaderboard (user_id, seed)',
];

// One row per player: their highest score, earliest if tied.
const BEST_PER_USER = 'select distinct on (user_id) id, user_id, name, score, wins, battles, team, handicap, created_at from leaderboard order by user_id, score desc, created_at asc';

export async function neonStore(url: string): Promise<Store> {
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(url);
  for (const stmt of SCHEMA) await sql.query(stmt);
  type Row = {id: string | number; name: string; score: number; wins: number; battles: number; team: string[]; handicap: number; created_at: string};
  const toEntry = (r: Row): Entry => ({id: Number(r.id), name: r.name, score: r.score, wins: r.wins, battles: r.battles, team: r.team, handicap: r.handicap, createdAt: new Date(r.created_at).toISOString()});
  const unique = (err: unknown, index: string) => new RegExp(`${index}|duplicate key`).test((err as Error).message);
  return {
    async top(limit) {
      const rows = await sql.query(`select * from (${BEST_PER_USER}) b order by score desc, created_at asc limit $1`, [limit]) as Row[];
      return rows.map(toEntry);
    },
    async insert(e) {
      let rows: {id: string | number}[];
      try {
        rows = await sql.query(
          'insert into leaderboard (user_id, name, score, wins, battles, seed, team, handicap, summary, proof) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
          [e.userId, e.name, e.score, e.wins, e.battles, e.seed, e.team, e.handicap, e.summary, JSON.stringify(e.proof)],
        ) as typeof rows;
      } catch (err) {
        if (unique(err, 'leaderboard_user_run_idx')) throw new DuplicateRunError('duplicate run');
        throw err;
      }
      const [best] = await sql.query('select score, created_at from leaderboard where user_id = $1 order by score desc, created_at asc limit 1', [e.userId]) as {score: number; created_at: string}[];
      const [{rank}] = await sql.query(
        `select count(*) + 1 as rank from (${BEST_PER_USER}) b where b.user_id <> $1 and (b.score > $2 or (b.score = $2 and b.created_at < $3))`,
        [e.userId, best.score, best.created_at],
      ) as {rank: string | number}[];
      return {id: Number(rows[0].id), rank: Number(rank), best: best.score};
    },
    async userByNameId(nameId) {
      const rows = await sql.query('select id, name, name_id, password_hash, created_at from users where name_id = $1', [nameId]) as {id: string | number; name: string; name_id: string; password_hash: string; created_at: string}[];
      const r = rows[0];
      return r ? {id: Number(r.id), name: r.name, nameId: r.name_id, passwordHash: r.password_hash, createdAt: new Date(r.created_at).toISOString()} satisfies UserRecord : null;
    },
    async createUser(u) {
      try {
        const [row] = await sql.query('insert into users (name, name_id, password_hash, ip_hash) values ($1,$2,$3,$4) returning id', [u.name, u.nameId, u.passwordHash, u.ipHash]) as {id: string | number}[];
        return {id: Number(row.id), name: u.name};
      } catch (err) {
        if (unique(err, 'users_name_id_key')) throw new NameTakenError('name taken');
        throw err;
      }
    },
    async signupsSince(ip, since) {
      const [{n}] = await sql.query('select count(*) as n from users where ip_hash = $1 and created_at > $2', [ip, since.toISOString()]) as {n: string | number}[];
      return Number(n);
    },
  };
}

/* ---- Node http adapter (Vercel Node runtime). Reads (GET) are open to any
   origin so a local build can show the board; writes are same-origin only:
   no CORS on POST, and a POST whose Origin does not match the host is
   refused (CSRF). The session cookie never travels cross-origin. */

export function nodeHandler(api: (req: ApiRequest) => Promise<ApiResponse>): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const send = (out: ApiResponse) => {
      const headers: Record<string, string> = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
      if (req.method === 'GET') headers['Access-Control-Allow-Origin'] = '*';
      if (out.setCookie) headers['Set-Cookie'] = out.setCookie;
      res.writeHead(out.status, headers);
      res.end(out.status === 204 ? undefined : JSON.stringify(out.body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Vercel rewrites /api/auth/<op> to /api/leaderboard?auth=<op> (deploy/vercel-build.sh).
      const authOp = url.searchParams.get('auth');
      const path = authOp ? `/api/auth/${authOp}` : url.pathname.replace(/\/$/, '');
      let body: string | null = null;
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) { send({status: 403, body: {error: 'cross-origin request refused'}}); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_BODY_BYTES) { send({status: 413, body: {error: 'submission too large'}}); return; }
          chunks.push(chunk as Buffer);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      const forwarded = req.headers['x-forwarded-for'];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || (req.headers['x-real-ip'] as string | undefined) || req.socket?.remoteAddress || null;
      send(await api({method: req.method ?? 'GET', path, query: url.searchParams, body, cookie: req.headers.cookie ?? null, ip}));
    } catch (err) {
      console.error(err);
      send({status: 500, body: {error: 'internal error'}});
    }
  };
}
