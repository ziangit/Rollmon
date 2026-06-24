/* =====================================================================
   STATE + API  (same contract as the original harness)
   ===================================================================== */
const state = { sessionId:null, bosses:[], teamExport:"", gauntletRunning:false, matrix:null, draft:null };
const MIN_BOSSES = 1, MAX_BOSSES = 10;

async function api(path, options={}){
  const r = await fetch(path,{headers:{"Content-Type":"application/json"},...options});
  const payload = await r.json();
  if(!r.ok) throw new Error(payload.detail || "Request failed");
  return payload;
}

/* =====================================================================
   ROUTER
   ===================================================================== */
const SCREENS = ["title","draft","loadout","bosses","battle","results","pool"];
let currentScreen = "title";
let poolReturn = "title";
function go(name){
  if(name==="pool" && currentScreen!=="pool") poolReturn = currentScreen;
  currentScreen = name;
  SCREENS.forEach(s=>document.getElementById("screen-"+s).classList.toggle("active", s===name));
  document.getElementById("topbar").classList.toggle("hidden", name==="title");
  if(name==="loadout") renderLoadout();
  // On the pool screen keep the step rail reflecting where Back will return to,
  // so the chips stay meaningful and clickable.
  updateSteps(name==="pool" ? poolReturn : name);
  const pokedexBtn = document.getElementById("pokedex-btn");
  if(pokedexBtn) pokedexBtn.textContent = name==="pool" ? "← Back" : "Pokédex";
  try{ localStorage.setItem("rollmons-screen", name); }catch(e){}
  window.scrollTo(0,0);
}
function togglePool(){ go(currentScreen==="pool" ? (poolReturn || "title") : "pool"); }
// Topbar steps are progress indicators only — navigation is via the in-screen
// buttons, so the player can't jump back mid-run to restart the fight.
function jumpToReplay(bid){
  go("battle");
  setTimeout(()=>{
    const el=document.querySelector(`#theater [data-bid="${bid}"]`);
    if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
  },60);
}
function updateSteps(name){
  const order = {draft:0,loadout:1,bosses:2,battle:3,results:4};
  const cur = order[name];
  document.querySelectorAll("#steps .step").forEach(el=>{
    const i = order[el.dataset.step];
    el.classList.toggle("active", el.dataset.step===name);
    el.classList.toggle("done", cur!==undefined && i<cur);
  });
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function esc(v){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}
function titleCase(v){return String(v).replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase());}
function typeChips(p){
  const t = (p.types||[]).map(x=>`<span class="chip t-${x.toLowerCase()}">${x}</span>`).join("");
  return t + (p.legendary?`<span class="chip legend">Legendary</span>`:"");
}
const TYPE_COLORS={bug:"#92bc2c",dark:"#595761",dragon:"#0c69c8",electric:"#eab911",fairy:"#ee90e6",
  fighting:"#d3425f",fire:"#fba54c",flying:"#7ab9e0",ghost:"#5f6dbc",grass:"#5fbd58",ground:"#da7c4d",
  ice:"#75d0c1",normal:"#a0a29f",poison:"#b763cf",psychic:"#fa8581",rock:"#c9bb8a",steel:"#5695a3",water:"#539ddf"};
function typeColor(t){return TYPE_COLORS[String(t).toLowerCase()]||"var(--ink)";}
function tintFor(p){
  const t=(p.types&&p.types[0]||"normal").toLowerCase();
  return `color-mix(in oklch, var(--t-seed,#888) 18%, transparent)`;
}
function fixImages(root){
  root.querySelectorAll(".asset").forEach(img=>{
    const hide=()=>{const f=img.closest(".asset-host"); if(f) f.classList.add("asset-failed"); img.remove();};
    img.addEventListener("error",hide,{once:true});
    if(img.complete && img.naturalWidth===0) hide();
  });
}
function sprite(p,cls=""){
  return `<span class="asset-host ${cls}"><img class="asset" src="${p.sprite_url||""}" alt="" loading="lazy"></span>`;
}

/* =====================================================================
   DRAFT
   ===================================================================== */
