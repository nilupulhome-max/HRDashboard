// ============================================================
//  HR Canteen System — app.js
// ============================================================

// ── Clock ─────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleString('en-LK');
}, 1000);

const auth = firebase.auth();

// ── Login / Logout ────────────────────────────────────────────
async function login() {
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('loginMsg').textContent = '';
  } catch (e) {
    document.getElementById('loginMsg').textContent = e.message;
  }
}

function logout() {
  auth.signOut().then(() => {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContent').style.display  = 'none';
    document.getElementById('loginMsg').textContent = '';
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-entry').classList.add('active');
    document.querySelector('.tab').classList.add('active');
  }).catch(e => toast('Logout error: ' + e.message, true));
}

auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display  = 'block';
    document.getElementById('db-badge').className   = 'db-badge connected';
    document.getElementById('db-badge').textContent  = '🟢 Connected';
    loadCosts().then(() => {
      loadMpRates();
      loadMpEntry();
      loadOTEntry();
      // dashboard loads when tab is clicked
    });
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContent').style.display  = 'none';
  }
});

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'dashboard') loadDashboard();
}

// ── Default dates ─────────────────────────────────────────────
(function () {
  const now   = new Date();
  const pad   = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const h     = now.getHours();

  document.getElementById('e-date').value    = today;
  document.getElementById('e-shift').value   = (h >= 8 && h < 20) ? 'DAY' : 'NIGHT';
  document.getElementById('ot-date').value   = today;
  document.getElementById('mp-date').value   = today;

  document.getElementById('f-to').value = today;
  const from = new Date(now); from.setDate(from.getDate() - 13);
  document.getElementById('f-from').value =
    `${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}`;

  const mpFrom = new Date(now); mpFrom.setDate(mpFrom.getDate() - 13);
  document.getElementById('mp-from').value =
    `${mpFrom.getFullYear()}-${pad(mpFrom.getMonth()+1)}-${pad(mpFrom.getDate())}`;
  document.getElementById('mp-to').value = today;
})();

// ════════════════════════════════════════════════════════════
//  COSTS
// ════════════════════════════════════════════════════════════
let COSTS = {
  milkTea: 47.50, plainTea: 20, kotha: 25,
  snack: 80, biscuit: 375,
  breakfast: 170, lunch: 170, dinner: 170,
  otRate: 38000   // Master OT Rate — formula: hours × (otRate/200) × 1.5
};

async function loadCosts() {
  try {
    const snap = await db.collection('config').doc('costs').get();
    if (snap.exists) Object.assign(COSTS, snap.data());
    Object.keys(COSTS).forEach(k => {
      const el = document.getElementById('c-' + k);
      if (el) el.value = COSTS[k];
    });
    updateRateHeaders();
    calcOTPreview();
  } catch (e) { console.error('loadCosts:', e); }
}

async function saveCosts() {
  ['milkTea','plainTea','kotha','snack','biscuit','breakfast','lunch','dinner','otRate']
    .forEach(k => {
      const el = document.getElementById('c-' + k);
      if (el) COSTS[k] = parseFloat(el.value) || 0;
    });
  try {
    await db.collection('config').doc('costs').set(COSTS);
    updateRateHeaders();
    calcOTPreview();
    loadDashboard();
    document.getElementById('costStatus').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('costStatus').textContent = '', 3000);
    toast('Costs saved!');
  } catch (e) { toast('Save error: ' + e.message, true); }
}

function updateRateHeaders() {
  document.getElementById('rh-milkTea').textContent  = 'Rs ' + COSTS.milkTea;
  document.getElementById('rh-plainTea').textContent = 'Rs ' + COSTS.plainTea;
  const el = document.getElementById('ot-rate-display');
  if (el) el.textContent = 'Rs ' + COSTS.otRate.toLocaleString();
}

// ── OT cost formula: hours × (MasterRate / 200) × 1.5 ────────
function otCost(hours) {
  return Math.round(hours * (COSTS.otRate / 200) * 1.5);
}

// ════════════════════════════════════════════════════════════
//  OT ENTRY  (in Data Entry tab)
// ════════════════════════════════════════════════════════════
function calcOTPreview() {
  const dayH   = parseFloat(document.getElementById('ot-day-hours').value)   || 0;
  const nightH = parseFloat(document.getElementById('ot-night-hours').value) || 0;
  document.getElementById('ot-day-cost').value   = dayH   > 0 ? 'Rs ' + otCost(dayH).toLocaleString()   : '';
  document.getElementById('ot-night-cost').value = nightH > 0 ? 'Rs ' + otCost(nightH).toLocaleString() : '';
}

