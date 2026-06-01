// ============================================================
//  HR Canteen System — app.js
// ============================================================

// ── Clock ────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById('clock').textContent =
    new Date().toLocaleString('en-LK');
}, 1000);

const auth = firebase.auth();
// ── Login ────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('loginMsg').textContent = "Login successful";
  } catch (e) {
    document.getElementById('loginMsg').textContent = e.message;
  }
}
// ── Logout ────────────────────────────────────────────────────
function logout() {
  auth.signOut();
}

auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display = 'block';
  } else {
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('appContent').style.display = 'none';
  }
});

// ── Load items lisitners ─────────────────────────────────────────
// ── Wire listeners (remove any old onchange from HTML) ────────
document.getElementById('e-supplier').addEventListener('change', async () => {
  renderSupplierFields();
});

document.getElementById('e-itemType').addEventListener('change', async () => {
  await renderItemFields();
});

document.getElementById('e-date').addEventListener('change', async () => {
  await loadEntryForm();
});

document.getElementById('e-shift').addEventListener('change', async () => {
  await loadEntryForm();
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
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const h = now.getHours();

  document.getElementById('e-date').value = today;
  document.getElementById('e-shift').value = (h >= 8 && h < 20) ? 'DAY' : 'NIGHT';
  document.getElementById('mp-date').value = today;
  document.getElementById('mp-shift').value = (h >= 8 && h < 20) ? 'DAY' : 'NIGHT';

  // Filter defaults: last 14 days
  document.getElementById('f-to').value = today;
  const from = new Date(now); from.setDate(from.getDate() - 13);
  document.getElementById('f-from').value =
    `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
})();

// ── Firebase init ─────────────────────────────────────────────
let db;
try {
  // firebase-config.js already called firebase.initializeApp(FIREBASE_CONFIG)
  db = firebase.firestore();
  document.getElementById('db-badge').className = 'db-badge connected';
  document.getElementById('db-badge').textContent = '🟢 Database Connected';
  loadCosts().then(() => loadDashboard());
} catch (e) {
  document.getElementById('db-badge').className = 'db-badge error';
  document.getElementById('db-badge').textContent = '🔴 Database Error';
  toast('Firebase error: ' + e.message, true);
}

// ── Costs (stored in Firestore config/costs) ──────────────────
let COSTS = {
  milkTea: 47.50, plainTea: 20, kotha: 25,
  snack: 80, biscuit: 375,
  breakfast: 170, lunch: 170, dinner: 170,
  otRate: 300
};

async function loadCosts() {
  try {
    const snap = await db.collection('config').doc('costs').get();
    if (snap.exists) {
      Object.assign(COSTS, snap.data());
      // Fill UI fields
      Object.keys(COSTS).forEach(k => {
        const el = document.getElementById('c-' + k);
        if (el) el.value = COSTS[k];
      });
    }
    updateRateHeaders();
  } catch (e) { console.error('loadCosts:', e); }
}

// ── load esisiting data from db per ──────────────────
// ── Step 3: load saved value for current supplier+item from DB ──
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
      // itemType is like "teaQty", "snackQty" etc — key matches DB field
      if (qtyEl) qtyEl.value = s[itemType] || 0;
    }
  } catch (e) {
    console.error('loadEntryForm:', e);
  }
}

// ── Supplier → allowed items map ──────────────────────────────
const supplierItems = {
  "MC Caters":      ["teaQty", "plainTeaQty", "biscuit"],
  "SAM Bake House": ["snackQty"],
  "Sujeewa":        ["breakfastQty"],
  "Nilu":           ["lunchQty", "dinnerQty"],
  "Walgama Hotel":  ["lunchQty", "dinnerQty"]
};


// Human-readable labels for the item type dropdown
const itemLabels = {
  teaQty:       "Milk Tea",
  plainTeaQty:  "Plain Tea",
  biscuit:      "Biscuit",
  snackQty:     "Snack",
  breakfastQty: "Breakfast",
  lunchQty:     "Lunch",
  dinnerQty:    "Dinner"
};
// ── Step 1: supplier changes → populate item dropdown ─────────
// ── Supplier changes → rebuild item dropdown ──────────────────
function renderSupplierFields() {
  const supplier = document.getElementById('e-supplier').value;
  const itemSelect = document.getElementById('e-itemType');

  // Reset item dropdown
  itemSelect.innerHTML = '<option value="">— select item —</option>';

  // Hide qty and biscuit fields until item chosen
  document.getElementById('field-qty').style.display = 'none';
  document.getElementById('field-biscuitCode').style.display = 'none';
  document.getElementById('e-qty').value = 0;

  if (!supplier) return;

  const items = supplierItems[supplier] || [];
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = itemLabels[item] || item;
    itemSelect.appendChild(opt);
  });
}


// ── Item changes → show/hide correct fields, load from DB ─────
async function renderItemFields() {
  const type = document.getElementById('e-itemType').value;

  const fieldQty     = document.getElementById('field-qty');
  const fieldBiscuit = document.getElementById('field-biscuitCode');

  if (!type) {
    fieldQty.style.display     = 'none';
    fieldBiscuit.style.display = 'none';
    document.getElementById('e-qty').value = 0;
    return;
  }

  // Always show qty
  fieldQty.style.display = 'block';

  // Only show biscuit type when biscuit selected
  fieldBiscuit.style.display = (type === 'biscuit') ? 'block' : 'none';

  // Reset qty then load saved value
  document.getElementById('e-qty').value = 0;
  await loadEntryForm();
}

async function saveCosts() {
  ['milkTea','plainTea','kotha','snack','biscuit','breakfast','lunch','dinner','otRate'].forEach(k => {
    const el = document.getElementById('c-' + k);
    if (el) COSTS[k] = parseFloat(el.value) || 0;
  });
  try {
    await db.collection('config').doc('costs').set(COSTS);
    updateRateHeaders();
    loadDashboard();
    document.getElementById('costStatus').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('costStatus').textContent = '', 3000);
    toast('Costs saved!');
  } catch (e) { toast('Save error: ' + e.message, true); }
}

function updateRateHeaders() {
   document.getElementById('rh-milkTea').textContent  = 'Rs ' + COSTS.milkTea;
  document.getElementById('rh-plainTea').textContent = 'Rs ' + COSTS.plainTea;
}

// ── Entry form helpers ────────────────────────────────────────
function fld(id) {
  const el = document.getElementById(id);
  return {
    val: () => el.value,
    num: () => parseFloat(el.value) || 0,
    set: v => el.value = v
  };
}

function clearForm() {
  document.getElementById('e-supplier').value = '';
  document.getElementById('e-itemType').value = '';
  document.getElementById('itemFields').innerHTML = '';
}

// ── Step 4: save only the selected item for selected supplier ──
async function saveRecord() {
  const date     = document.getElementById('e-date').value;
  const shift    = document.getElementById('e-shift').value;
  const supplier = document.getElementById('e-supplier').value;
  const itemType = document.getElementById('e-itemType').value;

  if (!date || !shift || !supplier || !itemType) {
    toast('Please select date, shift, supplier and item', true);
    return;
  }

  const qtyEl = document.getElementById('e-qty');
  const qty   = qtyEl ? (parseFloat(qtyEl.value) || 0) : 0;

  const id     = `${date}_${shift}`;
  const docRef = db.collection('records').doc(id);
  const doc    = await docRef.get();

  let data = doc.exists
    ? doc.data()
    : { date, shift, suppliers: {} };

  if (!data.suppliers)           data.suppliers = {};
  if (!data.suppliers[supplier]) data.suppliers[supplier] = {};

  if (itemType === 'biscuit') {
    const bisEl = document.getElementById('e-biscuitCode');
    data.suppliers[supplier].biscuitType = bisEl ? bisEl.value : '';
    data.suppliers[supplier].biscuitQty  = qty;
  } else {
    // itemType = "teaQty", "snackQty", etc — store directly
    data.suppliers[supplier][itemType] = qty;
  }

  try {
    await docRef.set(data);
    toast('Saved!');

    // Clear qty field after save, keep supplier+item selected
    if (qtyEl) qtyEl.value = 0;
    const bisEl = document.getElementById('e-biscuitCode');
    // Don't reset biscuit type — user may want to enter another
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── Save manpower/OT ──────────────────────────────────────────
async function saveManpower() {
  const date  = fld('mp-date').val();
  const shift = fld('mp-shift').val();
  if (!date) { toast('Please select a date', true); return; }
  const otH   = fld('mp-otHours').num();
  const otRate = COSTS.otRate;
  const rec = {
    date, shift,
    manpowerCost: fld('mp-cost').num(),
    otHours:      otH,
    otRate:       otRate,
    otTotal:      Math.round(otH * otRate),
    savedAt:      new Date().toISOString()
  };
  try {
    await db.collection('manpower').doc(`${date}_${shift}`).set(rec);
    document.getElementById('mpStatus').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('mpStatus').textContent = '', 3000);
    toast('Manpower saved!');
    loadDashboard();
  } catch (e) { toast('Save error: ' + e.message, true); }
}

// ── Dashboard ────────────────────────────────────────────────
let dashData = [];

async function loadDashboard() {
  const from  = document.getElementById('f-from').value;
  const to    = document.getElementById('f-to').value;
  const shift = document.getElementById('f-shift').value;

  const tbody = document.getElementById('dashBody');
  tbody.innerHTML = '<tr><td colspan="24" class="loading-cell">⏳ Loading from Firebase…</td></tr>';

  try {
    // ── Load canteen records ──────────────────────────────────
    let q = db.collection('records');
    if (from)  q = q.where('date', '>=', from);
    if (to)    q = q.where('date', '<=', to);
    if (shift !== 'ALL') q = q.where('shift', '==', shift);
    q = q.orderBy('date');
    const snap = await q.get();

    // ── Load manpower ─────────────────────────────────────────
    let mpQ = db.collection('manpower');
    if (from) mpQ = mpQ.where('date', '>=', from);
    if (to)   mpQ = mpQ.where('date', '<=', to);
    const mpSnap = await mpQ.get();

    const mpMap = {};
    mpSnap.forEach(d => {
      const r = d.data();
      mpMap[`${r.date}_${r.shift}`] = r;
    });

    // ── Build grouped rows ────────────────────────────────────
    // Each record doc already contains the full suppliers map,
    // so we just index by date_shift key directly.
    const grouped = {};
    snap.forEach(d => {
      const r = d.data();
      const key = `${r.date}_${r.shift}`;
      // Merge suppliers in case multiple writes produced separate docs
      // (shouldn't happen with current saveRecord, but safe guard)
      if (!grouped[key]) {
        grouped[key] = { date: r.date, shift: r.shift, suppliers: {} };
      }
      Object.assign(grouped[key].suppliers, r.suppliers || {});
    });

    // ── Merge manpower ────────────────────────────────────────
    Object.keys(mpMap).forEach(key => {
      if (!grouped[key]) {
        const mp = mpMap[key];
        grouped[key] = { date: mp.date, shift: mp.shift, suppliers: {} };
      }
      grouped[key].mp = mpMap[key];
    });

    // ── Sort: date asc, DAY before NIGHT ─────────────────────
    dashData = Object.values(grouped).sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      return a.shift === 'DAY' ? -1 : 1;
    });

    renderTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="30" class="loading-cell" style="color:red">Error: ${e.message}</td></tr>`;
    console.error(e);
  }
}

