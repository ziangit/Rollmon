// Title-screen Gen × Type slot roller: decorative mini-game carried over
// verbatim from v1 (web_static/app.js). Plain JS; no game data involved.
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
const titleCase=v=>String(v).replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase());
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

export {initRoller, rollMon};