async function loadOTEntry() {
  const date = document.getElementById('ot-date').value;
  if (!date) return;
  try {
    const doc = await db.collection('ot_entries').doc(date).get();
    if (doc.exists) {
      const d = doc.data();
      document.getElementById('ot-day-hours').value   = d.dayHours   || 0;
      document.getElementById('ot-night-hours').value = d.nightHours || 0;
    } else {
      document.getElementById('ot-day-hours').value   = 0;
      document.getElementById('ot-night-hours').value = 0;
    }
    calcOTPreview();
  } catch (e) { console.error('loadOTEntry:', e); }
}

async function saveOT() {
  const date   = document.getElementById('ot-date').value;
  if (!date) { toast('Select a date', true); return; }
  const dayH    = parseFloat(document.getElementById('ot-day-hours').value)   || 0;
  const nightH  = parseFloat(document.getElementById('ot-night-hours').value) || 0;
  try {
    await db.collection('ot_entries').doc(date).set({
      date,
      dayHours:   dayH,   dayCost:   otCost(dayH),
      nightHours: nightH, nightCost: otCost(nightH),
      otRateUsed: COSTS.otRate,
      savedAt: new Date().toISOString()
    });
    calcOTPreview();
    document.getElementById('ot-status').textContent = '✔ OT Saved!';
    setTimeout(() => document.getElementById('ot-status').textContent = '', 3000);
    toast('OT saved!');
  } catch (e) { toast('OT save error: ' + e.message, true); }
}

document.getElementById('ot-date').addEventListener('change', loadOTEntry);

// ════════════════════════════════════════════════════════════
//  CANTEEN ENTRY — supplier → item → qty
// ════════════════════════════════════════════════════════════
const supplierItems = {
  'MC Caters':      ['teaQty', 'plainTeaQty', 'biscuit'],
  'SAM Bake House': ['snackQty'],
  'Sujeewa':        ['breakfastQty'],
  'Nilu':           ['lunchQty', 'dinnerQty'],
  'Walgama Hotel':  ['lunchQty', 'dinnerQty']
};
const itemLabels = {
  teaQty:'Milk Tea', plainTeaQty:'Plain Tea', biscuit:'Biscuit',
  snackQty:'Snack', breakfastQty:'Breakfast', lunchQty:'Lunch', dinnerQty:'Dinner'
};

function renderSupplierFields() {
  const supplier   = document.getElementById('e-supplier').value;
  const itemSelect = document.getElementById('e-itemType');
  itemSelect.innerHTML = '<option value="">— select item —</option>';
  document.getElementById('field-qty').style.display         = 'none';
  document.getElementById('field-biscuitCode').style.display = 'none';
  document.getElementById('e-qty').value = 0;
  if (!supplier) return;
  (supplierItems[supplier] || []).forEach(item => {
    const opt = document.createElement('option');
    opt.value = item; opt.textContent = itemLabels[item] || item;
    itemSelect.appendChild(opt);
  });
}

async function renderItemFields() {
  const type = document.getElementById('e-itemType').value;
  document.getElementById('field-qty').style.display         = type ? 'block' : 'none';
  document.getElementById('field-biscuitCode').style.display = (type === 'biscuit') ? 'block' : 'none';
  document.getElementById('e-qty').value = 0;
  if (type) await loadEntryForm();
}

async function loadEntryForm() {
  const date     = document.getElementById('e-date').value;
  const shift    = document.getElementById('e-shift').value;
  const supplier = document.getElementById('e-supplier').value;
  const itemType = document.getElementById('e-itemType').value;
  if (!date || !shift || !supplier || !itemType) return;
  try {
    const doc = await db.collection('records').doc(`${date}_${shift}`).get();
    if (!doc.exists) return;
    const s = (doc.data().suppliers || {})[supplier];
    if (!s) return;
    const qtyEl = document.getElementById('e-qty');
    if (itemType === 'biscuit') {
      const bisEl = document.getElementById('e-biscuitCode');
      if (bisEl && s.biscuitType) bisEl.value = s.biscuitType;
      if (qtyEl) qtyEl.value = s.biscuitQty || 0;
    } else {
      if (qtyEl) qtyEl.value = s[itemType] || 0;
    }
  } catch (e) { console.error('loadEntryForm:', e); }
}

