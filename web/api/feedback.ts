// Player feedback, set contributions and boss contributions (docs/ROADMAP.md
// §7): one table, posted from the in-page drawer. Free text arrives with the
// screen, language and seed it was written on; a set contribution must parse
// as a Showdown export for the draftable species it was opened for, and a
// boss contribution as a full team of six with a name and the ladder level
// its author thinks it fits (in `note`), so every row is usable as is.
// Limited per network like sign-ups: one daily cap for free text, another for
// contributions (sets and bosses together), so a stream of sets never blocks a
// bug report and vice versa.
import type {GameContext} from '../app/session.ts';
import {parseShowdownExport, SubmissionError} from '../game/submissions.ts';

export const FEEDBACK_PER_IP_PER_DAY = 50;
export const CONTRIBUTIONS_PER_IP_PER_DAY = 50;
export const FEEDBACK_MAX_CHARS = 4000;
/** the one-line summary a set contribution comes with; a boss contribution's "fits level N because …" */
export const FEEDBACK_NOTE_MAX_CHARS = 200;
export const BOSS_TEAM_SIZE = 6;
export const BOSS_NAME_MAX_CHARS = 40;
export type FeedbackKind = 'feedback' | 'set' | 'boss';
/** The kinds that share a daily cap with `kind`, and that cap. */
export function capBucket(kind: FeedbackKind): {kinds: readonly FeedbackKind[]; limit: number; what: string} {
  return kind === 'feedback' ? {kinds: ['feedback'], limit: FEEDBACK_PER_IP_PER_DAY, what: 'feedback'} : {kinds: ['set', 'boss'], limit: CONTRIBUTIONS_PER_IP_PER_DAY, what: 'contributions'};
}

export interface FeedbackRow {
  kind: FeedbackKind;
  text: string;
  /** species id a set contribution is for; the boss name of a boss contribution */
  species: string | null;
  /** a set contribution's summary (what the set does); a boss contribution's level and why */
  note: string | null;
  screen: string | null;
  lang: string | null;
  seed: number | null;
}
export interface NewFeedback extends FeedbackRow {
  agent: string | null;
  userId: number | null;
  name: string | null;
  ipHash: string | null;
}
/** A stored row as the author's tooling reads it (no hashed address). */
export interface StoredFeedback extends FeedbackRow {
  id: number;
  createdAt: string;
  name: string | null;
  agent: string | null;
}
export interface FeedbackStore {
  addFeedback(f: NewFeedback): Promise<{id: number}>;
  /** rows of these kinds from the network since `since` */
  feedbackSince(ipHash: string, since: Date, kinds: readonly FeedbackKind[]): Promise<number>;
  /** newest first */
  feedbackList(limit: number): Promise<StoredFeedback[]>;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The validated row, or the message to answer 400 with. */
export function validateFeedback(payload: Record<string, unknown>, ctx: GameContext): {row: FeedbackRow} | {error: string} {
  const kind: FeedbackKind | null = payload.kind === 'set' ? 'set' : payload.kind === 'boss' ? 'boss' : payload.kind === 'feedback' ? 'feedback' : null;
  if (!kind) return {error: "kind must be 'feedback', 'set' or 'boss'"};
  const text = typeof payload.text === 'string' ? payload.text.replace(/\r\n?/g, '\n').trim() : '';
  if (!text) return {error: 'write something first'};
  if (text.length > FEEDBACK_MAX_CHARS) return {error: `at most ${FEEDBACK_MAX_CHARS} characters`};
  let species: string | null = null;
  let note: string | null = null;
  if (kind === 'set') {
    species = str(payload.species, 40);
    if (!species || !(species in ctx.legality.species)) return {error: 'unknown species'};
    note = str(payload.note, FEEDBACK_NOTE_MAX_CHARS);
    if (!note) return {error: 'say what the set does first'};
    if (typeof payload.note === 'string' && payload.note.trim().length > FEEDBACK_NOTE_MAX_CHARS) return {error: `summary: at most ${FEEDBACK_NOTE_MAX_CHARS} characters`};
    try {
      const wrong = parseShowdownExport(text, {source: species}).find((m) => m.species !== species);
      if (wrong) return {error: `that export is for ${wrong.species}, not ${species}`};
    } catch (err) {
      if (err instanceof SubmissionError) return {error: `not a Showdown export: ${err.message}`};
      throw err;
    }
  }
  if (kind === 'boss') {
    // the boss name goes in the species column; a file name once it lands in rollmons/bosses
    species = str(payload.boss, BOSS_NAME_MAX_CHARS);
    if (!species) return {error: 'name the boss first'};
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(species)) return {error: 'boss name: letters, digits, spaces, dots, apostrophes and hyphens'};
    note = str(payload.note, FEEDBACK_NOTE_MAX_CHARS);
    if (!note) return {error: 'say which level the boss fits first'};
    if (typeof payload.note === 'string' && payload.note.trim().length > FEEDBACK_NOTE_MAX_CHARS) return {error: `level note: at most ${FEEDBACK_NOTE_MAX_CHARS} characters`};
    try {
      parseShowdownExport(text, {expectedMembers: BOSS_TEAM_SIZE, source: 'boss team'});
    } catch (err) {
      if (err instanceof SubmissionError) return {error: `not a six-Pokémon Showdown export: ${err.message}`};
      throw err;
    }
  }
  const seed = typeof payload.seed === 'number' && Number.isFinite(payload.seed) ? payload.seed : null;
  return {row: {kind, text, species, note, screen: str(payload.screen, 32), lang: str(payload.lang, 8), seed}};
}
