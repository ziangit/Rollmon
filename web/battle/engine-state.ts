// Omniscient state mapper: @pkmn/sim `Battle` object -> poke-engine serialized
// state string (the format documented on `State::deserialize` in upstream
// src/state.rs). Written fresh for v2; both sides are fully known.
//
// Ordering contract: a side's six Pokémon are emitted in the sim's current
// `side.pokemon` order, so an engine `switch` index maps straight to the sim's
// `switch N` (N = index + 1) and a `move` index to `move N` (N = index + 1).
import type {Battle, Pokemon, Side} from '@pkmn/sim';

const up = (id: string | undefined | null) => (id || '').toUpperCase();

const STATUS: Record<string, string> = {
  '': 'NONE', brn: 'BURN', slp: 'SLEEP', frz: 'FREEZE', par: 'PARALYZE', psn: 'POISON', tox: 'TOXIC',
};
const WEATHER: Record<string, string> = {
  '': 'NONE', sunnyday: 'SUN', raindance: 'RAIN', sandstorm: 'SAND', hail: 'HAIL', snowscape: 'SNOW',
  snow: 'SNOW', desolateland: 'HARSHSUN', primordialsea: 'HEAVYRAIN', deltastream: 'DELTASTREAM',
};
const TERRAIN: Record<string, string> = {
  '': 'NONE', electricterrain: 'ELECTRICTERRAIN', psychicterrain: 'PSYCHICTERRAIN',
  mistyterrain: 'MISTYTERRAIN', grassyterrain: 'GRASSYTERRAIN',
};

// poke-engine `PokemonVolatileStatus` variants (gen9 build) that correspond to
// sim volatile ids of the same spelling. Anything else is dropped.
const ENGINE_VOLATILES = new Set(`AQUARING ATTRACT AUTOTOMIZE BANEFULBUNKER BIDE BOUNCE BURNINGBULWARK CHARGE
CONFUSION CURSE DEFENSECURL DESTINYBOND DIG DISABLE DIVE ELECTRIFY ELECTROSHOT EMBARGO ENCORE ENDURE FLASHFIRE
FLINCH FLY FOCUSENERGY FOLLOWME FORESIGHT FREEZESHOCK GASTROACID GEOMANCY GLAIVERUSH GRUDGE HEALBLOCK
HELPINGHAND ICEBURN IMPRISON INGRAIN KINGSSHIELD LASERFOCUS LEECHSEED LIGHTSCREEN LOCKEDMOVE MAGICCOAT
MAGNETRISE MAXGUARD METEORBEAM MINIMIZE MIRACLEEYE MUSTRECHARGE NIGHTMARE NORETREAT OCTOLOCK PARTIALLYTRAPPED
PHANTOMFORCE POWDER POWERSHIFT POWERTRICK PROTECT RAGE RAGEPOWDER RAZORWIND REFLECT ROOST SALTCURE SHADOWFORCE
SKULLBASH SKYATTACK SKYDROP SILKTRAP SLOWSTART SMACKDOWN SNATCH SOLARBEAM SOLARBLADE SPARKLINGARIA SPIKYSHIELD
SPOTLIGHT STOCKPILE SUBSTITUTE SYRUPBOMB TARSHOT TAUNT TELEKINESIS THROATCHOP TRUANT TORMENT TYPECHANGE
UNBURDEN UPROAR YAWN TRAPPED`.split(/\s+/));

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (b: unknown) => (b ? 'true' : 'false');

interface SideCtx {
  /**
   * sim says this side must send a switch while its active is still standing
   * (U-turn, Eject Button, …). A fainted active is left to the engine, which
   * infers the switch from hp <= 0 and, unlike the explicit flag, handles a
   * double KO where both sides switch at once.
   */
  forceSwitch: boolean;
}

function serializeMove(slot: {id: string; pp: number; disabled: boolean | string} | undefined): string {
  if (!slot) return 'NONE;true;0';
  return `${up(slot.id)};${bool(slot.disabled)};${Math.max(0, num(slot.pp))}`;
}