async function saveRecord() {
  const date     = document.getElementById('e-date').value;
  const shift    = document.getElementById('e-shift').value;
  const supplier = document.getElementById('e-supplier').value;
  const itemType = document.getElementById('e-itemType').value;
  if (!date || !shift || !supplier || !itemType) {
    toast('Select date, shift, supplier and item', true); return;
  }
  const qty    = parseFloat(document.getElementById('e-qty').value) || 0;
  const id     = `${date}_${shift}`;
  const docRef = db.collection('records').doc(id);
  const snap   = await docRef.get();
  let data     = snap.exists ? snap.data() : { date, shift, suppliers: {} };
  if (!data.suppliers)           data.suppliers = {};
  if (!data.suppliers[supplier]) data.suppliers[supplier] = {};
  if (itemType === 'biscuit') {
    const bisEl = document.getElementById('e-biscuitCode');
    data.suppliers[supplier].biscuitType = bisEl ? bisEl.value : '';
    data.suppliers[supplier].biscuitQty  = qty;
  } else {
    data.suppliers[supplier][itemType] = qty;
  }
  try {
    await docRef.set(data);
    toast('✔ Saved!');
    document.getElementById('e-qty').value = 0;
  } catch (e) { toast('Save error: ' + e.message, true); }
}

function clearForm() {
  document.getElementById('e-supplier').value = '';
  document.getElementById('e-itemType').innerHTML = '<option value="">— select item —</option>';
  document.getElementById('field-qty').style.display         = 'none';
  document.getElementById('field-biscuitCode').style.display = 'none';
  document.getElementById('e-qty').value = 0;
}

document.getElementById('e-supplier').addEventListener('change', renderSupplierFields);
document.getElementById('e-itemType').addEventListener('change', renderItemFields);
document.getElementById('e-date').addEventListener('change',     loadEntryForm);
document.getElementById('e-shift').addEventListener('change',    loadEntryForm);

// ════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════
let dashData = [];

