// DEV-ONLY hotlinks: Showdown's code is open source, but its sprite assets do
// not have established redistribution terms. Display them remotely; never
// download, vendor, or commit them. Port of the sprite-id logic in
// rollmons/web_app.py.
import type {PokedexEntry, SpeciesMetadata} from '../game/legality-matrix.ts';

export const SHOWDOWN_ASSET_ROOT = 'https://play.pokemonshowdown.com/sprites';

const showdownId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function showdownSpriteId(metadata: SpeciesMetadata, entry: PokedexEntry | undefined): string {
  const baseId = showdownId(String(entry?.baseSpecies ?? metadata.name));
  const formeId = baseId !== metadata.speciesId ? `-${showdownId(String(entry?.forme ?? ''))}` : '';
  let spriteId = `${baseId}${formeId}`;
  if (spriteId.endsWith('totem')) spriteId = spriteId.slice(0, -5);
  if (spriteId === 'greninja-bond' || spriteId === 'rockruff-dusk') spriteId = spriteId.split('-', 1)[0];
  return spriteId.replace(/-+$/, '');
}

export const spriteUrl = (metadata: SpeciesMetadata, entry: PokedexEntry | undefined) =>
  `${SHOWDOWN_ASSET_ROOT}/home-centered/${showdownSpriteId(metadata, entry)}.png`;
