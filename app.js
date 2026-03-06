/* Kitchen Inventory — v8 (CardFlow Auto Purple)
   - Single kitchen
   - Discovery counting (locations/sections built as you walk)
   - Card-style invoices with paste-many, vendor recents, price memory
   - Portion + Batch recipes; batch auto sync to inventory items
   - Reports: Actual COGS + Findings + Unmatched lines + Month ZIP export
*/

(() => {
  // One-time migration cleanup for legacy keys. Do not clear active persistence keys.
  const MIGRATION_KEY = "alibi.migration.v1.done";
  try{
    if(localStorage.getItem(MIGRATION_KEY) !== "1"){
      localStorage.removeItem("kitchen_inventory_v8");
      localStorage.removeItem("vendorMem");
      localStorage.removeItem("alibi.invoiceDraft.v1");
      localStorage.removeItem("alibi.demo.seed.version");
      sessionStorage.removeItem("kitchen_inventory_v8");
      localStorage.setItem(MIGRATION_KEY, "1");
    }
  }catch(_e){}

  /* v10.1 db bootstrap */
  // Prevent early ReferenceError before DB load block later in the file.
  let db = (window.__ALIBI_DB__ || { settings: {} });
  window.__ALIBI_DB__ = db;

  // Phase C: non-blocking notifications (toast when available)
  const __nativeAlert = (typeof window !== 'undefined' && window.alert) ? window.alert.bind(window) : null;
  function notify(msg, kind='ok', ms=1400){
    try{ if(typeof window.toast === 'function') return window.toast(msg, { kind, ms }); }catch(_e){}
    // If Alibi's internal toast exists later in this file, prefer it.
    try{ if(typeof toast === 'function') return toast(String(msg), ms); }catch(_e){}
    try{ if(__nativeAlert) __nativeAlert(String(msg)); }catch(_e){}
  }


// v8.9 Flow helpers
db.settings = db.settings || {};
function remember(k,v){ db.settings[k]=v; saveDB(); }
function recall(k, d){ return db.settings[k] ?? d; }

// Autofocus first input on view change
function autoFocus(){
  const i=document.querySelector('input:not([type=hidden]):not([disabled])');
  if(i) i.focus();
}

// Undo affordance toast
function undoToast(){
  try{ toast('Undo available (Ctrl/Cmd+Z)'); }catch(e){}
}


// Phase 7: Formalization state
db.settings = db.settings || {};
db.period = db.period || { locked:false, lockedAt:null, beginConfirmed:false, costSnapshot:{} };

function renderPeriodStatus(){
  const s = document.getElementById('periodStatus');
  if(!s) return;
  if(db.period.locked){
    s.textContent = `Locked ${new Date(db.period.lockedAt).toLocaleString()}`;
    s.classList.add('badge','lock');
  } else {
    s.textContent = 'Open';
  }
  const b = document.getElementById('beginInvStatus');
  if(b){
    b.textContent = db.period.beginConfirmed ? 'Beginning inventory confirmed' : 'Not confirmed';
  }
}

function confirmBeginInventory(){
  const inp = document.getElementById('beginInvInput');
  if(!inp) return;
  db.beginInventory = Number(inp.value||0);
  db.period.beginConfirmed = true;
  saveDB();
  renderPeriodStatus();
}

function lockCurrentPeriod(){
  if(db.period.locked) return;
  db.period.locked = true;
  db.period.lockedAt = Date.now();
  // snapshot item costs for visual change indicators
  db.items = db.items || [];
  db.items.forEach(i=>{ db.period.costSnapshot[i.name] = Number(i.defaultCost||0); });
  saveDB();
  renderPeriodStatus();
}

function isLocked(){
  return !!db.period.locked;
}

// Item list with formalization controls
let _aliasItem = null;
function renderItemFormalization(){
  const el = document.getElementById('itemList'); if(!el) return;
  db.items = db.items || [];
  el.innerHTML = db.items.map(i=>{
    const prev = db.period.costSnapshot && db.period.costSnapshot[i.name];
    const changed = prev!=null && Number(prev)!==Number(i.defaultCost||0);
    return `<div class="item-row">
      <b>${i.name}</b>
      ${changed?'<span class="badge warn">Cost changed</span>':''}
      <label><input type="checkbox" ${i.exclude?'checked':''} data-exclude="${i.name}"> Don’t count this item</label>
      <button data-alias="${i.name}">Aliases</button>
    </div>`;
  }).join('');
}

function openAliasModal(name){
  _aliasItem = db.items.find(i=>i.name===name);
  if(!_aliasItem) return;
  _aliasItem.aliases = _aliasItem.aliases || [];
  const m = document.getElementById('aliasModal');
  const list = document.getElementById('aliasList');
  list.innerHTML = _aliasItem.aliases.map(a=>`<div>${a}</div>`).join('');
  m.classList.add('open');
}

function addAlias(){
  if(!_aliasItem) return;
  const inp = document.getElementById('newAlias');
  const v = (inp.value||'').trim();
  if(!v) return;
  _aliasItem.aliases = _aliasItem.aliases || [];
  if(!_aliasItem.aliases.includes(v)) _aliasItem.aliases.push(v);
  inp.value='';
  saveDB();
  renderItemFormalization();
  openAliasModal(_aliasItem.name);
}


// v8.7 dropdown menu
document.getElementById('menuToggle')?.addEventListener('click', ()=>{
  const m=document.getElementById('dropdownMenu');
  if(m) m.classList.toggle('hidden');
});
document.addEventListener('click',(e)=>{
  const m=document.getElementById('dropdownMenu');
  const b=document.getElementById('menuToggle');
  if(!m||!b) return;
  if(!m.contains(e.target) && e.target!==b){ m.classList.add('hidden'); }
});


// Phase 6: Hardening & Polish
const UNDO_STACK = [];
const UNDO_WINDOW_MS = 5000;
let _saveTimer = null;

function saveDBDebounced(){
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{ try{ saveDB(); }catch(e){} }, 120);
}

function pushUndo(action){
  UNDO_STACK.push({action, ts:Date.now()});
  setTimeout(()=>{
    while(UNDO_STACK.length && Date.now()-UNDO_STACK[0].ts>UNDO_WINDOW_MS){
      UNDO_STACK.shift();
    }
  }, UNDO_WINDOW_MS+50);
}

function undoLast(){
  const last = UNDO_STACK.pop();
  if(!last) return;
  try{ last.action(); saveDBDebounced(); toast('Undo'); }catch(e){}
}

document.addEventListener('keydown', (e)=>{
  const tag = (e.target && e.target.tagName)||'';
  const typing = ['INPUT','TEXTAREA'].includes(tag);
  if(!typing && e.key.toLowerCase()==='n'){ e.preventDefault(); try{ newInvoice(); }catch(e){} }
  if(e.key==='Escape'){ const m=document.querySelector('.modal.open'); if(m){ m.classList.remove('open'); } }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undoLast(); }
});


// Phase 5: Manager actions + exports
function buildManagerActions(db){
  const actions=[];
  if((db.unmatched||[]).length) actions.push(`Unmatched invoice items: ${db.unmatched.length}`);
  if((db.items||[]).some(i=>Number(i.defaultCost||0)<=0)) actions.push('Items missing costs');
  const theo = (typeof computeTheoreticalCOGS==='function') ? computeTheoreticalCOGS(db) : {missing:[]};
  if(theo.missing && theo.missing.length) actions.push(`Missing recipe/PMIX mappings: ${theo.missing.length}`);
  const a = (typeof computeActualCOGS==='function') ? computeActualCOGS(db) : {actual:0};
  const t = (typeof computeTheoreticalCOGS==='function') ? computeTheoreticalCOGS(db) : {total:0};
  const v = (a.actual||0) - (t.total||0);
  if(Math.abs(v) > Math.max(1, (a.actual||0)*0.03)) actions.push('High COGS variance');
  return actions;
}

function renderManagerActions(){
  const ul=document.getElementById('managerActions'); if(!ul) return;
  const acts = buildManagerActions(db);
  ul.innerHTML = acts.length ? acts.map(a=>`<li>⚠️ ${a}</li>`).join('') : '<li>✅ No actions required</li>';
}

function renderMonthlySummary(){
  const month = db.months?.find(m=>m.id===currentMonthId) || db.months?.[0] || null;
  const sales = month ? Number(month.sales?.foodNet||0) : (db.sales||[]).reduce((s,r)=>s+Number(r.amount||0),0);
  const a = computeActualCOGS(db);
  const t = computeTheoreticalCOGS(db);
  const v = a.actual - t.total;

  const elSales = document.getElementById('sumSales');
  if(elSales) elSales.textContent = money(sales);

  const elActual = document.getElementById('sumActual');
  if(elActual) elActual.textContent = money(a.actual);

  const elTheo = document.getElementById('sumTheo');
  if(elTheo) elTheo.textContent = money(t.total);

  const elVar = document.getElementById('sumVar');
  if(elVar) elVar.textContent = money(v);
}