async function loadDashboard() {
  const from  = document.getElementById('f-from').value;
  const to    = document.getElementById('f-to').value;
  const shift = document.getElementById('f-shift').value;
  const tbody = document.getElementById('dashBody');
  tbody.innerHTML = '<tr><td colspan="24" class="loading-cell">⏳ Loading from Firebase…</td></tr>';

  try {
    // Canteen records
    let q = db.collection('records');
    if (from) q = q.where('date', '>=', from);
    if (to)   q = q.where('date', '<=', to);
    if (shift !== 'ALL') q = q.where('shift', '==', shift);
    q = q.orderBy('date');
    const snap = await q.get();

    // Manpower entries (per date)
    let mpQ = db.collection('manpower_entries');
    if (from) mpQ = mpQ.where('date', '>=', from);
    if (to)   mpQ = mpQ.where('date', '<=', to);
    const mpSnap = await mpQ.get();
    const mpMap  = {};
    mpSnap.forEach(d => { const r = d.data(); mpMap[r.date] = r; });

    // OT entries (per date, has both day+night)
    let otQ = db.collection('ot_entries');
    if (from) otQ = otQ.where('date', '>=', from);
    if (to)   otQ = otQ.where('date', '<=', to);
    const otSnap = await otQ.get();
    const otMap  = {};
    otSnap.forEach(d => { const r = d.data(); otMap[r.date] = r; });

    // Group canteen records by date_shift
    const grouped = {};
    snap.forEach(d => {
      const r   = d.data();
      const key = `${r.date}_${r.shift}`;
      if (!grouped[key]) grouped[key] = { date: r.date, shift: r.shift, suppliers: {} };
      Object.assign(grouped[key].suppliers, r.suppliers || {});
    });

    // Ensure rows exist for dates that have OT or MP but no canteen records
    const allDates = new Set([...Object.keys(mpMap), ...Object.keys(otMap)]);
    allDates.forEach(date => {
      ['DAY','NIGHT'].forEach(s => {
        if (shift !== 'ALL' && shift !== s) return;
        const key = `${date}_${s}`;
        if (!grouped[key]) grouped[key] = { date, shift: s, suppliers: {} };
      });
    });

    // Attach MP and OT data to each row
    Object.values(grouped).forEach(row => {
      if (mpMap[row.date]) row.mpEntry = mpMap[row.date];
      if (otMap[row.date]) row.otEntry = otMap[row.date];
    });

    dashData = Object.values(grouped).sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      return a.shift === 'DAY' ? -1 : 1;
    });

    renderTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="24" class="loading-cell" style="color:#c0392b">
      Error: ${e.message}<br><small>Check Firestore indexes in Firebase Console.</small></td></tr>`;
    console.error(e);
  }
}

function renderTable() {
  const tbody = document.getElementById('dashBody');
  const tfoot = document.getElementById('dashFoot');

  if (!dashData.length) {
    tbody.innerHTML = '<tr><td colspan="24" class="loading-cell">No records found for this period.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  const GT = zeros();
  let html = '';

  dashData.forEach(row => {
    const { date, shift, suppliers = {}, mpEntry, otEntry } = row;
    const mc   = suppliers['MC Caters']      || {};
    const sam  = suppliers['SAM Bake House'] || {};
    const suj  = suppliers['Sujeewa']        || {};
    const nilu = suppliers['Nilu']           || {};
    const walg = suppliers['Walgama Hotel']  || {};

    // MC Caters — tea
    const mcTea        = mc.teaQty      || 0;
    const mcPlain      = mc.plainTeaQty || 0;
    const mcTeaTotal   = Math.round(mcTea   * COSTS.milkTea);
    const mcPlainTotal = Math.round(mcPlain * COSTS.plainTea);
    const mcSub        = mcTeaTotal + mcPlainTotal;

    // Biscuits
    const bisType  = mc.biscuitType || sam.biscuitType || '';
    const bisQty   = (mc.biscuitQty || 0) + (sam.biscuitQty || 0);
    const bisTotal = Math.round(bisQty * COSTS.biscuit);

    // SAM Snack
    const samSnack      = sam.snackQty || 0;
    const samSnackTotal = Math.round(samSnack * COSTS.snack);

    // Sujeewa
    const sujBrf   = suj.breakfastQty || 0;
    const sujTotal = Math.round(sujBrf * COSTS.breakfast);

    // Nilu
    const niluL     = nilu.lunchQty  || 0;
    const niluD     = nilu.dinnerQty || 0;
    const niluTotal = Math.round((niluL * COSTS.lunch) + (niluD * COSTS.dinner));

    // Walgama
    const walgL     = walg.lunchQty  || 0;
    const walgD     = walg.dinnerQty || 0;
    const walgTotal = Math.round((walgL * COSTS.lunch) + (walgD * COSTS.dinner));

    // Manpower (one entry per day, shown on DAY row only to avoid double-counting)
    const mpTotal = (shift === 'DAY' && mpEntry) ? (mpEntry.totalCost || 0) : 0;

    // OT — split by shift from the daily ot_entry doc
    let otHours = 0, otCostVal = 0;
    if (otEntry) {
      if (shift === 'DAY') {
        otHours   = otEntry.dayHours || 0;
        otCostVal = otEntry.dayCost  || otCost(otHours);
      } else {
        otHours   = otEntry.nightHours || 0;
        otCostVal = otEntry.nightCost  || otCost(otHours);
      }
    }

    const dayTotal = mcSub + bisTotal + samSnackTotal + sujTotal + niluTotal + walgTotal + mpTotal + otCostVal;

    // Accumulate grand totals
    GT.mcTea        += mcTea;      GT.mcTeaTotal    += mcTeaTotal;
    GT.mcPlain      += mcPlain;    GT.mcPlainTotal  += mcPlainTotal;
    GT.mcSub        += mcSub;
    GT.bisQty       += bisQty;     GT.bisTotal      += bisTotal;
    GT.samSnack     += samSnack;   GT.samSnackTotal += samSnackTotal;
    GT.sujBrf       += sujBrf;     GT.sujTotal      += sujTotal;
    GT.niluL        += niluL;      GT.niluD         += niluD;     GT.niluTotal += niluTotal;
    GT.walgL        += walgL;      GT.walgD         += walgD;     GT.walgTotal += walgTotal;
    GT.mpTotal      += mpTotal;
    GT.otHours      += otHours;    GT.otCost        += otCostVal;
    GT.dayTotal     += dayTotal;

    const badge = shift === 'DAY'
      ? '<span class="badge-day">DAY ☀</span>'
      : '<span class="badge-night">NIGHT 🌙</span>';

    const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-LK',
      { weekday:'short', day:'2-digit', month:'short', year:'numeric' }) : '–';

    // 24 columns: Date, Shift, [MC×5], [Biscuit×3], [SAM×2], [Suj×2], [Nilu×3], [Walg×3], MP, OT hrs, OT cost, Total
    html += `<tr>
      <td class="left col-date">${fmtD(date)}</td>
      <td>${badge}</td>
      <td>${n(mcTea)}</td><td class="money">${rs(mcTeaTotal)}</td>
      <td>${n(mcPlain)}</td><td class="money">${rs(mcPlainTotal)}</td>
      <td class="subtotal-col money">${rs(mcSub)}</td>
      <td>${bisType||'–'}</td><td>${n(bisQty)}</td><td class="money">${rs(bisTotal)}</td>
      <td>${n(samSnack)}</td><td class="money">${rs(samSnackTotal)}</td>
      <td>${n(sujBrf)}</td><td class="money">${rs(sujTotal)}</td>
      <td>${n(niluL)}</td><td>${n(niluD)}</td><td class="money">${rs(niluTotal)}</td>
      <td>${n(walgL)}</td><td>${n(walgD)}</td><td class="money">${rs(walgTotal)}</td>
      <td class="money">${rs(mpTotal)}</td>
      <td class="ot-hrs">${otHours > 0 ? otHours : '<span class="dash">–</span>'}</td>
      <td class="money ot-cost">${rs(otCostVal)}</td>
      <td class="money day-total">${rs(dayTotal)}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  tfoot.innerHTML = `<tr class="grand-row">
    <td colspan="2" class="left" style="padding-left:10px;">GRAND TOTAL</td>
    <td>${GT.mcTea}</td><td>${rs(GT.mcTeaTotal)}</td>
    <td>${GT.mcPlain}</td><td>${rs(GT.mcPlainTotal)}</td>
    <td>${rs(GT.mcSub)}</td>
    <td>–</td><td>${GT.bisQty}</td><td>${rs(GT.bisTotal)}</td>
    <td>${GT.samSnack}</td><td>${rs(GT.samSnackTotal)}</td>
    <td>${GT.sujBrf}</td><td>${rs(GT.sujTotal)}</td>
    <td>${GT.niluL}</td><td>${GT.niluD}</td><td>${rs(GT.niluTotal)}</td>
    <td>${GT.walgL}</td><td>${GT.walgD}</td><td>${rs(GT.walgTotal)}</td>
    <td>${rs(GT.mpTotal)}</td>
    <td>${GT.otHours}</td><td>${rs(GT.otCost)}</td>
    <td style="font-size:.92rem;">${rs(GT.dayTotal)}</td>
  </tr>`;
}