function serializePokemon(p: Pokemon): string {
  const set = p.set as {nature?: string; evs?: Partial<Record<string, number>>};
  const evs = set.evs || {};
  const evStr = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => num(evs[k])).join(';');
  const stats = p.storedStats;

  const status = STATUS[p.status] ?? 'NONE';
  let restTurns = 0;
  let sleepTurns = 0;
  if (p.status === 'slp') {
    const st = p.statusState as {time?: number; startTime?: number};
    const remaining = num(st.time);
    const fromRest = p.lastMove?.id === 'rest' && num(st.startTime) === 3;
    if (fromRest) restTurns = remaining;
    else sleepTurns = Math.max(0, num(st.startTime) - remaining);
  }

  // A Mega Stone the sim will no longer honour (a teammate already Mega
  // Evolved) must not look usable to the engine, which keys Mega legality off
  // the held item alone.
  let item = p.item ? up(p.item) : 'NONE';
  const stoneSpent = !p.species.isMega && p.item && !p.canMegaEvo && p.battle.dex.items.get(p.item).megaStone;
  if (stoneSpent) item = 'NONE';

  const types = [up(p.types[0]), up(p.types[1] ?? 'Typeless')];
  const baseTypes = [up(p.species.types[0]), up(p.species.types[1] ?? 'Typeless')];
  const moves = [0, 1, 2, 3].map((i) => serializeMove(p.moveSlots[i]));

  return [
    up(p.species.id),
    p.level,
    ...types,
    ...baseTypes,
    p.hp,
    p.maxhp,
    up(p.ability) || 'NONE',
    up(p.baseAbility) || 'NONE',
    item,
    up(set.nature) || 'SERIOUS',
    evStr,
    stats.atk, stats.def, stats.spa, stats.spd, stats.spe,
    status,
    restTurns,
    sleepTurns,
    (p.weighthg / 10).toFixed(1),
    ...moves,
    bool(p.species.isMega),
    'false',
    up(p.teraType) || 'NORMAL',
  ].join(',');
}

function sideConditions(side: Side, active: Pokemon | undefined): string {
  const sc = side.sideConditions as Record<string, {duration?: number; layers?: number} | undefined>;
  const slot = (side.slotConditions[0] ?? {}) as Record<string, unknown>;
  const dur = (id: string) => num(sc[id]?.duration);
  const layers = (id: string) => num(sc[id]?.layers);
  const present = (id: string) => (sc[id] ? 1 : 0);
  // Showdown's `stall` counter is 3^n for n consecutive protects; the engine wants n.
  const stall = (active?.volatiles as Record<string, {counter?: number}> | undefined)?.stall;
  const protect = stall ? Math.round(Math.log(Math.max(1, num(stall.counter, 1))) / Math.log(3)) : 0;
  const toxicCount = active?.status === 'tox' ? num((active.statusState as {stage?: number}).stage) : 0;
  return [
    dur('auroraveil'), present('craftyshield'), slot.healingwish ? 1 : 0, dur('lightscreen'),
    dur('luckychant'), slot.lunardance ? 1 : 0, present('matblock'), dur('mist'), protect,
    present('quickguard'), dur('reflect'), dur('safeguard'), layers('spikes'), present('stealthrock'),
    present('stickyweb'), dur('tailwind'), toxicCount, layers('toxicspikes'), present('wideguard'),
  ].join(';');
}

function volatiles(active: Pokemon | undefined): {names: string[]; durations: string; substituteHp: number} {
  const names: string[] = [];
  const d = {confusion: 0, encore: 0, lockedmove: 0, slowstart: 0, taunt: 0, yawn: 0};
  let substituteHp = 0;
  if (active) {
    const vols = active.volatiles as Record<string, {duration?: number; time?: number; move?: string; bestStat?: string; hp?: number}>;
    for (const [id, v] of Object.entries(vols)) {
      switch (id) {
        case 'perishsong': names.push(`PERISH${Math.min(4, Math.max(1, num(v.duration, 4)))}`); break;
        case 'protosynthesis':
        case 'quarkdrive': names.push(`${up(id)}${up(v.bestStat)}`); break;
        case 'twoturnmove': if (ENGINE_VOLATILES.has(up(v.move))) names.push(up(v.move)); break;
        case 'substitute': names.push('SUBSTITUTE'); substituteHp = num(v.hp); break;
        // Engine counts turns elapsed for these; the sim stores turns remaining.
        case 'encore': names.push('ENCORE'); d.encore = Math.max(0, 3 - num(v.duration, 3)); break;
        case 'taunt': names.push('TAUNT'); d.taunt = Math.max(0, 3 - num(v.duration, 3)); break;
        case 'lockedmove': names.push('LOCKEDMOVE'); d.lockedmove = Math.max(0, 2 - num(v.duration, 2)); break;
        case 'yawn': names.push('YAWN'); d.yawn = Math.max(0, 2 - num(v.duration, 2)); break;
        case 'slowstart': names.push('SLOWSTART'); d.slowstart = num(v.duration); break;
        case 'confusion': names.push('CONFUSION'); d.confusion = num(v.time); break;
        case 'stall': break; // handled as the protect side condition
        default: if (ENGINE_VOLATILES.has(up(id))) names.push(up(id));
      }
    }
  }
  const durations = [d.confusion, d.encore, d.lockedmove, d.slowstart, d.taunt, d.yawn].join(';');
  return {names: [...new Set(names)], durations, substituteHp};
}

