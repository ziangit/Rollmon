// Player feedback and set contributions (docs/ROADMAP.md §7): one table,
// posted from the in-page drawer. Free text arrives with the screen, language
// and seed it was written on; a set contribution must parse as a Showdown
// export for the draftable species it was opened for, so every row is usable
// as is. Limited per network like sign-ups.
import type {GameContext} from '../app/session.ts';
import {parseShowdownExport, SubmissionError} from '../game/submissions.ts';

export const FEEDBACK_PER_IP_PER_DAY = 10;
export const FEEDBACK_MAX_CHARS = 4000;
/** the one-line summary a set contribution comes with */
export const FEEDBACK_NOTE_MAX_CHARS = 200;
export type FeedbackKind = 'feedback' | 'set';

export interface FeedbackRow {
  kind: FeedbackKind;
  text: string;
  /** species id a set contribution is for */
  species: string | null;
  /** a set contribution's summary: what the set does, in one line */
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
  feedbackSince(ipHash: string, since: Date): Promise<number>;
  /** newest first */
  feedbackList(limit: number): Promise<StoredFeedback[]>;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The validated row, or the message to answer 400 with. */
export function validateFeedback(payload: Record<string, unknown>, ctx: GameContext): {row: FeedbackRow} | {error: string} {
  const kind: FeedbackKind | null = payload.kind === 'set' ? 'set' : payload.kind === 'feedback' ? 'feedback' : null;
  if (!kind) return {error: "kind must be 'feedback' or 'set'"};
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
  const seed = typeof payload.seed === 'number' && Number.isFinite(payload.seed) ? payload.seed : null;
  return {row: {kind, text, species, note, screen: str(payload.screen, 32), lang: str(payload.lang, 8), seed}};
}