function zeros() {
  return {
    mcTea:0, mcTeaTotal:0, mcPlain:0, mcPlainTotal:0, mcSub:0,
    bisQty:0, bisTotal:0, samSnack:0, samSnackTotal:0,
    sujBrf:0, sujTotal:0, niluL:0, niluD:0, niluTotal:0,
    walgL:0, walgD:0, walgTotal:0,
    mpTotal:0, otHours:0, otCost:0, dayTotal:0
  };
}

const n  = v => v ? v.toLocaleString()        : '<span class="dash">–</span>';
const rs = v => v ? 'Rs ' + v.toLocaleString(): '<span class="dash">–</span>';

function exportCSV() {
  if (!dashData.length) { toast('No data to export', true); return; }
  const headers = ['Date','Shift',
    'MC Tea Qty','MC Tea Total','MC Plain Qty','MC Plain Total','MC Sub',
    'Biscuit Type','Biscuit Qty','Biscuit Total',
    'SAM Snack Qty','SAM Total','Sujeewa Bfast','Sujeewa Total',
    'Nilu Lunch','Nilu Dinner','Nilu Total',
    'Walgama Lunch','Walgama Dinner','Walgama Total',
    'Manpower Total','OT Hours','OT Cost','Daily Total'];
  const rows = dashData.map(({ date, shift, suppliers={}, mpEntry, otEntry }) => {
    const mc=suppliers['MC Caters']||{}, sam=suppliers['SAM Bake House']||{},
          suj=suppliers['Sujeewa']||{}, nilu=suppliers['Nilu']||{}, walg=suppliers['Walgama Hotel']||{};
    const mcT=mc.teaQty||0, mcP=mc.plainTeaQty||0;
    const mcSub=Math.round(mcT*COSTS.milkTea+mcP*COSTS.plainTea);
    const bQ=(mc.biscuitQty||0)+(sam.biscuitQty||0), bT=Math.round(bQ*COSTS.biscuit);
    const sQ=sam.snackQty||0, sT=Math.round(sQ*COSTS.snack);
    const brQ=suj.breakfastQty||0, brT=Math.round(brQ*COSTS.breakfast);
    const nL=nilu.lunchQty||0, nD=nilu.dinnerQty||0, nT=Math.round((nL*COSTS.lunch)+(nD*COSTS.dinner));
    const wL=walg.lunchQty||0, wD=walg.dinnerQty||0, wT=Math.round((wL*COSTS.lunch)+(wD*COSTS.dinner));
    const mp = (shift==='DAY' && mpEntry) ? (mpEntry.totalCost||0) : 0;
    let otH=0, otC=0;
    if (otEntry) {
      otH = shift==='DAY' ? (otEntry.dayHours||0)   : (otEntry.nightHours||0);
      otC = shift==='DAY' ? (otEntry.dayCost||otCost(otH)) : (otEntry.nightCost||otCost(otH));
    }
    return [date,shift, mcT,Math.round(mcT*COSTS.milkTea), mcP,Math.round(mcP*COSTS.plainTea),mcSub,
      mc.biscuitType||'',bQ,bT, sQ,sT, brQ,brT, nL,nD,nT, wL,wD,wT, mp, otH,otC,
      mcSub+bT+sT+brT+nT+wT+mp+otC];
  });
  const csv = [headers,...rows].map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = `canteen_${document.getElementById('f-from').value}_to_${document.getElementById('f-to').value}.csv`;
  a.click(); toast('CSV downloaded!');
}