// ── Render table ──────────────────────────────────────────────
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
    const { date, shift, suppliers = {}, mp = {} } = row;

    const mc   = suppliers['MC Caters']      || {};
    const sam  = suppliers['SAM Bake House'] || {};
    const suj  = suppliers['Sujeewa']        || {};
    const nilu = suppliers['Nilu']           || {};
    const walg = suppliers['Walgama Hotel']  || {};

    // MC Caters
    const mcTea        = mc.teaQty      || 0;
    const mcPlain      = mc.plainTeaQty || 0;
    const mcTeaTotal   = Math.round(mcTea   * COSTS.milkTea);
    const mcPlainTotal = Math.round(mcPlain * COSTS.plainTea);
    const mcSub        = mcTeaTotal + mcPlainTotal;

    // Biscuits
    const bisType  = mc.biscuitType  || sam.biscuitType  || '';
    const bisQty   = (mc.biscuitQty  || 0) + (sam.biscuitQty  || 0);
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

    // Manpower / OT
    const mpCost  = mp.manpowerCost || 0;
    const otHours = mp.otHours      || 0;
    const otTotal = mp.otTotal      || Math.round(otHours * COSTS.otRate);

    // Daily total
    const dayTotal = mcSub + bisTotal + samSnackTotal + sujTotal + niluTotal + walgTotal + mpCost + otTotal;

    // Accumulators
    GT.mcTea         += mcTea;     GT.mcTeaTotal    += mcTeaTotal;
    GT.mcPlain       += mcPlain;   GT.mcPlainTotal  += mcPlainTotal;
    GT.mcSub         += mcSub;
    GT.bisQty        += bisQty;    GT.bisTotal      += bisTotal;
    GT.samSnack      += samSnack;  GT.samSnackTotal += samSnackTotal;
    GT.sujBrf        += sujBrf;    GT.sujTotal      += sujTotal;
    GT.niluL         += niluL;     GT.niluD         += niluD;    GT.niluTotal += niluTotal;
    GT.walgL         += walgL;     GT.walgD         += walgD;    GT.walgTotal += walgTotal;
    GT.mpCost        += mpCost;
    GT.otHours       += otHours;   GT.otTotal       += otTotal;
    GT.dayTotal      += dayTotal;

    const shiftBadge = shift === 'DAY'
      ? '<span class="badge-day">DAY ☀</span>'
      : '<span class="badge-night">NIGHT 🌙</span>';

    const fmtD = d => d
      ? new Date(d + 'T00:00:00').toLocaleDateString('en-LK',
          { weekday:'short', day:'2-digit', month:'short', year:'numeric' })
      : '–';

    // 24 columns exactly
    html += `<tr>
      <td class="left col-date">${fmtD(date)}</td>
      <td>${shiftBadge}</td>
      <td>${n(mcTea)}</td>
      <td class="money">${rs(mcTeaTotal)}</td>
      <td>${n(mcPlain)}</td>
      <td class="money">${rs(mcPlainTotal)}</td>
      <td class="subtotal-col money">${rs(mcSub)}</td>
      <td>${bisType || '–'}</td>
      <td>${n(bisQty)}</td>
      <td class="money">${rs(bisTotal)}</td>
      <td>${n(samSnack)}</td>
      <td class="money">${rs(samSnackTotal)}</td>
      <td>${n(sujBrf)}</td>
      <td class="money">${rs(sujTotal)}</td>
      <td>${n(niluL)}</td>
      <td>${n(niluD)}</td>
      <td class="money">${rs(niluTotal)}</td>
      <td>${n(walgL)}</td>
      <td>${n(walgD)}</td>
      <td class="money">${rs(walgTotal)}</td>
      <td class="money">${rs(mpCost)}</td>
      <td>${otHours || '–'}</td>
      <td class="money">${rs(otTotal)}</td>
      <td class="money" style="background:#fde8e8;color:#c0392b;font-weight:800;">${rs(dayTotal)}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Grand total footer — 24 columns
  tfoot.innerHTML = `
    <tr class="grand-row">
      <td colspan="2" class="left" style="padding-left:10px;">GRAND TOTAL</td>
      <td>${GT.mcTea}</td>
      <td class="money">${rs(GT.mcTeaTotal)}</td>
      <td>${GT.mcPlain}</td>
      <td class="money">${rs(GT.mcPlainTotal)}</td>
      <td class="money">${rs(GT.mcSub)}</td>
      <td>–</td>
      <td>${GT.bisQty}</td>
      <td class="money">${rs(GT.bisTotal)}</td>
      <td>${GT.samSnack}</td>
      <td class="money">${rs(GT.samSnackTotal)}</td>
      <td>${GT.sujBrf}</td>
      <td class="money">${rs(GT.sujTotal)}</td>
      <td>${GT.niluL}</td>
      <td>${GT.niluD}</td>
      <td class="money">${rs(GT.niluTotal)}</td>
      <td>${GT.walgL}</td>
      <td>${GT.walgD}</td>
      <td class="money">${rs(GT.walgTotal)}</td>
      <td class="money">${rs(GT.mpCost)}</td>
      <td>${GT.otHours}</td>
      <td class="money">${rs(GT.otTotal)}</td>
      <td class="money" style="font-size:.95rem;">${rs(GT.dayTotal)}</td>
    </tr>`;
}

// ── Helpers ───────────────────────────────────────────────────
// ── zeros — matches exactly the columns above ─────────────────
function zeros() {
  return {
    mcTea:0,    mcTeaTotal:0,
    mcPlain:0,  mcPlainTotal:0,
    mcSub:0,
    bisQty:0,   bisTotal:0,
    samSnack:0, samSnackTotal:0,
    sujBrf:0,   sujTotal:0,
    niluL:0,    niluD:0,    niluTotal:0,
    walgL:0,    walgD:0,    walgTotal:0,
    mpCost:0,   otHours:0,  otTotal:0,
    dayTotal:0
  };
}


const n   = v => v ? v.toLocaleString() : '<span class="dash">–</span>';
const rs  = v => v ? 'Rs ' + v.toLocaleString() : '<span class="dash">–</span>';

// ── Export CSV ────────────────────────────────────────────────
function exportCSV() {
  if (!dashData.length) { toast('No data to export', true); return; }

  const headers = ['Date','Shift',
    'MC Tea Qty','MC Tea Total','MC Plain Qty','MC Plain Total','MC Sub',
    'Biscuit Type','Biscuit Qty','Biscuit Total',
    'SAM Snack Qty','SAM Snack Total',
    'Sujeewa Bfast Qty','Sujeewa Total',
    'Nilu Lunch','Nilu Dinner','Nilu Total',
    'Walgama Lunch','Walgama Dinner','Walgama Total',
    'Manpower Cost','OT Hours','OT Total','Daily Total'];

  const rows = dashData.map(row => {
    const { date, shift, suppliers = {}, mp = {} } = row;
    const mc   = suppliers['MC Caters']      || {};
    const sam  = suppliers['SAM Bake House'] || {};
    const suj  = suppliers['Sujeewa']        || {};
    const nilu = suppliers['Nilu']           || {};
    const walg = suppliers['Walgama Hotel']  || {};

    const mcTea   = mc.teaQty || 0;
    const mcPlain = mc.plainTeaQty || 0;
    const mcSub   = Math.round(mcTea * COSTS.milkTea + mcPlain * COSTS.plainTea);

    const bisType  = mc.biscuitType || sam.biscuitType || '';
    const bisQty   = (mc.biscuitQty || 0) + (sam.biscuitQty || 0);
    const bisT     = Math.round(bisQty * COSTS.biscuit);

    const samSnack = sam.snackQty || 0;
    const samT     = Math.round(samSnack * COSTS.snack);

    const sujBrf   = suj.breakfastQty || 0;
    const sujT     = Math.round(sujBrf * COSTS.breakfast);

    const niluL = nilu.lunchQty || 0, niluD = nilu.dinnerQty || 0;
    const niluT = Math.round(niluL * COSTS.lunch + niluD * COSTS.dinner);

    const walgL = walg.lunchQty || 0, walgD = walg.dinnerQty || 0;
    const walgT = Math.round(walgL * COSTS.lunch + walgD * COSTS.dinner);

    const mpCost = mp.manpowerCost || 0;
    const otH    = mp.otHours      || 0;
    const otT    = mp.otTotal      || Math.round(otH * COSTS.otRate);

    const total = mcSub + bisT + samT + sujT + niluT + walgT + mpCost + otT;

    return [date, shift,
      mcTea, Math.round(mcTea * COSTS.milkTea),
      mcPlain, Math.round(mcPlain * COSTS.plainTea), mcSub,
      bisType, bisQty, bisT,
      samSnack, samT,
      sujBrf, sujT,
      niluL, niluD, niluT,
      walgL, walgD, walgT,
      mpCost, otH, otT, total];
  });

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `canteen_${document.getElementById('f-from').value}_${document.getElementById('f-to').value}.csv`;
  a.click();
  toast('CSV downloaded!');
}

// ── Export Image ────────────────────────────────────────────────
async function exportImage() {

  const scrollDiv = document.querySelector('.table-scroll');

  const originalOverflow = scrollDiv.style.overflow;
  const originalWidth = scrollDiv.style.width;

  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width = scrollDiv.scrollWidth + 'px';

  const canvas = await html2canvas(scrollDiv, {
      scale: 2,
      width: scrollDiv.scrollWidth,
      height: scrollDiv.scrollHeight,
      windowWidth: scrollDiv.scrollWidth,
      windowHeight: scrollDiv.scrollHeight
  });

  scrollDiv.style.overflow = originalOverflow;
  scrollDiv.style.width = originalWidth;

  const link = document.createElement('a');
  link.download = 'HR-Canteen-Full-Dashboard.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = err ? 'show err' : 'show ok';
  setTimeout(() => t.className = '', 3000);
}