function csvFromRows(rows){
  if(!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const out=[headers.join(',')];
  rows.forEach(r=>out.push(headers.map(h=>JSON.stringify(r[h]??'')).join(',')));
  return out.join('\n');
}

function makeSummaryHTML(){
  const a = computeActualCOGS(db);
  const t = computeTheoreticalCOGS(db);
  const v = a.actual - t.total;
  const acts = buildManagerActions(db);
  return `<!doctype html><html><meta charset="utf-8"><title>Monthly Summary</title>
  <body>
  <h1>Monthly Summary</h1>
  <p><b>Actual COGS:</b> ${money(a.actual)}</p>
  <p><b>Theoretical COGS:</b> ${money(t.total)}</p>
  <p><b>Variance:</b> ${money(v)}</p>
  <h3>Manager Actions</h3>
  <ul>${acts.map(a=>`<li>${a}</li>`).join('')||'<li>None</li>'}</ul>
  </body></html>`;
}

function exportZIP(){
  const zip = new JSZip();
  zip.file('summary.html', makeSummaryHTML());
  const a = computeActualCOGS(db);
  const t = computeTheoreticalCOGS(db);
  zip.file('cogs.csv', csvFromRows([{actual:a.actual, theoretical:t.total, variance:a.actual-t.total}]));
  const acts = buildManagerActions(db).map(a=>({issue:a}));
  zip.file('manager_actions.csv', csvFromRows(acts.length?acts:[{issue:'None'}]));
  zip.generateAsync({type:'blob'}).then(b=>{
    const aTag=document.createElement('a');
    aTag.href=URL.createObjectURL(b);
    aTag.download=`reports_${new Date().toISOString().slice(0,10)}.zip`;
    aTag.click();
  });
}

function emailDraft(){
  const email = (db.settings||{}).reportEmail||'';
  const subj = encodeURIComponent('Monthly Inventory & COGS Report');
  const body = encodeURIComponent('Attached: Monthly summary, COGS, variance, and action items.');
  window.location.href = `mailto:${email}?subject=${subj}&body=${body}`;
}


// Phase 4: COGS helpers

function normalizeUnit(u){
  if(!u) return u;
  const bad=['pan'];
  return bad.includes(u.toLowerCase()) ? 'ea' : u;
}

function money(n){ return `$${(Number(n)||0).toFixed(2)}`; }
function fmtQty(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "0";
  if(Math.abs(x) >= 100) return x.toFixed(0);
  if(Math.abs(x) >= 10) return x.toFixed(1).replace(/\.0$/, "");
  return x.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
function parseNum(v){
  if(typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if(v == null) return NaN;
  const s = String(v).trim();
  if(!s) return NaN;
  const cleaned = s
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function computeActualCOGS(db){
  const monthIdx = (db.months||[]).findIndex(m => m.id === currentMonthId);
  const month = monthIdx >= 0 ? db.months[monthIdx] : db.months?.[0];
  if(month){
    const prev = monthIdx >= 0 ? db.months?.[monthIdx+1] : null;
    const groups = new Set(["ingredients","products"]);
    const byId = new Map((db.items||[]).map(i => [i.id, i]));
    const invValue = (m) => {
      let total = 0;
      const counts = m?.end?.counts || {};
      Object.entries(counts).forEach(([itemId, c]) => {
        const it = byId.get(itemId);
        if(!it || !groups.has(it.group)) return;
        const qty = Number(c?.qty||0);
        const cost = Number(it.defaultCost||0);
        if(Number.isFinite(qty) && Number.isFinite(cost)) total += qty * cost;
      });
      return total;
    };
    const begin = prev ? invValue(prev) : Number(db.beginInventory||0);
    const purchases = (db.invoices||[])
      .filter(inv => inv.monthId === month.id)
      .reduce((sum, inv) => sum + (inv.lines||[]).reduce((s, ln) => {
        const g = ln.group || byId.get(ln.itemId)?.group;
        if(!groups.has(g)) return s;
        const ext = Number(ln.qty||0) * Number(ln.unitCost||0);
        return s + (Number.isFinite(ext) ? ext : 0);
      }, 0), 0);
    const end = invValue(month);
    return { begin, purchases, end, actual: begin + purchases - end };
  }
  const begin = Number(db.beginInventory||0);
  const purchases = (db.purchases||[]).reduce((s,p)=>s+Number(p.extended||0),0);
  const end = Number(db.endInventory||0);
  return { begin, purchases, end, actual: begin + purchases - end };
}

function parsePMIX(text){
  const lines = text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const rows = [];
  for(const l of lines){
    const parts = l.split(/,|\t/);
    if(parts.length>=2){
      rows.push({ name: parts[0].trim(), qty: Number(parts[1])||0 });
    }
  }
  return rows;
}

function computeTheoreticalCOGS(db){
  const pmix = db.pmix||[];
  let total = 0;
  const missing = [];
  const portionCost = (recipe) => {
    let cost = 0;
    (recipe.lines||[]).forEach(ln => {
      const it = (db.items||[]).find(x => x.id === ln.itemId);
      if(!it) return;
      cost += (Number(ln.qty)||0) * (Number(it.defaultCost)||0);
    });
    return cost;
  };
  pmix.forEach(r=>{
    const recipe = (db.recipes||[]).find(x=>x.type==='portion' && x.name===r.name);
    if(!recipe){ missing.push(`Missing recipe: ${r.name}`); return; }
    const cost = portionCost(recipe);
    total += cost * Number(r.qty||0);
  });
  return { total, missing };
}

function cogsConfidence(db, theoMissing){
  const flags = [];
  const items = db.items||[];
  if(items.some(i=>Number(i.defaultCost||0)<=0)) flags.push('Missing item costs');
  if((db.unmatched||[]).length) flags.push('Unmatched invoice items');
  if(theoMissing.length) flags.push('Missing recipes/PMIX mappings');
  return flags;
}

function renderCOGS(){
  const a = computeActualCOGS(db);
  const t = computeTheoreticalCOGS(db);
  const v = a.actual - t.total;

  document.getElementById('actualCogs').textContent = money(a.actual);
  document.getElementById('theoreticalCogs').textContent = money(t.total);
  document.getElementById('varianceCogs').textContent = money(v);

  const varNote = document.getElementById('varianceNote');
  varNote.textContent = v===0 ? 'On target' : (v>0?'Over theoretical':'Under theoretical');

  const conf = document.getElementById('cogsConfidence');
  const flags = cogsConfidence(db, t.missing);
  conf.innerHTML = flags.length ? flags.map(f=>`<span class="flag">⚠️ ${f}</span>`).join('') : '✅ Complete';

  const cards = document.querySelectorAll('.cogs-card');
  cards.forEach(c=>c.classList.remove('good','warn','bad'));
  if(Math.abs(v) < 0.01){ cards[2].classList.add('good'); }
  else if(Math.abs(v)/Math.max(a.actual,1) < 0.03){ cards[2].classList.add('warn'); }
  else{ cards[2].classList.add('bad'); }
}


// Phase 3: Counting flow helpers
const LOCATION_PRESETS = {
  'Dry Storage': ['cs','ea'],
  'Walk-In': ['lb','qt'],
  'Freezer': ['cs','lb'],
  'Line': ['ea']
};

// Phase 2: Invoice speed helpers
const todayISO = () => new Date().toISOString().slice(0,10);

const VENDOR_MEM = {};
function getVendorMemory(v){
  return VENDOR_MEM[v]||{items:[], prices:{}};
}
function setVendorMemory(v, item, price){
  VENDOR_MEM[v]=VENDOR_MEM[v]||{items:[], prices:{}};
  if(item && !VENDOR_MEM[v].items.includes(item)){
    VENDOR_MEM[v].items.unshift(item); VENDOR_MEM[v].items=VENDOR_MEM[v].items.slice(0,20);
  }
  if(item && price){ VENDOR_MEM[v].prices[item]=price; }
}

function renderVendorChips(vendor){
  const el=document.getElementById('vendorChips'); if(!el) return;
  el.innerHTML='';
  if(!vendor) return;
  const mem=getVendorMemory(vendor);
  mem.items.forEach(it=>{
    const c=document.createElement('div');
    c.className='chip';
    c.textContent=it;
    c.onclick=()=>addInvoiceLine({name:it, price:mem.prices[it]||''});
    el.appendChild(c);
  });
}


  // Phase 1 helpers
  let DIRTY = false;
  const saveStatusEl = () => document.getElementById('saveStatus');
  const toast = (msg, t=1400)=>{
    const el=document.getElementById('toast'); if(!el) return;
    el.textContent=msg; el.classList.remove('hidden');
    setTimeout(()=>el.classList.add('hidden'), t);
  };
  const markDirty = ()=>{
    DIRTY = true;
    const el=saveStatusEl(); if(!el) return;
    el.classList.add('saving'); el.classList.remove('saved');
    el.querySelector('.label').textContent='Saving…';
  };
  const markSaved = ()=>{
    DIRTY = false;
    const el=saveStatusEl(); if(!el) return;
    el.classList.remove('saving'); el.classList.add('saved');
    el.querySelector('.label').textContent='Saved';
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // -------- Navigation (tabs/panels) --------
  function syncQuickDock(tab){
    const tabMap = {
      dashboard: "#qdDash",
      counting: "#qdCount",
      reports: "#qdReports",
      settings: "#qdSettings"
    };
    ["#qdDash", "#qdCount", "#qdReports", "#qdSettings"].forEach((sel) => {
      const el = $(sel);
      if(!el) return;
      el.classList.remove("active");
      el.setAttribute("aria-pressed", "false");
    });
    const sel = tabMap[tab];
    if(sel){
      const active = $(sel);
      if(active){
        active.classList.add("active");
        active.setAttribute("aria-pressed", "true");
      }
    }
  }

  function goTab(tab){
    if(!tab) return;
    // Panels
    $$(".panel").forEach(p => p.classList.remove("active"));
    const panel = $("#panel-" + tab);
    if(panel) panel.classList.add("active");

    // Legacy .tab buttons (if ever present)
    $$(".tab").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });

    // Tile row nav buttons
    $$(".tile-nav-btn").forEach(b => b.classList.toggle("active", b.dataset.gotoTab === tab));
    syncQuickDock(tab);

    // Refresh visible UI safely
    try{ renderAll(); }catch(e){}
  }
  window.goTab = goTab;

  // ===============================
  // enh1 wireLineEditorUX — faster line entry, fewer decisions, safer saves
  // ===============================
  function _isVisible(el){
    if(!el) return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== "hidden";
  }
  function _focusNextIn(container, current){
    const focusables = Array.from(container.querySelectorAll("input, select, textarea, button"))
      .filter(el => !el.disabled && el.tabIndex !== -1 && _isVisible(el));
    const idx = focusables.indexOf(current);
    if(idx >= 0 && idx < focusables.length-1){
      focusables[idx+1].focus();
      if(focusables[idx+1].select) focusables[idx+1].select();
      return true;
    }
    return false;
  }
  function _setInvalid(el, bad){
    if(!el) return;
    el.classList.toggle("invalid", !!bad);
    el.setAttribute("aria-invalid", bad ? "true" : "false");
  }
  function wireLineEditorUX(){
  if(wireLineEditorUX._bound) return;
  wireLineEditorUX._bound = true;
    const card = document.querySelector(".overlay-card");
    if(!card) return;

    const advBtn = $("#btnToggleLineAdvanced");
    const advBox = $("#lineAdvanced");

    // Auto-show advanced if existing data present
    if(advBox){
      const hasAdv = ( ($("#lnCategory")?.value || "").trim().length > 0 ) || ( ($("#lnNotes")?.value || "").trim().length > 0 );
      if(hasAdv) advBox.hidden = false;
    }
    advBtn?.addEventListener("click", ()=>{
      if(!advBox) return;
      advBox.hidden = !advBox.hidden;
    });

    const qty = $("#lnQty");
    const cost = $("#lnCost");
    const unit = $("#lnUnit");
    const item = $("#lnItem");
    const save = $("#btnSaveLine");

    function validate(){
      const q = parseNum((qty?.value || "").toString().replace(",","."));
      const c = parseNum((cost?.value || "").toString().replace(",","."));
      const hasItem = ((item?.value || "").trim().length > 0);
      const badQty = !Number.isFinite(q) || q < 0;
      const badCost = !Number.isFinite(c) || c < 0;
      _setInvalid(qty, badQty);
      _setInvalid(cost, badCost);
      _setInvalid(item, !hasItem);
      // Unit optional; but if qty present and unit blank, soft-invalid
      const softUnitBad = Number.isFinite(q) && q > 0 && ((unit?.value || "").trim().length === 0);
      _setInvalid(unit, softUnitBad);
      if(save){
        save.disabled = (!hasItem) || badQty || badCost;
        save.style.opacity = save.disabled ? "0.55" : "1";
      }
    }

    [qty, cost, unit, item, $("#lnCategory"), $("#lnNotes")].forEach(el => el?.addEventListener("input", validate));
    validate();

    // Keyboard flow
    card.addEventListener("keydown", (e)=>{
      const t = e.target;
      if(e.key === "Escape"){
        $("#btnCloseEditLine")?.click();
        return;
      }
      if(e.key === "Enter"){
        // Ctrl+Enter = save (fast)
        if(e.ctrlKey || e.metaKey){
          e.preventDefault();
          if(!save?.disabled) save?.click();
          return;
        }
        // Regular Enter = next field (except textarea)
        if(t && t.tagName !== "TEXTAREA"){
          e.preventDefault();
          const moved = _focusNextIn(card, t);
          if(!moved){
            if(!save?.disabled) save?.click();
          }
        }
      }
    }, { capture:true });
  }


  function initTileRowNav(){
    const buttons = $$(".tile-nav-btn");
    if(!buttons.length) return;

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        goTab(btn.dataset.gotoTab);
      });
    });

    // Sync initial active state from current active panel
    const activePanel = $(".panel.active");
    if(activePanel && activePanel.id && activePanel.id.startsWith("panel-")){
      goTab(activePanel.id.replace("panel-",""));
    } else {
      goTab(buttons[0].dataset.gotoTab);
    }
  }

  function initQuickDock(){
    $("#qdDash")?.addEventListener("click", () => goTab("dashboard"));
    $("#qdCount")?.addEventListener("click", () => goTab("counting"));
    $("#qdReports")?.addEventListener("click", () => goTab("reports"));
    $("#qdSettings")?.addEventListener("click", () => goTab("settings"));
    $("#qdInvoice")?.addEventListener("click", () => {
      goTab("invoices");
      setTimeout(() => $("#btnNewInvoice")?.click(), 50);
    });
    $("#qdRecalc")?.addEventListener("click", () => {
      goTab("reports");
      setTimeout(() => $("#btnRecalc")?.click(), 50);
    });

    document.addEventListener("keydown", (e) => {
      if(!e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      if(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if(k === "1"){ e.preventDefault(); goTab("dashboard"); return; }
      if(k === "2"){ e.preventDefault(); goTab("counting"); return; }
      if(k === "3"){ e.preventDefault(); goTab("invoices"); return; }
      if(k === "4"){ e.preventDefault(); goTab("recipes"); return; }
      if(k === "5"){ e.preventDefault(); goTab("reports"); return; }
      if(k === "6"){ e.preventDefault(); goTab("settings"); return; }
      if(k === "n"){ e.preventDefault(); goTab("invoices"); setTimeout(() => $("#btnNewInvoice")?.click(), 50); return; }
      if(k === "r"){ e.preventDefault(); goTab("reports"); setTimeout(() => $("#btnRecalc")?.click(), 50); return; }
    });
  }

  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const nowISO = () => new Date().toISOString().slice(0,10);
  const moneyFmt = (n) => {
    const x = Number(n||0);
    return x.toLocaleString(undefined, { style:'currency', currency:'USD' });
  };
  const pct = (n) => {
    if (!isFinite(n)) return '—';
    return (n*100).toFixed(1) + '%';
  };
  const clamp = (n) => (isFinite(n) ? n : 0);
  const DEMO_AUTH_USER = "demo";
  const DEMO_AUTH_PASS = "demo";
  const DEMO_AUTH_KEY = "alibi.demo.auth.v1";
  const DEMO_FOCUS_MS = 30000;
  const DB_STORAGE_KEY = "alibi.db.v1";
  const PERSIST_MODE_KEY = "alibi.persistence.mode";
  const REMOTE_QUEUE_KEY = "alibi.remote.queue.v1";
  const persistenceMode = (() => {
    try{
      const mode = localStorage.getItem(PERSIST_MODE_KEY);
      return mode === "remote" ? "remote" : "local";
    }catch(_e){
      return "local";
    }
  })();
  let demoFocusTimer = null;

  function beginDemoFocusWindow(){
    if(!db.settings?.demoMode) return;
    document.body.classList.add("demo-focus");
    clearTimeout(demoFocusTimer);
    demoFocusTimer = setTimeout(() => {
      document.body.classList.remove("demo-focus");
    }, DEMO_FOCUS_MS);
  }

  function isDemoAuthed(){
    try{
      return sessionStorage.getItem(DEMO_AUTH_KEY) === "1";
    }catch(_e){
      return false;
    }
  }

  function unlockDemoAuth(){
    try{ sessionStorage.setItem(DEMO_AUTH_KEY, "1"); }catch(_e){}
    document.body.classList.remove("auth-locked");
    $("#authGate")?.classList.add("hidden");
    $("#authMsg").textContent = "";
    beginDemoFocusWindow();
    // Start tour after login so it is always visible and intentional.
    if(db.settings?.demoMode){
      setTimeout(() => {
        if(!tourState.active) startGuidedTour();
      }, 80);
    }
  }

  function showDemoAuthGate(){
    const gate = $("#authGate");
    if(!gate) return;
    // Ensure no hidden active tour captures clicks behind auth modal.
    if(tourState.active) stopGuidedTour();
    document.body.classList.add("auth-locked");
    gate.classList.remove("hidden");
    const user = $("#authUser");
    const pass = $("#authPass");
    const msg = $("#authMsg");
    const submit = () => {
      const u = (user?.value || "").trim();
      const p = (pass?.value || "").trim();
      if(u === DEMO_AUTH_USER && p === DEMO_AUTH_PASS){
        unlockDemoAuth();
        return;
      }
      msg.textContent = "Invalid credentials";
    };
    $("#authLoginBtn")?.addEventListener("click", submit);
    user?.addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); submit(); } });
    pass?.addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); submit(); } });
    setTimeout(() => user?.focus(), 20);
  }

  const SEED = () => ({
    version: "v8",
    settings: { reportEmail: "" },
    items: [], // master items: {id,name,group,category,baseUnit,unitsPerCase,defaultCost,aliases:[]}
    kitchen: { locations: [] }, // {id,name,sections:[{id,name,itemIds:[], overrides:{[itemId]:{defaultUnit, allowedUnits}}}]}
    months: [], // {id,label,year,month, sales:{foodNet,totalNet}, begin:{...}, purchases:[], end:{counts:{itemId:{qty,unit}}}}
    invoices: [], // {id, monthId, vendor, number, date, notes, lines:[{id,rawName,itemId,qty,unit,unitCost,group,category,notes}], createdAt}
    findings: [], // {id, monthId, createdAt, locationName, sectionName, text}
    recipes: [] // {id,type:'portion'|'batch', name, yieldQty,yieldUnit, lines:[{id,itemId,qty,unit}], notes}
  });

  // -------- DB load/save --------
  db = loadDB(); window.__ALIBI_DB__ = db;

  const localPersistenceAdapter = {
    load(){
      const raw = localStorage.getItem(DB_STORAGE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    },
    save(payload){
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(payload));
    }
  };

  // Remote-ready scaffold: queue writes locally until API endpoint is wired.
  const remotePersistenceAdapter = {
    load(){
      const raw = localStorage.getItem(DB_STORAGE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    },
    save(payload){
      const ts = new Date().toISOString();
      const queue = JSON.parse(localStorage.getItem(REMOTE_QUEUE_KEY) || "[]");
      queue.push({ at: ts, payload });
      localStorage.setItem(REMOTE_QUEUE_KEY, JSON.stringify(queue.slice(-50)));
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(payload));
    }
  };

  const persistenceAdapter = persistenceMode === "remote" ? remotePersistenceAdapter : localPersistenceAdapter;

  function normalizeDbShape(parsed){
    if(!parsed || typeof parsed !== "object"){
      return null;
    }
    const base = SEED();
    const out = { ...base, ...parsed };
    out.settings = { ...base.settings, ...(parsed.settings || {}) };
    out.kitchen = { ...base.kitchen, ...(parsed.kitchen || {}) };
    if(!Array.isArray(out.kitchen.locations)) out.kitchen.locations = [];
    out.period = {
      locked: false,
      lockedAt: null,
      beginConfirmed: false,
      costSnapshot: {},
      ...(parsed.period || {})
    };
    if(!out.period.costSnapshot || typeof out.period.costSnapshot !== "object"){
      out.period.costSnapshot = {};
    }
    ["items","months","invoices","findings","recipes"].forEach((k) => {
      if(!Array.isArray(out[k])) out[k] = [];
    });
    if(!Array.isArray(out.pmix)) out.pmix = [];
    if(!Array.isArray(out.unmatched)) out.unmatched = [];
    if(!Array.isArray(out.sales)) out.sales = [];
    if(!Array.isArray(out.purchases)) out.purchases = [];
    if(!out.version) out.version = "v8";
    return out;
  }

  function loadDB(){
    try{
      const loaded = persistenceAdapter.load();
      const normalized = normalizeDbShape(loaded);
      if(normalized) return normalized;
    }catch(err){
      console.warn("DB load failed:", err);
    }
    return buildDemoData();
  }
  function saveDB(){
    markDirty();
    try{
      persistenceAdapter.save(db);
      markSaved();
    }catch(err){
      console.warn("DB save failed:", err);
      try{ notify("Save failed on this device. Changes may not persist.", "warn", 2400); }catch(_e){}
    }
  }
  function bootstrapSeed(){
    const s = SEED();
    // create first month = current month
    const d = new Date();
    const label = d.toLocaleString(undefined, {month:'long'}) + " " + d.getFullYear();
    s.months.push({
      id: uid(),
      label,
      year: d.getFullYear(),
      month: d.getMonth()+1,
      sales: { foodNet: 0, totalNet: 0 },
      begin: {},
      purchases: [],
      end: { counts: {} }
    });
    // basic suggested locations (empty)
    const locs = ["Freezer","Walk-In","Dry Storage","Line","Cleaning/Paper"];
    s.kitchen.locations = locs.map(name => ({ id: uid(), name, sections: [] }));
    return s;
  }

  // -------- Month selection --------
  let currentMonthId = db.months[0]?.id;
  let currentLocationId = null;
  let currentSectionId = null;

  function ensureActiveSelections(){
    if(!db.months?.length) return;
    if(!currentMonthId || !db.months.find(m => m.id === currentMonthId)){
      currentMonthId = db.months[0].id;
    }

    if(!currentLocationId || !db.kitchen?.locations?.find(l => l.id === currentLocationId)){
      currentLocationId = db.kitchen?.locations?.[0]?.id || null;
    }
    const loc = db.kitchen?.locations?.find(l => l.id === currentLocationId) || null;
    if(loc){
      if(!currentSectionId || !loc.sections?.find(s => s.id === currentSectionId)){
        currentSectionId = loc.sections?.[0]?.id || null;
      }
    }else{
      currentSectionId = null;
    }

    const monthInvoices = db.invoices.filter(i => i.monthId === currentMonthId);
    if(!currentInvoiceId || !monthInvoices.find(i => i.id === currentInvoiceId)){
      currentInvoiceId = monthInvoices[0]?.id || db.invoices[0]?.id || null;
    }

    const visibleRecipes = db.recipes.filter(r => r.type === recipeFilter);
    if(!currentRecipeId || !visibleRecipes.find(r => r.id === currentRecipeId)){
      currentRecipeId = visibleRecipes[0]?.id || db.recipes[0]?.id || null;
    }
  }

  // -------- Tabs --------
  // (Legacy .tab buttons optional. Primary navigation uses tile-row buttons.)
  $$(".tab").forEach(btn => btn.addEventListener("click", () => {
    goTab(btn.dataset.tab);
  }));

  // Tile row navigation
  initTileRowNav();
  initQuickDock();

  // -------- Top actions --------
  const monthSelect = $("#monthSelect");
  $("#btnNewMonth")?.addEventListener("click", () => {
    const name = prompt("New month label (e.g., March 2026):");
    if(!name) return;
    db.months.unshift({
      id: uid(),
      label: name.trim(),
      year: new Date().getFullYear(),
      month: 0,
      sales: { foodNet: 0, totalNet: 0 },
      begin: {},
      purchases: [],
      end: { counts: {} }
    });
    currentMonthId = db.months[0].id;
    saveDBDebounced(); renderAll();
  });

  $("#btnExportBackup")?.addEventListener("click", () => {
    downloadJSON("kitchen_inventory_backup.json", db);
  });

  $("#btnImportBackup")?.addEventListener("click", () => {
    $("#importFile")?.click();
  });

  function loadFreshDemoAndTour(opts={}){
    const startTour = opts.startTour !== false;
    notify("Loading full demo data…");
    db = buildDemoData();
    window.__ALIBI_DB__ = db;
    currentMonthId = db.months[0]?.id || null;
    currentLocationId = db.kitchen.locations[0]?.id || null;
    currentSectionId = db.kitchen.locations[0]?.sections?.[0]?.id || null;
    currentInvoiceId = db.invoices[0]?.id || null;
    currentRecipeId = db.recipes[0]?.id || null;
    saveDB();
    renderAll();
    beginDemoFocusWindow();
    notify(`Demo loaded: ${db.months.length} months, ${db.items.length} items, ${db.invoices.length} invoices, ${db.recipes.length} recipes`, "ok", 2600);
    if(startTour){
      setTimeout(() => startGuidedTour(), 120);
    }
  }

  $("#btnRestartTour")?.addEventListener("click", () => {
    startGuidedTour();
  });

  function resetDemoNow(){
    if(!confirm("Reset to a clean demo state now?")) return;
    loadFreshDemoAndTour({ startTour: false });
    goTab("dashboard");
    notify("Demo reset complete.");
  }
  $("#btnResetDemoNow")?.addEventListener("click", () => resetDemoNow());
  $("#btnResetDemoHeader")?.addEventListener("click", () => resetDemoNow());
  $("#btnHappyPath")?.addEventListener("click", () => startGuidedTour("happy"));

  $("#importFile")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if(!f) return;
    try{
      const text = await f.text();
      const parsed = JSON.parse(text);
      if(!parsed || typeof parsed !== "object"){
        console.warn("Invalid JSON");
        return;
      }
      db = parsed;
      if(!db.version) db.version = "v8";
      saveDBDebounced();
      currentMonthId = db.months?.[0]?.id || null;
      notify("Imported backup.");
      renderAll();
    }catch(err){
      notify("Import failed: " + err.message);
    }finally{
      e.target.value = "";
    }
  });

  // Dashboard quick nav
  $("#btnGoCount")?.addEventListener("click", () => {
    goTab("counting");
  });
  $("#btnGoInvoices")?.addEventListener("click", () => {
    goTab("invoices");
  });
  $("#btnFixExceptions")?.addEventListener("click", () => {
    goTab("reports");
  });
  $("#btnDashHeatOpenReports")?.addEventListener("click", () => {
    goTab("reports");
  });

  // Quick add item
  $("#btnQuickAdd")?.addEventListener("click", () => {
    const name = $("#qaName").value.trim();
    if(!name) return notify("Name required.");
    const group = $("#qaGroup").value;
    const category = $("#qaCategory").value.trim();
    const baseUnit = $("#qaBaseUnit").value;
    const unitsPerCase = parseNum($("#qaUnitsPerCase").value || "0") || 0;
    const defaultCost = parseNum($("#qaCost").value || "0") || 0;

    const item = { id: uid(), name, group, category, baseUnit, unitsPerCase, defaultCost, aliases: [] };
    db.items.push(item);
    saveDBDebounced();
    $("#qaName").value = "";
    $("#qaCategory").value = "";
    $("#qaUnitsPerCase").value = "";
    $("#qaCost").value = "";
    renderAll();
  });

  // Settings
  $("#btnSaveSettings")?.addEventListener("click", () => {
    db.settings.reportEmail = $("#setReportEmail").value.trim();
    saveDBDebounced();
    notify("Saved.");
  });
  $("#btnResetSeed")?.addEventListener("click", () => {
    if(!confirm("Reset all app data? This cannot be undone.")) return;
    db = buildDemoData();
    window.__ALIBI_DB__ = db;
    currentMonthId = db.months[0]?.id;
    currentLocationId = null;
    currentSectionId = null;
    notify("Demo data reset.");
    renderAll();
  });

  async function clearLocalDataAndReload(){
    if(!confirm("Delete local browser data for Alibi on this device and reload?")) return;
    const keepAlibiScoped = (name) => /^(alibi\.|kitchen_inventory_|vendorMem$)/i.test(String(name||""));
    try{
      Object.keys(localStorage).forEach((k)=>{ if(keepAlibiScoped(k)) localStorage.removeItem(k); });
      Object.keys(sessionStorage).forEach((k)=>{ if(keepAlibiScoped(k)) sessionStorage.removeItem(k); });
    }catch(_e){}

    try{
      if("caches" in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => keepAlibiScoped(k) ? caches.delete(k) : Promise.resolve(false)));
      }
    }catch(_e){}

    try{
      const idb = window.indexedDB;
      if(idb && typeof idb.databases === "function"){
        const dbs = await idb.databases();
        await Promise.all((dbs||[]).map(d => d?.name ? new Promise(res => {
          if(!keepAlibiScoped(d.name)) return res();
          const req = idb.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        }) : Promise.resolve()));
      }
    }catch(_e){}

    notify("Local data deleted. Reloading…");
    setTimeout(() => window.location.reload(), 220);
  }
  $("#btnClearLocalData")?.addEventListener("click", clearLocalDataAndReload);

  // -------- Counting: location/section builders --------
  $("#btnNewLocation")?.addEventListener("click", () => {
    const name = prompt("Location name (e.g., Freezer):");
    if(!name) return;
    db.kitchen.locations.push({ id: uid(), name: name.trim(), sections: [] });
    saveDBDebounced(); renderAll();
  });

  $("#btnNewSection")?.addEventListener("click", () => {
    if(!currentLocationId) return;
    const name = prompt("Section name (e.g., Protein):");
    if(!name) return;
    const loc = db.kitchen.locations.find(l => l.id === currentLocationId);
    loc.sections.push({ id: uid(), name: name.trim(), itemIds: [], overrides: {} });
    saveDBDebounced(); renderAll();
  });

  $("#btnClearNotes")?.addEventListener("click", () => {
    if(!confirm("Clear running notes text?")) return;
    $("#runningNotes").value = "";
  });

  $("#btnAddFinding")?.addEventListener("click", () => {
    const text = $("#runningNotes").value.trim();
    if(!text) return notify("Add a note first.");
    const loc = db.kitchen.locations.find(l => l.id === currentLocationId);
    const sec = loc?.sections?.find(s => s.id === currentSectionId);
    db.findings.unshift({
      id: uid(),
      monthId: currentMonthId,
      createdAt: new Date().toISOString(),
      locationName: loc?.name || "",
      sectionName: sec?.name || "",
      text
    });
    $("#findingHint").textContent = "Saved finding ✅";
    setTimeout(()=>$("#findingHint").textContent="Findings show up in Reports → Findings Queue", 1200);
    saveDBDebounced(); renderAll();
  });

  const addToSectionSearch = $("#addToSectionSearch");
  $("#btnAddToSection")?.addEventListener("click", () => {
    const q = addToSectionSearch.value.trim();
    if(!q) return;
    if(!currentLocationId || !currentSectionId) return;
    const loc = db.kitchen.locations.find(l => l.id === currentLocationId);
    const sec = loc.sections.find(s => s.id === currentSectionId);
    const match = findBestItem(q);
    if(!match){
      // quick-create
      if(confirm(`"${q}" not found. Create as new item?`)){
        const item = { id: uid(), name: q, group: "ingredients", category: "", baseUnit: "ea", unitsPerCase: 0, defaultCost: 0, aliases: [] };
        db.items.push(item);
        sec.itemIds.push(item.id);
        sec.overrides[item.id] = { defaultUnit: "ea", allowedUnits: ["ea"] };
      }
    }else{
      if(!sec.itemIds.includes(match.id)) sec.itemIds.push(match.id);
      if(!sec.overrides[match.id]){
        // allowed units default: if case pack exists, allow cs/ea
        const allowed = (match.unitsPerCase && match.unitsPerCase>0) ? ["cs","ea"] : [match.baseUnit || "ea"];
        const defaultUnit = (match.unitsPerCase && match.unitsPerCase>0) ? "ea" : (match.baseUnit || "ea");
        sec.overrides[match.id] = { defaultUnit, allowedUnits: allowed };
      }
    }
    addToSectionSearch.value = "";
    saveDBDebounced(); renderAll();
  });

  // walk count
  let walkState = null;
  $("#btnStartWalk")?.addEventListener("click", () => startWalk());
  $("#btnCloseWalk")?.addEventListener("click", () => closeWalk());

  $("#btnZero")?.addEventListener("click", () => { $("#walkQty").value = "0"; persistWalkValue(); });
  $("#btnSameAsLast")?.addEventListener("click", () => {
    if(!walkState) return;
    const ghost = walkState.ghostQty;
    if(ghost != null) $("#walkQty").value = String(ghost);
    persistWalkValue();
  });
  $("#btnPrevItem")?.addEventListener("click", () => {
    if(!walkState) return;
    persistWalkValue();
    walkState.idx = Math.max(0, walkState.idx-1);
    renderWalk();
  });
  $("#btnNextItem")?.addEventListener("click", () => {
    if(!walkState) return;
    persistWalkValue();
    walkState.idx = Math.min(walkState.items.length-1, walkState.idx+1);
    renderWalk();
  });
  $("#walkUnit")?.addEventListener("change", persistWalkValue);
  $("#walkQty")?.addEventListener("input", () => {
    // keep it responsive but don't spam
  });
  $("#btnWalkSaveFinding")?.addEventListener("click", () => {
    const text = $("#walkNote").value.trim();
    if(!text) return;
    const loc = db.kitchen.locations.find(l => l.id === currentLocationId);
    const sec = loc?.sections?.find(s => s.id === currentSectionId);
    db.findings.unshift({
      id: uid(),
      monthId: currentMonthId,
      createdAt: new Date().toISOString(),
      locationName: loc?.name || "",
      sectionName: sec?.name || "",
      text
    });
    $("#walkNote").value = "";
    saveDBDebounced();
    $("#walkGhost").textContent = "Saved finding ✅";
    setTimeout(renderWalk, 700);
  });

  function startWalk(){
    const loc = db.kitchen.locations.find(l => l.id === currentLocationId);
    const sec = loc?.sections?.find(s => s.id === currentSectionId);
    if(!sec) return;
    if(sec.itemIds.length === 0) return notify("Add some items to this section first.");
    walkState = {
      locId: loc.id,
      secId: sec.id,
      items: sec.itemIds.slice(),
      idx: 0
    };
    $("#walkOverlay").classList.remove("hidden");
    renderWalk();
  }
  function closeWalk(){
    walkState = null;
    $("#walkOverlay").classList.add("hidden");
  }
  function renderWalk(){
    const month = getMonth();
    const loc = db.kitchen.locations.find(l => l.id === walkState.locId);
    const sec = loc.sections.find(s => s.id === walkState.secId);
    const itemId = walkState.items[walkState.idx];
    const item = db.items.find(i => i.id === itemId) || {name:"(missing item)"};
    const crumb = `${loc.name} → ${sec.name}`;
    $("#walkCrumb").textContent = crumb;
    $("#walkProgress").textContent = `Item ${walkState.idx+1} of ${walkState.items.length}`;

    $("#walkItemName").textContent = item.name;

    // allowed units / default
    const ov = sec.overrides[itemId] || { defaultUnit: item.baseUnit || "ea", allowedUnits: [item.baseUnit || "ea"] };
    const sel = $("#walkUnit");
    sel.innerHTML = "";
    ov.allowedUnits.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u; opt.textContent = u;
      sel.appendChild(opt);
    });

    // load current month count for this item (by section, stored as end.counts[itemId] aggregated)
    const current = getEndCount(itemId); // {qty,unit} in base or storage unit? We'll store raw as entered per section? v8 stores last entry per section in overrides map.
    // We'll store per-section counts in sec._counts[monthId][itemId] = {qty,unit}
    if(!sec._counts) sec._counts = {};
    if(!sec._counts[month.id]) sec._counts[month.id] = {};
    const entry = sec._counts[month.id][itemId] || { qty: "", unit: ov.defaultUnit };
    $("#walkQty").value = entry.qty === "" ? "" : String(entry.qty);
    sel.value = entry.unit || ov.defaultUnit;

    // ghost: use previous month count if exists for section
    const prev = getPrevMonth();
    let ghost = null;
    if(prev && sec._counts?.[prev.id]?.[itemId]?.qty !== undefined){
      ghost = sec._counts[prev.id][itemId].qty;
    }
    walkState.ghostQty = ghost;
    $("#walkGhost").textContent = ghost == null ? "Last month: —" : `Last month: ${ghost}`;

    $("#walkNote").value = "";
  }
  function persistWalkValue(){
    if(!walkState) return;
    const month = getMonth();
    const loc = db.kitchen.locations.find(l => l.id === walkState.locId);
    const sec = loc.sections.find(s => s.id === walkState.secId);
    const itemId = walkState.items[walkState.idx];

    if(!sec._counts) sec._counts = {};
    if(!sec._counts[month.id]) sec._counts[month.id] = {};

    const qty = $("#walkQty").value.trim();
    const unit = $("#walkUnit").value;
    sec._counts[month.id][itemId] = { qty, unit };

    // update month end aggregated count for itemId (sum across sections)
    updateAggregatedEndFromSections(itemId, month.id);

    saveDBDebounced();
  }

  function updateAggregatedEndFromSections(itemId, monthId){
    // sum all section counts for itemId, converting to base unit where possible.
    const item = db.items.find(i => i.id === itemId);
    if(!item) return;

    let totalBase = 0;
    let hasAny = false;

    for(const loc of db.kitchen.locations){
      for(const sec of (loc.sections||[])){
        const e = sec._counts?.[monthId]?.[itemId];
        if(!e) continue;
        const q = parseNum(String(e.qty||"").replace(",",""));
        if(!isFinite(q)) continue;
        hasAny = true;
        totalBase += convertToBase(item, q, e.unit);
      }
    }

    const month = getMonthById(monthId);
    if(!month.end) month.end = { counts: {} };
    if(!month.end.counts) month.end.counts = {};
    if(!hasAny){
      delete month.end.counts[itemId];
    }else{
      month.end.counts[itemId] = { qty: totalBase, unit: item.baseUnit || "ea" };
    }
  }

  function convertToBase(item, qty, unit){
    // base = item.baseUnit or ea. Supported: cs -> base when base is ea and unitsPerCase set.
    const base = item.baseUnit || "ea";
    if(unit === base) return qty;
    if(unit === "cs" && base === "ea" && item.unitsPerCase>0) return qty * item.unitsPerCase;
    // minimal: if base is qt and unit is gal
    if(unit === "gal" && base === "qt") return qty * 4;
    if(unit === "qt" && base === "gal") return qty / 4;
    // otherwise no conversion
    return qty;
  }

  function getEndCount(itemId){
    const month = getMonth();
    return month.end?.counts?.[itemId] || null;
  }

  // -------- Invoices --------
  let currentInvoiceId = null;
  function newInvoice(){
    const inv = {
      id: uid(),
      monthId: currentMonthId,
      vendor: "",
      number: "",
      date: nowISO(),
      notes: "",
      lines: [],
      createdAt: new Date().toISOString()
    };
    db.invoices.unshift(inv);
    currentInvoiceId = inv.id;
    saveDBDebounced();
    renderAll();
  }

  $("#btnNewInvoice")?.addEventListener("click", () => newInvoice());

  $("#btnDuplicateInvoice")?.addEventListener("click", () => {
    const inv = getInvoice();
    if(!inv) return;
    const copy = JSON.parse(JSON.stringify(inv));
    copy.id = uid();
    copy.number = "";
    copy.date = nowISO();
    copy.createdAt = new Date().toISOString();
    copy.lines.forEach(l => l.id = uid());
    db.invoices.unshift(copy);
    currentInvoiceId = copy.id;
    saveDBDebounced(); renderAll();
  });

  $("#btnDeleteInvoice")?.addEventListener("click", () => {
    const inv = getInvoice();
    if(!inv) return;
    if(!confirm("Delete this invoice?")) return;
    db.invoices = db.invoices.filter(i => i.id !== inv.id);
    currentInvoiceId = db.invoices[0]?.id || null;
    saveDBDebounced(); renderAll();
  });

  function openPasteModal(){
    const modal = $("#pasteModal");
    if(!modal) return;
    const card = modal.querySelector(".overlay-card");
    if(!card) return;
    card.innerHTML = `
      <div class="overlay-h">
        <div>
          <div class="overlay-title">Paste Invoice Lines</div>
          <div class="overlay-sub">Format: name, qty, unit, unit cost</div>
        </div>
        <button class="btn ghost" id="btnClosePaste" type="button">Close</button>
      </div>
      <label>Paste rows
        <textarea class="textarea" id="pasteArea" placeholder="Chicken Thigh,96,lb,2.82&#10;Olive Oil,12,qt,8.95"></textarea>
      </label>
      <div class="row">
        <button class="btn" id="btnApplyPaste" type="button">Apply</button>
        <span class="hint grow" id="pasteResult">—</span>
      </div>
    `;
    $("#btnClosePaste")?.addEventListener("click", () => modal.classList.add("hidden"));
    $("#btnApplyPaste")?.addEventListener("click", () => applyPaste());
    modal.classList.remove("hidden");
    $("#pasteArea")?.focus();
  }

  function getInvoice(){
    return db.invoices.find(i => i.id === currentInvoiceId) || null;
  }

  function applyPaste(){
    const inv = getInvoice();
    if(!inv) return;
    const raw = $("#pasteArea").value.trim();
    if(!raw){
      $("#pasteResult").textContent = "Nothing pasted.";
      return;
    }
    const rows = raw.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    for(const r of rows){
      const cols = r.split(/\t|,/).map(c => c.trim()).filter(c => c !== "");
      if(cols.length === 0) continue;
      const name = cols[0];
      const qty = parseNum(cols[1] || "1");
      const unit = cols[2] || "";
      const unitCost = parseNum(cols[3] || "");
      const match = findBestItem(name);
      const itemId = match ? match.id : null;

      const line = {
        id: uid(),
        rawName: name,
        itemId,
        qty: isFinite(qty) ? qty : 1,
        unit: unit || (match?.baseUnit || "ea"),
        unitCost: isFinite(unitCost) ? unitCost : (match?.defaultCost || 0),
        group: match?.group || "ingredients",
        category: match?.category || "",
        notes: ""
      };
      inv.lines.push(line);
      added++;
    }
    saveDBDebounced();
    $("#pasteResult").textContent = `Added ${added} lines.`;
    renderAll();
  }

  // -------- Recipes --------
  let recipeFilter = "portion";
  let currentRecipeId = null;

  $$(".chip[data-recipe-filter]").forEach(ch => ch.addEventListener("click", () => {
    $$(".chip[data-recipe-filter]").forEach(x => x.classList.remove("active"));
    ch.classList.add("active");
    recipeFilter = ch.dataset.recipeFilter;
    currentRecipeId = null;
    renderAll();
  }));

  $("#btnNewPortion")?.addEventListener("click", () => {
    const r = { id: uid(), type:"portion", name:"", yieldQty: 1, yieldUnit: "portion", lines: [], notes:"" };
    db.recipes.unshift(r);
    currentRecipeId = r.id;
    recipeFilter = "portion";
    $$(".chip[data-recipe-filter]").forEach(x => x.classList.toggle("active", x.dataset.recipeFilter==="portion"));
    saveDBDebounced(); renderAll();
  });
  $("#btnNewBatch")?.addEventListener("click", () => {
    const r = { id: uid(), type:"batch", name:"", yieldQty: 1, yieldUnit: "qt", lines: [], notes:"" };
    db.recipes.unshift(r);
    currentRecipeId = r.id;
    recipeFilter = "batch";
    $$(".chip[data-recipe-filter]").forEach(x => x.classList.toggle("active", x.dataset.recipeFilter==="batch"));
    saveDBDebounced(); renderAll();
  });
  $("#btnDeleteRecipe")?.addEventListener("click", () => {
    const r = db.recipes.find(x => x.id === currentRecipeId);
    if(!r) return;
    if(!confirm("Delete this recipe?")) return;
    db.recipes = db.recipes.filter(x => x.id !== r.id);
    currentRecipeId = null;
    saveDBDebounced(); renderAll();
  });

  // -------- Reports actions --------
  $("#btnRecalc")?.addEventListener("click", () => { renderReports(); renderDashboard(); });
  $("#btnClearFindings")?.addEventListener("click", () => {
    if(!confirm("Clear findings for this month?")) return;
    db.findings = db.findings.filter(f => f.monthId !== currentMonthId);
    saveDBDebounced(); renderAll();
  });
  $("#btnResolveAll")?.addEventListener("click", () => {
    notify("Resolve flow: tap a line and match/create item (built into the Unmatched list).");
  });

  $("#btnExportMonthZip")?.addEventListener("click", async () => {
    await exportMonthZip();
  });
  $("#applyPmix")?.addEventListener("click", () => {
    const text = $("#pmixInput")?.value || "";
    db.pmix = parsePMIX(text);
    saveDBDebounced();
    renderCOGS();
    renderManagerActions();
    renderMonthlySummary();
    notify(`PMIX applied (${db.pmix.length} rows).`);
  });
  $("#exportZip")?.addEventListener("click", () => exportZIP());
  $("#emailReport")?.addEventListener("click", () => emailDraft());
  $("#confirmBeginInv")?.addEventListener("click", () => confirmBeginInventory());
  $("#lockPeriod")?.addEventListener("click", () => lockCurrentPeriod());
  $("#addAlias")?.addEventListener("click", () => addAlias());
  $("#closeAlias")?.addEventListener("click", () => { $("#aliasModal")?.classList.remove("open"); });
  $("#newAlias")?.addEventListener("keydown", (e) => {
    if(e.key !== "Enter") return;
    e.preventDefault();
    addAlias();
  });
  $("#itemList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-alias]");
    if(!btn) return;
    openAliasModal(btn.getAttribute("data-alias"));
  });
  $("#itemList")?.addEventListener("change", (e) => {
    const chk = e.target.closest("[data-exclude]");
    if(!chk) return;
    const name = chk.getAttribute("data-exclude");
    const item = db.items.find(i => i.name === name);
    if(!item) return;
    item.exclude = !!chk.checked;
    saveDBDebounced();
  });

  // -------- Helpers: find item --------
  function normalize(s){
    return (s||"").toLowerCase()
      .replace(/[^a-z0-9]+/g," ")
      .trim();
  }
  function findBestItem(query){
    const q = normalize(query);
    if(!q) return null;
    // exact name/alias
    for(const it of db.items){
      if(normalize(it.name) === q) return it;
      if((it.aliases||[]).some(a => normalize(a) === q)) return it;
    }
    // fuzzy contains
    const scored = db.items.map(it => {
      const name = normalize(it.name);
      let score = 0;
      if(name.includes(q)) score += 10;
      if(q.includes(name)) score += 6;
      // token overlap
      const tq = new Set(q.split(" "));
      const tn = new Set(name.split(" "));
      let overlap = 0;
      tq.forEach(t => { if(tn.has(t)) overlap++; });
      score += overlap;
      return { it, score };
    }).sort((a,b)=>b.score-a.score);
    return scored[0]?.score ? scored[0].it : null;
  }

  // -------- COGS Calculation (basic) --------
  function getMonth(){
    return db.months.find(m => m.id === currentMonthId) || db.months[0];
  }
  function getMonthById(id){
    return db.months.find(m => m.id === id) || null;
  }
  function getPrevMonth(){
    const idx = db.months.findIndex(m => m.id === currentMonthId);
    if(idx < 0) return null;
    return db.months[idx+1] || null;
  }

  function computeInventoryValue(month, group){
    // value based on end counts * item defaultCost
    let total = 0;
    for(const it of db.items){
      if(it.group !== group) continue;
      const c = month.end?.counts?.[it.id];
      if(!c) continue;
      const q = parseNum(c.qty);
      if(!isFinite(q)) continue;
      const cost = parseNum(it.defaultCost || 0);
      total += q * cost;
    }
    return total;
  }

  function computePurchasesValue(month, group){
    // sum invoice lines for month for that group
    let total = 0;
    for(const inv of db.invoices){
      if(inv.monthId !== month.id) continue;
      for(const ln of inv.lines || []){
        if((ln.group || groupFromItem(ln.itemId)) !== group) continue;
        const ext = (parseNum(ln.qty)||0) * (parseNum(ln.unitCost)||0);
        total += ext;
      }
    }
    return total;
  }

  function groupFromItem(itemId){
    const it = db.items.find(i => i.id === itemId);
    return it?.group || "ingredients";
  }

  function computeCOGS(month, group){
    const prev = getPrevMonthById(month.id);
    const begin = prev ? computeInventoryValue(prev, group) : 0;
    const purch = computePurchasesValue(month, group);
    const endv = computeInventoryValue(month, group);
    const cogs = begin + purch - endv;
    return { begin, purch, endv, cogs };
  }

  function getPrevMonthById(monthId){
    const idx = db.months.findIndex(m => m.id === monthId);
    if(idx < 0) return null;
    return db.months[idx+1] || null;
  }

  // -------- Rendering --------
  monthSelect.addEventListener("change", () => {
    currentMonthId = monthSelect.value;
    currentInvoiceId = null;
    currentRecipeId = null;
    saveDBDebounced(); // persist selection not necessary but ok
    renderAll();
  });

  $("#addToSectionSearch")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter"){ e.preventDefault(); $("#btnAddToSection")?.click(); }
  });

  $("#btnStartWalk")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter"){ e.preventDefault(); startWalk(); }
  });

  function renderMonthSelect(){
    monthSelect.innerHTML = "";
    db.months.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      monthSelect.appendChild(opt);
    });
    monthSelect.value = currentMonthId || db.months[0]?.id;
  }

  function renderDashboard(){
    const month = getMonth();
    $("#dashMonthLabel").textContent = month.label;
    $("#dashSalesFoodNet").textContent = money(month.sales?.foodNet||0);
    $("#dashSalesTotalNet").textContent = money(month.sales?.totalNet||0);

    const ing = computeCOGS(month, "ingredients");
    const prod = computeCOGS(month, "products");
    $("#dashCogsIng").textContent = money(ing.cogs);
    $("#dashCogsProd").textContent = money(prod.cogs);

    const denom = (month.sales?.foodNet||0);
    $("#dashCogsPct").textContent = denom>0 ? pct((ing.cogs+prod.cogs)/denom) : "—";

    // ---- Phase D: Quick stat tiles ----
    const cogsTotal = (ing.cogs + prod.cogs);
    const purchTotal = computePurchasesValue(month, "ingredients") + computePurchasesValue(month, "products");
    const endInvTotal = computeInventoryValue(month, "ingredients") + computeInventoryValue(month, "products");

    {
      const e1 = $("#dashTileCogsPctVal");
      if(e1) e1.textContent = denom>0 ? pct(cogsTotal/denom) : "—";
      const e2 = $("#dashTileCogsPctSub");
      if(e2) e2.textContent = denom>0 ? `Food+NA net ${money(denom)}` : "Food+NA net —";
      const e3 = $("#dashTilePurchVal");
      if(e3) e3.textContent = purchTotal>0 ? money(purchTotal) : "—";
      const e4 = $("#dashTileEndInvVal");
      if(e4) e4.textContent = endInvTotal>0 ? money(endInvTotal) : "—";
    }

    // COGS vs goal (operator-friendly wording; avoid misleading signed deltas)
    const targetPct = 0.30;
    const targetCogs = denom>0 ? denom * targetPct : 0;
    const delta = denom>0 ? (cogsTotal - targetCogs) : 0;
    const absDelta = Math.abs(delta);
    if($("#dashTileDeltaTargetVal")){
      if(denom<=0){
        $("#dashTileDeltaTargetVal").textContent = "—";
      }else if(absDelta < 0.005){
        $("#dashTileDeltaTargetVal").textContent = "On Goal";
      }else if(delta > 0){
        $("#dashTileDeltaTargetVal").textContent = `Above Goal ${money(absDelta)}`;
      }else{
        $("#dashTileDeltaTargetVal").textContent = `Below Goal ${money(absDelta)}`;
      }
    }
    if($("#dashTileDeltaTargetSub")){
      if(denom>0){
        if(absDelta < 0.005){
          $("#dashTileDeltaTargetSub").textContent = `Goal ${Math.round(targetPct*100)}% of Food+NA Net`;
        }else{
          const state = delta > 0 ? "Needs attention" : "Good";
          $("#dashTileDeltaTargetSub").textContent = `${state} • Goal ${Math.round(targetPct*100)}% of Food+NA Net`;
        }
      }else{
        $("#dashTileDeltaTargetSub").textContent = `Goal ${Math.round(targetPct*100)}% COGS`;
      }
    }

    // ---- Phase D: Variance Heat Map (biggest movers) ----
    const heatBox = $("#dashHeatList");
    if(heatBox){
      const prev = getPrevMonthById(month.id);
      const beginCounts = prev?.end?.counts || {};
      const endCounts = month.end?.counts || {};

      // aggregate invoice movement per item
      const purchById = new Map();
      const spendById = new Map();
      db.invoices.filter(inv => inv.monthId === month.id).forEach(inv => {
        (inv.lines||[]).forEach(ln => {
          const itemId = ln.itemId;
          if(!itemId) return;
          const q = parseNum(ln.qty)||0;
          const u = parseNum(ln.unitCost)||0;
          purchById.set(itemId, (purchById.get(itemId)||0) + q);
          spendById.set(itemId, (spendById.get(itemId)||0) + (q*u));
        });
      });

      const movers = [];
      db.items.forEach(it => {
        if(!(it.group === "ingredients" || it.group === "products")) return;
        const bq = parseNum(beginCounts?.[it.id]?.qty || 0) || 0;
        const eq = parseNum(endCounts?.[it.id]?.qty || 0) || 0;
        const pq = purchById.get(it.id) || 0;
        const spend = spendById.get(it.id) || 0;

        const inferred = (pq>0 && spend>0) ? (spend / pq) : 0;
        const cost = (parseNum(it.defaultCost)||0) > 0 ? (parseNum(it.defaultCost)||0) : inferred;
        if(!cost) return;

        const usageQty = bq + pq - eq;
        const usageVal = usageQty * cost;
        const mag = Math.abs(usageVal);
        if(mag < 1) return; // ignore tiny noise
        movers.push({
          id: it.id,
          name: it.name,
          group: it.group,
          usageQty,
          usageVal,
          mag,
          bq, pq, eq,
          unitCost: cost
        });
      });

      movers.sort((a,b) => b.mag - a.mag);
      const top = movers.slice(0, 8);

      heatBox.innerHTML = "";
      if(top.length === 0){
        heatBox.innerHTML = `<div class="item"><div class="left"><div class="title">No movers yet</div><div class="meta">Add invoices + end counts to see the heat map.</div></div><span class="badge">—</span></div>`;
      }else{
        const max = top[0].mag || 1;
        top.forEach(r => {
          const el = document.createElement("div");
          el.className = "item heat-item";

          const w = Math.max(4, Math.min(100, Math.round((r.mag / max) * 100)));
          const anomaly = r.usageQty < 0 ? "Anomaly" : "Move";
          const badgeClass = r.usageQty < 0 ? "badge warn" : "badge";
          const groupPill = r.group === "ingredients" ? "Ing" : "Prod";

          el.innerHTML = `
            <div class="left">
              <div class="title">${escapeHtml(r.name)} <span class="badge lock">${groupPill}</span></div>
              <div class="meta">Begin ${fmtQty(r.bq)} + Purch ${fmtQty(r.pq)} − End ${fmtQty(r.eq)} = <b>${fmtQty(r.usageQty)}</b></div>
            </div>
            <div class="heat-right">
              <div class="heat-val">${money(r.usageVal)}</div>
              <div class="heat-bar"><div class="heat-fill" style="width:${w}%"></div></div>
              <div class="heat-sub"><span class="${badgeClass}">${anomaly}</span></div>
            </div>
          `;
          el.addEventListener("click", () => goTab("reports"));
          heatBox.appendChild(el);
        });
      }
    }

    // exceptions
    const exc = [];
    // missing costs
    const missingCost = db.items.filter(i => (i.group==="ingredients" || i.group==="products") && (!i.defaultCost || Number(i.defaultCost)<=0));
    if(missingCost.length) exc.push(`${missingCost.length} items missing cost`);
    // unmatched invoice lines
    const um = getUnmatchedLines(month.id);
    if(um.length) exc.push(`${um.length} unmatched invoice lines`);
    // items counted but not in master shouldn't happen, but check counts against items
    const countIds = Object.keys(month.end?.counts||{});
    const unknown = countIds.filter(id => !db.items.some(i=>i.id===id));
    if(unknown.length) exc.push(`${unknown.length} unknown counted item IDs`);

    const box = $("#dashExceptions");
    box.innerHTML = "";
    if(exc.length === 0){
      box.innerHTML = `<div class="item"><div class="left"><div class="title">No obvious problems</div><div class="meta">Still… trust but verify.</div></div><span class="badge">OK</span></div>`;
    }else{
      exc.forEach(t => {
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `<div class="left"><div class="title">${escapeHtml(t)}</div><div class="meta">Tap Reports to fix</div></div><span class="badge">Fix</span>`;
        el.addEventListener("click", () => goTab("reports"));
        box.appendChild(el);
      });
    }
  }

  function renderCounting(){
    // locations list
    const locBox = $("#locationsList");
    locBox.innerHTML = "";
    db.kitchen.locations.forEach(loc => {
      const el = document.createElement("div");
      el.className = "item";
      const secCount = (loc.sections||[]).length;
      el.innerHTML = `<div class="left"><div class="title">${escapeHtml(loc.name)}</div><div class="meta">${secCount} section(s)</div></div><div class="right"><button class="btn ghost">Open</button></div>`;
      el.querySelector("button").addEventListener("click", () => {
        currentLocationId = loc.id;
        currentSectionId = loc.sections?.[0]?.id || null;
        renderCounting();
      });
      locBox.appendChild(el);
    });

    const loc = db.kitchen.locations.find(l => l.id === currentLocationId) || null;
    $("#btnNewSection").disabled = !loc;
    $("#btnStartWalk").disabled = !loc || !currentSectionId;
    $("#addToSectionSearch").disabled = !loc || !currentSectionId;
    $("#btnAddToSection").disabled = !loc || !currentSectionId;

    // sections list
    const secBox = $("#sectionsList");
    secBox.innerHTML = "";
    $("#sectionsList").classList.toggle("muted", !loc);

    if(!loc){
      $("#sectionTitle").textContent = "Section";
      $("#sectionSub").textContent = "Pick a location";
      $("#sectionsList").innerHTML = `<div class="hint">Select a location on the left. Then add sections and items as you walk.</div>`;
      return;
    }

    $("#sectionTitle").textContent = loc.name;
    $("#sectionSub").textContent = "Choose a section";

    (loc.sections||[]).forEach(sec => {
      const el = document.createElement("div");
      el.className = "item";
      const count = sec.itemIds?.length || 0;
      el.innerHTML = `<div class="left"><div class="title">${escapeHtml(sec.name)}</div><div class="meta">${count} item(s) in path</div></div><div class="right"><button class="btn ghost">Select</button></div>`;
      el.querySelector("button").addEventListener("click", () => {
        currentSectionId = sec.id;
        renderCounting();
      });
      secBox.appendChild(el);
    });

    const sec = loc.sections?.find(s => s.id === currentSectionId) || null;
    if(sec){
      $("#sectionSub").textContent = `${sec.name} • ${sec.itemIds.length} item(s)`;
      $("#btnStartWalk").disabled = sec.itemIds.length === 0;
      $("#btnNewSection").disabled = false;
      $("#addToSectionSearch").disabled = false;
      $("#btnAddToSection").disabled = false;

      // typeahead list for addToSectionSearch via datalist
      ensureDatalist("itemsDatalist", db.items.map(i=>i.name));
      $("#addToSectionSearch").setAttribute("list","itemsDatalist");
    }
    const notesEl = $("#runningNotes");
    if(notesEl && db.settings?.demoMode && !notesEl.value.trim()){
      notesEl.value = [
        "Prep shelf check: chicken case #2 had two leaking cryovacs; 3.2 lb waste logged.",
        "Line expo: aioli backup moved to lowboy during rush; transfer not written on handoff.",
        "Dry shelf: soup cups received in mixed sleeve counts (200 + 50 partial)."
      ].join("\n");
    }
  }

  function ensureDatalist(id, values){
    let dl = $("#"+id);
    if(!dl){
      dl = document.createElement("datalist");
      dl.id = id;
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    values.slice(0, 800).forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      dl.appendChild(opt);
    });
  }

  function renderInvoices(){
    const month = getMonth();
    const list = $("#invoiceList");
    list.innerHTML = "";

    const invs = db.invoices.filter(i => i.monthId === month.id);
    if(invs.length === 0){
      list.innerHTML = `<div class="hint">No invoices yet for ${escapeHtml(month.label)}. Tap “New Invoice”.</div>`;
    }else{
      invs.forEach(inv => {
        const total = inv.lines.reduce((s,l)=>s + (parseNum(l.qty)||0)*(parseNum(l.unitCost)||0), 0);
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `<div class="left">
            <div class="title">${escapeHtml(inv.vendor || "(Vendor)")}${inv.number ? " • #"+escapeHtml(inv.number) : ""}</div>
            <div class="meta">${escapeHtml(inv.date || "")} • ${inv.lines.length} line(s)</div>
          </div>
          <div class="right">
            <span class="badge">${money(total)}</span>
            <button class="btn ghost">Edit</button>
          </div>`;
        el.querySelector("button").addEventListener("click", (e) => {
          e.stopPropagation();
          currentInvoiceId = inv.id;
          renderInvoices();
        });
        el.addEventListener("click", () => {
          currentInvoiceId = inv.id;
          renderInvoices();
        });
        list.appendChild(el);
      });
    }

    // Editor
    const editor = $("#invoiceEditor");
    const inv = getInvoice();
    $("#btnDuplicateInvoice").disabled = !inv;
    $("#btnDeleteInvoice").disabled = !inv;

    if(!inv){
      $("#invoiceEditorTitle").textContent = "Invoice Editor";
      $("#invoiceEditorSub").textContent = "Create or select an invoice";
      editor.innerHTML = `<div class="hint">Tip: use “Paste Many” for long invoices. The app will match items and remember vendor pricing.</div>`;
      return;
    }

    $("#invoiceEditorTitle").textContent = "Invoice • " + (inv.vendor || "(Vendor)");
    $("#invoiceEditorSub").textContent = "Card-style lines • tap to expand";

    const vendorRecents = getVendorRecents(inv.vendor);

    const total = inv.lines.reduce((s,l)=>s + (parseNum(l.qty)||0)*(parseNum(l.unitCost)||0), 0);

    editor.innerHTML = `
      <div class="card" style="padding:12px; box-shadow:none; border-color: var(--border);">
        <div class="row">
          <label class="grow">Vendor
            <input id="invVendor" class="input" placeholder="e.g., US Foods" value="${escapeAttr(inv.vendor)}"/>
          </label>
          <label class="grow">Invoice #
            <input id="invNumber" class="input" placeholder="12345" value="${escapeAttr(inv.number)}"/>
          </label>
          <label class="grow">Date
            <input id="invDate" type="date" class="input" value="${escapeAttr(inv.date||nowISO())}"/>
          </label>
        </div>
        <label>Notes
          <input id="invNotes" class="input" placeholder="freight, credits, special notes" value="${escapeAttr(inv.notes||"")}"/>
        </label>

        <div class="row" style="align-items:flex-start;">
          <div class="grow">
            <div class="hint"><b>Vendor Recents:</b> tap to add a line instantly</div>
            <div class="row" id="vendorChips"></div>
          </div>
          <div>
            <div class="hint"><b>Total</b></div>
            <div style="font-weight:900; font-size:20px;">${money(total)}</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row">
          <button class="btn" id="btnAddLine">+ Add Line</button>
          <button class="btn ghost" id="btnPasteMany">Paste Many</button>
          <button class="btn ghost" id="btnApplyToPurchases">Post to Purchases</button>
        </div>
      </div>

      <div class="divider"></div>

      <div id="lineCards" class="list"></div>
    `;

    // header events
    $("#invVendor")?.addEventListener("input", (e) => { inv.vendor = e.target.value; saveDBDebounced(); renderInvoices(); });
    $("#invNumber")?.addEventListener("input", (e) => { inv.number = e.target.value; saveDBDebounced(); });
    $("#invDate")?.addEventListener("input", (e) => { inv.date = e.target.value; saveDBDebounced(); });
    $("#invNotes")?.addEventListener("input", (e) => { inv.notes = e.target.value; saveDBDebounced(); });

    // vendor chips
    const chips = $("#vendorChips");
    chips.innerHTML = "";
    vendorRecents.slice(0, 10).forEach(name => {
      const c = document.createElement("button");
      c.className = "chip";
      c.textContent = name;
      c.addEventListener("click", () => {
        addInvoiceLine(inv, name);
        saveDBDebounced(); renderInvoices();
      });
      chips.appendChild(c);
    });
    if(vendorRecents.length===0){
      chips.innerHTML = `<span class="hint">No history yet. Once you enter a couple invoices, this becomes your “1-tap vendor menu”.</span>`;
    }

    $("#btnAddLine")?.addEventListener("click", () => {
      addInvoiceLine(inv, "");
      saveDBDebounced(); renderInvoices();
    });

    $("#btnPasteMany")?.addEventListener("click", () => {
      openPasteModal();
    });

    $("#btnApplyToPurchases")?.addEventListener("click", () => {
      // For v8 MVP: posting means updating item default cost (last cost) and ensuring group/category
      let updated = 0;
      for(const ln of inv.lines){
        if(!ln.itemId) continue;
        const it = db.items.find(i => i.id === ln.itemId);
        if(!it) continue;
        const uc = parseNum(ln.unitCost);
        if(isFinite(uc) && uc>0){
          it.defaultCost = uc; // last cost
          updated++;
        }
        // keep category if missing
        if(!it.category && ln.category) it.category = ln.category;
      }
      saveDBDebounced();
      notify(`Posted. Updated ${updated} item cost(s).`);
      renderAll();
    });

    // line cards
    renderInvoiceLines(inv);
  }

  function addInvoiceLine(inv, rawName){
    const match = findBestItem(rawName);
    const itemId = match ? match.id : null;
    const ln = {
      id: uid(),
      rawName: rawName || "",
      itemId,
      qty: 1,
      unit: match?.baseUnit || "ea",
      unitCost: guessUnitCost(inv.vendor, itemId) ?? (match?.defaultCost || 0),
      group: match?.group || "ingredients",
      category: match?.category || "",
      notes: ""
    };
    inv.lines.push(ln);
  }

  function guessUnitCost(vendor, itemId){
    if(!vendor || !itemId) return null;
    // search last invoice for vendor with this item
    for(const inv of db.invoices){
      if(inv.vendor !== vendor) continue;
      for(const ln of inv.lines||[]){
        if(ln.itemId === itemId && isFinite(parseNum(ln.unitCost))) return parseNum(ln.unitCost);
      }
    }
    return null;
  }

  function getVendorRecents(vendor){
    if(!vendor) return [];
    const names = [];
    for(const inv of db.invoices){
      if(inv.vendor !== vendor) continue;
      for(const ln of inv.lines||[]){
        if(ln.itemId){
          const it = db.items.find(i => i.id === ln.itemId);
          if(it) names.push(it.name);
        }else if(ln.rawName){
          names.push(ln.rawName);
        }
      }
    }
    // unique preserve order
    const out = [];
    const seen = new Set();
    for(const n of names){
      const k = normalize(n);
      if(!k || seen.has(k)) continue;
      seen.add(k); out.push(n);
    }
    return out;
  }

  function renderInvoiceLines(inv){
    const box = $("#lineCards");
    box.innerHTML = "";

    if(inv.lines.length === 0){
      box.innerHTML = `<div class="hint">No lines yet. Add a line or use Paste Many.</div>`;
      return;
    }

    inv.lines.forEach((ln, idx) => {
      const it = ln.itemId ? db.items.find(i=>i.id===ln.itemId) : null;
      const ext = (parseNum(ln.qty)||0) * (parseNum(ln.unitCost)||0);

      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="left">
          <div class="title">${escapeHtml(it?.name || ln.rawName || "(Item)")}</div>
          <div class="meta">${ln.itemId ? "Matched" : "Unmatched"} • ${escapeHtml(ln.group||"")} ${ln.category ? "• "+escapeHtml(ln.category) : ""}</div>
        </div>
        <div class="right">
          <span class="badge">${money(ext)}</span>
          <button class="btn ghost" data-act="edit">Edit</button>
        </div>
      `;

      el.querySelector('[data-act="edit"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openLineEditor(inv, ln);
      });
      el.addEventListener("click", () => openLineEditor(inv, ln));
      box.appendChild(el);
    });
  }

  function openLineEditor(inv, ln){
    // simple in-place overlay editor using pasteModal container for convenience
    const modal = $("#pasteModal");
    modal.classList.remove("hidden");

    // reuse modal UI, replace with editor form
    const card = modal.querySelector(".overlay-card");
    card.innerHTML = `
      <div class="overlay-h">
        <div>
          <div class="overlay-title">Edit Line</div>
          <div class="overlay-sub">Fast card editing • updates totals immediately</div>
        </div>
        <button class="btn ghost" id="btnCloseEditLine">Close</button>
      </div>

      <div class="form">
        <label>Item (search)
          <input id="lnItem" class="input" placeholder="type to match…" value="${escapeAttr(ln.itemId ? (db.items.find(i=>i.id===ln.itemId)?.name||"") : (ln.rawName||""))}" />
        </label>

        <div class="row">
          <label class="grow">Qty
            <input id="lnQty" class="input" inputmode="decimal" value="${escapeAttr(ln.qty)}" />
          </label>
          <label class="grow">Unit
            <input id="lnUnit" class="input" value="${escapeAttr(ln.unit||"")}" />
          </label>
          <label class="grow">Unit Cost
            <input id="lnCost" class="input" inputmode="decimal" value="${escapeAttr(ln.unitCost)}" />
          
          </label>
          <div class="row" style="margin-top:8px; align-items:center; justify-content:space-between; gap:10px;">
            <div class="hint">
              <span class="kbd">Enter</span> next field · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> save · <span class="kbd">Esc</span> close
            </div>
            <button class="adv-toggle" id="btnToggleLineAdvanced" type="button">
              <span class="dot"></span>
              More Details
            </button>
          </div>

        </div>

        <div class="row">
          <label class="grow">Group
            <select id="lnGroup" class="select">
              <option value="ingredients">Ingredients</option>
              <option value="products">Products</option>
              <option value="nonfood">Nonfood</option>
              <option value="batch">Batch</option>
            </select>
          </label>
          <div class="line-advanced" id="lineAdvanced" hidden>
<label class="grow">Category
            <input id="lnCategory" class="input" placeholder="protein / dairy / paper..." value="${escapeAttr(ln.category||"")}" />
          </label>
        </div>

        <label>Notes
          <input id="lnNotes" class="input" placeholder="credits, weird packaging, etc." value="${escapeAttr(ln.notes||"")}" />
        </label>
</div>

        <div class="row">
          <button class="btn" id="btnSaveLine">Save</button>
          <button class="btn ghost" id="btnMatchOrCreate">Match / Create Item</button>
          <button class="btn ghost" id="btnDeleteLine">Delete Line</button>
          <span class="hint grow" id="lineStatus"></span>
        </div>
      </div>
    `;

    $("#lnGroup").value = ln.group || "ingredients";

    // datalist
    ensureDatalist("itemsDatalist2", db.items.map(i=>i.name));
    $("#lnItem").setAttribute("list","itemsDatalist2");

    $("#btnCloseEditLine")?.addEventListener("click", () => { $("#pasteModal").classList.add("hidden"); renderInvoices(); });

    $("#btnSaveLine")?.addEventListener("click", () => {
      ln.qty = parseNum($("#lnQty").value || "0") || 0;
      ln.unit = $("#lnUnit").value.trim() || ln.unit;
      ln.unitCost = parseNum($("#lnCost").value || "0") || 0;
      ln.group = $("#lnGroup").value;
      ln.category = $("#lnCategory").value.trim();
      ln.notes = $("#lnNotes").value.trim();

      // update rawName if not matched
      const typed = $("#lnItem").value.trim();
      if(!ln.itemId) ln.rawName = typed;

      saveDBDebounced();
      $("#lineStatus").textContent = "Saved ✅";
      setTimeout(() => $("#pasteModal").classList.add("hidden"), 400);
      renderInvoices();
    });

    $("#btnMatchOrCreate")?.addEventListener("click", () => {
      const typed = $("#lnItem").value.trim();
      if(!typed) return notify("Type an item name.");
      const match = findBestItem(typed);
      if(match){
        ln.itemId = match.id;
        ln.rawName = typed;
        ln.group = match.group || ln.group;
        ln.category = match.category || ln.category;
        ln.unit = ln.unit || match.baseUnit || "ea";
        if(!ln.unitCost) ln.unitCost = match.defaultCost || 0;
        saveDBDebounced();
        $("#lineStatus").textContent = "Matched ✅";
      }else{
        if(!confirm(`No match for "${typed}". Create a new master item?`)) return;
        const item = { id: uid(), name: typed, group: $("#lnGroup").value, category: $("#lnCategory").value.trim(), baseUnit: "ea", unitsPerCase: 0, defaultCost: parseNum($("#lnCost").value||"0")||0, aliases: [] };
        db.items.push(item);
        ln.itemId = item.id;
        ln.rawName = typed;
        saveDBDebounced();
        $("#lineStatus").textContent = "Created ✅";
      }
      renderInvoices();
    });

    $("#btnDeleteLine")?.addEventListener("click", () => {
      if(!confirm("Delete this line?")) return;
      const idx = inv.lines.findIndex(x => x.id === ln.id);
      if(idx>=0) inv.lines.splice(idx,1);
      saveDBDebounced();
      $("#pasteModal").classList.add("hidden");
      renderInvoices();
    });
  }

  function getUnmatchedLines(monthId){
    const out = [];
    for(const inv of db.invoices){
      if(inv.monthId !== monthId) continue;
      for(const ln of inv.lines||[]){
        if(!ln.itemId){
          out.push({ inv, ln });
        }
      }
    }
    return out;
  }

  function renderRecipes(){
    const list = $("#recipeList");
    list.innerHTML = "";
    const recipes = db.recipes.filter(r => r.type === recipeFilter);
    if(recipes.length === 0){
      list.innerHTML = `<div class="hint">No ${recipeFilter} recipes yet. Create one.</div>`;
    }else{
      recipes.forEach(r => {
        const el = document.createElement("div");
        el.className = "item";
        const cost = estimateRecipeCost(r);
        el.innerHTML = `<div class="left"><div class="title">${escapeHtml(r.name || "(Recipe)")}</div><div class="meta">${r.type} • ${r.lines.length} line(s)</div></div><div class="right"><span class="badge">${money(cost)}</span><button class="btn ghost">Edit</button></div>`;
        el.querySelector("button").addEventListener("click", () => { currentRecipeId = r.id; renderRecipes(); });
        el.addEventListener("click", () => { currentRecipeId = r.id; renderRecipes(); });
        list.appendChild(el);
      });
    }

    const editor = $("#recipeEditor");
    const r = db.recipes.find(x => x.id === currentRecipeId) || null;
    $("#btnDeleteRecipe").disabled = !r;

    if(!r){
      $("#recipeEditorTitle").textContent = "Recipe Editor";
      $("#recipeEditorSub").textContent = "Create or select a recipe";
      editor.innerHTML = `<div class="hint">Portion recipes = per plate. Batch recipes = yields. Batch auto-creates an inventory item you can count and use as ingredient.</div>`;
      return;
    }

    $("#recipeEditorTitle").textContent = (r.type === "batch" ? "Batch" : "Portion") + " • " + (r.name || "(Recipe)");
    $("#recipeEditorSub").textContent = "Card editor • live cost updates";

    ensureDatalist("itemsDatalist3", db.items.map(i=>i.name));

    editor.innerHTML = `
      <label>Name
        <input id="rName" class="input" value="${escapeAttr(r.name||"")}" placeholder="e.g., Caesar Salad" />
      </label>

      ${r.type==="batch" ? `
      <div class="row">
        <label class="grow">Yield Qty
          <input id="rYieldQty" class="input" inputmode="decimal" value="${escapeAttr(r.yieldQty||1)}" />
        </label>
        <label class="grow">Yield Unit
          <input id="rYieldUnit" class="input" value="${escapeAttr(r.yieldUnit||"qt")}" />
        </label>
      </div>
      <div class="hint">Batch auto-sync: saved batch becomes an inventory item with cost per yield unit.</div>
      ` : `
      <div class="hint">Portion recipe costs are per portion (yield=1 portion).</div>
      `}

      <div class="divider"></div>

      <div class="row">
        <button class="btn" id="btnAddRecipeLine">+ Ingredient</button>
        <button class="btn ghost" id="btnSyncBatch" ${r.type==="batch" ? "" : "disabled"}>Sync Batch → Inventory</button>
        <span class="badge">Est. Cost: ${money(estimateRecipeCost(r))}</span>
      </div>

      <div id="recipeLines" class="list"></div>

      <label>Notes
        <input id="rNotes" class="input" value="${escapeAttr(r.notes||"")}" placeholder="prep notes…" />
      </label>
    `;

    $("#rName")?.addEventListener("input", (e)=>{ r.name = e.target.value; saveDBDebounced(); renderRecipes(); });

    if(r.type==="batch"){
      $("#rYieldQty")?.addEventListener("input", (e)=>{ r.yieldQty = parseNum(e.target.value||"1")||1; saveDBDebounced(); renderRecipes(); });
      $("#rYieldUnit")?.addEventListener("input", (e)=>{ r.yieldUnit = e.target.value; saveDBDebounced(); renderRecipes(); });
    }

    $("#rNotes")?.addEventListener("input", (e)=>{ r.notes = e.target.value; saveDBDebounced(); });

    $("#btnAddRecipeLine")?.addEventListener("click", () => {
      r.lines.push({ id: uid(), itemId: null, qty: 0, unit: "ea" });
      saveDBDebounced(); renderRecipes();
    });

    $("#btnSyncBatch")?.addEventListener("click", () => {
      syncBatchToInventory(r);
      saveDBDebounced(); renderRecipes(); renderAll();
      notify("Batch synced to inventory.");
    });

    // lines
    const linesBox = $("#recipeLines");
    linesBox.innerHTML = "";
    r.lines.forEach(line => {
      const it = line.itemId ? db.items.find(i=>i.id===line.itemId) : null;
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="left">
          <div class="title">${escapeHtml(it?.name || "(Choose item)")}</div>
          <div class="meta">${escapeHtml(String(line.qty||0))} ${escapeHtml(line.unit||"")}</div>
        </div>
        <div class="right">
          <button class="btn ghost" data-act="edit">Edit</button>
          <button class="btn ghost" data-act="del">Delete</button>
        </div>
      `;
      el.querySelector('[data-act="edit"]').addEventListener("click", (e) => {
        e.stopPropagation();
        editRecipeLine(r, line);
      });
      el.querySelector('[data-act="del"]').addEventListener("click", (e) => {
        e.stopPropagation();
        r.lines = r.lines.filter(x=>x.id!==line.id);
        saveDBDebounced(); renderRecipes();
      });
      el.addEventListener("click", () => editRecipeLine(r, line));
      linesBox.appendChild(el);
    });

    // auto-sync batch if type batch and has name
    if(r.type==="batch" && r.name.trim()){
      syncBatchToInventory(r, true);
      saveDBDebounced();
    }
  }

  function editRecipeLine(recipe, line){
    const modal = $("#pasteModal");
    modal.classList.remove("hidden");

    const card = modal.querySelector(".overlay-card");
    ensureDatalist("itemsDatalist4", db.items.map(i=>i.name));
    const it = line.itemId ? db.items.find(i=>i.id===line.itemId) : null;

    card.innerHTML = `
      <div class="overlay-h">
        <div>
          <div class="overlay-title">Edit Ingredient</div>
          <div class="overlay-sub">Pick item, qty, unit</div>
        </div>
        <button class="btn ghost" id="btnCloseEditRecipeLine">Close</button>
      </div>

      <label>Item
        <input id="rlItem" class="input" list="itemsDatalist4" value="${escapeAttr(it?.name||"")}" placeholder="search item…" />
      </label>

      <div class="row">
        <label class="grow">Qty
          <input id="rlQty" class="input" inputmode="decimal" value="${escapeAttr(line.qty||0)}" />
        </label>
        <label class="grow">Unit
          <input id="rlUnit" class="input" value="${escapeAttr(line.unit||"ea")}" />
        </label>
      </div>

      <div class="row">
        <button class="btn" id="btnSaveRecipeLine">Save</button>
        <button class="btn ghost" id="btnDeleteRecipeLine">Delete</button>
        <span class="hint grow" id="rlStatus"></span>
      </div>
    `;

    $("#btnCloseEditRecipeLine")?.addEventListener("click", () => { $("#pasteModal").classList.add("hidden"); renderRecipes(); });
    $("#btnSaveRecipeLine")?.addEventListener("click", () => {
      const typed = $("#rlItem").value.trim();
      const match = findBestItem(typed);
      if(!match) return notify("Choose an existing item (or create it first in Dashboard Quick Add).");
      line.itemId = match.id;
      line.qty = parseNum($("#rlQty").value||"0")||0;
      line.unit = $("#rlUnit").value.trim() || (match.baseUnit||"ea");
      saveDBDebounced();
      $("#rlStatus").textContent = "Saved ✅";
      setTimeout(()=>{ $("#pasteModal").classList.add("hidden"); renderRecipes(); }, 300);
    });
    $("#btnDeleteRecipeLine")?.addEventListener("click", () => {
      recipe.lines = recipe.lines.filter(x => x.id !== line.id);
      saveDBDebounced();
      $("#pasteModal").classList.add("hidden");
      renderRecipes();
    });
  }

  function estimateRecipeCost(recipe){
    let total = 0;
    for(const ln of recipe.lines||[]){
      const it = ln.itemId ? db.items.find(i=>i.id===ln.itemId) : null;
      if(!it) continue;
      const qty = parseNum(ln.qty)||0;
      const cost = parseNum(it.defaultCost)||0;
      // minimal: treat cost per base unit
      total += qty * cost;
    }
    // if batch, return cost per yield unit
    if(recipe.type==="batch"){
      const y = parseNum(recipe.yieldQty)||1;
      if(y>0) total = total / y;
    }
    return total;
  }

  function syncBatchToInventory(batchRecipe, silent=false){
    if(batchRecipe.type !== "batch") return;
    const name = (batchRecipe.name||"").trim();
    if(!name) return;
    const costPerUnit = estimateRecipeCost(batchRecipe); // already /yield
    // find existing item by exact name
    let item = db.items.find(i => normalize(i.name) === normalize(name));
    if(!item){
      item = { id: uid(), name, group:"batch", category:"batch", baseUnit: batchRecipe.yieldUnit || "qt", unitsPerCase: 0, defaultCost: costPerUnit, aliases: [] };
      db.items.push(item);
      if(!silent) notify("Created inventory item for batch: " + name);
    }else{
      item.group = "batch";
      item.baseUnit = batchRecipe.yieldUnit || item.baseUnit || "qt";
      item.defaultCost = costPerUnit;
    }
  }

  function renderReports(){
    const month = getMonth();

    const ing = computeCOGS(month, "ingredients");
    $("#repBeginIng").textContent = money(ing.begin);
    $("#repPurchIng").textContent = money(ing.purch);
    $("#repEndIng").textContent = money(ing.endv);
    $("#repCogsIng").textContent = money(ing.cogs);

    const prod = computeCOGS(month, "products");
    const denom = (month.sales?.foodNet||0);
    $("#repCogsPct").textContent = denom>0 ? pct((ing.cogs+prod.cogs)/denom) : "—";

    const fbox = $("#findingsList");
    fbox.innerHTML = "";
    const fs = db.findings.filter(f => f.monthId === month.id);
    if(fs.length === 0){
      fbox.innerHTML = `<div class="hint">No findings yet. Add notes while counting and save as Findings.</div>`;
    }else{
      fs.forEach(f => {
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `<div class="left"><div class="title">${escapeHtml(f.locationName || "")}${f.sectionName ? " • "+escapeHtml(f.sectionName) : ""}</div><div class="meta">${escapeHtml(f.text)}</div></div><div class="right"><span class="badge">${new Date(f.createdAt).toLocaleString()}</span></div>`;
        fbox.appendChild(el);
      });
    }

    const ubox = $("#unmatchedList");
    ubox.innerHTML = "";
    const um = getUnmatchedLines(month.id);
    if(um.length === 0){
      ubox.innerHTML = `<div class="hint">No unmatched invoice lines. Nice.</div>`;
    }else{
      um.forEach(({inv, ln}) => {
        const el = document.createElement("div");
        el.className = "item";
        const ext = (parseNum(ln.qty)||0) * (parseNum(ln.unitCost)||0);
        el.innerHTML = `<div class="left"><div class="title">${escapeHtml(ln.rawName || "(Item)")}</div><div class="meta">${escapeHtml(inv.vendor||"(Vendor)")} • ${escapeHtml(inv.date||"")}</div></div><div class="right"><span class="badge">${money(ext)}</span><button class="btn ghost">Fix</button></div>`;
        el.querySelector("button").addEventListener("click", (e) => {
          e.stopPropagation();
          goTab("invoices");
          currentInvoiceId = inv.id;
          renderInvoices();
          setTimeout(() => {
            const inv2 = db.invoices.find(i=>i.id===inv.id);
            const ln2 = inv2?.lines?.find(x=>x.id===ln.id);
            if(inv2 && ln2) openLineEditor(inv2, ln2);
          }, 50);
        });
        ubox.appendChild(el);
      });
    }
    const pmixInput = $("#pmixInput");
    if(pmixInput && Array.isArray(db.pmix)){
      pmixInput.value = db.pmix.map(r => `${r.name},${r.qty}`).join("\n");
    }
    renderCOGS();
    renderManagerActions();
    renderMonthlySummary();
    renderPeriodStatus();
  }

  async function exportMonthZip(){
    const month = getMonth();
    const ing = computeCOGS(month, "ingredients");
    const prod = computeCOGS(month, "products");

    const report = buildMonthReportHTML(month, ing, prod);
    const itemsCsv = buildItemsCSV();
    const invoiceCsv = buildInvoicesCSV(month.id);
    const exceptionsCsv = buildExceptionsCSV(month.id);

    const payload = {
      exportedAt: new Date().toISOString(),
      month: month.label,
      data: db
    };

    const filenameBase = safeFile(month.label || "month") + "_report";

    // Try JSZip, fallback to multiple downloads
    try{
      if(typeof JSZip === "undefined"){
        console.warn("JSZip not loaded");
        return;
      }
      const zip = new JSZip();
      zip.file("month_report.html", report);
      zip.file("items.csv", itemsCsv);
      zip.file("invoices.csv", invoiceCsv);
      zip.file("exceptions.csv", exceptionsCsv);
      zip.file("data_export.json", JSON.stringify(payload, null, 2));
      const blob = await zip.generateAsync({type:"blob"});
      downloadBlob(`${filenameBase}.zip`, blob);
      openEmailDraft(month, filenameBase + ".zip");
    }catch(err){
      console.warn("ZIP export failed, fallback:", err);
      downloadText(`${filenameBase}.html`, report, "text/html");
      downloadText(`${filenameBase}_items.csv`, itemsCsv, "text/csv");
      downloadText(`${filenameBase}_invoices.csv`, invoiceCsv, "text/csv");
      downloadText(`${filenameBase}_exceptions.csv`, exceptionsCsv, "text/csv");
      downloadJSON(`${filenameBase}_data_export.json`, payload);
      openEmailDraft(month, "(attach downloaded files)");
      notify("ZIP library unavailable (offline). Exported separate files instead.");
    }
  }

  function openEmailDraft(month, attachmentName){
    const to = encodeURIComponent(db.settings.reportEmail || "");
    const subject = encodeURIComponent(`Month Report — ${month.label}`);
    const body = encodeURIComponent(
      `Attached: ${attachmentName}\n\n` +
      `Month: ${month.label}\n` +
      `Generated: ${new Date().toLocaleString()}\n\n` +
      `Notes: (add anything here)\n`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  function buildMonthReportHTML(month, ing, prod){
    const denom = (month.sales?.foodNet||0);
    const cogsPct = denom>0 ? pct((ing.cogs+prod.cogs)/denom) : "—";
    return `<!doctype html><html><head><meta charset="utf-8"><title>Month Report — ${escapeHtml(month.label)}</title>
      <style>
        body{font-family: Arial, sans-serif; padding:24px; color:#111;}
        h1{margin:0 0 6px;}
        .sub{color:#555; margin-bottom:18px;}
        .kv{display:grid; grid-template-columns: 1fr auto; gap:10px 18px; max-width:520px;}
        .k{color:#555;}
        .v{font-weight:700;}
        table{border-collapse:collapse; width:100%; margin-top:18px;}
        th,td{border:1px solid #ddd; padding:8px; text-align:left;}
        th{background:#f4f4f4;}
      </style></head><body>
      <h1>Month Report — ${escapeHtml(month.label)}</h1>
      <div class="sub">Kitchen Inventory export • ${new Date().toLocaleString()}</div>
      <div class="kv">
        <div class="k">Food+NA Net Sales</div><div class="v">${money(month.sales?.foodNet||0)}</div>
        <div class="k">Ingredients COGS</div><div class="v">${money(ing.cogs)}</div>
        <div class="k">Products COGS</div><div class="v">${money(prod.cogs)}</div>
        <div class="k">COGS% vs Food+NA Net</div><div class="v">${cogsPct}</div>
      </div>
      <h2>Invoices (Summary)</h2>
      ${htmlInvoicesTable(month.id)}
      <h2>Findings</h2>
      ${htmlFindings(month.id)}
      </body></html>`;
  }

  function htmlInvoicesTable(monthId){
    const invs = db.invoices.filter(i => i.monthId === monthId);
    if(invs.length===0) return "<p>No invoices.</p>";
    const rows = invs.map(inv => {
      const total = (inv.lines||[]).reduce((s,l)=>s+(parseNum(l.qty)||0)*(parseNum(l.unitCost)||0),0);
      return `<tr><td>${escapeHtml(inv.vendor||"")}</td><td>${escapeHtml(inv.number||"")}</td><td>${escapeHtml(inv.date||"")}</td><td>${inv.lines.length}</td><td>${money(total)}</td></tr>`;
    }).join("");
    return `<table><thead><tr><th>Vendor</th><th>Invoice #</th><th>Date</th><th>Lines</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function htmlFindings(monthId){
    const fs = db.findings.filter(f=>f.monthId===monthId);
    if(fs.length===0) return "<p>No findings.</p>";
    return "<ul>" + fs.map(f => `<li><b>${escapeHtml(f.locationName||"")}${f.sectionName ? " • "+escapeHtml(f.sectionName) : ""}:</b> ${escapeHtml(f.text)}</li>`).join("") + "</ul>";
  }

  function buildItemsCSV(){
    const cols = ["name","group","category","baseUnit","unitsPerCase","defaultCost"];
    const lines = [cols.join(",")];
    for(const it of db.items){
      lines.push(cols.map(c => csvCell(it[c])).join(","));
    }
    return lines.join("\n");
  }

  function buildInvoicesCSV(monthId){
    const cols = ["vendor","invoiceNumber","date","lineItem","qty","unit","unitCost","extended","group","category","matchedItemName","notes"];
    const out = [cols.join(",")];
    const invs = db.invoices.filter(i=>i.monthId===monthId);
    for(const inv of invs){
      for(const ln of inv.lines||[]){
        const it = ln.itemId ? db.items.find(i=>i.id===ln.itemId) : null;
        const ext = (parseNum(ln.qty)||0)*(parseNum(ln.unitCost)||0);
        out.push([
          inv.vendor, inv.number, inv.date,
          (it?.name || ln.rawName),
          ln.qty, ln.unit, ln.unitCost, ext,
          ln.group, ln.category,
          it?.name || "",
          ln.notes
        ].map(csvCell).join(","));
      }
    }
    return out.join("\n");
  }

  function buildExceptionsCSV(monthId){
    const month = getMonthById(monthId);
    const rows = [];
    // missing costs
    db.items.forEach(it => {
      if((it.group==="ingredients" || it.group==="products") && (!it.defaultCost || Number(it.defaultCost)<=0)){
        rows.push(["missing_cost", it.name, it.group, it.category, "defaultCost<=0"]);
      }
    });
    // unmatched lines
    getUnmatchedLines(monthId).forEach(({inv, ln}) => {
      rows.push(["unmatched_invoice_line", ln.rawName, inv.vendor, inv.date, "no itemId match"]);
    });
    const cols = ["type","a","b","c","details"];
    return [cols.join(","), ...rows.map(r=>r.map(csvCell).join(","))].join("\n");
  }

  // -------- Downloads --------
  function downloadText(name, text, mime="text/plain"){
    const blob = new Blob([text], {type: mime});
    downloadBlob(name, blob);
  }
  function downloadJSON(name, obj){
    downloadText(name, JSON.stringify(obj, null, 2), "application/json");
  }
  function downloadBlob(name, blob){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2500);
  }

  // -------- CSV helpers --------
  function csvCell(v){
    if(v===null || v===undefined) return "";
    const s = String(v);
    if(/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
    return s;
  }

  // -------- HTML escape --------
  function escapeHtml(s){
    return String(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  }
  function escapeAttr(s){
    return String(s||"").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
  }
  function safeFile(s){
    return String(s||"").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toLowerCase();
  }

  function buildDemoData(){
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), 1);
    const prev = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const monthLabel = (d) => "DEMO " + d.toLocaleString(undefined, { month: "long" }) + " " + d.getFullYear();
    const mkItem = (name, group, category, baseUnit, defaultCost, unitsPerCase=0) => ({ id: uid(), name, group, category, baseUnit, unitsPerCase, defaultCost, aliases: [] });

    const items = [
      mkItem("Chicken Thigh","ingredients","protein","lb",2.95),
      mkItem("Ground Beef","ingredients","protein","lb",4.15),
      mkItem("Salmon Fillet","ingredients","protein","lb",8.8),
      mkItem("Roma Tomato","ingredients","produce","lb",1.18),
      mkItem("Romaine Hearts","ingredients","produce","ea",1.05),
      mkItem("Yellow Onion","ingredients","produce","lb",0.85),
      mkItem("Olive Oil","ingredients","oil","qt",8.6),
      mkItem("Canola Oil","ingredients","oil","qt",6.1),
      mkItem("Garlic Puree","ingredients","sauce","qt",4.25),
      mkItem("Burger Bun","products","bread","ea",0.41,48),
      mkItem("Ciabatta Roll","products","bread","ea",0.52,36),
      mkItem("French Fries","products","frozen","lb",1.62),
      mkItem("Takeout Box","nonfood","packaging","ea",0.21,200),
      mkItem("Soup Cup 16oz","nonfood","packaging","ea",0.14,250),
      mkItem("Nitrile Gloves","nonfood","sanitation","ea",0.08,1000),
      mkItem("House Marinara","batch","sauce","qt",5.4),
      mkItem("Pickled Onions","batch","prep","qt",2.9),
      mkItem("Lemon Herb Aioli","batch","sauce","qt",4.8)
    ];
    const byName = Object.fromEntries(items.map(i => [i.name, i]));
    byName["Roma Tomato"].aliases.push("tomatoes");
    byName["Ground Beef"].aliases.push("beef grind");
    byName["French Fries"].aliases.push("fries");

    const prev2 = new Date(now.getFullYear(), now.getMonth()-2, 1);
    const prev3 = new Date(now.getFullYear(), now.getMonth()-3, 1);
    const curMonth = { id: uid(), label: monthLabel(cur), year: cur.getFullYear(), month: cur.getMonth()+1, sales:{foodNet:52840,totalNet:61820}, begin:{}, purchases:[], end:{counts:{}} };
    const prevMonth = { id: uid(), label: monthLabel(prev), year: prev.getFullYear(), month: prev.getMonth()+1, sales:{foodNet:48710,totalNet:57140}, begin:{}, purchases:[], end:{counts:{}} };
    const prev2Month = { id: uid(), label: monthLabel(prev2), year: prev2.getFullYear(), month: prev2.getMonth()+1, sales:{foodNet:45220,totalNet:53640}, begin:{}, purchases:[], end:{counts:{}} };
    const prev3Month = { id: uid(), label: monthLabel(prev3), year: prev3.getFullYear(), month: prev3.getMonth()+1, sales:{foodNet:43890,totalNet:51720}, begin:{}, purchases:[], end:{counts:{}} };
    const curMonthId = curMonth.id;
    const setCount = (m, name, qty, unit) => { m.end.counts[byName[name].id] = { qty, unit: unit || byName[name].baseUnit }; };
    const setTrend = (name, q0, q1, q2, q3, unit) => {
      setCount(curMonth, name, q0, unit);
      setCount(prevMonth, name, q1, unit);
      setCount(prev2Month, name, q2, unit);
      setCount(prev3Month, name, q3, unit);
    };

    setTrend("Chicken Thigh",61,78,82,75,"lb");
    setTrend("Ground Beef",52,64,66,58,"lb");
    setTrend("Salmon Fillet",19,25,27,22,"lb");
    setTrend("Roma Tomato",41,52,48,45,"lb");
    setTrend("Romaine Hearts",17,24,22,20,"ea");
    setTrend("Yellow Onion",21,34,31,29,"lb");
    setTrend("Olive Oil",10,14,16,13,"qt");
    setTrend("Canola Oil",16,22,19,18,"qt");
    setTrend("Garlic Puree",6,8,8,7,"qt");
    setTrend("Burger Bun",188,230,214,198,"ea");
    setTrend("Ciabatta Roll",89,122,118,106,"ea");
    setTrend("French Fries",102,140,132,121,"lb");
    setTrend("Takeout Box",275,410,390,355,"ea");
    setTrend("Soup Cup 16oz",342,510,488,460,"ea");
    setTrend("House Marinara",7,11,10,9,"qt");
    setTrend("Pickled Onions",5,8,7,6,"qt");
    setTrend("Lemon Herb Aioli",4,6,6,5,"qt");

    const mkLine = (name, qty, unit, unitCost, group, category, matched=true, notes="") => ({
      id: uid(), rawName: name, itemId: matched ? byName[name]?.id || null : null, qty, unit, unitCost, group, category, notes
    });
    const mkInv = (vendor, number, lines, notes="", monthId=curMonthId) => ({
      id: uid(), monthId, vendor, number, date: nowISO(), notes, createdAt: new Date().toISOString(), lines
    });
    const invoices = [
      mkInv("US Foods","US-44812",[mkLine("Chicken Thigh",96,"lb",2.82,"ingredients","protein"),mkLine("Ground Beef",90,"lb",4.02,"ingredients","protein"),mkLine("Burger Bun",288,"ea",0.39,"products","bread"),mkLine("Takeout Box",500,"ea",0.18,"nonfood","packaging")],"Tuesday truck"),
      mkInv("Sysco","SY-77104",[mkLine("Olive Oil",12,"qt",8.95,"ingredients","oil"),mkLine("Canola Oil",18,"qt",5.98,"ingredients","oil"),mkLine("French Fries",140,"lb",1.56,"products","frozen"),mkLine("Soup Cup 16oz",600,"ea",0.13,"nonfood","packaging")],"Weekend load-in"),
      mkInv("Local Produce Co","LP-1022",[mkLine("Roma Tomato",88,"lb",1.12,"ingredients","produce"),mkLine("Romaine Hearts",42,"ea",0.95,"ingredients","produce"),mkLine("Yellow Onion",70,"lb",0.79,"ingredients","produce"),mkLine("Cherry Tomato Medley",24,"lb",1.44,"ingredients","produce",false,"Needs mapping"),mkLine("Micro Basil Clamshell",18,"ea",2.1,"ingredients","produce",false,"New product code not mapped")]),
      mkInv("Sea Hub","SH-2218",[mkLine("Salmon Fillet",38,"lb",8.52,"ingredients","protein"),mkLine("Lemon Herb Aioli",6,"qt",4.65,"batch","sauce")],"Friday fish delivery"),
      mkInv("PrepSource","PS-9004",[mkLine("House Marinara",10,"qt",5.25,"batch","sauce"),mkLine("Pickled Onions",8,"qt",2.72,"batch","prep"),mkLine("Garlic Puree",7,"qt",4.11,"ingredients","sauce")]),
      mkInv("Metro Wholesale","MW-3301",[mkLine("Ciabatta Roll",180,"ea",0.48,"products","bread"),mkLine("Nitrile Gloves",400,"ea",0.07,"nonfood","sanitation"),mkLine("Unknown Bread Crumbs",12,"lb",1.9,"ingredients","dry",false,"Label mismatch"),mkLine("Fryer Filter Pad XL",30,"ea",1.35,"nonfood","paper",false,"Needs item setup")]),
      mkInv("US Foods","US-44791",[mkLine("Chicken Thigh",84,"lb",2.76,"ingredients","protein"),mkLine("Burger Bun",264,"ea",0.38,"products","bread")],"Previous month delivery", prevMonth.id),
      mkInv("Local Produce Co","LP-1014",[mkLine("Roma Tomato",76,"lb",1.05,"ingredients","produce"),mkLine("Yellow Onion",63,"lb",0.77,"ingredients","produce")],"Previous month produce", prevMonth.id),
      mkInv("Sysco","SY-76880",[mkLine("French Fries",130,"lb",1.51,"products","frozen"),mkLine("Takeout Box",460,"ea",0.17,"nonfood","packaging")],"Previous month stock", prevMonth.id),
      mkInv("US Foods","US-44620",[mkLine("Ground Beef",92,"lb",3.92,"ingredients","protein"),mkLine("Ciabatta Roll",150,"ea",0.46,"products","bread")],"Two months back", prev2Month.id),
      mkInv("PrepSource","PS-8911",[mkLine("House Marinara",9,"qt",5.1,"batch","sauce"),mkLine("Pickled Onions",7,"qt",2.66,"batch","prep")],"Two months back prep", prev2Month.id),
      mkInv("Sea Hub","SH-2108",[mkLine("Salmon Fillet",33,"lb",8.31,"ingredients","protein"),mkLine("Lemon Herb Aioli",5,"qt",4.52,"batch","sauce")],"Three months back fish", prev3Month.id),
      mkInv("Metro Wholesale","MW-3180",[mkLine("Soup Cup 16oz",520,"ea",0.12,"nonfood","packaging"),mkLine("Nitrile Gloves",350,"ea",0.068,"nonfood","sanitation")],"Three months back disposables", prev3Month.id)
    ];

    const recipes = [
      { id: uid(), type:"portion", name:"Grilled Chicken Plate", yieldQty:1, yieldUnit:"portion", notes:"High runner", lines:[{id:uid(),itemId:byName["Chicken Thigh"].id,qty:0.62,unit:"lb"},{id:uid(),itemId:byName["Roma Tomato"].id,qty:0.18,unit:"lb"},{id:uid(),itemId:byName["Olive Oil"].id,qty:0.04,unit:"qt"}] },
      { id: uid(), type:"portion", name:"Smash Burger", yieldQty:1, yieldUnit:"portion", notes:"Weekend promo", lines:[{id:uid(),itemId:byName["Ground Beef"].id,qty:0.36,unit:"lb"},{id:uid(),itemId:byName["Burger Bun"].id,qty:1,unit:"ea"},{id:uid(),itemId:byName["Lemon Herb Aioli"].id,qty:0.03,unit:"qt"}] },
      { id: uid(), type:"portion", name:"Salmon Sandwich", yieldQty:1, yieldUnit:"portion", notes:"Lunch menu", lines:[{id:uid(),itemId:byName["Salmon Fillet"].id,qty:0.28,unit:"lb"},{id:uid(),itemId:byName["Ciabatta Roll"].id,qty:1,unit:"ea"},{id:uid(),itemId:byName["Romaine Hearts"].id,qty:0.15,unit:"ea"}] },
      { id: uid(), type:"batch", name:"House Marinara", yieldQty:8, yieldUnit:"qt", notes:"Prep Tue/Fri", lines:[{id:uid(),itemId:byName["Roma Tomato"].id,qty:18,unit:"lb"},{id:uid(),itemId:byName["Garlic Puree"].id,qty:1.8,unit:"qt"},{id:uid(),itemId:byName["Olive Oil"].id,qty:1.2,unit:"qt"}] },
      { id: uid(), type:"batch", name:"Pickled Onions", yieldQty:6, yieldUnit:"qt", notes:"For burgers", lines:[{id:uid(),itemId:byName["Yellow Onion"].id,qty:12,unit:"lb"}] },
      { id: uid(), type:"batch", name:"Lemon Herb Aioli", yieldQty:5, yieldUnit:"qt", notes:"Sauce station", lines:[{id:uid(),itemId:byName["Olive Oil"].id,qty:1.5,unit:"qt"},{id:uid(),itemId:byName["Garlic Puree"].id,qty:0.8,unit:"qt"}] }
    ];

    const mkSection = (name, itemNames) => ({ id: uid(), name, itemIds: itemNames.map(n => byName[n].id), overrides: {}, _counts: {} });
    const walkInPrep = mkSection("Prep Shelf",["Chicken Thigh","Ground Beef","Romaine Hearts","Roma Tomato","Yellow Onion","Olive Oil","Canola Oil","Garlic Puree"]);
    const lineExpo = mkSection("Expo",["Burger Bun","Ciabatta Roll","French Fries","House Marinara","Lemon Herb Aioli","Pickled Onions"]);
    const dryStorage = mkSection("Dry Shelf",["Takeout Box","Soup Cup 16oz","Nitrile Gloves"]);
    [walkInPrep,lineExpo,dryStorage].forEach(sec => {
      const sectionCounts = {};
      sec.itemIds.forEach(id => {
        const c = curMonth.end.counts[id];
        if(c) sectionCounts[id] = { qty: c.qty, unit: c.unit };
      });
      sec._counts[curMonthId] = sectionCounts;
    });

    const kitchen = {
      locations: [
        { id: uid(), name: "Walk-In", sections: [walkInPrep] },
        { id: uid(), name: "Line", sections: [lineExpo] },
        { id: uid(), name: "Dry Storage", sections: [dryStorage] },
        { id: uid(), name: "Freezer", sections: [mkSection("Frozen Rack",["French Fries"])] }
      ]
    };

    const invTotalByMonthAndGroups = (monthId, groups) => invoices
      .filter(inv => inv.monthId === monthId)
      .reduce((sum, inv) => sum + (inv.lines||[]).reduce((s, ln) => {
        if(!groups.has(ln.group)) return s;
        return s + ((Number(ln.qty)||0) * (Number(ln.unitCost)||0));
      }, 0), 0);
    const invValueByMonthAndGroups = (month, groups) => (items||[]).reduce((sum, it) => {
      if(!groups.has(it.group)) return sum;
      const c = month?.end?.counts?.[it.id];
      if(!c) return sum;
      return sum + ((Number(c.qty)||0) * (Number(it.defaultCost)||0));
    }, 0);
    const cogsGroups = new Set(["ingredients","products"]);
    const beginInventory = invValueByMonthAndGroups(prevMonth, cogsGroups);
    const purchasesTotal = invTotalByMonthAndGroups(curMonthId, cogsGroups);
    const endInventory = invValueByMonthAndGroups(curMonth, cogsGroups);
    const periodSnapshot = {};
    items.forEach(i => { periodSnapshot[i.name] = Number(i.defaultCost||0); });

    recipes.forEach(r => {
      if(r.type !== "portion") return;
      r.cost = (r.lines||[]).reduce((s, ln) => {
        const it = items.find(x => x.id === ln.itemId);
        return s + ((Number(ln.qty)||0) * (Number(it?.defaultCost||0)));
      }, 0);
    });

    return {
      version: "v8",
      settings: { reportEmail: "chef@demo-restaurant.com", demoMode: true },
      period: { locked: true, lockedAt: new Date().toISOString(), beginConfirmed: true, costSnapshot: periodSnapshot },
      items,
      kitchen,
      pmix: [
        { name: "Grilled Chicken Plate", qty: 980 },
        { name: "Smash Burger", qty: 1420 },
        { name: "Salmon Sandwich", qty: 620 },
        { name: "Family Meal Pasta", qty: 160 }
      ],
      unmatched: [
        { rawName: "Cherry Tomato Medley" },
        { rawName: "Unknown Bread Crumbs" },
        { rawName: "Micro Basil Clamshell" },
        { rawName: "Fryer Filter Pad XL" }
      ],
      sales: [
        { date: nowISO(), amount: curMonth.sales.foodNet }
      ],
      beginInventory,
      purchases: [
        { vendor: "All Vendors", extended: purchasesTotal }
      ],
      endInventory,
      months: [curMonth, prevMonth, prev2Month, prev3Month],
      invoices,
      findings: [
        { id: uid(), monthId: curMonthId, createdAt: new Date().toISOString(), locationName: "Walk-In", sectionName: "Prep Shelf", text: "Opened chicken case had two leaky cryovacs. Waste logged." },
        { id: uid(), monthId: curMonthId, createdAt: new Date().toISOString(), locationName: "Line", sectionName: "Expo", text: "Aioli backup moved to lowboy and not logged at handoff." },
        { id: uid(), monthId: curMonthId, createdAt: new Date().toISOString(), locationName: "Dry Storage", sectionName: "Dry Shelf", text: "Soup cups arrived in mixed sleeve counts; verify pack size." },
        { id: uid(), monthId: curMonthId, createdAt: new Date().toISOString(), locationName: "Walk-In", sectionName: "Prep Shelf", text: "Romaine case temp logged high at receiving; quality check requested." },
        { id: uid(), monthId: curMonthId, createdAt: new Date().toISOString(), locationName: "Line", sectionName: "Expo", text: "Burger bun par exceeded by 3 sleeves after event night." },
        { id: uid(), monthId: prevMonth.id, createdAt: new Date().toISOString(), locationName: "Walk-In", sectionName: "Prep Shelf", text: "Tomatoes overripe from late truck; reduced yield." },
        { id: uid(), monthId: prevMonth.id, createdAt: new Date().toISOString(), locationName: "Line", sectionName: "Expo", text: "Burger bun sleeve count mismatch found mid-shift." },
        { id: uid(), monthId: prev2Month.id, createdAt: new Date().toISOString(), locationName: "Freezer", sectionName: "Frozen Rack", text: "Fries transfer to sister location not entered same day." }
      ],
      recipes
    };
  }

  let tourState = { active: false, stepIndex: 0, steps: [] };
  function getTourSteps(mode="full"){
    const monthInvoice = db.invoices.find(i => i.monthId === currentMonthId) || db.invoices[0] || null;
    const firstLocation = db.kitchen?.locations?.[0] || null;
    const firstSection = firstLocation?.sections?.[0] || null;
    const firstPortionRecipe = db.recipes.find(r => r.type === "portion") || db.recipes[0] || null;
    const firstBatchRecipe = db.recipes.find(r => r.type === "batch") || db.recipes[0] || null;
    const steps = [
      { tab: "dashboard", selector: "#menuToggle", title: "Quick Menu", body: "Use the top-left menu for quick tab jumps when you are moving fast on a small screen." },
      { tab: "dashboard", selector: "#buildTag", title: "Build Tag", body: "This tag shows which demo build is loaded so training sessions stay aligned." },
      { tab: "dashboard", selector: "#demoDataTag", title: "Data Health Tag", body: "This badge summarizes demo data volume and helps spot accidental data drift." },
      { tab: "dashboard", selector: "#demoUiTag", title: "UI Health Tag", body: "This badge reports render coverage and quick UI diagnostics for support checks." },
      { tab: "dashboard", selector: "#saveStatus", title: "Save Indicator", body: "This badge reflects save state so you know whether recent edits were captured." },
      { tab: "dashboard", selector: "#monthSelect", title: "Month Context", body: "Start here. Every view is scoped to the selected month, so switching this updates counts, invoices, recipes, and reports together." },
      { tab: "dashboard", selector: "#btnNewMonth", title: "Create New Month", body: "Use this when you roll into a new accounting period and need clean monthly scope." },
      { tab: "dashboard", selector: "#panel-dashboard .dash-tiles", title: "Overview KPIs", body: "The dashboard summarizes COGS%, purchases, ending inventory, and target delta so you can spot drift in seconds." },
      { tab: "dashboard", selector: "#dashExceptions", title: "Exceptions Queue", body: "This card surfaces blocking issues like unmatched invoices, missing costs, and recipe mapping gaps." },
      { tab: "dashboard", selector: "#btnFixExceptions", title: "Fix Exceptions Shortcut", body: "This jumps straight to the Reports tab so the team can clear blockers quickly." },
      { tab: "dashboard", selector: "#dashHeatList", title: "Variance Heat Map", body: "Top movers by dollar impact are ranked here to guide where to investigate first." },
      { tab: "dashboard", selector: "#btnDashHeatOpenReports", title: "Heat Map Drilldown", body: "Use this shortcut to move from variance scan to detailed reporting analysis." },
      { tab: "dashboard", selector: "#btnGoCount", title: "Start Counting Shortcut", body: "This is the fastest path from dashboard triage into active counting workflow." },
      { tab: "dashboard", selector: "#btnGoInvoices", title: "Enter Invoices Shortcut", body: "Use this when purchasing updates are the immediate bottleneck." },
      { tab: "dashboard", selector: "#qaName", title: "Quick Add Item", body: "Need to add a new SKU mid-shift? Enter it here so it is available across counting, invoices, and recipes immediately." },
      { tab: "dashboard", selector: "#qaGroup", title: "Item Group", body: "Pick the right group to ensure reporting and COGS calculations land in the correct bucket." },
      { tab: "dashboard", selector: "#qaBaseUnit", title: "Base Unit", body: "Set a consistent unit now to reduce downstream conversion errors and data cleanup." },
      { tab: "dashboard", selector: "#btnQuickAdd", title: "Create Item Fast", body: "After filling minimal fields, Add Item puts it directly in your master item list." },
      { tab: "counting", selector: "#sectionTitle", title: "Current Section Header", body: "This header confirms where your team is counting right now to avoid cross-section confusion.", before: () => { currentLocationId = firstLocation?.id || null; currentSectionId = firstSection?.id || null; } },
      { tab: "counting", selector: "#sectionSub", title: "Section Guidance", body: "Use this line as a quick context check before entering counts." },
      { tab: "counting", selector: "#locationsList", title: "Kitchen Locations", body: "Counting starts by location. Demo data includes realistic areas so you can test the walk path quickly.", before: () => { currentLocationId = firstLocation?.id || null; currentSectionId = firstSection?.id || null; } },
      { tab: "counting", selector: "#btnNewLocation", title: "Add Location", body: "Create new storage areas as your operation expands or layout changes." },
      { tab: "counting", selector: "#sectionsList", title: "Sections In Location", body: "Pick a section to focus the count list and keep inventory passes consistent across shifts." },
      { tab: "counting", selector: "#btnNewSection", title: "Add Section", body: "Add sections to mirror your real-world walk path and reduce missed items." },
      { tab: "counting", selector: "#btnStartWalk", title: "Walk Mode", body: "Walk mode is optimized for rapid counting while moving through storage areas." },
      { tab: "counting", selector: "#walkItemName", title: "Walk Item Focus", body: "The current item to count is front-and-center here.", before: () => { currentLocationId = firstLocation?.id || null; currentSectionId = firstSection?.id || null; renderCounting(); startWalk(); } },
      { tab: "counting", selector: "#walkQty", title: "Walk Quantity", body: "Enter count quantity for the active item as you move through the section." },
      { tab: "counting", selector: "#btnNextItem", title: "Walk Next Item", body: "Advance through the section path without leaving the walk flow." },
      { tab: "counting", selector: "#btnWalkSaveFinding", title: "Walk Finding Save", body: "Capture an issue instantly without breaking counting rhythm." },
      { tab: "counting", selector: "#addToSectionSearch", title: "Add To Section", body: "Search and assign items to the active section so future counts are faster and cleaner." },
      { tab: "counting", selector: "#btnAddToSection", title: "Assign Item", body: "This action commits the selected item to the current section." },
      { tab: "counting", selector: "#runningNotes", title: "Live Count Notes", body: "Capture anomalies while counting. Notes become reportable findings for management follow-up." },
      { tab: "counting", selector: "#btnClearNotes", title: "Clear Notes", body: "Clear notes after filing findings so the next issue is captured cleanly." },
      { tab: "counting", selector: "#btnAddFinding", title: "Send To Findings", body: "One tap pushes the current note into the Findings Queue with location and section context." },
      { tab: "counting", selector: "#findingHint", title: "Finding Feedback", body: "This helper confirms when a finding is saved and reminds where it appears in reports." },
      { tab: "invoices", selector: "#invoiceList", title: "Invoice Stream", body: "The invoice list is your purchasing timeline. Demo includes multiple vendors and intentional mismatches.", before: () => { closeWalk(); $("#pasteModal")?.classList.add("hidden"); $("#aliasModal")?.classList.remove("open"); currentInvoiceId = monthInvoice?.id || null; } },
      { tab: "invoices", selector: "#invoiceEditorTitle", title: "Invoice Context", body: "This title confirms which invoice you are editing before making line changes." },
      { tab: "invoices", selector: "#invoiceEditor", title: "Invoice Editor", body: "Open an invoice to correct lines, costs, and matching so COGS reflects what actually landed." },
      { tab: "invoices", selector: "#btnNewInvoice", title: "New Invoice", body: "Create a new invoice when receiving product so purchases are captured the same day." },
      { tab: "invoices", selector: "#btnDuplicateInvoice", title: "Duplicate Invoice", body: "Use this for recurring vendor patterns to speed up entry while preserving accuracy." },
      { tab: "invoices", selector: "#btnDeleteInvoice", title: "Delete Invoice", body: "Use cautiously for accidental entries or test records." },
      { tab: "invoices", selector: "#btnImportBackup", title: "Import Backup", body: "Import lets you load exported data snapshots for recovery or migration." },
      { tab: "invoices", selector: "#btnExportBackup", title: "Export Full Backup", body: "Use full backup export before major changes or to hand data to another device." },
      { tab: "invoices", selector: "#btnPasteMany", title: "Paste Many Entry", body: "Use Paste Many for fast bulk line capture from vendor exports." },
      { tab: "invoices", selector: "#pasteArea", title: "Paste Buffer", body: "Paste rows as name, qty, unit, unit cost. Alibi will parse and map.", before: () => { currentInvoiceId = monthInvoice?.id || null; renderInvoices(); openPasteModal(); } },
      { tab: "invoices", selector: "#btnApplyPaste", title: "Apply Pasted Lines", body: "Apply to append parsed lines directly into the selected invoice." },
      { tab: "recipes", selector: "#recipeList", title: "Recipe Library", body: "Portion and batch recipes are preloaded so you can validate theoretical cost assumptions fast.", before: () => { $("#pasteModal")?.classList.add("hidden"); recipeFilter = "portion"; currentRecipeId = firstPortionRecipe?.id || null; } },
      { tab: "recipes", selector: "#recipeEditorTitle", title: "Recipe Context", body: "This title verifies which recipe is open before changing yields or line items." },
      { tab: "recipes", selector: "#recipeEditor", title: "Recipe Editor", body: "Edit ingredient lines, yield, and notes to tighten recipe costing and reduce variance noise." },
      { tab: "recipes", selector: "#btnNewPortion", title: "New Portion Recipe", body: "Add menu-item recipes here to improve PMIX-based theoretical COGS quality." },
      { tab: "recipes", selector: "#btnNewBatch", title: "New Batch Recipe", body: "Track prep components as batch recipes so downstream portion costs stay grounded.", before: () => { recipeFilter = "batch"; currentRecipeId = firstBatchRecipe?.id || null; } },
      { tab: "recipes", selector: "#btnDeleteRecipe", title: "Delete Recipe", body: "Remove obsolete recipes to keep theoretical COGS clean and actionable." },
      { tab: "reports", selector: "#btnRecalc", title: "Recalculate Reports", body: "Run recalculation after edits so report outputs reflect current data." },
      { tab: "reports", selector: "#repBeginIng", title: "Beginning Inventory", body: "This is your opening valuation baseline for the selected month." },
      { tab: "reports", selector: "#repPurchIng", title: "Purchases", body: "Purchases reflect invoice-driven spend for ingredients and products." },
      { tab: "reports", selector: "#repEndIng", title: "Ending Inventory", body: "Ending valuation comes from section counts and item costs." },
      { tab: "reports", selector: "#repCogsIng", title: "Actual COGS Value", body: "This is the accounting result from begin + purchases - ending inventory." },
      { tab: "reports", selector: "#repCogsPct", title: "Actual COGS Percent", body: "Use this metric for period-over-period performance tracking." },
      { tab: "reports", selector: "#findingsList", title: "Findings Queue", body: "Operational issues from counting are centralized here for closure and accountability." },
      { tab: "reports", selector: "#btnClearFindings", title: "Clear Findings", body: "Use after review meetings when findings are resolved and documented elsewhere." },
      { tab: "reports", selector: "#unmatchedList", title: "Unmatched Invoice Items", body: "Resolve these lines to avoid undercounted purchases and confidence penalties in COGS reporting." },
      { tab: "reports", selector: "#btnResolveAll", title: "Resolve All Unmatched", body: "Bulk resolve is useful after completing a focused matching pass." },
      { tab: "reports", selector: "#cogsSection", expand: "advancedReports", title: "Actual vs Theoretical COGS", body: "This section compares inventory-driven COGS with PMIX/recipe expectations and highlights risk flags." },
      { tab: "reports", selector: "#actualCogs", expand: "advancedReports", title: "Actual COGS Panel", body: "The computed actual value is shown here for quick verification." },
      { tab: "reports", selector: "#theoreticalCogs", expand: "advancedReports", title: "Theoretical COGS Panel", body: "This value is PMIX and recipe driven, and should track operational intent." },
      { tab: "reports", selector: "#varianceCogs", expand: "advancedReports", title: "Variance Delta", body: "This value shows the dollar gap between actual and theoretical COGS for the active month." },
      { tab: "reports", selector: "#varianceNote", expand: "advancedReports", title: "Variance Note", body: "Read this note for quick interpretation of the delta direction and significance." },
      { tab: "reports", selector: "#cogsConfidence", expand: "advancedReports", title: "Confidence Flags", body: "Use this to identify why a month is low confidence before sharing numbers externally." },
      { tab: "reports", selector: "#pmixInput", expand: "advancedReports", title: "PMIX Input", body: "Paste Toast PMIX data here to drive theoretical COGS." },
      { tab: "reports", selector: "#applyPmix", expand: "advancedReports", title: "Apply PMIX", body: "Apply updates recipe-driven theoretical totals and confidence cues." },
      { tab: "reports", selector: "#periodControl", expand: "advancedReports", title: "Period Control", body: "Use period controls to confirm beginning inventory and lock the month." },
      { tab: "reports", selector: "#confirmBeginInv", expand: "advancedReports", title: "Confirm Beginning Inventory", body: "This anchors actual COGS calculations for the period." },
      { tab: "reports", selector: "#lockPeriod", expand: "advancedReports", title: "Lock Period", body: "Lock after review to prevent accidental changes during closeout." },
      { tab: "reports", selector: "#managerActions", title: "Manager Action List", body: "This section turns report gaps into concrete next actions." },
      { tab: "reports", selector: "#monthlySummary", title: "Monthly Snapshot", body: "A compact summary for quick check-ins and handoff notes." },
      { tab: "reports", selector: "#btnExportMonthZip", title: "Month Export", body: "Export a ZIP snapshot for finance, audit trails, or handoff to another system." },
      { tab: "reports", selector: "#exportZip", expand: "advancedReports", title: "Backup ZIP Export", body: "Creates a broader backup package from the advanced report section." },
      { tab: "reports", selector: "#emailReport", expand: "advancedReports", title: "Email Draft", body: "Builds a ready-to-send email summary for managers or ownership." },
      { tab: "settings", selector: "#panel-settings .form", title: "Settings & Controls", body: "Report email, demo reset, and backup controls live here for operations and training workflows." },
      { tab: "settings", selector: "#setReportEmail", title: "Report Email", body: "Set the default destination for report sharing workflows." },
      { tab: "settings", selector: "#btnSaveSettings", title: "Save Settings", body: "Commit settings changes here before leaving the tab." },
      { tab: "settings", selector: "#btnResetSeed", title: "Reset Demo Data", body: "Use this only for training resets when you need pristine demo records." },
      { tab: "settings", selector: "#settingsAdvanced", expand: "settingsAdvanced", title: "Advanced Controls", body: "Advanced controls include deeper cleanup and formalization tools." },
      { tab: "settings", selector: "#itemFormalization", expand: "settingsAdvanced", title: "Formalization Block", body: "This area improves data hygiene through aliases, exclusions, and item governance." },
      { tab: "settings", selector: "#itemList", expand: "settingsAdvanced", title: "Item Formalization", body: "Use this list to manage aliases and exclusions for cleaner counting and matching." },
      { tab: "settings", selector: "#newAlias", expand: "settingsAdvanced", title: "Alias Modal", body: "Alias management helps map messy invoice text to clean master items.", before: () => { const name = db.items?.[0]?.name; if(name) openAliasModal(name); } },
      { tab: "settings", selector: "#addAlias", expand: "settingsAdvanced", title: "Add Alias Action", body: "Add known label variations so matching improves over time.", before: () => { const name = db.items?.[0]?.name; if(name) openAliasModal(name); } },
      { tab: "settings", selector: "#btnClearLocalData", title: "Recovery Action", body: "Use Delete Local Data only when you need a clean Alibi state on this device." },
      { tab: "dashboard", selector: "#demoModeBanner", title: "Demo Banner", body: "The banner confirms demo mode and provides fast access to restart this walkthrough.", before: () => { $("#aliasModal")?.classList.remove("open"); } },
      { tab: "dashboard", selector: "#btnRestartTour", title: "Tour Shortcut", body: "Need a refresher later? Use Restart Tour from the demo banner anytime." }
    ];
    if(mode === "happy"){
      const keep = new Set([
        "#monthSelect",
        "#btnGoCount",
        "#btnStartWalk",
        "#btnAddFinding",
        "#btnNewInvoice",
        "#btnPasteMany",
        "#btnNewPortion",
        "#btnRecalc",
        "#btnExportMonthZip",
        "#btnSaveSettings"
      ]);
      return steps.filter((s) => keep.has(s.selector));
    }
    return steps;
  }

  function ensureTourUI(){
    if($("#guidedTour")) return;
    const shell = document.createElement("div");
    shell.id = "guidedTour";
    shell.className = "tour-shell hidden";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.innerHTML = `
      <div class="tour-backdrop" id="tourBackdrop"></div>
      <div class="tour-card">
        <div class="tour-step" id="tourStepNum">Step 1 of 1</div>
        <h3 class="tour-title" id="tourTitle">Guided Tour</h3>
        <p class="tour-body" id="tourBody"></p>
        <div class="tour-actions">
          <button class="btn ghost" id="tourPrev" type="button">Back</button>
          <button class="btn ghost" id="tourClose" type="button">Close</button>
          <button class="btn" id="tourNext" type="button">Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(shell);
    $("#tourPrev")?.addEventListener("click", () => moveTour(-1));
    $("#tourNext")?.addEventListener("click", () => moveTour(1));
    $("#tourClose")?.addEventListener("click", () => stopGuidedTour());
    $("#tourBackdrop")?.addEventListener("click", () => moveTour(1));
    document.addEventListener("keydown", (e) => {
      if(!tourState.active) return;
      if(e.key === "Escape") stopGuidedTour();
      if(e.key === "ArrowRight" || e.key === "Enter") moveTour(1);
      if(e.key === "ArrowLeft") moveTour(-1);
    });
  }

  function startGuidedTour(mode="full"){
    ensureTourUI();
    tourState.steps = getTourSteps(mode);
    tourState.stepIndex = 0;
    tourState.active = true;
    document.body.classList.add("tour-active");
    $("#guidedTour")?.classList.remove("hidden");
    applyTourStep();
    setTimeout(() => applyTourStep(), 180);
  }

  function stopGuidedTour(){
    tourState.active = false;
    tourState.stepIndex = 0;
    document.body.classList.remove("tour-active");
    $$(".tour-focus").forEach(el => el.classList.remove("tour-focus"));
    $("#guidedTour")?.classList.add("hidden");
  }

  function moveTour(dir){
    if(!tourState.active) return;
    const next = tourState.stepIndex + dir;
    if(next < 0) return;
    if(next >= tourState.steps.length){ stopGuidedTour(); return; }
    tourState.stepIndex = next;
    applyTourStep();
  }

  function applyTourStep(){
    if(!tourState.active) return;
    const steps = tourState.steps;
    const i = tourState.stepIndex;
    const step = steps[i];
    if(!step) return;

    step.before?.();
    if(step.tab) goTab(step.tab);
    if(step.expand){
      const details = $("#"+step.expand);
      if(details) details.open = true;
    }

    $$(".tour-focus").forEach(el => el.classList.remove("tour-focus"));
    const target = step.selector ? $(step.selector) : null;
    if(target){
      target.classList.add("tour-focus");
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }

    $("#tourStepNum").textContent = `${i+1}/${steps.length}`;
    $("#tourTitle").textContent = step.title;
    $("#tourBody").textContent = step.body;
    $("#tourPrev").disabled = (i === 0);
    $("#tourNext").textContent = (i === steps.length - 1) ? "Finish Tour" : "Next";
  }

  // -------- Export/Import buttons already wired --------
  // -------- Reports email handled in ZIP export --------

  // Render all
  function renderAll(){
    ensureDemoIntegrity();
    ensureDemoCoverage();
    ensureActiveSelections();
    renderMonthSelect();
    const buildTag = $("#buildTag");
    if(buildTag) buildTag.textContent = "Build demo-tour-24 live";
    // settings
    $("#setReportEmail").value = db.settings.reportEmail || "";
    const demoBanner = $("#demoModeBanner");
    if(demoBanner){
      demoBanner.classList.toggle("hidden", !db.settings?.demoMode);
    }
    const demoDataTag = $("#demoDataTag");
    if(demoDataTag){
      const months = Array.isArray(db.months) ? db.months.length : 0;
      const items = Array.isArray(db.items) ? db.items.length : 0;
      const invoices = Array.isArray(db.invoices) ? db.invoices.length : 0;
      const recipes = Array.isArray(db.recipes) ? db.recipes.length : 0;
      demoDataTag.textContent = `Demo M${months} I${items} V${invoices} R${recipes}`;
    }
    const renderErrors = [];
    try{ renderDashboard(); }catch(_e){ renderErrors.push("D"); }
    try{ renderCounting(); }catch(_e){ renderErrors.push("C"); }
    try{ renderInvoices(); }catch(_e){ renderErrors.push("I"); }
    try{ renderRecipes(); }catch(_e){ renderErrors.push("R"); }
    try{ renderReports(); }catch(_e){ renderErrors.push("P"); }
    try{ renderItemFormalization(); }catch(_e){ renderErrors.push("F"); }
    enforceDemoVisibleRows();
    if(renderErrors.length){
      const uiTag = $("#demoUiTag");
      if(uiTag){
        uiTag.textContent = `ERR ${renderErrors.join("")} · ${uiTag.textContent}`;
      }
    }
  }

  function ensureDemoIntegrity(){
    const minMonths = 4;
    const minItems = 18;
    const minInvoices = 12;
    const minRecipes = 6;

    const months = Array.isArray(db.months) ? db.months.length : 0;
    const items = Array.isArray(db.items) ? db.items.length : 0;
    const invoices = Array.isArray(db.invoices) ? db.invoices.length : 0;
    const recipes = Array.isArray(db.recipes) ? db.recipes.length : 0;
    const demoMode = !!db.settings?.demoMode;

    if(demoMode && (months < minMonths || items < minItems || invoices < minInvoices || recipes < minRecipes)){
      db = buildDemoData();
      window.__ALIBI_DB__ = db;
      currentMonthId = db.months?.[0]?.id || null;
      currentLocationId = db.kitchen?.locations?.[0]?.id || null;
      currentSectionId = db.kitchen?.locations?.[0]?.sections?.[0]?.id || null;
      currentInvoiceId = db.invoices?.[0]?.id || null;
      currentRecipeId = db.recipes?.[0]?.id || null;
    }
  }

  function ensureDemoCoverage(){
    if(!db.settings?.demoMode) return;
    db.findings = Array.isArray(db.findings) ? db.findings : [];
    db.pmix = Array.isArray(db.pmix) ? db.pmix : [];
    db.unmatched = Array.isArray(db.unmatched) ? db.unmatched : [];
    db.recipes = Array.isArray(db.recipes) ? db.recipes : [];
    db.invoices = Array.isArray(db.invoices) ? db.invoices : [];
    db.items = Array.isArray(db.items) ? db.items : [];
    db.months = Array.isArray(db.months) ? db.months : [];

    // Keep advanced controls "filled" for demo.
    db.period = db.period || { locked:false, lockedAt:null, beginConfirmed:false, costSnapshot:{} };
    if(!db.period.beginConfirmed) db.period.beginConfirmed = true;
    if(!db.period.locked){
      db.period.locked = true;
      db.period.lockedAt = new Date().toISOString();
    }
    db.period.costSnapshot = db.period.costSnapshot || {};
    db.items.forEach(i => {
      if(db.period.costSnapshot[i.name] == null) db.period.costSnapshot[i.name] = Number(i.defaultCost||0);
    });

    // Guarantee counting structure exists and has item paths.
    db.kitchen = db.kitchen || { locations: [] };
    db.kitchen.locations = Array.isArray(db.kitchen.locations) ? db.kitchen.locations : [];
    if(db.kitchen.locations.length === 0){
      db.kitchen.locations.push({ id: uid(), name: "Walk-In", sections: [] });
    }
    const firstLoc = db.kitchen.locations[0];
    firstLoc.sections = Array.isArray(firstLoc.sections) ? firstLoc.sections : [];
    if(firstLoc.sections.length === 0){
      firstLoc.sections.push({ id: uid(), name: "Prep Shelf", itemIds: [], overrides: {}, _counts: {} });
    }
    const firstSec = firstLoc.sections[0];
    firstSec.itemIds = Array.isArray(firstSec.itemIds) ? firstSec.itemIds : [];
    if(firstSec.itemIds.length === 0){
      firstSec.itemIds = db.items.slice(0, 8).map(i => i.id);
    }

    // Ensure active selections point to real content.
    currentLocationId = firstLoc.id;
    currentSectionId = firstSec.id;

    // Ensure PMIX exists and points to real portion recipes.
    const portion = db.recipes.filter(r => r.type === "portion" && r.name);
    if(db.pmix.length < 3 && portion.length){
      db.pmix = portion.slice(0, 3).map((r, i) => ({ name: r.name, qty: [980, 1420, 620][i] || 300 }));
    }

    const demoFindingText = [
      "Shift handoff count mismatch flagged for verification.",
      "Receiving variance logged and pending supplier credit review.",
      "Station transfer moved without same-shift annotation."
    ];

    // For each month, guarantee at least one finding and one unmatched invoice line.
    db.months.forEach((m, idx) => {
      const monthInvoices = db.invoices.filter(inv => inv.monthId === m.id);
      if(monthInvoices.length === 0){
        const fallbackItem = db.items.find(i => i.group === "ingredients") || db.items[0];
        if(fallbackItem){
          db.invoices.unshift({
            id: uid(),
            monthId: m.id,
            vendor: "Demo Vendor",
            number: `DM-${idx+1}`,
            date: nowISO(),
            notes: "Auto-seeded demo invoice",
            createdAt: new Date().toISOString(),
            lines: [{
              id: uid(),
              rawName: fallbackItem.name,
              itemId: fallbackItem.id,
              qty: 12 + idx,
              unit: fallbackItem.baseUnit || "ea",
              unitCost: Number(fallbackItem.defaultCost || 1),
              group: fallbackItem.group || "ingredients",
              category: fallbackItem.category || "",
              notes: ""
            }]
          });
        }
      }

      const monthInvoices2 = db.invoices.filter(inv => inv.monthId === m.id);
      const monthFindings = db.findings.filter(f => f.monthId === m.id);
      if(monthFindings.length === 0){
        db.findings.unshift({
          id: uid(),
          monthId: m.id,
          createdAt: new Date().toISOString(),
          locationName: "Walk-In",
          sectionName: "Prep Shelf",
          text: demoFindingText[idx % demoFindingText.length]
        });
      }

      const hasUnmatched = monthInvoices2.some(inv => (inv.lines||[]).some(ln => !ln.itemId));
      if(!hasUnmatched){
        const inv = monthInvoices2[0];
        inv.lines = Array.isArray(inv.lines) ? inv.lines : [];
        inv.lines.push({
          id: uid(),
          rawName: `Demo Unmatched Item ${idx+1}`,
          itemId: null,
          qty: 1 + idx,
          unit: "ea",
          unitCost: 1.25 + idx,
          group: "ingredients",
          category: "misc",
          notes: "Auto-seeded unmatched demo line"
        });
      }
    });

    // Guarantee recipes tab has both portion and batch content.
    const hasPortion = db.recipes.some(r => r.type === "portion");
    const hasBatch = db.recipes.some(r => r.type === "batch");
    if(!hasPortion){
      const a = db.items.find(i => i.group === "ingredients") || db.items[0];
      if(a){
        db.recipes.unshift({
          id: uid(),
          type: "portion",
          name: "Demo Portion Dish",
          yieldQty: 1,
          yieldUnit: "portion",
          notes: "Auto-seeded",
          lines: [{ id: uid(), itemId: a.id, qty: 1, unit: a.baseUnit || "ea" }]
        });
      }
    }
    if(!hasBatch){
      const a = db.items.find(i => i.group === "ingredients") || db.items[0];
      if(a){
        db.recipes.push({
          id: uid(),
          type: "batch",
          name: "Demo Batch Prep",
          yieldQty: 4,
          yieldUnit: "qt",
          notes: "Auto-seeded",
          lines: [{ id: uid(), itemId: a.id, qty: 4, unit: a.baseUnit || "ea" }]
        });
      }
    }

    // Keep current item selections non-empty for list editors.
    const curMonth = db.months.find(m => m.id === currentMonthId) || db.months[0];
    const curInvs = db.invoices.filter(i => i.monthId === curMonth?.id);
    currentInvoiceId = curInvs[0]?.id || db.invoices[0]?.id || null;
    const visibleRecipes = db.recipes.filter(r => r.type === recipeFilter);
    currentRecipeId = visibleRecipes[0]?.id || db.recipes[0]?.id || null;
  }

  function enforceDemoVisibleRows(){
    if(!db.settings?.demoMode) return;
    const hasItemRows = (el) => {
      if(!el) return false;
      if(el.querySelector(".item")) return true;
      const txt = (el.textContent || "").trim();
      if(!txt) return false;
      if(/no .*yet|create or select|pick a location|select a location/i.test(txt)) return false;
      return true;
    };

    const locBox = $("#locationsList");
    if(locBox && !hasItemRows(locBox)){
      const locs = (db.kitchen?.locations || []).slice(0, 3);
      locBox.innerHTML = locs.map(l => `<div class="item"><div class="left"><div class="title">${escapeHtml(l.name||"Location")}</div><div class="meta">${(l.sections||[]).length} section(s)</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Walk-In</div><div class="meta">1 section(s)</div></div></div>`;
    }

    const secBox = $("#sectionsList");
    if(secBox && !hasItemRows(secBox)){
      const loc = db.kitchen?.locations?.find(l => l.id === currentLocationId) || db.kitchen?.locations?.[0];
      const secs = (loc?.sections || []).slice(0, 4);
      secBox.innerHTML = secs.map(s => `<div class="item"><div class="left"><div class="title">${escapeHtml(s.name||"Section")}</div><div class="meta">${(s.itemIds||[]).length} item(s) in path</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Prep Shelf</div><div class="meta">8 item(s) in path</div></div></div>`;
    }

    const invBox = $("#invoiceList");
    if(invBox && !hasItemRows(invBox)){
      const month = db.months?.find(m => m.id === currentMonthId) || db.months?.[0];
      const invs = (db.invoices||[]).filter(i => i.monthId === month?.id).slice(0, 5);
      invBox.innerHTML = invs.map(inv => `<div class="item"><div class="left"><div class="title">${escapeHtml(inv.vendor||"Demo Vendor")} • #${escapeHtml(inv.number||"")}</div><div class="meta">${escapeHtml(inv.date||"")} • ${(inv.lines||[]).length} line(s)</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Demo Vendor • #DM-1</div><div class="meta">1 line(s)</div></div></div>`;
    }

    const recBox = $("#recipeList");
    if(recBox && !hasItemRows(recBox)){
      const recs = (db.recipes||[]).filter(r => r.type === recipeFilter).slice(0, 6);
      recBox.innerHTML = recs.map(r => `<div class="item"><div class="left"><div class="title">${escapeHtml(r.name||"Recipe")}</div><div class="meta">${escapeHtml(r.type||"portion")} • ${(r.lines||[]).length} line(s)</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Demo Portion Dish</div><div class="meta">portion • 1 line(s)</div></div></div>`;
    }

    const findBox = $("#findingsList");
    if(findBox && !hasItemRows(findBox)){
      const month = db.months?.find(m => m.id === currentMonthId) || db.months?.[0];
      const fs = (db.findings||[]).filter(f => f.monthId === month?.id).slice(0, 5);
      findBox.innerHTML = fs.map(f => `<div class="item"><div class="left"><div class="title">${escapeHtml(f.locationName||"Walk-In")} • ${escapeHtml(f.sectionName||"Prep Shelf")}</div><div class="meta">${escapeHtml(f.text||"Demo finding")}</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Walk-In • Prep Shelf</div><div class="meta">Demo finding</div></div></div>`;
    }

    const unBox = $("#unmatchedList");
    if(unBox && !hasItemRows(unBox)){
      const month = db.months?.find(m => m.id === currentMonthId) || db.months?.[0];
      const um = [];
      (db.invoices||[]).filter(i => i.monthId === month?.id).forEach(inv => {
        (inv.lines||[]).forEach(ln => { if(!ln.itemId) um.push({ inv, ln }); });
      });
      const show = um.slice(0, 6);
      unBox.innerHTML = show.map(({inv,ln}) => `<div class="item"><div class="left"><div class="title">${escapeHtml(ln.rawName||"Unmatched Item")}</div><div class="meta">${escapeHtml(inv.vendor||"Vendor")} • ${escapeHtml(inv.date||"")}</div></div></div>`).join("") || `<div class="item"><div class="left"><div class="title">Demo Unmatched Item</div><div class="meta">Demo Vendor</div></div></div>`;
    }

    const uiTag = $("#demoUiTag");
    if(uiTag){
      const c = ($("#locationsList")?.querySelectorAll(".item").length || 0) + ($("#sectionsList")?.querySelectorAll(".item").length || 0);
      const i = $("#invoiceList")?.querySelectorAll(".item").length || 0;
      const r = $("#recipeList")?.querySelectorAll(".item").length || 0;
      const f = $("#findingsList")?.querySelectorAll(".item").length || 0;
      const u = $("#unmatchedList")?.querySelectorAll(".item").length || 0;
      uiTag.textContent = `UI C${c} I${i} R${r} F${f} U${u}`;
    }
  }

  renderAll();

  try{
    const params = new URLSearchParams(window.location.search);
    const v = (params.get("v") || "").toLowerCase();
    const isDemoUrl = v.startsWith("demo");
    if(params.get("forceDemo") === "1" || isDemoUrl){
      loadFreshDemoAndTour({ startTour: true });
      params.delete("forceDemo");
      const next = params.toString();
      const newUrl = window.location.pathname + (next ? ("?"+next) : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }catch(_e){}

  if(!isDemoAuthed()){
    showDemoAuthGate();
  }else{
    beginDemoFocusWindow();
  }

})();
