// In-memory Store for tests and local runs: same ranking rules as neonStore.
import {NameTakenError, type UserRecord} from './auth.ts';
import {DuplicateRunError, type Entry, type NewEntry, type Store} from './leaderboard.ts';
import type {NewFeedback} from './feedback.ts';

export interface MemoryStore extends Store {
  rows: (Entry & NewEntry)[];
  users: (UserRecord & {ipHash: string | null})[];
  feedback: (NewFeedback & {id: number; createdAt: string})[];
}

export function memoryStore(now: () => number = Date.now): MemoryStore {
  const rows: (Entry & NewEntry)[] = [];
  const users: (UserRecord & {ipHash: string | null})[] = [];
  const feedback: (NewFeedback & {id: number; createdAt: string})[] = [];
  const byScore = (a: {score: number; createdAt: string}, b: {score: number; createdAt: string}) => b.score - a.score || a.createdAt.localeCompare(b.createdAt);
  const bests = () => {
    const best = new Map<number, Entry & NewEntry>();
    for (const r of [...rows].sort(byScore)) if (!best.has(r.userId)) best.set(r.userId, r);
    return [...best.values()].sort(byScore);
  };
  const entry = ({id, name, score, wins, battles, team, handicap, createdAt}: Entry): Entry => ({id, name, score, wins, battles, team, handicap, createdAt});
  return {
    rows,
    users,
    feedback,
    async top(limit) { return bests().slice(0, limit).map(entry); },
    async insert(e) {
      if (rows.some((r) => r.userId === e.userId && r.seed === e.seed)) throw new DuplicateRunError('dup');
      const row = {...e, id: rows.length + 1, createdAt: new Date(now() + rows.length).toISOString()};
      rows.push(row);
      const ranked = bests();
      const mine = ranked.find((r) => r.userId === e.userId)!;
      return {id: row.id, rank: ranked.indexOf(mine) + 1, best: mine.score};
    },
    async userByNameId(nameId) { return users.find((u) => u.nameId === nameId) ?? null; },
    async createUser(u) {
      if (users.some((x) => x.nameId === u.nameId)) throw new NameTakenError('taken');
      const user = {id: users.length + 1, ...u, createdAt: new Date(now()).toISOString()};
      users.push(user);
      return {id: user.id, name: user.name};
    },
    async signupsSince(ipHash, since) { return users.filter((u) => u.ipHash === ipHash && new Date(u.createdAt) > since).length; },
    async addFeedback(f) {
      const row = {...f, id: feedback.length + 1, createdAt: new Date(now() + feedback.length).toISOString()};
      feedback.push(row);
      return {id: row.id};
    },
    async feedbackSince(ipHash, since) { return feedback.filter((f) => f.ipHash === ipHash && new Date(f.createdAt) > since).length; },
  };
}
