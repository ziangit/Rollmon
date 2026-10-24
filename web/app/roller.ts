// Title-screen Gen × Type slot roller: a decorative mini-game that rolls a
// real cell of the draft pool and shows one of its natives. The reel
// mechanics are carried over from v1 (web_static/app.js); the pool is fed in
// from the loaded game data, so every species it shows is draftable.

export interface RollerMon {
  /** display name, already localised */
  name: string;
  /** debut generation 1–9 */
  gen: number;
  /** lowercase type names */
  types: string[];
  /** animated sprite to try first */
  animatedSpriteUrl: string;
  /** pixel sprite shown when the animated one does not exist (most gen 9 species) */
  pixelSpriteUrl: string;
}

/** Reel order (the classic in-game order, not alphabetical). */
export const ROLLER_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'] as const;
const TYPE_COLORS = ['#9099a1', '#ff9c54', '#4d90d5', '#f3d23b', '#63bc5a', '#74cec0', '#ce4069', '#ab6ac8', '#d97746', '#8fa8dd', '#f97176', '#90c12c', '#c7b78b', '#5269ac', '#0a6dc4', '#5a5366', '#5a8ea1', '#ec8fe6'];
const ITEM_HEIGHT = 56; // px height of one reel cell — matches CSS .reel-cell

interface Reel { idle(speed: number): void; spin(target: number, dur: number, cb: () => void): void; stop(): void }

let combos = new Map<string, RollerMon[]>();
let rolling = false;
let genReel: Reel | null = null;
let typeReel: Reel | null = null;
let typeLabel: (type: string) => string = (type) => type;

const el = (id: string) => document.getElementById(id)!;

/** A vertical slot reel: a tall strip of repeated cells that scrolls in px. */
function makeReel(stripId: string, count: number, renderCell: (i: number) => string): Reel {
  const strip = el(stripId);
  const COPIES = 24; // enough loops for a long spin
  let h = '';
  for (let c = 0; c < COPIES; c++) for (let i = 0; i < count; i++) h += renderCell(i);
  strip.innerHTML = h;
  const cycle = count * ITEM_HEIGHT;
  let offset = 0;
  let raf: number | null = null;
  const place = () => { const o = ((offset % cycle) + cycle) % cycle; strip.style.transform = `translateY(${ITEM_HEIGHT - o}px)`; };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
  /** slow continuous drift: the idle slot-machine motion */
  function idle(speed: number): void {
    stop();
    let last: number | null = null;
    const f = (t: number) => { if (last != null) offset += (t - last) * speed; last = t; place(); raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
  }
  /** decelerating spin that lands centred on `target`, then freezes */
  function spin(target: number, dur: number, cb: () => void): void {
    stop();
    offset = ((offset % cycle) + cycle) % cycle;
    let dest = target * ITEM_HEIGHT;
    while (dest < offset + 4 * cycle) dest += cycle;
    const start = offset, dist = dest - offset, t0 = performance.now();
    const f = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      offset = start + dist * e; place();
      if (p < 1) raf = requestAnimationFrame(f);
      else { offset = target * ITEM_HEIGHT; place(); cb(); }
    };
    raf = requestAnimationFrame(f);
  }
  place();
  return {idle, spin, stop};
}

/** Build (or rebuild, after a language change) the two reels. */
export function initRoller(labelType: (type: string) => string = typeLabel): void {
  typeLabel = labelType;
  genReel?.stop(); typeReel?.stop();
  genReel = makeReel('genstrip', 9, (i) => `<div class="reel-cell">${i + 1}</div>`);
  typeReel = makeReel('typestrip', ROLLER_TYPES.length, (i) => `<div class="reel-cell t"><span class="dot" style="--tc:${TYPE_COLORS[i]}"></span>${typeLabel(ROLLER_TYPES[i])}</div>`);
  genReel.idle(0.018); typeReel.idle(0.024); // slow drift, slightly desynced
}

/** The species the roller may show: the draft pool, grouped by every (gen, type) cell they occupy. */
export function setRollerPool(mons: readonly RollerMon[]): void {
  combos = new Map();
  for (const mon of mons) {
    for (const type of mon.types) {
      const ti = (ROLLER_TYPES as readonly string[]).indexOf(type);
      if (ti < 0) continue;
      const key = `${mon.gen}|${ti}`;
      const bucket = combos.get(key) ?? [];
      bucket.push(mon);
      combos.set(key, bucket);
    }
  }
}

export function rollMon(): void {
  if (rolling || !combos.size || !genReel || !typeReel) return;
  rolling = true;
  const btn = el('rollbtn') as HTMLButtonElement;
  btn.disabled = true;
  el('reel-gen').classList.remove('locked');
  el('reel-type').classList.remove('locked');
  // reset the summon panel to its spinning state
  const mon = el('rollmon') as HTMLImageElement;
  mon.classList.remove('pop'); mon.hidden = true;
  el('rollname').hidden = true;
  el('rolltypes').innerHTML = '';
  el('summon-gen').hidden = true;
  const empty = el('summon-empty'); empty.hidden = false; empty.textContent = '…';
  // pick a real, non-empty Gen × Type cell, then a random native inside it
  const keys = [...combos.keys()];
  const key = keys[Math.floor(Math.random() * keys.length)];
  const [gen, typeIndex] = key.split('|').map(Number);
  const bucket = combos.get(key)!;
  const pick = bucket[Math.floor(Math.random() * bucket.length)];
  // fetch the animated sprite (100–170 KB) while the reels spin, so the reveal does not wait for it on a phone
  new Image().src = pick.animatedSpriteUrl;
  // spin both reels; the type reel lands a touch later, then reveal once both freeze
  let done = 0;
  const both = () => { if (++done === 2) reveal(pick, gen, btn); };
  genReel.spin(gen - 1, 2100, () => { el('reel-gen').classList.add('locked'); both(); });
  typeReel.spin(typeIndex, 2650, () => { el('reel-type').classList.add('locked'); both(); });
}

function reveal(pick: RollerMon, gen: number, btn: HTMLButtonElement): void {
  const mon = el('rollmon') as HTMLImageElement;
  el('summon-empty').hidden = true;
  const gtag = el('summon-gen'); gtag.textContent = `GEN ${gen}`; gtag.hidden = false;
  const name = el('rollname'); name.textContent = pick.name; name.hidden = false;
  el('rolltypes').innerHTML = pick.types.map((type) => {
    const ti = (ROLLER_TYPES as readonly string[]).indexOf(type);
    return `<span class="tpill" style="--tc:${TYPE_COLORS[ti] ?? '#9099a1'}">${typeLabel(type)}</span>`;
  }).join('');
  mon.onload = () => { mon.hidden = false; mon.classList.remove('spinning'); void mon.offsetWidth; mon.classList.add('pop'); };
  // no animated sprite for this species: show the pixel one instead
  mon.onerror = () => { if (mon.src !== pick.pixelSpriteUrl) mon.src = pick.pixelSpriteUrl; else mon.hidden = true; };
  mon.classList.add('spinning'); mon.hidden = false;
  mon.src = pick.animatedSpriteUrl;
  rolling = false; btn.disabled = false;
}