function lastUsedMove(active: Pokemon | undefined, activeIndex: number): string {
  if (!active || active.activeMoveActions === 0) return `switch:${activeIndex}`;
  const id = active.lastMove?.id;
  const i = id ? active.moveSlots.findIndex((m) => m.id === id) : -1;
  return i >= 0 ? `move:${i}` : 'move:none';
}

function serializeSide(side: Side, opponent: Side, ctx: SideCtx): string {
  if (side.pokemon.length !== 6) throw new Error(`${side.id} has ${side.pokemon.length} Pokémon; the engine needs 6`);
  const active = side.active[0] ?? undefined;
  const activeIndex = Math.max(0, active ? side.pokemon.indexOf(active) : 0);
  const boosts = active?.boosts ?? {};
  const vol = volatiles(active);

  const slot = (side.slotConditions[0] ?? {}) as Record<string, {duration?: number; hp?: number} | undefined>;
  const wish = slot.wish ? [num(slot.wish.duration), Math.floor(num(slot.wish.hp))] : [0, 0];

  // The engine stores Future Sight on the *user's* side; the sim stores it on
  // the target's slot with the user as `source`.
  let futureSight = [0, 0];
  const incoming = (opponent.slotConditions[0] ?? {}) as Record<string, {duration?: number; source?: Pokemon} | undefined>;
  const fm = incoming.futuremove;
  if (fm?.source && fm.source.side === side) {
    futureSight = [num(fm.duration), Math.max(0, side.pokemon.indexOf(fm.source))];
  }

  const forceSwitch = ctx.forceSwitch && !!active && active.hp > 0;
  // `pokemon.trapped` is only refreshed when the sim builds a move request,
  // so it is stale on a switch request (and meaningless once fainted).
  const trapped = !!active && active.hp > 0 && active.trapped === true && !ctx.forceSwitch;

  return [
    ...side.pokemon.map(serializePokemon),
    activeIndex,
    sideConditions(side, active),
    vol.names.join(':'),
    vol.durations,
    vol.substituteHp,
    num((boosts as Record<string, number>).atk), num((boosts as Record<string, number>).def),
    num((boosts as Record<string, number>).spa), num((boosts as Record<string, number>).spd),
    num((boosts as Record<string, number>).spe), num((boosts as Record<string, number>).accuracy),
    num((boosts as Record<string, number>).evasion),
    wish[0], wish[1],
    futureSight[0], futureSight[1],
    bool(forceSwitch),
    'NONE',
    'false',
    'false',
    bool(trapped),
    lastUsedMove(active, activeIndex),
    'false',
  ].join('=');
}

export interface StateOptions {
  p1ForceSwitch?: boolean;
  p2ForceSwitch?: boolean;
}

/** Serialize the whole battle for poke-engine, side one = p1, side two = p2. */
export function battleToEngineState(battle: Battle, opts: StateOptions = {}): string {
  const [p1, p2] = battle.sides;
  const field = battle.field;
  const weather = `${WEATHER[field.weather] ?? 'NONE'};${num(field.weatherState.duration)}`;
  const terrain = `${TERRAIN[field.terrain] ?? 'NONE'};${num(field.terrainState.duration)}`;
  const tr = (field.pseudoWeather as Record<string, {duration?: number} | undefined>).trickroom;
  const trickRoom = `${bool(tr)};${num(tr?.duration)}`;
  return [
    serializeSide(p1, p2, {forceSwitch: !!opts.p1ForceSwitch}),
    serializeSide(p2, p1, {forceSwitch: !!opts.p2ForceSwitch}),
    weather,
    terrain,
    trickRoom,
    'false',
  ].join('/');
}
