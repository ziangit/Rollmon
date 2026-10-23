// Vercel function entry (bundled by scripts/build-api.mjs into
// .vercel/output/functions/api/leaderboard.func/index.mjs, next to a copy of
// the game data). DATABASE_URL comes from the Neon integration and
// SESSION_SECRET signs the account cookies; without them the API answers 503
// for the board / accounts respectively.
import {readFileSync} from 'node:fs';
import {createGameContext} from '../app/session.ts';
import type {GameData} from '../game/data.ts';
import {createApi, neonStore, nodeHandler, type Store} from './leaderboard.ts';

const data = JSON.parse(readFileSync(new URL('./game-data.json', import.meta.url), 'utf8')) as GameData;
const ctx = createGameContext(data);
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';
let store: Promise<Store | null> | null = null;

export default nodeHandler(createApi({ctx, secret: process.env.SESSION_SECRET, readToken: process.env.FEEDBACK_READ_TOKEN, store: () => (store ??= url ? neonStore(url) : Promise.resolve(null))}));