function renderDraft(draft){
  state.sessionId = draft.session_id;
  state.draft = draft;
  const ds = document.getElementById("draft-status");
  if(ds) ds.textContent = "";
  state.teamExport = draft.complete ? (draft.team_export||"") : "";
  const copyBtn = document.getElementById("copy-export");
  if(copyBtn) copyBtn.disabled = !state.teamExport;

  renderPips(draft);
  renderParty(draft.team, "party");
  document.getElementById("party-count").textContent = `${draft.team.length} / 6 drafted`;

  const live = document.getElementById("draft-live");
  const done = document.getElementById("draft-done");
  if(draft.complete){
    live.classList.add("hidden"); done.classList.remove("hidden");
    renderParty(draft.team, "party-done");
    // remember the assembled team so the gauntlet & battle screens have it
    state.team = draft.team;
    return;
  }
  live.classList.remove("hidden"); done.classList.add("hidden");
  renderEncounter(draft);
  renderCandidates(draft.offer, draft);
}
function renderPips(draft){
  const filled = draft.team.length;
  const pips = document.getElementById("pips");
  pips.innerHTML = Array.from({length:6},(_,i)=>{
    const cls = i<filled?"filled":(i===filled && !draft.complete?"current":"");
    return `<span class="pip ${cls}"></span>`;
  }).join("");
  const rl = document.getElementById("round-label");
  rl.textContent = draft.complete ? "Complete" : `Round ${draft.offer.round_number} of 6`;
}
function renderEncounter(draft){
  const o = draft.offer;
  const totalSkips = draft.draft_config.manual_skip_count;
  const thin = o.thin_reroll_available
    ? `<button class="btn btn-warn btn-sm" onclick="thinReroll()">↻ Free re-spin</button>` : "";
  document.getElementById("encounter").innerHTML = `
    <div>
      <p class="eyebrow" style="margin:0 0 .25rem">Wild cell</p>
      <div class="cell-name"><span style="color:${typeColor(o.cell.type)}">${titleCase(o.cell.type)}</span> · Gen ${o.cell.generation}</div>
      ${o.thin_reroll_available?`<p class="thin-note">Thin cell — fewer than ${o.thin_cell_threshold} choices left, this re-spin is free.</p>`:""}
    </div>
    <div class="encounter-actions">
      ${thin}
      <button class="btn btn-ghost btn-sm" onclick="skip()" ${draft.skips_remaining?"":"disabled"}>
        Skip cell (${draft.skips_remaining}/${totalSkips})
      </button>
    </div>`;
}
// Full PokéPaste text. Smogon/override sets ship .export; randbats sets don't,
// so build one from the parsed fields + the neutral assembly spread.
function pokepaste(name, set, spread){
  if(set && set.export) return set.export;
  const lines=[`${titleCase(name)}${set&&set.item?` @ ${titleCase(set.item)}`:""}`];
  if(set&&set.ability) lines.push(`Ability: ${titleCase(set.ability)}`);
  if(spread){
    lines.push(`Level: ${spread.level}`);
    const ev=spread.evs?Object.entries(spread.evs).map(([k,v])=>`${v} ${k}`).join(" / "):"";
    if(ev) lines.push(`EVs: ${ev}`);
    if(spread.nature) lines.push(`${spread.nature} Nature`);
  }
  ((set&&set.moves)||[]).forEach(m=>lines.push(`- ${titleCase(m)}`));
  return lines.join("\n");
}
function setSummary(p){
  return `<div class="setbox"><pre class="pokepaste-set">${esc(pokepaste(p.name,p.randbats_set,p.assembly_spread))}</pre></div>`;
}
function renderCandidates(offer, draft){
  const root = document.getElementById("candidates");
  root.innerHTML = offer.candidates.map(p=>{
    const prob = (p.selection_probability*100);
    return `
    <article class="mon">
      <div class="mon-top">
        <span class="mon-badge">Gen ${p.debut_generation} · BST ${p.base_stat_total}</span>
        <div class="sprite-frame">${sprite(p)}</div>
        <div class="mon-name">${titleCase(p.name)}</div>
        <div class="chips">${typeChips(p)}</div>
      </div>
      <div class="mon-body">
        <div class="prob" title="Draft odds">
          <span>Odds</span>
          <span class="bar"><i style="width:${Math.min(100,prob)}%"></i></span>
          <span class="mono">${prob.toFixed(1)}%</span>
        </div>
        ${setSummary(p)}
      </div>
      <button class="btn btn-primary pick" onclick="pick('${p.id}')">Pick ${titleCase(p.name)}</button>
    </article>`;
  }).join("");
  fixImages(root);
}
function renderParty(team, targetId){
  const root = document.getElementById(targetId);
  const slots = [...team]; while(slots.length<6) slots.push(null);
  root.innerHTML = slots.map((p,i)=> p
    ? `<li class="slot"><span class="mini">${sprite(p)}</span>
         <span class="info"><strong>${titleCase(p.name)}</strong>
         <span>Gen ${p.debut_generation} · BST ${p.base_stat_total}</span></span></li>`
    : `<li class="slot empty"><span class="pokeball ball"></span><span class="info"><strong>Slot ${i+1}</strong><span>Empty</span></span></li>`
  ).join("");
  fixImages(root);
}

async function newRun(){
  go("draft");
  document.getElementById("encounter").innerHTML = `<div><p class="lead">Rolling the first cell…</p></div>`;
  try{ renderDraft(await api("/api/drafts",{method:"POST",body:JSON.stringify({level:100})})); }
  catch(e){ document.getElementById("encounter").innerHTML = `<div><p class="lead">${esc(e.message)}</p></div>`; }
}
function draftError(e){
  const el = document.getElementById("draft-status");
  if(el) el.textContent = e.message || "Request failed — is the backend running?";
}
async function pick(id){
  try{ renderDraft(await api(`/api/drafts/${state.sessionId}/pick`,{method:"POST",body:JSON.stringify({species_id:id})})); }
  catch(e){ draftError(e); }
}
async function skip(){
  try{ renderDraft(await api(`/api/drafts/${state.sessionId}/skip`,{method:"POST"})); }
  catch(e){ draftError(e); }
}
async function thinReroll(){
  try{ renderDraft(await api(`/api/drafts/${state.sessionId}/thin-reroll`,{method:"POST"})); }
  catch(e){ draftError(e); }
}

async function copyExport(){
  if(!state.teamExport) return;
  try{ await navigator.clipboard.writeText(state.teamExport);
    document.querySelectorAll("#copy-export").forEach(b=>{const t=b.textContent;b.textContent="Copied ✓";setTimeout(()=>b.textContent=t,1200);});
  }catch(e){}
}

/* =====================================================================
   LOADOUT  (choose one set per drafted Pokémon; Mega is opt-in)
   ===================================================================== */
function renderLoadout(){
  const draft = state.draft;
  const list = document.getElementById("loadout-list");
  if(!draft || !draft.loadout){ list.innerHTML = ""; return; }
  list.innerHTML = draft.loadout.map(entry=>{
    const chosen = entry.sets.find(s=>s.set_id===entry.chosen_set_id) || entry.sets[0];
    const opts = entry.sets.map(s=>
      `<option value="${s.set_id}"${s.set_id===chosen.set_id?" selected":""}>${esc(s.label)}${s.is_mega?" ⚡ Mega":""}</option>`
    ).join("");
    const picker = (entry.sets.length>1 && !entry.locked)
      ? `<select class="set-select" onchange="chooseSet('${entry.species_id}',this.value)">${opts}</select>`
      : `<span class="set-only">${esc(chosen.label)}${chosen.is_mega?" ⚡ Mega":""}</span>`;
    return `
      <article class="loadout-card card">
        <div class="loadout-head"><span class="mini">${sprite(entry)}</span><strong>${titleCase(entry.name)}</strong></div>
        <label class="field set-field">Set ${picker}</label>
        <div class="setbox"><pre class="pokepaste-set">${esc(pokepaste(entry.name, chosen, null))}</pre></div>
      </article>`;
  }).join("");
  fixImages(list);
}
async function chooseSet(speciesId, setId){
  const status = document.getElementById("loadout-status");
  try{
    const draft = await api(`/api/drafts/${state.sessionId}/loadout`,
      {method:"POST", body:JSON.stringify({species_id:speciesId, set_id:setId})});
    state.draft = draft; state.teamExport = draft.team_export || "";
    renderLoadout();
    if(status) status.textContent = "";
  }catch(e){ if(status) status.textContent = e.message; }
}

