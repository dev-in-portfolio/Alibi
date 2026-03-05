/* Kitchen Inventory — v8 (CardFlow Auto Purple)
   - Single kitchen
   - Discovery counting (locations/sections built as you walk)
   - Card-style invoices with paste-many, vendor recents, price memory
   - Portion + Batch recipes; batch auto sync to inventory items
   - Reports: Actual COGS + Findings + Unmatched lines + Month ZIP export
*/

(() => {

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

function setBreadcrumb(parts){
  const el=document.getElementById('breadcrumb');
  if(el) el.textContent = parts.join(' → ');
}
function setProgress(txt){
  const el=document.getElementById('progress');
  if(el) el.textContent = txt;
}

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
  db.items.forEach(i=>{ db.period.costSnapshot[i.name] = Number(i.cost||0); });
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
    const changed = prev!=null && Number(prev)!==Number(i.cost||0);
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
  if((db.items||[]).some(i=>!i.cost)) actions.push('Items missing costs');
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
  const sales = (db.sales||[]).reduce((s,r)=>s+Number(r.amount||0),0);
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

function computeActualCOGS(db){
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
  pmix.forEach(r=>{
    const recipe = (db.recipes||[]).find(x=>x.type==='portion' && x.name===r.name);
    if(!recipe){ missing.push(`Missing recipe: ${r.name}`); return; }
    const cost = Number(recipe.cost||0);
    total += cost * Number(r.qty||0);
  });
  return { total, missing };
}

function cogsConfidence(db, theoMissing){
  const flags = [];
  const items = db.items||[];
  if(items.some(i=>!i.cost)) flags.push('Missing item costs');
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

function getVendorMemory(v){
  try{
    const mem = JSON.parse(localStorage.getItem('vendorMem')||'{}');
    return mem[v]||{items:[], prices:{}};
  }catch(e){
    return {items:[], prices:{}};
  }
}
function setVendorMemory(v, item, price){
  try{
    const mem = JSON.parse(localStorage.getItem('vendorMem')||'{}');
    mem[v]=mem[v]||{items:[], prices:{}};
    if(item && !mem[v].items.includes(item)){
      mem[v].items.unshift(item); mem[v].items=mem[v].items.slice(0,20);
    }
    if(item && price){ mem[v].prices[item]=price; }
    localStorage.setItem('vendorMem', JSON.stringify(mem));
  }catch(e){
    // Storage might be blocked (private mode / quota). Ignore silently.
  }
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

  const STORAGE_KEY = "kitchen_inventory_v8";
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

  function loadDB(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return bootstrapSeed();
      const parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== 'object') return bootstrapSeed();
      // soft migrate
      if(!parsed.version) parsed.version = "v8";
      if(!parsed.settings) parsed.settings = { reportEmail: "" };
      if(!parsed.items) parsed.items = [];
      if(!parsed.kitchen) parsed.kitchen = { locations: [] };
      if(!parsed.months) parsed.months = [];
      if(!parsed.invoices) parsed.invoices = [];
      if(!parsed.findings) parsed.findings = [];
      if(!parsed.recipes) parsed.recipes = [];
      return parsed;
    }catch(e){
      console.warn("DB load failed:", e);
      return bootstrapSeed();
    }
  }
  function saveDB(){
    markDirty();
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    }catch(e){
      console.warn("DB save failed:", e);
      try{ toast("Storage blocked — changes not saved", 2200); }catch(_e){}
    }
    markSaved();
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
    markDirty();
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }catch(e){
      console.warn("Seed persist failed:", e);
      try{ toast("Storage blocked — seed not saved", 2200); }catch(_e){}
    }
    markSaved();
    return s;
  }

  // -------- Month selection --------
  let currentMonthId = db.months[0]?.id;
  let currentLocationId = null;
  let currentSectionId = null;

  // -------- Tabs --------
  // (Legacy .tab buttons optional. Primary navigation uses tile-row buttons.)
  $$(".tab").forEach(btn => btn.addEventListener("click", () => {
    goTab(btn.dataset.tab);
  }));

  // Tile row navigation
  initTileRowNav();

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
    if(confirm('This will erase ALL local data for this app on this device. Export a backup first. Continue?')){ try{ localStorage.removeItem(STORAGE_KEY); }catch(e){} toast('Data reset'); }
    db = loadDB();
    currentMonthId = db.months[0]?.id;
    currentLocationId = null;
    currentSectionId = null;
    renderAll();
  });

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

  $("#btnNewInvoice")?.addEventListener("click", () => {
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
    saveDBDebounced(); renderAll();
  });

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

  $("#btnClosePaste")?.addEventListener("click", () => $("#pasteModal").classList.add("hidden"));
  $("#btnApplyPaste")?.addEventListener("click", () => applyPaste());

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

    // Variance vs a default target (safe heuristic; adjustable later)
    const targetPct = 0.30;
    const targetCogs = denom>0 ? denom * targetPct : 0;
    const delta = denom>0 ? (cogsTotal - targetCogs) : 0;
    if($("#dashTileDeltaTargetVal")){
      const sign = delta > 0 ? "+" : "";
      $("#dashTileDeltaTargetVal").textContent = denom>0 ? `${sign}${money(delta)}` : "—";
    }
    if($("#dashTileDeltaTargetSub")){
      if(denom>0){
        const over = delta > 0;
        $("#dashTileDeltaTargetSub").textContent = over ? `Over target (${Math.round(targetPct*100)}%)` : `Under target (${Math.round(targetPct*100)}%)`;
      }else{
        $("#dashTileDeltaTargetSub").textContent = `Target ${Math.round(targetPct*100)}% COGS`;
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
        el.addEventListener("click", () => $('[data-tab="reports"]').click());
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
        el.querySelector("button").addEventListener("click", () => {
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
      $("#pasteModal").classList.remove("hidden");
      $("#pasteResult").textContent = "—";
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

      el.querySelector('[data-act="edit"]').addEventListener("click", () => {
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
    $("#pasteArea").value = "";
    $("#pasteResult").textContent = "Editing line";

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
      el.querySelector('[data-act="edit"]').addEventListener("click", () => editRecipeLine(r, line));
      el.querySelector('[data-act="del"]').addEventListener("click", () => {
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
    $("#pasteArea").value = "";
    $("#pasteResult").textContent = "";

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
        el.querySelector("button").addEventListener("click", () => {
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

  // -------- Export/Import buttons already wired --------
  // -------- Reports email handled in ZIP export --------

  // Render all
  function renderAll(){
    renderMonthSelect();
    // settings
    $("#setReportEmail").value = db.settings.reportEmail || "";
    renderDashboard();
    renderCounting();
    renderInvoices();
    renderRecipes();
    renderReports();
  }

  renderAll();

})();
