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
function goToStep(name){
  // Only navigate to a screen the player has already reached (active or done).
  const el = [...document.querySelectorAll("#steps .step")].find(s=>s.dataset.step===name);
  if(el && (el.classList.contains("active") || el.classList.contains("done"))) go(name);
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
      <div class="cell-name">${o.cell.type} · Gen ${o.cell.generation}</div>
      ${o.thin_reroll_available?`<p class="thin-note">Thin cell — fewer than ${o.thin_cell_threshold} choices left, this re-spin is free.</p>`:""}
    </div>
    <div class="encounter-actions">
      ${thin}
      <button class="btn btn-ghost btn-sm" onclick="skip()" ${draft.skips_remaining?"":"disabled"}>
        Skip cell (${draft.skips_remaining}/${totalSkips})
      </button>
    </div>`;
}
function setSummary(p){
  const s=p.randbats_set, sp=p.assembly_spread;
  const item = s.item?` @ ${titleCase(s.item)}`:"";
  const moves = (s.moves||[]).map(m=>`<span class="move">${titleCase(m)}</span>`).join("");
  let evLine = sp&&sp.evs?Object.entries(sp.evs).map(([k,v])=>`${v} ${k}`).join(" / "):"";
  return `
    <div class="setbox">
      <div class="row"><b>${titleCase(p.name)}</b>${item}</div>
      <div class="row">Ability: <b>${titleCase(s.ability||"—")}</b>${sp?` · ${sp.nature} · Lv ${sp.level}`:""}</div>
      ${evLine?`<div class="row">EVs: ${evLine}</div>`:""}
      <div class="moves">${moves}</div>
      ${s.export?`<details class="raw"><summary>Raw PokéPaste</summary><pre>${esc(s.export)}</pre></details>`:""}
    </div>`;
}
function renderCandidates(offer, draft){
  const root = document.getElementById("candidates");
  root.innerHTML = offer.candidates.map(p=>{
    const suggested = p.id===offer.suggested_species;
    const prob = (p.selection_probability*100);
    return `
    <article class="mon ${suggested?"suggested":""}">
      <div class="mon-top">
        <span class="mon-badge">Gen ${p.debut_generation} · BST ${p.base_stat_total}</span>
        ${suggested?`<span class="star" title="Suggested pick">★</span>`:""}
        <div class="sprite-frame">${sprite(p)}</div>
        <div class="mon-name">${titleCase(p.name)}</div>
        <div class="chips">${typeChips(p)}</div>
      </div>
      <div class="mon-body">
        <div class="prob" title="Suggestion probability">
          <span>${suggested?"Suggested":"Eligible"}</span>
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
async function pick(id){ renderDraft(await api(`/api/drafts/${state.sessionId}/pick`,{method:"POST",body:JSON.stringify({species_id:id})})); }
async function skip(){ renderDraft(await api(`/api/drafts/${state.sessionId}/skip`,{method:"POST"})); }
async function thinReroll(){ renderDraft(await api(`/api/drafts/${state.sessionId}/thin-reroll`,{method:"POST"})); }

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
    const moves = (chosen.moves||[]).map(m=>`<span class="move">${titleCase(m)}</span>`).join("");
    return `
      <article class="loadout-card card">
        <div class="loadout-head"><span class="mini">${sprite(entry)}</span><strong>${titleCase(entry.name)}</strong></div>
        <label class="field set-field">Set ${picker}</label>
        <div class="setbox">
          <div class="row"><b>${titleCase(entry.name)}</b>${chosen.item?` @ ${titleCase(chosen.item)}`:""}</div>
          <div class="row">Ability: <b>${titleCase(chosen.ability||"—")}</b></div>
          <div class="moves">${moves}</div>
        </div>
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
function replayDoc(log){
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
    theater.innerHTML=`<div class="replay-card"><div class="replay-ph"><div><div class="big">Waiting for the first battle…</div><div class="sm">Matchups stream in here as your team climbs the ladder.</div></div></div></div>`;
    return;
  }
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
      f.title=`${r.player_name} vs ${r.boss_name} replay`; f.srcdoc=replayDoc(r.replay_log);
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
  const results=g.results;
  const wins=results.filter(r=>r.winner==="player").length;
  const losses=results.filter(r=>r.winner==="boss").length;
  const ties=results.filter(r=>r.winner==="tie").length;
  const avg=results.length?results.reduce((s,r)=>s+r.turns,0)/results.length:0;
  const cleared = wins===g.bosses.length;
  const lastLoss = g.stop_on_loss && results.length && results[results.length-1].winner!=="player";

  const hero=document.getElementById("result-hero");
  hero.className="result-hero "+(cleared?"victory":lastLoss?"defeat":"mixed");
  document.getElementById("result-title").textContent = cleared?"Champion! 🏆":lastLoss?"Run ended":"Gauntlet complete";
  document.getElementById("result-sub").textContent = g.summary ||
    (cleared?`Your team swept all ${g.bosses.length} bosses.`
            :lastLoss?`Fell at boss ${results.length} of ${g.bosses.length}.`
                     :`Final record across ${results.length} battles.`);

  document.getElementById("record").innerHTML = `
    <div class="stat"><div class="v" style="color:var(--good)">${wins}</div><div class="k">Wins</div></div>
    <div class="stat"><div class="v" style="color:var(--bad)">${losses}</div><div class="k">Losses</div></div>
    ${ties?`<div class="stat"><div class="v">${ties}</div><div class="k">Ties</div></div>`:""}
    <div class="stat"><div class="v">${avg.toFixed(1)}</div><div class="k">Avg turns</div></div>`;

  document.getElementById("result-chips").innerHTML = g.bosses.map((b,i)=>{
    const r=results[i]; if(!r) return `<span class="rchip"><span class="dot" style="background:var(--line)"></span>${esc(b.name)}</span>`;
    const cls=r.winner==="player"?"win":r.winner==="boss"?"loss":"tie";
    return `<span class="rchip ${cls}"><span class="dot"></span>${esc(b.name)} · ${r.turns}t</span>`;
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
