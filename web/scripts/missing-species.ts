// Fully evolved species that are not draftable (docs/ROADMAP.md §6): the
// worklist for coverage.ts and smogon-scrape.ts. Battle-only and item-locked
// formes are left out; cosmetic and cap formes too.
import type {GameContext} from '../app/session.ts';
import type {GameData} from '../game/data.ts';
import {DROPPED_FORMES} from '../game/legality-matrix.ts';

export interface MissingSpecies { id: string; name: string; bst: number; types: string; forme: boolean }

const COSMETIC = /^(pikachu|vivillon|squawkabilly|oinkologne|maushold|dudunsparce|polteageist|sinistcha|magearna|xerneas|arceus|floette|eternatus|tatsugiri|basculin)/;

export function missingSpecies(data: GameData, ctx: GameContext): MissingSpecies[] {
  const dex = data.pokedex as Record<string, any>;
  const atoms = new Set(ctx.legality.atoms);
  const seen = new Set<string>();
  const out: MissingSpecies[] = [];
  for (const [id, e] of Object.entries(dex)) {
    if (e.num <= 0 || (e.evos && e.evos.length)) continue;
    if (e.battleOnly || e.requiredItem || e.requiredAbility || e.requiredMove) continue;
    if (/gmax|totem|cosplay|starter|spiky/.test(id)) continue;
    if (e.isNonstandard && e.isNonstandard !== 'Past') continue;
    const baseId = e.baseSpecies ? String(e.baseSpecies).toLowerCase().replace(/[^a-z0-9]/g, '') : id;
    if (e.baseSpecies && dex[baseId]?.cosmeticFormes?.includes(e.name)) continue;
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    if (atoms.has(id) || DROPPED_FORMES.has(id)) continue;
    const bst = Object.values(e.baseStats as Record<string, number>).reduce((a, b) => a + b, 0);
    // regional formes count as species of their own; other formes are listed separately
    const forme = baseId !== id && !/alola|galar|hisui|paldea/.test(id);
    if (forme && COSMETIC.test(id)) continue;
    out.push({id, name: e.name, bst, types: e.types.join('/'), forme});
  }
  return out.sort((a, b) => b.bst - a.bst);
}
