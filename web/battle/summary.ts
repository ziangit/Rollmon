// Damage summary from a battle's protocol log: how much of the opponents' HP
// (in percent of each target's max) each of the player's Pokémon took off.
// Port of the reference in rollmons/web_app.py (its tests define behaviour).

export interface DamageEntry { name: string; damage: number; contribution: number }
export interface DamagePayload { total: number; mvp: DamageEntry | null; byPokemon: DamageEntry[] }

/** Canonical species key: roster names ("iron moth") and replay names ("Iron Moth") collapse to one. */
export function normalizeSpeciesKey(value: string): string {
  for (const c of " -.'%*:()") value = value.replaceAll(c, '');
  return value.trim().toLowerCase().replace(/[^\x00-\x7f]/g, '');
}

const slotOf = (ident: string) => ident.split(':', 1)[0];
const nameOf = (ident: string) => ident.includes(':') ? ident.slice(ident.indexOf(':') + 1).trim() : ident.trim();
const speciesOf = (details: string) => details.split(',', 1)[0].trim();

function conditionPercent(condition: string): number {
  const hp = condition.split(/\s+/)[0];
  if (hp === '0' || !hp.includes('/')) return 0;
  const [cur, max] = hp.split('/', 2).map(Number);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max === 0) return 0;
  return Math.max(0, Math.min(100, (100 * cur) / max));
}

export function playerSideFromLog(log: string[], playerName: string): 'p1' | 'p2' {
  const wanted = normalizeSpeciesKey(playerName);
  for (const line of log) {
    const p = line.split('|');
    if (p.length >= 4 && p[1] === 'player' && normalizeSpeciesKey(p[3]) === wanted) return p[2] as 'p1' | 'p2';
  }
  return 'p1';
}

/** Percent damage dealt to opponents, keyed by the player's attacking species (replay spelling). */
export function damageByPlayerPokemon(log: string[], playerName: string): Map<string, number> {
  const playerSide = playerSideFromLog(log, playerName);
  const opponentSide = playerSide === 'p1' ? 'p2' : 'p1';
  const speciesBySlot = new Map<string, string>();
  const hpBySlot = new Map<string, number>();
  let attacker: string | null = null;
  const damage = new Map<string, number>();

  for (const line of log) {
    const p = line.split('|');
    if (p.length < 2) continue;
    const event = p[1];
    if ((event === 'switch' || event === 'drag') && p.length >= 5) {
      const slot = slotOf(p[2]);
      speciesBySlot.set(slot, speciesOf(p[3]));
      hpBySlot.set(slot, conditionPercent(p[4]));
      attacker = null;
    } else if (event === 'move' && p.length >= 4) {
      const slot = slotOf(p[2]);
      attacker = slot.slice(0, 2) === playerSide ? (speciesBySlot.get(slot) ?? nameOf(p[2])) : null;
    } else if (event === 'turn' || event === 'upkeep' || event === 'win' || event === 'tie') {
      attacker = null;
    } else if (event === '-heal' && p.length >= 4) {
      const slot = slotOf(p[2]);
      if (slot.slice(0, 2) === opponentSide) hpBySlot.set(slot, conditionPercent(p[3]));
    } else if (event === '-damage' && p.length >= 4) {
      const slot = slotOf(p[2]);
      const current = conditionPercent(p[3]);
      const previous = hpBySlot.get(slot) ?? 100;
      hpBySlot.set(slot, current);
      if (slot.slice(0, 2) !== opponentSide || attacker === null) continue;
      const dealt = Math.max(0, previous - current);
      if (dealt > 0) damage.set(attacker, (damage.get(attacker) ?? 0) + dealt);
    }
  }
  return damage;
}

/** Zeroed per-Pokémon totals keyed by normalized species, plus key -> display name. */
export function seedDamageTracking(speciesNames: string[]): {totals: Map<string, number>; display: Map<string, string>} {
  const totals = new Map<string, number>();
  const display = new Map<string, string>();
  for (const name of speciesNames) {
    const key = normalizeSpeciesKey(name);
    if (!totals.has(key)) totals.set(key, 0);
    if (!display.has(key)) display.set(key, name);
  }
  return {totals, display};
}

/** Fold one battle's damage into the running totals (roster display names win). */
export function accumulatePlayerDamage(totals: Map<string, number>, display: Map<string, string>, log: string[], playerName: string): void {
  for (const [species, dealt] of damageByPlayerPokemon(log, playerName)) {
    const key = normalizeSpeciesKey(species);
    totals.set(key, (totals.get(key) ?? 0) + dealt);
    if (!display.has(key)) display.set(key, species);
  }
}

export function damagePayload(totals: Map<string, number>, display: Map<string, string> = new Map()): DamagePayload {
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  const byPokemon = [...totals].map(([key, damage]) => ({
    name: display.get(key) ?? key,
    damage,
    contribution: total ? (100 * damage) / total : 0,
  }));
  byPokemon.sort((a, b) => b.damage - a.damage);
  const mvp = byPokemon.length && byPokemon[0].damage > 0 ? byPokemon[0] : null;
  return {total, mvp, byPokemon};
}

export function gauntletDamageSummary(totals: Map<string, number>, display?: Map<string, string>): string | null {
  const {mvp, byPokemon} = damagePayload(totals, display);
  if (!mvp) return null;
  const contributions = byPokemon.map((e) => `${e.name} ${e.damage.toFixed(1)}% (${e.contribution.toFixed(1)}%)`).join(', ');
  return `Your MVP is ${mvp.name}, dealing ${mvp.damage.toFixed(1)}% damage to your opponents (${mvp.contribution.toFixed(1)}% contribution). Team damage: ${contributions}.`;
}