// ════════════════════════════════════════════════════════════
//  MANPOWER SYSTEM  (rates in Dashboard, entry in Data Entry)
// ════════════════════════════════════════════════════════════
let mpRates = [];
let mpRows  = [];

async function loadMpRates() {
  try {
    const snap = await db.collection('manpower_rates').orderBy('company').get();
    mpRates = [];
    snap.forEach(d => mpRates.push({ id: d.id, ...d.data() }));
    renderMpRatesTable();
    populateMpCompanyDropdown();
  } catch (e) { console.error('loadMpRates:', e); }
}

function renderMpRatesTable() {
  const tbody = document.getElementById('mp-rates-body');
  if (!mpRates.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No rates added yet.</td></tr>';
    return;
  }
  tbody.innerHTML = mpRates.map(r => `
    <tr>
      <td class="left" style="padding:6px 10px;">${r.company}</td>
      <td style="padding:6px 10px;text-align:center;">
        <span class="${r.shift==='DAY'?'badge-day':'badge-night'}">${r.shift}</span></td>
      <td style="padding:6px 10px;text-align:center;">${r.section}</td>
      <td style="padding:6px 10px;text-align:center;color:#1a3a5c;font-weight:700;">
        Rs ${r.rate.toLocaleString()}</td>
      <td style="padding:6px 10px;text-align:center;">
        <button onclick="deleteMpRate('${r.id}')"
          style="background:#e74c3c;color:#fff;border:none;padding:3px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;">✕ Delete</button></td>
    </tr>`).join('');
}

async function saveMpRate() {
  const company = document.getElementById('mp-r-company').value.trim();
  const shift   = document.getElementById('mp-r-shift').value;
  const section = document.getElementById('mp-r-section').value.trim();
  const rate    = parseFloat(document.getElementById('mp-r-rate').value) || 0;
  if (!company || !section || !rate) { toast('Fill company, section and rate', true); return; }
  try {
    await db.collection('manpower_rates').add({ company, shift, section, rate });
    document.getElementById('mp-r-company').value = '';
    document.getElementById('mp-r-section').value = '';
    document.getElementById('mp-r-rate').value    = 0;
    document.getElementById('mp-rate-status').textContent = '✔ Added!';
    setTimeout(() => document.getElementById('mp-rate-status').textContent = '', 3000);
    await loadMpRates();
    toast('Rate added!');
  } catch (e) { toast('Error: ' + e.message, true); }
}

