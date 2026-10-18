// Hosted Showdown replay embed, carried over from v1's app.js (replayDoc +
// boss avatar rewrite + sizing/lazy-load helpers). Dev-only dependency on
// play.pokemonshowdown.com; the distribution decision is deferred.

/* Showdown's replay player resolves a named avatar to
   https://play.pokemonshowdown.com/sprites/trainers/<name>.png. Bosses named
   after canonical trainers map directly; themed teams get a stable pick from a
   pool of valid avatars (deterministic per name so rewatches stay consistent). */
const CANON_AVATARS: Record<string, string> = {
  cynthia: 'cynthia', lance: 'lance', steven: 'steven', wallace: 'wallace', diantha: 'diantha',
  leon: 'leon', geeta: 'geeta', red: 'red', blue: 'blue', silver: 'silver',
  gold: 'ethan', ethan: 'ethan', giovanni: 'giovanni', archie: 'archie-gen6', maxie: 'maxie-gen6',
  cyrus: 'cyrus', ghetsis: 'ghetsis', lysandre: 'lysandre', guzma: 'guzma', marnie: 'marnie',
  raihan: 'raihan', nessa: 'nessa', n: 'n', alder: 'alder', caitlin: 'caitlin', grimsley: 'grimsley',
  ash: 'ash', zinnia: 'zinnia', emma: 'emma',
};
const THEME_AVATARS = ['lance', 'steven', 'wallace', 'diantha', 'cynthia', 'red', 'blue', 'silver',
  'guzma', 'raihan', 'nessa', 'marnie', 'grimsley', 'caitlin', 'leon', 'geeta', 'giovanni', 'zinnia', 'emma'];

export function bossAvatar(name: string): string {
  const tokens = (name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) if (CANON_AVATARS[t]) return CANON_AVATARS[t];
  const norm = tokens.join('') || 'x';
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) >>> 0;
  return THEME_AVATARS[h % THEME_AVATARS.length];
}

/** Rewrite the boss's `|player|` line to carry a real trainer sprite. */
export function withBossAvatar(log: string[], bossName: string, playerName: string): string[] {
  const avatar = bossAvatar(bossName);
  return log.map((line) => {
    if (!line.startsWith('|player|')) return line;
    const p = line.split('|'); // ["", "player", "p2", "Name", "avatar", ...]
    if (p[3] === playerName) return line; // leave the human player's sprite alone
    while (p.length < 5) p.push('');
    p[4] = avatar;
    return p.join('|');
  });
}

export const esc = (v: unknown) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Self-contained srcdoc for an iframe running the hosted replay player. */
export function replayDoc(log: string[], bossName: string, playerName: string): string {
  const protocol = esc(withBossAvatar(log, bossName, playerName).join('\n'));
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;font-family:Verdana,sans-serif;background:#f5f7fb}.wrapper{max-width:1180px;margin:0 auto}</style>
<div class="wrapper replay-wrapper"><div class="battle"></div><div class="battle-log"></div>
<div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data">${protocol}<\/script></div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"><\/script>`;
}

/* The replay is a srcdoc iframe (same-origin), so size it to its real content
   instead of a fixed height. replay-embed.js renders asynchronously, so
   re-measure for a short window. */
export function fitReplayFrame(f: HTMLIFrameElement): void {
  try {
    const doc = f.contentDocument;
    if (!doc || !doc.body) return;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    if (h > 0) f.style.height = `${h}px`;
  } catch { /* if ever cross-origin, keep the CSS fallback height */ }
}

export function fitReplayFrameOnLoad(f: HTMLIFrameElement): void {
  f.addEventListener('load', () => {
    fitReplayFrame(f);
    let n = 0;
    const id = setInterval(() => { fitReplayFrame(f); if (++n >= 24) clearInterval(id); }, 250);
    try { new ResizeObserver(() => fitReplayFrame(f)).observe(f.contentDocument!.documentElement); } catch { /* ignore */ }
  });
}

/* Build the replay iframe only once it is on-screen (and thus laid out), so
   the Showdown player initialises with real dimensions instead of blank. */
export function lazyLoadReplay(iframe: HTMLIFrameElement, doc: string): void {
  let loaded = false;
  const load = () => { if (!loaded) { loaded = true; iframe.srcdoc = doc; } };
  if (!('IntersectionObserver' in globalThis)) { load(); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { load(); io.disconnect(); break; }
  }, {root: null, threshold: 0.01});
  io.observe(iframe);
}

/** Create a replay iframe for a finished battle's protocol log. */
export function mountReplay(container: HTMLElement, log: string[], bossName: string, playerName: string): HTMLIFrameElement {
  const f = document.createElement('iframe');
  f.className = 'replay-frame';
  f.title = `${playerName} vs ${bossName} replay`;
  f.style.cssText = 'width:100%;height:620px;border:0;background:#f5f7fb;display:block';
  fitReplayFrameOnLoad(f);
  container.appendChild(f);
  lazyLoadReplay(f, replayDoc(log, bossName, playerName));
  return f;
}
