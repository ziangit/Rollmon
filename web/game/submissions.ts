// Pure parsing and existence validation for contributed Showdown exports.
// Port of rollmons/submissions.py; data comes in as objects, not paths.
import {exportToMembers, type ExportMember} from './showdown-export.ts';

export class SubmissionError extends Error {}
export class BattleEntityNotFoundError extends SubmissionError {}

export function parseShowdownExport(exportText: string, opts: {expectedMembers?: number; source?: string} = {}): ExportMember[] {
  const source = opts.source ?? 'submission';
  const text = exportText.trim();
  if (!text) throw new SubmissionError(`${source} is empty`);
  let members: ExportMember[];
  try {
    members = exportToMembers(text);
  } catch (err) {
    throw new SubmissionError(`${source} is malformed Showdown export text`, {cause: err});
  }
  if (opts.expectedMembers !== undefined && members.length !== opts.expectedMembers) {
    throw new SubmissionError(`${source} must contain exactly ${opts.expectedMembers} Pokemon; found ${members.length}`);
  }
  members.forEach((member, i) => {
    if (!member.species) throw new SubmissionError(`${source} member ${i + 1} has no species`);
    if (!member.moves.length) throw new SubmissionError(`${source} member ${i + 1} has no moves`);
    if (member.moves.length > 4) throw new SubmissionError(`${source} member ${i + 1} has more than four moves`);
  });
  return members;
}

export interface EntityData { pokedex: Record<string, unknown>; moves: Record<string, unknown> }

/** Reject only species and moves absent from the checked-in Gen 9 engine data. */
export function verifyTeamEntitiesExist(teams: Record<string, string>, data: EntityData): void {
  const missing: string[] = [];
  for (const [teamName, exportText] of Object.entries(teams)) {
    for (const member of parseShowdownExport(exportText, {source: teamName})) {
      if (!(member.species in data.pokedex)) missing.push(`${teamName}: species '${member.species || '(blank)'}'`);
      for (const move of member.moves) if (!(move in data.moves)) missing.push(`${teamName}: move '${move || '(blank)'}'`);
    }
  }
  if (missing.length) throw new BattleEntityNotFoundError(`not implemented in the Gen 9 engine: ${missing.join(', ')}`);
}

/** Validate one contributed file's text: returns [members, total moves]. */
export function validateSubmission(exportText: string, kind: 'boss' | 'set', data: EntityData, source = 'submission'): [number, number] {
  const members = parseShowdownExport(exportText, {expectedMembers: kind === 'boss' ? 6 : 1, source});
  verifyTeamEntitiesExist({submission: exportText}, data);
  return [members.length, members.reduce((n, m) => n + m.moves.length, 0)];
}