async function deleteMpRate(id) {
  if (!confirm('Delete this rate?')) return;
  try {
    await db.collection('manpower_rates').doc(id).delete();
    await loadMpRates();
    toast('Deleted!');
  } catch (e) { toast('Error: ' + e.message, true); }
}

function populateMpCompanyDropdown() {
  const companies = [...new Set(mpRates.map(r => r.company))].sort();
  const sel = document.getElementById('mp-e-company');
  sel.innerHTML = '<option value="">— select —</option>' +
    companies.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('mp-e-section').innerHTML = '<option value="">— select —</option>';
  document.getElementById('mp-e-rate').value = '';
  document.getElementById('mp-e-cost').value = '';
}

function onMpCompanyOrShiftChange() {
  const company = document.getElementById('mp-e-company').value;
  const shift   = document.getElementById('mp-e-shift').value;
  const secSel  = document.getElementById('mp-e-section');
  secSel.innerHTML = '<option value="">— select —</option>';
  document.getElementById('mp-e-rate').value = '';
  document.getElementById('mp-e-cost').value = '';
  if (!company || !shift) return;
  mpRates.filter(r => r.company === company && r.shift === shift).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.section;
    secSel.appendChild(opt);
  });
}

function onMpSectionChange() {
  const rateId = document.getElementById('mp-e-section').value;
  const heads  = parseFloat(document.getElementById('mp-e-heads').value) || 0;
  const rate   = mpRates.find(r => r.id === rateId);
  if (!rate) {
    document.getElementById('mp-e-rate').value = '';
    document.getElementById('mp-e-cost').value = '';
    return;
  }
  document.getElementById('mp-e-rate').value = 'Rs ' + rate.rate.toLocaleString();
  document.getElementById('mp-e-cost').value = heads ? 'Rs ' + Math.round(heads * rate.rate).toLocaleString() : '';
}

function onMpHeadsChange() {
  const rateId = document.getElementById('mp-e-section').value;
  const heads  = parseFloat(document.getElementById('mp-e-heads').value) || 0;
  const rate   = mpRates.find(r => r.id === rateId);
  if (!rate) return;
  document.getElementById('mp-e-cost').value = 'Rs ' + Math.round(heads * rate.rate).toLocaleString();
}

function addMpEntryRow() {
  const rateId = document.getElementById('mp-e-section').value;
  const heads  = parseFloat(document.getElementById('mp-e-heads').value) || 0;
  const rate   = mpRates.find(r => r.id === rateId);
  if (!rate)  { toast('Select company, shift and section', true); return; }
  if (!heads) { toast('Enter number of heads', true); return; }
  mpRows.push({
    rateId: rate.id, company: rate.company, shift: rate.shift,
    section: rate.section, rate: rate.rate, heads,
    cost: Math.round(heads * rate.rate)
  });
  document.getElementById('mp-e-section').innerHTML = '<option value="">— select —</option>';
  document.getElementById('mp-e-heads').value = 1;
  document.getElementById('mp-e-rate').value  = '';
  document.getElementById('mp-e-cost').value  = '';
  renderMpEntryRows();
}

function removeMpRow(idx) {
  mpRows.splice(idx, 1);
  renderMpEntryRows();
}

function renderMpEntryRows() {
  const tbody = document.getElementById('mp-entry-body');
  const tfoot = document.getElementById('mp-entry-foot');
  if (!mpRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No rows yet — add above.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }
  tbody.innerHTML = mpRows.map((r, i) => `
    <tr>
      <td class="left" style="padding:6px 8px;">${r.company}</td>
      <td style="padding:6px 8px;text-align:center;">
        <span class="${r.shift==='DAY'?'badge-day':'badge-night'}">${r.shift}</span></td>
      <td style="padding:6px 8px;text-align:center;">${r.section}</td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;">${r.heads}</td>
      <td style="padding:6px 8px;text-align:center;color:#1a3a5c;font-weight:700;">
        Rs ${r.rate.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:center;color:#c0392b;font-weight:800;">
        Rs ${r.cost.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:center;">
        <button onclick="removeMpRow(${i})"
          style="background:#e74c3c;color:#fff;border:none;padding:4px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;">✕</button></td>
    </tr>`).join('');
  const total = mpRows.reduce((s, r) => s + r.cost, 0);
  tfoot.innerHTML = `<tr style="background:#1a3a5c;color:#fff;font-weight:800;">
    <td colspan="5" style="padding:8px 10px;text-align:left;">TOTAL</td>
    <td style="padding:8px;text-align:center;">Rs ${total.toLocaleString()}</td>
    <td></td></tr>`;
}