/* =====================================================================
   BOSSES
   ===================================================================== */
function bossName(b){ return b.source==="custom"?`${b.name} (pasted)`:b.source==="edited"?`${b.name} (edited)`:b.name; }
function renderBosses(bosses){
  state.bosses = bosses;
  const ladder = document.getElementById("ladder");
  ladder.innerHTML = bosses.map((b,i)=>`
    <li class="boss" draggable="true" data-index="${i}">
      <span class="handle" aria-hidden="true">⠿</span>
      <span class="num">${i+1}</span>
      <span class="bname">${esc(b.name)}</span>
      ${b.source==="custom"||b.source==="edited"?`<span class="tag">${b.source}</span>`:""}
      <span class="acts">
        <button class="btn btn-ghost btn-sm" onclick="editBoss(${i})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="discardBoss(${i})" ${bosses.length<=MIN_BOSSES?"disabled":""}>✕</button>
      </span>
    </li>`).join("");
  wireDrag(ladder);
  // advanced select
  const sel = document.getElementById("boss-select");
  if(sel) sel.replaceChildren(...bosses.map(b=>{const o=document.createElement("option");o.value=b.id;o.textContent=bossName(b);return o;}));
  const runBtn=document.getElementById("run-btn"), exBtn=document.getElementById("exhibition-btn");
  if(runBtn) runBtn.disabled = bosses.length===0;
  if(exBtn) exBtn.disabled = bosses.length===0;
  if(bosses.length===0) document.getElementById("boss-status").textContent="No bosses found under rollmons/bosses/.";
}
function wireDrag(root){
  root.querySelectorAll(".boss").forEach(item=>{
    item.addEventListener("dragstart",e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",item.dataset.index);item.classList.add("dragging");});
    item.addEventListener("dragend",()=>item.classList.remove("dragging"));
    item.addEventListener("dragover",e=>{e.preventDefault();item.classList.add("drag-over");});
    item.addEventListener("dragleave",()=>item.classList.remove("drag-over"));
    item.addEventListener("drop",e=>{e.preventDefault();root.querySelectorAll(".drag-over").forEach(r=>r.classList.remove("drag-over"));
      moveBoss(Number(e.dataTransfer.getData("text/plain")),Number(item.dataset.index));});
  });
}
function moveBoss(from,to){
  if(Number.isNaN(from)||Number.isNaN(to)||from===to) return;
  const b=[...state.bosses]; const [m]=b.splice(from,1); b.splice(to,0,m); renderBosses(b);
}
function discardBoss(i){
  if(state.bosses.length<=MIN_BOSSES){document.getElementById("boss-form-status").textContent="At least one boss must remain.";return;}
  renderBosses(state.bosses.filter((_,j)=>j!==i)); resetBossForm();
}
async function editBoss(i){
  const b=state.bosses[i]; const st=document.getElementById("boss-form-status"); st.textContent=`Loading ${b.name}…`;
  try{
    const d=await api(`/api/bosses/${b.id}`);
    document.getElementById("boss-id").value=d.id;
    document.getElementById("boss-name").value=d.name;
    document.getElementById("boss-export").value=d.export;
    document.getElementById("boss-form-title").textContent=`Edit ${d.name}`;
    document.getElementById("boss-save").textContent="Save boss";
    document.getElementById("boss-cancel").classList.remove("hidden");
    st.textContent="Validate and save to apply.";
  }catch(e){st.textContent=e.message;}
}
function resetBossForm(){
  document.getElementById("boss-form").reset();
  document.getElementById("boss-id").value="";
  document.getElementById("boss-form-title").textContent="Add a boss";
  document.getElementById("boss-save").textContent="Add boss";
  document.getElementById("boss-cancel").classList.add("hidden");
}
async function saveBoss(e){
  e.preventDefault();
  const st=document.getElementById("boss-form-status");
  const id=document.getElementById("boss-id").value;
  const name=document.getElementById("boss-name").value.trim();
  const exp=document.getElementById("boss-export").value.trim();
  if(!name||!exp){st.textContent="Name and export are required.";return;}
  if(!id && state.bosses.length>=MAX_BOSSES){st.textContent=`A run can hold at most ${MAX_BOSSES} bosses.`;return;}
  st.textContent="Validating…";
  try{
    const boss=await api(id?`/api/bosses/${id}`:"/api/bosses/custom",{method:id?"PUT":"POST",body:JSON.stringify({name,export:exp})});
    renderBosses(id?state.bosses.map(b=>b.id===boss.id?boss:b):[...state.bosses,boss]);
    resetBossForm(); st.textContent=id?`Saved ${boss.name}.`:`Added ${boss.name}.`;
  }catch(err){st.textContent=`Does not validate: ${err.message}`;}
}

/* =====================================================================
   RUN / BATTLE  (Showdown replay viewport untouched)
   ===================================================================== */
/* Opponent trainer sprite: Showdown's replay player resolves a named avatar to
   https://play.pokemonshowdown.com/sprites/trainers/<name>.png. Bosses named after
   canonical trainers map directly; themed teams get a stable pick from a pool of
   valid avatars (deterministic per name so rewatches stay consistent). */
const CANON_AVATARS={                       // boss-name keyword -> verified sprite filename
  cynthia:"cynthia",lance:"lance",steven:"steven",wallace:"wallace",diantha:"diantha",
  leon:"leon",geeta:"geeta",red:"red",blue:"blue",silver:"silver",
  gold:"ethan",ethan:"ethan",giovanni:"giovanni",archie:"archie-gen6",maxie:"maxie-gen6",
  cyrus:"cyrus",ghetsis:"ghetsis",lysandre:"lysandre",guzma:"guzma",marnie:"marnie",
  raihan:"raihan",nessa:"nessa",n:"n",alder:"alder",caitlin:"caitlin",grimsley:"grimsley",
  ash:"ash",zinnia:"zinnia",emma:"emma"};
const THEME_AVATARS=["lance","steven","wallace","diantha","cynthia","red","blue","silver",
  "guzma","raihan","nessa","marnie","grimsley","caitlin","leon","geeta","giovanni","zinnia","emma"];
function bossAvatar(name){
  const tokens=(name||"").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for(const t of tokens){ if(CANON_AVATARS[t]) return CANON_AVATARS[t]; }
  const norm=tokens.join("")||"x";
  let h=0; for(let i=0;i<norm.length;i++) h=(h*31+norm.charCodeAt(i))>>>0;
  return THEME_AVATARS[h%THEME_AVATARS.length];
}
function withBossAvatar(log,bossName,playerName){
  const avatar=bossAvatar(bossName);
  return (log||[]).map(line=>{
    if(!line.startsWith("|player|")) return line;
    const p=line.split("|");            // ["","player","p2","Name","avatar",...]
    if(p[3]===playerName) return line;   // leave the human player's sprite alone
    p[4]=avatar;
    return p.join("|");
  });
}
function replayDoc(log,bossName,playerName){
  log=withBossAvatar(log,bossName,playerName);
  const protocol = esc((log||[]).join("\n"));
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;font-family:Verdana,sans-serif;background:#f5f7fb}.wrapper{max-width:1180px;margin:0 auto}</style>
<div class="wrapper replay-wrapper"><div class="battle"></div><div class="battle-log"></div>
<div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data">${protocol}<\/script></div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"><\/script>`;
}
function renderRail(gauntlet){
  const rail=document.getElementById("rail");
  if(!gauntlet||!gauntlet.bosses||!gauntlet.bosses.length){rail.innerHTML="";return;}
  rail.innerHTML = gauntlet.bosses.map((b,i)=>{
    const r=gauntlet.results[i];
    let cls="",label="Waiting";
    if(r){cls=r.winner==="player"?"win":r.winner==="boss"?"loss":"tie";label=`${r.turns}t`;}
    else if(b.current){cls="current";label="Now";}
    return `<li class="${cls}"><span class="dot"></span><span>${i+1}. ${esc(b.name)}</span><small>${label}</small></li>`;
  }).join("");
}
function renderTheater(results){
  const theater=document.getElementById("theater");
  if(!results||!results.length){
    theater.innerHTML=`<div class="replay-card replay-placeholder"><div class="replay-ph"><div><div class="big">Waiting for the first battle…</div><div class="sm">Matchups stream in here as your team climbs the ladder.</div></div></div></div>`;
    return;
  }
  // The first real battle replaces the waiting placeholder.
  const placeholder=theater.querySelector(".replay-placeholder");
  if(placeholder) placeholder.remove();
  const seen=new Set([...theater.querySelectorAll("[data-bid]")].map(n=>n.dataset.bid));
  results.forEach((r,i)=>{
    if(seen.has(r.battle_id)) return;
    const cls=r.winner==="player"?"win":r.winner==="boss"?"loss":"tie";
    const resLabel=r.winner==="tie"?"Tie":`${r.winner==="player"?r.player_name:r.boss_name} wins`;
    const card=document.createElement("div");
    card.className="replay-card"; card.dataset.bid=r.battle_id;
    const hasLog = r.replay_log && r.replay_log.length;
    card.innerHTML=`
      <div class="replay-head">
        <h3>${esc(r.player_name)} <span style="color:var(--faint)">vs</span> ${esc(r.boss_name)}</h3>
        <span class="res ${cls}">${esc(resLabel)} · ${r.turns}t</span>
      </div>`;
    if(hasLog){
      const f=document.createElement("iframe"); f.className="replay-frame";
      f.title=`${r.player_name} vs ${r.boss_name} replay`; f.srcdoc=replayDoc(r.replay_log,r.boss_name,r.player_name);
      card.appendChild(f);
    }else{
      const ph=document.createElement("div"); ph.className="replay-ph";
      ph.innerHTML=`<div><div class="big">▶ Live Showdown replay renders here</div><div class="sm">Connect the backend to stream the full turn-by-turn battle. (${esc(resLabel)} in ${r.turns} turns.)</div></div>`;
      card.appendChild(ph);
    }
    theater.appendChild(card);
  });
}
function renderRun(draft){
  const g=draft.gauntlet;
  renderRail(g);
  const results = g&&g.results&&g.results.length ? g.results : (draft.battle_result?[draft.battle_result]:[]);
  if(results.length===0) document.getElementById("theater").innerHTML="";
  renderTheater(results);
  const matchTitle=document.getElementById("battle-lead");
  if(g&&!g.complete && g.bosses){
    const nb=g.bosses[g.next_index];
    if(nb) matchTitle.textContent=`Now battling ${nb.name} — ${g.next_index+1} of ${g.bosses.length}.`;
  }
  const toRes=document.getElementById("to-results");
  if(toRes) toRes.disabled = !(g&&g.complete);
}

function orderedBossIds(){ return state.bosses.map(b=>b.id); }

async function startRun(stopOnLoss){
  if(state.bosses.length<MIN_BOSSES){document.getElementById("boss-status").textContent="Add at least one boss first.";return;}
  go("battle");
  document.getElementById("battle-lead").textContent = stopOnLoss?"Climbing the ladder — one loss ends the run.":"Exhibition — playing every boss.";
  document.getElementById("theater").innerHTML="";
  state.gauntletRunning=true;
  try{
    const cur=await api(`/api/drafts/${state.sessionId}`);
    if(cur.gauntlet && cur.gauntlet.bosses.length && !cur.gauntlet.complete){ renderRun(cur); }
    else{
      renderRun(await api(`/api/drafts/${state.sessionId}/gauntlet/start`,{method:"POST",
        body:JSON.stringify({boss_ids:orderedBossIds(),stop_on_loss:stopOnLoss})}));
    }
    setTimeout(runNext,0);
  }catch(e){ document.getElementById("battle-lead").textContent=e.message; state.gauntletRunning=false; }
}
async function startCampaign(stopOnLoss){
  if(!state.sessionId){document.getElementById("boss-status").textContent="Draft a team first.";return;}
  go("battle");
  document.getElementById("battle-lead").textContent =
    "Tiered campaign — 10 battles, one random team drawn per level (level_6to9 gives 4).";
  document.getElementById("theater").innerHTML="";
  state.gauntletRunning=true;
  try{
    renderRun(await api(`/api/drafts/${state.sessionId}/campaign/start`,
      {method:"POST",body:JSON.stringify({stop_on_loss:stopOnLoss})}));
    setTimeout(runNext,0);
  }catch(e){ document.getElementById("battle-lead").textContent=e.message; state.gauntletRunning=false; }
}
async function runNext(){
  try{
    const cur=await api(`/api/drafts/${state.sessionId}`);
    if(cur.gauntlet.complete){ finishRun(cur); return; }
    renderRail(cur.gauntlet);
    const next=await api(`/api/drafts/${state.sessionId}/gauntlet/next`,{method:"POST"});
    renderRun(next);
    if(!next.gauntlet.complete){ if(state.gauntletRunning) setTimeout(runNext,650); }
    else finishRun(next);
  }catch(e){ document.getElementById("battle-lead").textContent=e.message; state.gauntletRunning=false; }
}
function finishRun(draft){
  state.gauntletRunning=false;
  renderRun(draft);
  document.getElementById("to-results").disabled=false;
  renderResults(draft.gauntlet);
  setTimeout(()=>go("results"),500);
}

async function battleOne(){
  const sel=document.getElementById("boss-select"); const id=sel&&sel.value;
  if(!id){document.getElementById("boss-status").textContent="Pick a boss to test.";return;}
  go("battle");
  document.getElementById("battle-lead").textContent="Single exhibition battle.";
  document.getElementById("theater").innerHTML="";
  try{ renderRun(await api(`/api/drafts/${state.sessionId}/battle`,{method:"POST",body:JSON.stringify({boss_id:id})})); }
  catch(e){ document.getElementById("battle-lead").textContent=e.message; }
}

/* =====================================================================
   RESULTS
   ===================================================================== */
function renderResults(g){
  if(!g||!g.results) return;
  const results=g.results, total=g.bosses.length;
  const wins=results.filter(r=>r.winner==="player").length;
  const losses=results.filter(r=>r.winner==="boss").length;
  const ties=results.filter(r=>r.winner==="tie").length;
  const avg=results.length?results.reduce((s,r)=>s+r.turns,0)/results.length:0;
  const cleared = wins===total;
  const lastLoss = g.stop_on_loss && results.length && results[results.length-1].winner!=="player";

  const hero=document.getElementById("result-hero");
  hero.className="result-hero "+(cleared?"victory":lastLoss?"defeat":"mixed");
  document.getElementById("result-eyebrow").textContent = `${total}-battle campaign`;
  document.getElementById("result-title").textContent = cleared?"Champion! 🏆":lastLoss?"Run ended":"Gauntlet complete";
  document.getElementById("result-record").textContent =
    `${wins}–${losses}${ties?`–${ties}`:""}  ·  cleared ${wins}/${total}  ·  ${avg.toFixed(1)} avg turns`;

  // the climb, as one pip per battle slot in run order
  document.getElementById("result-pips").innerHTML = g.bosses.map((b,i)=>{
    const r=results[i];
    const cls=!r?"pending":r.winner==="player"?"win":r.winner==="boss"?"loss":"tie";
    return `<span class="rpip ${cls}" title="${esc(b.name)}${r?` · ${r.winner} · ${r.turns}t`:""}"></span>`;
  }).join("");

  // sprite lookup from the drafted team (damage names are lowercase species names)
  const team=(state.draft&&state.draft.team)||state.team||[];
  const spriteByName={};
  team.forEach(p=>{ spriteByName[String(p.name).toLowerCase()]=p.sprite_url; });
  const dmg=g.damage||{by_pokemon:[],mvp:null};
  const mvpName=dmg.mvp&&dmg.mvp.name;
  const maxShare=Math.max(1,...dmg.by_pokemon.map(e=>e.contribution));

  document.getElementById("damage-bars").innerHTML = dmg.by_pokemon.length
    ? dmg.by_pokemon.map(e=>{
        const sp=spriteByName[String(e.name).toLowerCase()];
        const isMvp=e.name===mvpName && e.contribution>0;
        const w=Math.max(3,(e.contribution/maxShare)*100);
        return `<div class="dmg-row${isMvp?" mvp":""}">
          <span class="dmg-mon">${sp?sprite({sprite_url:sp},"mini"):`<span class="asset-host mini"></span>`}<span class="dmg-name">${titleCase(e.name)}${isMvp?`<span class="mvp-tag">MVP</span>`:""}</span></span>
          <span class="dmg-track"><i style="width:${w}%"></i></span>
          <span class="dmg-num"><b>${e.contribution.toFixed(1)}%</b><small>${e.damage.toFixed(0)}% dealt</small></span>
        </div>`;
      }).join("")
    : `<p class="panel-note" style="padding:.5rem">No damage was recorded this run.</p>`;
  fixImages(document.getElementById("damage-bars"));

  const mvpEl=document.getElementById("mvp-card");
  if(dmg.mvp){
    const sp=spriteByName[String(dmg.mvp.name).toLowerCase()];
    mvpEl.classList.remove("hidden");
    mvpEl.innerHTML=`<p class="eyebrow">Run MVP</p>
      <div class="mvp-body">
        ${sp?sprite({sprite_url:sp},"mvp-sprite"):""}
        <div class="mvp-meta">
          <strong>${titleCase(dmg.mvp.name)}</strong>
          <p class="mvp-share">${dmg.mvp.contribution.toFixed(1)}%</p>
          <p class="panel-note">of team damage · ${dmg.mvp.damage.toFixed(0)}% HP dealt</p>
        </div>
      </div>`;
    fixImages(mvpEl);
  } else { mvpEl.classList.add("hidden"); }

  document.getElementById("stat-tiles").innerHTML = `
    <div class="stat win"><div class="v">${wins}</div><div class="k">Wins</div></div>
    <div class="stat loss"><div class="v">${losses}</div><div class="k">Losses</div></div>
    ${ties?`<div class="stat"><div class="v">${ties}</div><div class="k">Ties</div></div>`:""}
    <div class="stat"><div class="v">${avg.toFixed(1)}</div><div class="k">Avg turns</div></div>`;

  document.getElementById("ladder-results").innerHTML = g.bosses.map((b,i)=>{
    const r=results[i];
    const cls=!r?"pending":r.winner==="player"?"win":r.winner==="boss"?"loss":"tie";
    const label=!r?"Not reached":r.winner==="tie"?"Tie":r.winner==="player"?"Win":"Loss";
    const attrs = r ? `onclick="jumpToReplay('${r.battle_id}')" title="Watch this battle" role="button" tabindex="0"` : "";
    return `<li class="ladder-row ${cls}${r?" clickable":""}" ${attrs}><span class="ln">${i+1}</span><span class="lname">${esc(b.name)}</span><span class="lres">${label}${r?` · ${r.turns}t`:""}</span></li>`;
  }).join("");
}

/* =====================================================================
   POOL / POKÉDEX MATRIX
   ===================================================================== */
function renderMatrix(){
  const m=state.matrix; const grid=document.getElementById("matrix");
  grid.innerHTML = `<div class="mhead">Type</div>` + m.generations.map(g=>`<div class="mhead">G${g}</div>`).join("");
  for(const type of m.types){
    grid.insertAdjacentHTML("beforeend",`<div class="mhead type t-${type.toLowerCase()}">${type}</div>`);
    for(const gen of m.generations){
      const cell=m.cells.find(c=>c.type===type&&c.generation===gen);
      const btn=document.createElement("button");
      btn.className=`mcell ${cell.state}`;
      btn.innerHTML=`${cell.eligible_count}<small>${cell.state==="normal"?"":cell.state}</small>`;
      btn.onclick=()=>renderCell(cell,btn);
      grid.appendChild(btn);
    }
  }
  document.getElementById("matrix-summary").textContent =
    `${m.included_cell_count} included cells · ${m.atom_count} draftable Pokémon`;
}
function renderCell(cell,btn){
  document.querySelectorAll(".mcell").forEach(c=>c.classList.remove("selected"));
  btn.classList.add("selected");
  const d=document.getElementById("detail");
  const list = cell.pokemon.length
    ? `<ul class="dlist">${cell.pokemon.map(p=>`<li><span class="mini">${sprite(p)}</span>
         <span><strong>${titleCase(p.name)}</strong><div class="meta">Gen ${p.debut_generation} · BST ${p.base_stat_total}</div>
         <div class="chips" style="justify-content:flex-start;margin-top:.2rem">${typeChips(p)}</div></span></li>`).join("")}</ul>`
    : `<p style="color:var(--muted)">No active-source Pokémon occupy this cell.</p>`;
  d.innerHTML = `<h3>${cell.type} · Gen ${cell.generation}</h3>
    <p style="color:var(--muted);font-size:.88rem"><b style="color:var(--ink)">${cell.eligible_count}</b> eligible · ${
      cell.state==="excluded"?"excluded from rolls":cell.state==="thin"?"thin — free reroll":"included"}</p>${list}`;
  fixImages(d);
}

/* =====================================================================
   BOOT
   ===================================================================== */
document.getElementById("boss-form").addEventListener("submit",saveBoss);

async function boot(){
  try{ state.matrix = await api("/api/matrix"); renderMatrix(); }
  catch(e){ document.getElementById("matrix-summary").textContent = e.message; }
  try{ renderBosses(await api("/api/bosses")); }
  catch(e){ document.getElementById("boss-status").textContent = e.message; }
  go("title");
}

boot();


/* ===== GEN × TYPE slot roller (title mini-game; decorative, no backend) ===== */
const RTYPES=["Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"];
const RTCOL=["#9099a1","#ff9c54","#4d90d5","#f3d23b","#63bc5a","#74cec0","#ce4069","#ab6ac8","#d97746","#8fa8dd","#f97176","#90c12c","#c7b78b","#5269ac","#0a6dc4","#5a5366","#5a8ea1","#ec8fe6"];
const RCODE="0123456789abcdefgh";  /* type index → single char (0-9, a-h) */
const RNAMES={hooh:"Ho-Oh",jangmoo:"Jangmo-o",kommoo:"Kommo-o",tapukoko:"Tapu Koko",tapulele:"Tapu Lele",sirfetchd:"Sirfetch'd",flabebe:"Flabébé",mimikyu:"Mimikyu"};
const RDEX=`
bulbasaur,1,47 charmander,1,1 squirtle,1,2 pikachu,1,3 jigglypuff,1,0h geodude,1,c8 machop,1,6 gastly,1,d7 abra,1,a onix,1,c8 eevee,1,0 snorlax,1,0 gyarados,1,29 dragonite,1,e9 scyther,1,b9 magnemite,1,3g vulpix,1,1 poliwag,1,2 growlithe,1,1 sandshrew,1,8 clefairy,1,h ekans,1,7 diglett,1,8 zubat,1,79 lapras,1,25 jynx,1,5a pinsir,1,b tauros,1,0 magmar,1,1 electabuzz,1,3 aerodactyl,1,c9 articuno,1,59 zapdos,1,39 moltres,1,19 mewtwo,1,a alakazam,1,a gengar,1,d7 machamp,1,6 golem,1,c8 venusaur,1,47 charizard,1,19 blastoise,1,2
chikorita,2,4 cyndaquil,2,1 totodile,2,2 pichu,2,3 togepi,2,h mareep,2,3 hoothoot,2,09 ledyba,2,b9 natu,2,a9 wooper,2,28 sneasel,2,f5 houndour,2,f1 larvitar,2,c8 tyranitar,2,cf scizor,2,bg heracross,2,b6 umbreon,2,f espeon,2,a lugia,2,a9 hooh,2,19 feraligatr,2,2 typhlosion,2,1 meganium,2,4 ampharos,2,3 skarmory,2,g9 donphan,2,8 miltank,2,0 steelix,2,g8 misdreavus,2,d murkrow,2,f9 girafarig,2,0a dunsparce,2,0 gligar,2,89 slugma,2,1 swinub,2,58 mantine,2,29 smeargle,2,0
treecko,3,4 torchic,3,1 mudkip,3,2 poochyena,3,f zigzagoon,3,0 ralts,3,ah gardevoir,3,ah aggron,3,gc mawile,3,gh sableye,3,fd electrike,3,3 gulpin,3,7 carvanha,3,2f sharpedo,3,2f wailmer,3,2 numel,3,18 camerupt,3,18 trapinch,3,8 flygon,3,8e cacnea,3,4 altaria,3,e9 zangoose,3,0 seviper,3,7 lunatone,3,ca baltoy,3,8a anorith,3,cb feebas,3,2 milotic,3,2 absol,3,f snorunt,3,5 spheal,3,52 bagon,3,e salamence,3,e9 metagross,3,ga regirock,3,c regice,3,5 registeel,3,g latias,3,ea latios,3,ea kyogre,3,2 groudon,3,8 rayquaza,3,e9 blaziken,3,16 swampert,3,28 sceptile,3,4 banette,3,d duskull,3,d shuppet,3,d
turtwig,4,4 chimchar,4,1 piplup,4,2 starly,4,09 shinx,4,3 luxray,4,3 roserade,4,47 combee,4,b9 pachirisu,4,3 buizel,4,2 drifloon,4,d9 buneary,4,0 stunky,4,7f bronzong,4,ga gible,4,e8 garchomp,4,e8 riolu,4,6 lucario,4,6g hippopotas,4,8 croagunk,4,76 toxicroak,4,76 snover,4,45 abomasnow,4,45 weavile,4,f5 magnezone,4,3g rhyperior,4,8c togekiss,4,h9 leafeon,4,4 glaceon,4,5 gallade,4,a6 froslass,4,5d rotom,4,3d dialga,4,ge palkia,4,2e giratina,4,de darkrai,4,f empoleon,4,2g infernape,4,16 torterra,4,48 gastrodon,4,28 spiritomb,4,df mamoswine,4,58
snivy,5,4 tepig,5,1 oshawott,5,2 lillipup,5,0 purrloin,5,f pansage,5,4 pidove,5,09 blitzle,5,3 roggenrola,5,c woobat,5,a9 drilbur,5,8 audino,5,0 timburr,5,6 sewaddle,5,b4 sandile,5,8f krookodile,5,8f darumaka,5,1 scraggy,5,f6 sigilyph,5,a9 yamask,5,d trubbish,5,7 zorua,5,f zoroark,5,f ducklett,5,29 deerling,5,04 emolga,5,39 joltik,5,b3 galvantula,5,b3 ferrothorn,5,4g klink,5,g litwick,5,d1 chandelure,5,d1 axew,5,e haxorus,5,e cubchoo,5,5 cryogonal,5,5 golett,5,8d bisharp,5,fg rufflet,5,09 deino,5,fe hydreigon,5,fe larvesta,5,b1 volcarona,5,b1 cobalion,5,g6 terrakion,5,c6 virizion,5,46 reshiram,5,e1 zekrom,5,e3 kyurem,5,e5 serperior,5,4 emboar,5,16 samurott,5,2 excadrill,5,8g
chespin,6,4 fennekin,6,1 froakie,6,2 bunnelby,6,0 fletchling,6,09 litleo,6,10 flabebe,6,h pancham,6,6 espurr,6,a honedge,6,gd aegislash,6,gd spritzee,6,h swirlix,6,h inkay,6,fa malamar,6,fa skrelp,6,72 dragalge,6,7e clauncher,6,2 helioptile,6,30 tyrunt,6,ce tyrantrum,6,ce amaura,6,c5 aurorus,6,c5 sylveon,6,h hawlucha,6,69 dedenne,6,3h carbink,6,ch goomy,6,e goodra,6,e klefki,6,gh phantump,6,d4 pumpkaboo,6,d4 noibat,6,9e noivern,6,9e xerneas,6,h yveltal,6,f9 zygarde,6,e8 diancie,6,ch greninja,6,2f chesnaught,6,46 delphox,6,1a
rowlet,7,49 litten,7,1 popplio,7,2 pikipek,7,09 yungoos,7,0 grubbin,7,b crabrawler,7,6 oricorio,7,19 cutiefly,7,bh rockruff,7,c lycanroc,7,c wishiwashi,7,2 mareanie,7,72 mudbray,7,8 fomantis,7,4 salandit,7,71 bewear,7,06 bounsweet,7,4 comfey,7,h mimikyu,7,dh bruxish,7,2a drampa,7,0e jangmoo,7,e kommoo,7,e6 tapukoko,7,3h tapulele,7,ah solgaleo,7,ag lunala,7,ad nihilego,7,c7 buzzwole,7,b6 pheromosa,7,b6 xurkitree,7,3 kartana,7,4g necrozma,7,a decidueye,7,4d incineroar,7,1f primarina,7,2h toxapex,7,72 mudsdale,7,8 golisopod,7,b2 palossand,7,d8 minior,7,c9 tsareena,7,4
grookey,8,4 scorbunny,8,1 sobble,8,2 rookidee,8,9 blipbug,8,b nickit,8,f gossifleur,8,4 wooloo,8,0 corviknight,8,9g drednaw,8,2c yamper,8,3 rolycoly,8,c applin,8,4e flapple,8,4e silicobra,8,8 toxtricity,8,37 sizzlipede,8,1b sinistea,8,d hatenna,8,a impidimp,8,fh grimmsnarl,8,fh obstagoon,8,f0 perrserker,8,g cursola,8,d sirfetchd,8,6 runerigus,8,8d alcremie,8,h falinks,8,6 pincurchin,8,3 snom,8,5b frosmoth,8,5b stonjourner,8,c eiscue,8,5 indeedee,8,a0 morpeko,8,3f dracozolt,8,3e dragapult,8,ed zacian,8,h zamazenta,8,6 eternatus,8,7e rillaboom,8,4 cinderace,8,1 inteleon,8,2 duraludon,8,ge regieleki,8,3 regidrago,8,e glastrier,8,5 spectrier,8,d calyrex,8,a4
sprigatito,9,4 fuecoco,9,1 quaxly,9,2 lechonk,9,0 tarountula,9,b pawmi,9,3 tandemaus,9,0 fidough,9,h smoliv,9,40 squawkabilly,9,09 nacli,9,c charcadet,9,1 tadbulb,9,3 wattrel,9,39 maschiff,9,f shroodle,9,70 bramblin,9,4d toedscool,9,84 klawf,9,c flittle,9,a tinkatink,9,hg wiglett,9,2 bombirdier,9,9f finizen,9,2 varoom,9,g7 cyclizar,9,e0 orthworm,9,g glimmet,9,c7 greavard,9,d flamigo,9,96 cetoddle,9,5 veluza,9,2a dondozo,9,2 tatsugiri,9,e2 annihilape,9,6d clodsire,9,78 farigiraf,9,0a dudunsparce,9,0 kingambit,9,fg gholdengo,9,gd armarouge,9,1a ceruledge,9,1d meowscarada,9,4f skeledirge,9,1d quaquaval,9,26 baxcalibur,9,e5 koraidon,9,6e miraidon,9,3e tinkaton,9,hg
`.trim().split(/\s+/).map(s=>{const[n,g,c]=s.split(",");return{name:n,gen:+g,t:[...c].map(ch=>RCODE.indexOf(ch))};});

const RCOMBO={};                       /* "gen|typeIdx" → [mons]            */
for(const m of RDEX) for(const ti of m.t){const k=m.gen+"|"+ti;(RCOMBO[k]||(RCOMBO[k]=[])).push(m);}
const RVALID=Object.keys(RCOMBO);      /* combos that actually have a 'mon  */

let _rolling=false, _rGen=1, _rType=0, _genReel=null, _typeReel=null;
const rPretty=n=>RNAMES[n]||titleCase(n);
const RITEM=56;   /* px height of one reel cell — matches CSS .reel-cell */

/* a vertical slot reel: a tall strip of repeated cells that scrolls in px */
function makeReel(stripId, count, renderCell){
  const strip=document.getElementById(stripId);
  const COPIES=24;                       /* enough loops for a long spin   */
  let h=""; for(let c=0;c<COPIES;c++) for(let i=0;i<count;i++) h+=renderCell(i);
  strip.innerHTML=h;
  const cycle=count*RITEM;
  let offset=0, raf=null;
  const place=()=>{const o=((offset%cycle)+cycle)%cycle; strip.style.transform=`translateY(${RITEM-o}px)`;};
  const stop =()=>{ if(raf){cancelAnimationFrame(raf); raf=null;} };
  /* slow continuous drift — the "idle" slot-machine motion */
  function idle(speed){ stop(); let last=null;
    const f=t=>{ if(last!=null) offset+=(t-last)*speed; last=t; place(); raf=requestAnimationFrame(f); };
    raf=requestAnimationFrame(f);
  }
  /* decelerating spin that lands centred on `target`, then freezes */
  function spin(target, dur, cb){ stop();
    offset=((offset%cycle)+cycle)%cycle;          /* normalise start        */
    let dest=target*RITEM; while(dest < offset + 4*cycle) dest+=cycle;
    const start=offset, dist=dest-offset, t0=performance.now();
    const f=now=>{ const p=Math.min(1,(now-t0)/dur); const e=1-Math.pow(1-p,3);
      offset=start+dist*e; place();
      if(p<1){ raf=requestAnimationFrame(f); } else { offset=target*RITEM; place(); cb&&cb(); }
    };
    raf=requestAnimationFrame(f);
  }
  place();
  return {idle, spin, stop};
}

function initRoller(){
  _genReel =makeReel("genstrip", 9,  i=>`<div class="reel-cell">${i+1}</div>`);
  _typeReel=makeReel("typestrip",18, i=>`<div class="reel-cell t"><span class="dot" style="--tc:${RTCOL[i]}"></span>${RTYPES[i]}</div>`);
  _genReel.idle(0.018); _typeReel.idle(0.024);   /* slow drift, slightly desynced */
}

function rollMon(){
  if(_rolling)return; _rolling=true;
  const btn=document.getElementById("rollbtn"); btn.disabled=true; btn.textContent="● Rolling…";
  document.getElementById("reel-gen").classList.remove("locked");
  document.getElementById("reel-type").classList.remove("locked");
  // reset the summon panel to its spinning state
  const mon=document.getElementById("rollmon");
  mon.classList.remove("pop"); mon.hidden=true;
  document.getElementById("rollname").hidden=true;
  document.getElementById("rolltypes").innerHTML="";
  document.getElementById("summon-gen").hidden=true;
  const empty=document.getElementById("summon-empty"); empty.hidden=false; empty.innerHTML="Summoning…";
  // pick a real, non-empty Gen × Type, then a random 'mon inside it
  const key=RVALID[Math.floor(Math.random()*RVALID.length)];
  const [tg,tt]=key.split("|").map(Number);
  const pick=RCOMBO[key][Math.floor(Math.random()*RCOMBO[key].length)];
  // spin both reels; type reel lands a touch later — then reveal once both freeze
  let done=0; const both=()=>{ if(++done===2){ _rGen=tg; _rType=tt; rReveal(pick,tg,btn); } };
  _genReel.spin(tg-1, 2100, ()=>{ document.getElementById("reel-gen").classList.add("locked"); both(); });
  _typeReel.spin(tt,  2650, ()=>{ document.getElementById("reel-type").classList.add("locked"); both(); });
}

function rReveal(pick, gen, btn){
  const mon=document.getElementById("rollmon");
  document.getElementById("summon-empty").hidden=true;
  const gtag=document.getElementById("summon-gen"); gtag.textContent="GEN "+gen; gtag.hidden=false;
  const name=document.getElementById("rollname"); name.textContent=rPretty(pick.name); name.hidden=false;
  document.getElementById("rolltypes").innerHTML=pick.t.map(ti=>`<span class="tpill" style="--tc:${RTCOL[ti]}">${RTYPES[ti]}</span>`).join("");
  mon.onload=()=>{ mon.hidden=false; mon.classList.remove("spinning"); void mon.offsetWidth; mon.classList.add("pop"); };
  mon.onerror=()=>{ mon.hidden=true; };          // graceful: just name + types
  mon.classList.add("spinning"); mon.hidden=false;
  mon.src=`https://play.pokemonshowdown.com/sprites/ani/${pick.name}.gif`;
  _rolling=false; btn.disabled=false; btn.textContent="● Roll again";
}

initRoller();