async function loadMpEntry() {
  const date = document.getElementById('mp-date').value;
  if (!date) return;
  try {
    const doc = await db.collection('manpower_entries').doc(date).get();
    mpRows = doc.exists ? (doc.data().rows || []) : [];
    renderMpEntryRows();
  } catch (e) { console.error('loadMpEntry:', e); }
}

async function saveMpEntry() {
  const date = document.getElementById('mp-date').value;
  if (!date)          { toast('Select a date', true); return; }
  if (!mpRows.length) { toast('Add at least one row first', true); return; }
  const totalCost = mpRows.reduce((s, r) => s + r.cost, 0);
  try {
    await db.collection('manpower_entries').doc(date).set({
      date, rows: mpRows, totalCost, savedAt: new Date().toISOString()
    });
    document.getElementById('mp-entry-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('mp-entry-status').textContent = '', 3000);
    toast('Manpower saved!');
  } catch (e) { toast('Error: ' + e.message, true); }
}

async function loadMpSummary() {
  const from = document.getElementById('mp-from').value;
  const to   = document.getElementById('mp-to').value;
  if (!from || !to) { toast('Select date range', true); return; }
  const tbody = document.getElementById('mp-summary-body');
  tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">⏳ Loading…</td></tr>';
  try {
    const snap = await db.collection('manpower_entries')
      .where('date', '>=', from).where('date', '<=', to).orderBy('date').get();
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No entries found.</td></tr>';
      document.getElementById('mp-summary-foot').innerHTML = '';
      return;
    }
    let html = '', grandTotal = 0;
    snap.forEach(d => {
      const entry = d.data();
      const fmtD  = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-LK',
        { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
      (entry.rows || []).forEach((r, i) => {
        grandTotal += r.cost;
        html += `<tr>
          <td class="left" style="padding:6px 8px;white-space:nowrap;">${i===0?fmtD:''}</td>
          <td class="left" style="padding:6px 8px;">${r.company}</td>
          <td style="padding:6px 8px;text-align:center;">
            <span class="${r.shift==='DAY'?'badge-day':'badge-night'}">${r.shift}</span></td>
          <td style="padding:6px 8px;text-align:center;">${r.section}</td>
          <td style="padding:6px 8px;text-align:center;font-weight:700;">${r.heads}</td>
          <td style="padding:6px 8px;text-align:center;color:#1a3a5c;font-weight:700;">
            Rs ${r.rate.toLocaleString()}</td>
          <td style="padding:6px 8px;text-align:center;color:#c0392b;font-weight:800;">
            Rs ${r.cost.toLocaleString()}</td>
        </tr>`;
      });
    });
    tbody.innerHTML = html;
    document.getElementById('mp-summary-foot').innerHTML = `
      <tr style="background:#1a3a5c;color:#fff;font-weight:800;font-size:.82rem;">
        <td colspan="6" style="padding:8px 12px;text-align:left;">GRAND TOTAL</td>
        <td style="padding:8px;text-align:center;">Rs ${grandTotal.toLocaleString()}</td>
      </tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:red">Error: ${e.message}</td></tr>`;
  }
}

// ── Wire manpower listeners ───────────────────────────────────
document.getElementById('mp-date').addEventListener('change',      loadMpEntry);
document.getElementById('mp-e-company').addEventListener('change', onMpCompanyOrShiftChange);
document.getElementById('mp-e-shift').addEventListener('change',   onMpCompanyOrShiftChange);
document.getElementById('mp-e-section').addEventListener('change', onMpSectionChange);
document.getElementById('mp-e-heads').addEventListener('input',    onMpHeadsChange);

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = err ? 'show err' : 'show ok';
  setTimeout(() => t.className = '', 3000);
}
