// ============================================================
//  HR Canteen System — app.js
//
//  SECTIONS (in order):
//    1.  Live Clock
//    2.  Firebase Auth — Login / Logout / State Observer
//    3.  Tab Navigation
//    4.  Default Date & Shift Initialization
//    5.  Cost Configuration  (Firestore: config/costs)
//    6.  OT Entry            (Firestore: ot_entries/{date})
//    7.  Canteen Entry       (Firestore: records/{date_shift})
//    8.  Dashboard — Load & Render
//    9.  Dashboard — Export (CSV + Image)
//   10.  Dashboard — Clear Records
//   11.  Manpower Rates      (Firestore: manpower_rates)
//   12.  Manpower Entry      (Firestore: manpower_entries/{date})
//   13.  Manpower Summary
//   14.  Event Listeners
//   15.  Utility Helpers (toast, formatting)
// ============================================================


// ════════════════════════════════════════════════════════════
//  1. LIVE CLOCK
//  Updates the header clock element every second using Sri
//  Lanka locale formatting (en-LK).
// ════════════════════════════════════════════════════════════

setInterval(() => {
  document.getElementById('clock').textContent =
    new Date().toLocaleString('en-LK');
}, 1000);


// ════════════════════════════════════════════════════════════
//  2. FIREBASE AUTH — Login / Logout / State Observer
// ════════════════════════════════════════════════════════════

const auth = firebase.auth();

// ── Login ────────────────────────────────────────────────────
// Reads email + password from the login form and attempts
// Firebase email/password sign-in. Displays error message on
// the form if it fails.
async function login() {
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('loginMsg').textContent = '';    // clear any prior error
  } catch (e) {
    document.getElementById('loginMsg').textContent = e.message;
  }
}

// ── Logout ───────────────────────────────────────────────────
// Signs out the current user, hides the app shell, shows the
// login screen, and resets tab state back to "Data Entry".
function logout() {
  auth.signOut()
    .then(() => {
      // Show login, hide app
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('appContent').style.display  = 'none';
      document.getElementById('loginMsg').textContent      = '';

      // Reset tab state — always land on Data Entry after logout
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(el       => el.classList.remove('active'));
      document.getElementById('tab-entry').classList.add('active');
      document.querySelector('.tab').classList.add('active');
    })
    .catch(e => toast('Logout error: ' + e.message, true));
}

// ── Auth State Observer ──────────────────────────────────────
// Fires automatically when the user's authentication state
// changes (login, logout, page refresh with an active session).
// On login  → show app, update badge, seed all data.
// On logout → show login screen.
auth.onAuthStateChanged(user => {
  if (user) {
    // User is signed in — reveal the main app
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display  = 'block';

    // Update the Firebase connection status badge in the header
    const badge = document.getElementById('db-badge');
    badge.className   = 'db-badge connected';
    badge.textContent = '🟢 Connected';

    // Load all persistent data in sequence.
    // Dashboard intentionally loads only when that tab is clicked.
    loadCosts().then(() => {
      loadMpRates();   // populates the Manpower Rates table & dropdowns
      loadMpEntry();   // loads today's manpower entry rows
      loadOTEntry();   // loads today's OT hours
    });
  } else {
    // User is signed out — show login screen
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContent').style.display  = 'none';
  }
});


// ════════════════════════════════════════════════════════════
//  3. TAB NAVIGATION
//  Switches between "Data Entry" and "Dashboard" tabs.
//  Auto-loads dashboard data when the Dashboard tab is opened.
// ════════════════════════════════════════════════════════════

function switchTab(name, btn) {
  // Deactivate all tab panels and tab buttons
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el           => el.classList.remove('active'));

  // Activate the selected tab panel and button
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');

  // Dashboard tab triggers a fresh data load on every visit
  if (name === 'dashboard') loadDashboard();
}


// ════════════════════════════════════════════════════════════
//  4. DEFAULT DATE & SHIFT INITIALIZATION
//  Runs once on page load (IIFE) to pre-fill every date input
//  with today's date and the filter range with the current
//  calendar month (1st → today). The shift defaults to DAY
//  between 08:00–19:59, NIGHT otherwise.
// ════════════════════════════════════════════════════════════

(function initDates() {
  const now          = new Date();
  const pad          = n => String(n).padStart(2, '0');
  const today        = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const firstOfMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const h            = now.getHours();

  // Individual entry forms — default to today
  document.getElementById('e-date').value  = today;
  document.getElementById('ot-date').value = today;
  document.getElementById('mp-date').value = today;

  // Canteen entry shift: DAY 08:00–19:59, NIGHT otherwise
  document.getElementById('e-shift').value = (h >= 8 && h < 20) ? 'DAY' : 'NIGHT';

  // Dashboard filter range — from the 1st of the current month to today
  document.getElementById('f-from').value = firstOfMonth;
  document.getElementById('f-to').value   = today;

  // Manpower summary filter — same range
  document.getElementById('mp-from').value = firstOfMonth;
  document.getElementById('mp-to').value   = today;
})();


// ════════════════════════════════════════════════════════════
//  5. COST CONFIGURATION
//  Stores per-unit rates for every food/drink item and the
//  master OT rate in Firestore (config/costs).
//
//  COSTS object is the in-memory cache of those rates and is
//  used throughout the app for all cost calculations.
// ════════════════════════════════════════════════════════════

let COSTS = {
  milkTea:   47.50,  // Rs per cup
  plainTea:  20,     // Rs per cup
  kotha:     25,     // Rs per cup  (Koththamalli)
  snack:     80,     // Rs per unit (SAM Bake House snacks)
  biscuit:   375,    // Rs per pack
  breakfast: 170,    // Rs per meal
  lunch:     170,    // Rs per meal
  dinner:    170,    // Rs per meal
  otRate:    38000   // Master OT Rate — used in formula: hours × otRate
};

// ── loadCosts ────────────────────────────────────────────────
// Fetches the saved cost config from Firestore and merges it
// into the local COSTS object. Refreshes UI elements that
// display rate values (table header rate cells, OT banner).
async function loadCosts() {
  try {
    const snap = await db.collection('config').doc('costs').get();
    if (snap.exists) Object.assign(COSTS, snap.data());

    // Sync all cost input fields in the Cost Configuration card
    Object.keys(COSTS).forEach(k => {
      const el = document.getElementById('c-' + k);
      if (el) el.value = COSTS[k];
    });

    updateRateHeaders();  // refresh column rate labels in the dashboard table
    calcOTPreview();      // refresh OT cost preview fields
  } catch (e) {
    console.error('loadCosts:', e);
  }
}

// ── saveCosts ────────────────────────────────────────────────
// Reads all cost input fields, updates the in-memory COSTS
// object, persists to Firestore, and refreshes downstream UI.
async function saveCosts() {
  const costKeys = ['milkTea','plainTea','kotha','snack','biscuit','breakfast','lunch','dinner','otRate'];
  costKeys.forEach(k => {
    const el = document.getElementById('c-' + k);
    if (el) COSTS[k] = parseFloat(el.value) || 0;
  });

  try {
    await db.collection('config').doc('costs').set(COSTS);
    updateRateHeaders();
    calcOTPreview();
    loadDashboard();   // re-render dashboard with new rates applied

    // Inline status feedback
    document.getElementById('costStatus').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('costStatus').textContent = '', 3000);
    toast('Costs saved!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── updateRateHeaders ────────────────────────────────────────
// Pushes the current per-unit rates into the dashboard table
// header cells and the OT entry rate banner.
function updateRateHeaders() {
  document.getElementById('rh-milkTea').textContent  = 'Rs ' + COSTS.milkTea;
  document.getElementById('rh-plainTea').textContent = 'Rs ' + COSTS.plainTea;

  const otDisplay = document.getElementById('ot-rate-display');
  if (otDisplay) otDisplay.textContent = 'Rs ' + COSTS.otRate.toLocaleString();
}


// ════════════════════════════════════════════════════════════
//  6. OT ENTRY
//  Stored in Firestore collection: ot_entries
//  Document ID: the date string (YYYY-MM-DD)
//  Each document holds both DAY and NIGHT OT for that date.
//
//  OT Cost formula: hours × masterOtRate
//  (The masterOtRate itself already encodes the per-hour cost.)
// ════════════════════════════════════════════════════════════

// ── otCost ───────────────────────────────────────────────────
// Calculates the OT cost for a given number of hours using the
// current master OT rate from COSTS.
function otCost(hours) {
  return Math.round(hours * COSTS.otRate);
}

// ── calcOTPreview ────────────────────────────────────────────
// Reads the DAY and NIGHT OT hour inputs and writes the
// computed cost into the read-only preview fields in real time.
// Called on every input event and after costs are loaded/saved.
function calcOTPreview() {
  const dayH   = parseFloat(document.getElementById('ot-day-hours').value)   || 0;
  const nightH = parseFloat(document.getElementById('ot-night-hours').value) || 0;

  document.getElementById('ot-day-cost').value =
    dayH   > 0 ? 'Rs ' + otCost(dayH).toLocaleString()   : '';
  document.getElementById('ot-night-cost').value =
    nightH > 0 ? 'Rs ' + otCost(nightH).toLocaleString() : '';
}

// ── loadOTEntry ──────────────────────────────────────────────
// Fetches the OT document for the currently selected date and
// populates the OT hour inputs. Clears inputs if no doc exists.
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
      // No record for this date — reset to zero
      document.getElementById('ot-day-hours').value   = 0;
      document.getElementById('ot-night-hours').value = 0;
    }
    calcOTPreview();
  } catch (e) {
    console.error('loadOTEntry:', e);
  }
}

// ── saveOT ───────────────────────────────────────────────────
// Saves (or overwrites) the OT entry for the selected date.
// Stores both the raw hours AND the computed cost so the
// dashboard can display costs even if the rate changes later.
async function saveOT() {
  const date  = document.getElementById('ot-date').value;
  if (!date) { toast('Select a date', true); return; }

  const dayH   = parseFloat(document.getElementById('ot-day-hours').value)   || 0;
  const nightH = parseFloat(document.getElementById('ot-night-hours').value) || 0;

  try {
    await db.collection('ot_entries').doc(date).set({
      date,
      dayHours:   dayH,
      dayCost:    otCost(dayH),
      nightHours: nightH,
      nightCost:  otCost(nightH),
      otRateUsed: COSTS.otRate,          // snapshot the rate used at time of save
      savedAt:    new Date().toISOString()
    });

    calcOTPreview();

    // Inline status feedback
    document.getElementById('ot-status').textContent = '✔ OT Saved!';
    setTimeout(() => document.getElementById('ot-status').textContent = '', 3000);
    toast('OT saved!');
  } catch (e) {
    toast('OT save error: ' + e.message, true);
  }
}


// ════════════════════════════════════════════════════════════
//  7. CANTEEN ENTRY
//  Stored in Firestore collection: records
//  Document ID: {date}_{shift}  e.g. "2025-07-01_DAY"
//  Each document stores a "suppliers" map keyed by supplier
//  name, with quantity fields nested inside.
//
//  Supplier → allowed items mapping:
//    MC Caters      → Milk Tea, Plain Tea, Biscuit
//    SAM Bake House → Snack
//    Sujeewa        → Breakfast
//    Nilu           → Lunch, Dinner
//    Walgama Hotel  → Lunch, Dinner
// ════════════════════════════════════════════════════════════

// Maps each supplier to the item field names they supply
const supplierItems = {
  'MC Caters':      ['teaQty', 'plainTeaQty', 'biscuit'],
  'SAM Bake House': ['snackQty'],
  'Sujeewa':        ['breakfastQty'],
  'Nilu':           ['lunchQty', 'dinnerQty'],
  'Walgama Hotel':  ['lunchQty', 'dinnerQty']
};

// Human-readable labels for each item field name
const itemLabels = {
  teaQty:       'Milk Tea',
  plainTeaQty:  'Plain Tea',
  biscuit:      'Biscuit',
  snackQty:     'Snack',
  breakfastQty: 'Breakfast',
  lunchQty:     'Lunch',
  dinnerQty:    'Dinner'
};

// ── renderSupplierFields ─────────────────────────────────────
// Triggered when the supplier dropdown changes.
// Rebuilds the Item dropdown to show only items that the
// selected supplier provides. Hides quantity / biscuit fields
// until an item is also selected.
function renderSupplierFields() {
  const supplier   = document.getElementById('e-supplier').value;
  const itemSelect = document.getElementById('e-itemType');

  // Reset item dropdown and hide quantity fields
  itemSelect.innerHTML = '<option value="">— select item —</option>';
  document.getElementById('field-qty').style.display         = 'none';
  document.getElementById('field-biscuitCode').style.display = 'none';
  document.getElementById('e-qty').value = 0;

  if (!supplier) return;

  // Populate items available for this supplier
  (supplierItems[supplier] || []).forEach(item => {
    const opt       = document.createElement('option');
    opt.value       = item;
    opt.textContent = itemLabels[item] || item;
    itemSelect.appendChild(opt);
  });
}

// ── renderItemFields ─────────────────────────────────────────
// Triggered when the item dropdown changes.
// Shows the quantity input (and the biscuit-type selector if
// the item is "biscuit"). Then auto-loads any existing value
// for this date/shift/supplier/item combination from Firestore.
async function renderItemFields() {
  const type = document.getElementById('e-itemType').value;

  // Show/hide qty and biscuit-code fields based on selection
  document.getElementById('field-qty').style.display         = type ? 'block' : 'none';
  document.getElementById('field-biscuitCode').style.display = (type === 'biscuit') ? 'block' : 'none';
  document.getElementById('e-qty').value = 0;

  // If an item was selected, try to pre-fill with an existing saved value
  if (type) await loadEntryForm();
}

// ── loadEntryForm ────────────────────────────────────────────
// Reads the Firestore record for the selected date+shift and
// pre-fills the qty (and biscuit type) fields if a saved value
// exists. Called when any of date/shift/supplier/item changes.
async function loadEntryForm() {
  const date     = document.getElementById('e-date').value;
  const shift    = document.getElementById('e-shift').value;
  const supplier = document.getElementById('e-supplier').value;
  const itemType = document.getElementById('e-itemType').value;

  if (!date || !shift || !supplier || !itemType) return;

  try {
    const doc = await db.collection('records').doc(`${date}_${shift}`).get();
    if (!doc.exists) return;

    const supplierData = (doc.data().suppliers || {})[supplier];
    if (!supplierData) return;

    const qtyEl = document.getElementById('e-qty');

    if (itemType === 'biscuit') {
      // Biscuit stores type + qty separately
      const bisEl = document.getElementById('e-biscuitCode');
      if (bisEl && supplierData.biscuitType) bisEl.value = supplierData.biscuitType;
      if (qtyEl) qtyEl.value = supplierData.biscuitQty || 0;
    } else {
      // Standard item — just set qty
      if (qtyEl) qtyEl.value = supplierData[itemType] || 0;
    }
  } catch (e) {
    console.error('loadEntryForm:', e);
  }
}

// ── saveRecord ───────────────────────────────────────────────
// Saves or updates one supplier's item quantity for the
// selected date+shift. Uses a read-then-write pattern to
// preserve other suppliers' data in the same document.
async function saveRecord() {
  const date     = document.getElementById('e-date').value;
  const shift    = document.getElementById('e-shift').value;
  const supplier = document.getElementById('e-supplier').value;
  const itemType = document.getElementById('e-itemType').value;

  if (!date || !shift || !supplier || !itemType) {
    toast('Select date, shift, supplier and item', true);
    return;
  }

  const qty    = parseFloat(document.getElementById('e-qty').value) || 0;
  const id     = `${date}_${shift}`;
  const docRef = db.collection('records').doc(id);

  // Read existing document so we don't overwrite other suppliers
  const snap = await docRef.get();
  let data   = snap.exists ? snap.data() : { date, shift, suppliers: {} };

  // Ensure nested supplier map exists
  if (!data.suppliers)           data.suppliers = {};
  if (!data.suppliers[supplier]) data.suppliers[supplier] = {};

  if (itemType === 'biscuit') {
    // Biscuit: save type + qty together
    const bisEl = document.getElementById('e-biscuitCode');
    data.suppliers[supplier].biscuitType = bisEl ? bisEl.value : '';
    data.suppliers[supplier].biscuitQty  = qty;
  } else {
    // Standard item: save qty under its field key
    data.suppliers[supplier][itemType] = qty;
  }

  try {
    await docRef.set(data);
    toast('✔ Saved!');
    document.getElementById('e-qty').value = 0;
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── clearForm ────────────────────────────────────────────────
// Resets the canteen entry form to its blank state without
// changing the date or shift selectors.
function clearForm() {
  document.getElementById('e-supplier').value = '';
  document.getElementById('e-itemType').innerHTML = '<option value="">— select item —</option>';
  document.getElementById('field-qty').style.display         = 'none';
  document.getElementById('field-biscuitCode').style.display = 'none';
  document.getElementById('e-qty').value = 0;
}


// ════════════════════════════════════════════════════════════
//  8. DASHBOARD — LOAD & RENDER
//  Fetches three parallel Firestore collections for the filter
//  range and merges them into a single sorted row-set:
//    • records           → canteen qty data per date+shift
//    • manpower_entries  → headcount + cost per date
//    • ot_entries        → OT hours + cost per date
//
//  Rows are sorted by date ASC, DAY before NIGHT within a date.
//  Dates that only have OT or MP (no canteen records) still get
//  a row so no data is silently omitted.
// ════════════════════════════════════════════════════════════

let dashData = [];   // in-memory cache of the last loaded dashboard rows

// ── loadDashboard ────────────────────────────────────────────
async function loadDashboard() {
  const from  = document.getElementById('f-from').value;
  const to    = document.getElementById('f-to').value;
  const shift = document.getElementById('f-shift').value;
  const tbody = document.getElementById('dashBody');

  tbody.innerHTML = '<tr><td colspan="24" class="loading-cell">⏳ Loading from Firebase…</td></tr>';

  try {
    // ── Fetch 1: Canteen records ─────────────────────────────
    let q = db.collection('records');
    if (from)           q = q.where('date', '>=', from);
    if (to)             q = q.where('date', '<=', to);
    if (shift !== 'ALL') q = q.where('shift', '==', shift);
    q = q.orderBy('date');
    const snap = await q.get();

    // ── Fetch 2: Manpower entries ────────────────────────────
    let mpQ = db.collection('manpower_entries');
    if (from) mpQ = mpQ.where('date', '>=', from);
    if (to)   mpQ = mpQ.where('date', '<=', to);
    const mpSnap = await mpQ.get();
    const mpMap  = {};
    mpSnap.forEach(d => { const r = d.data(); mpMap[r.date] = r; });

    // ── Fetch 3: OT entries ──────────────────────────────────
    let otQ = db.collection('ot_entries');
    if (from) otQ = otQ.where('date', '>=', from);
    if (to)   otQ = otQ.where('date', '<=', to);
    const otSnap = await otQ.get();
    const otMap  = {};
    otSnap.forEach(d => { const r = d.data(); otMap[r.date] = r; });

    // ── Group canteen records by date_shift key ──────────────
    const grouped = {};
    snap.forEach(d => {
      const r   = d.data();
      const key = `${r.date}_${r.shift}`;
      if (!grouped[key]) grouped[key] = { date: r.date, shift: r.shift, suppliers: {} };
      Object.assign(grouped[key].suppliers, r.suppliers || {});
    });

    // ── Ensure rows exist for dates with MP/OT but no canteen ─
    // This prevents losing MP or OT data when no canteen entry
    // was made for that date.
    const allDates = new Set([...Object.keys(mpMap), ...Object.keys(otMap)]);
    allDates.forEach(date => {
      ['DAY', 'NIGHT'].forEach(s => {
        if (shift !== 'ALL' && shift !== s) return;   // respect shift filter
        const key = `${date}_${s}`;
        if (!grouped[key]) grouped[key] = { date, shift: s, suppliers: {} };
      });
    });

    // ── Attach MP and OT data to each row ────────────────────
    Object.values(grouped).forEach(row => {
      if (mpMap[row.date]) row.mpEntry = mpMap[row.date];
      if (otMap[row.date]) row.otEntry = otMap[row.date];
    });

    // ── Sort: date ASC, DAY before NIGHT within same date ────
    dashData = Object.values(grouped).sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      return a.shift === 'DAY' ? -1 : 1;
    });

    renderTable();

  } catch (e) {
    tbody.innerHTML = `
      <tr>
        <td colspan="24" class="loading-cell" style="color:#c0392b">
          Error: ${e.message}<br>
          <small>Check Firestore composite indexes in Firebase Console.</small>
        </td>
      </tr>`;
    console.error(e);
  }
}

// ── renderTable ──────────────────────────────────────────────
// Converts the dashData array into HTML table rows and a grand
// total footer row. Called after loadDashboard() and also after
// clearRangeRecords() to refresh an empty table.
//
// Column order (24 cols):
//   Date | Shift |
//   MC Tea Qty | MC Tea Cost | MC Plain Qty | MC Plain Cost | MC Sub |
//   Biscuit Type | Biscuit Qty | Biscuit Total |
//   SAM Snack Qty | SAM Total |
//   Sujeewa Breakfast | Sujeewa Total |
//   Nilu Lunch | Nilu Dinner | Nilu Total |
//   Walgama Lunch | Walgama Dinner | Walgama Total |
//   MP Heads | MP Cost |
//   OT Hours | OT Cost |
//   Daily Total
function renderTable() {
  const tbody = document.getElementById('dashBody');
  const tfoot = document.getElementById('dashFoot');

  if (!dashData.length) {
    tbody.innerHTML = '<tr><td colspan="24" class="loading-cell">No records found for this period.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  // Running grand totals across all rows
  const GT = zeros();
  let html = '';

  dashData.forEach(row => {
    const { date, shift, suppliers = {}, mpEntry, otEntry } = row;

    // Destructure supplier data with safe empty-object fallback
    const mc   = suppliers['MC Caters']      || {};
    const sam  = suppliers['SAM Bake House'] || {};
    const suj  = suppliers['Sujeewa']        || {};
    const nilu = suppliers['Nilu']           || {};
    const walg = suppliers['Walgama Hotel']  || {};

    // ── MC Caters — Tea ──────────────────────────────────────
    const mcTea        = mc.teaQty      || 0;
    const mcPlain      = mc.plainTeaQty || 0;
    const mcTeaTotal   = Math.round(mcTea   * COSTS.milkTea);
    const mcPlainTotal = Math.round(mcPlain * COSTS.plainTea);
    const mcSub        = mcTeaTotal + mcPlainTotal;

    // ── Biscuits (sourced from MC Caters or SAM Bake House) ──
    const bisType  = mc.biscuitType || sam.biscuitType || '';
    const bisQty   = (mc.biscuitQty  || 0) + (sam.biscuitQty  || 0);
    const bisTotal = Math.round(bisQty * COSTS.biscuit);

    // ── SAM Bake House — Snacks ──────────────────────────────
    const samSnack      = sam.snackQty || 0;
    const samSnackTotal = Math.round(samSnack * COSTS.snack);

    // ── Sujeewa — Breakfast ──────────────────────────────────
    const sujBrf   = suj.breakfastQty || 0;
    const sujTotal = Math.round(sujBrf * COSTS.breakfast);

    // ── Nilu — Lunch & Dinner ────────────────────────────────
    const niluL     = nilu.lunchQty  || 0;
    const niluD     = nilu.dinnerQty || 0;
    const niluTotal = Math.round((niluL * COSTS.lunch) + (niluD * COSTS.dinner));

    // ── Walgama Hotel — Lunch & Dinner ───────────────────────
    const walgL     = walg.lunchQty  || 0;
    const walgD     = walg.dinnerQty || 0;
    const walgTotal = Math.round((walgL * COSTS.lunch) + (walgD * COSTS.dinner));

    // ── Manpower — filter rows by current shift ──────────────
    // A single manpower_entry document stores rows for all
    // shifts, so we filter to only the shift of this table row.
    const mpHeads = mpEntry
      ? (mpEntry.rows || []).filter(r => r.shift === shift).reduce((s, r) => s + (r.heads || 0), 0)
      : 0;
    const mpTotal = mpEntry
      ? (mpEntry.rows || []).filter(r => r.shift === shift).reduce((s, r) => s + (r.cost  || 0), 0)
      : 0;

    // ── OT — pick DAY or NIGHT hours from the shared doc ─────
    let otHours = 0, otCostVal = 0;
    if (otEntry) {
      if (shift === 'DAY') {
        otHours   = otEntry.dayHours || 0;
        otCostVal = otEntry.dayCost  || otCost(otHours);   // fallback: recalculate
      } else {
        otHours   = otEntry.nightHours || 0;
        otCostVal = otEntry.nightCost  || otCost(otHours);
      }
    }

    // ── Daily total for this row ─────────────────────────────
    const dayTotal =
      mcSub + bisTotal + samSnackTotal + sujTotal +
      niluTotal + walgTotal + mpTotal + otCostVal;

    // ── Accumulate into grand totals ─────────────────────────
    GT.mcTea        += mcTea;      GT.mcTeaTotal    += mcTeaTotal;
    GT.mcPlain      += mcPlain;    GT.mcPlainTotal  += mcPlainTotal;
    GT.mcSub        += mcSub;
    GT.bisQty       += bisQty;     GT.bisTotal      += bisTotal;
    GT.samSnack     += samSnack;   GT.samSnackTotal += samSnackTotal;
    GT.sujBrf       += sujBrf;     GT.sujTotal      += sujTotal;
    GT.niluL        += niluL;      GT.niluD         += niluD;     GT.niluTotal += niluTotal;
    GT.walgL        += walgL;      GT.walgD         += walgD;     GT.walgTotal += walgTotal;
    GT.mpHeads      += mpHeads;    GT.mpTotal       += mpTotal;
    GT.otHours      += otHours;    GT.otCost        += otCostVal;
    GT.dayTotal     += dayTotal;

    // ── Shift badge ──────────────────────────────────────────
    const badge = shift === 'DAY'
      ? '<span class="badge-day">DAY ☀</span>'
      : '<span class="badge-night">NIGHT 🌙</span>';

    // ── Date formatter ───────────────────────────────────────
    const fmtD = d => d
      ? new Date(d + 'T00:00:00').toLocaleDateString('en-LK',
          { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      : '–';

    // ── Build table row HTML (24 columns) ────────────────────
    html += `<tr>
      <td class="left col-date">${fmtD(date)}</td>
      <td>${badge}</td>

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

      <td class="mp-heads">${mpHeads > 0 ? mpHeads : '<span class="dash">–</span>'}</td>
      <td class="money">${rs(mpTotal)}</td>

      <td class="ot-hrs">${otHours > 0 ? otHours : '<span class="dash">–</span>'}</td>
      <td class="money ot-cost">${rs(otCostVal)}</td>

      <td class="money day-total">${rs(dayTotal)}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // ── Grand total footer row ───────────────────────────────
  tfoot.innerHTML = `
    <tr class="grand-row">
      <td colspan="2" class="left" style="padding-left:10px;">GRAND TOTAL</td>
      <td>${GT.mcTea}</td>
      <td>${rs(GT.mcTeaTotal)}</td>
      <td>${GT.mcPlain}</td>
      <td>${rs(GT.mcPlainTotal)}</td>
      <td>${rs(GT.mcSub)}</td>
      <td>–</td>
      <td>${GT.bisQty}</td>
      <td>${rs(GT.bisTotal)}</td>
      <td>${GT.samSnack}</td>
      <td>${rs(GT.samSnackTotal)}</td>
      <td>${GT.sujBrf}</td>
      <td>${rs(GT.sujTotal)}</td>
      <td>${GT.niluL}</td>
      <td>${GT.niluD}</td>
      <td>${rs(GT.niluTotal)}</td>
      <td>${GT.walgL}</td>
      <td>${GT.walgD}</td>
      <td>${rs(GT.walgTotal)}</td>
      <td>${GT.mpHeads}</td>
      <td>${rs(GT.mpTotal)}</td>
      <td>${GT.otHours}</td>
      <td>${rs(GT.otCost)}</td>
      <td style="font-size:.92rem;">${rs(GT.dayTotal)}</td>
    </tr>`;
}

// ── zeros ────────────────────────────────────────────────────
// Returns a fresh grand-total accumulator object with all
// numeric fields set to 0. Used at the start of renderTable().
function zeros() {
  return {
    mcTea: 0,        mcTeaTotal: 0,
    mcPlain: 0,      mcPlainTotal: 0,
    mcSub: 0,
    bisQty: 0,       bisTotal: 0,
    samSnack: 0,     samSnackTotal: 0,
    sujBrf: 0,       sujTotal: 0,
    niluL: 0,        niluD: 0,        niluTotal: 0,
    walgL: 0,        walgD: 0,        walgTotal: 0,
    mpHeads: 0,      mpTotal: 0,
    otHours: 0,      otCost: 0,
    dayTotal: 0
  };
}


// ════════════════════════════════════════════════════════════
//  9. DASHBOARD — EXPORT
// ════════════════════════════════════════════════════════════

// ── exportCSV ────────────────────────────────────────────────
// Serialises dashData into a CSV file and triggers a browser
// download. Recomputes costs from the current COSTS rates so
// the CSV always reflects up-to-date values.
function exportCSV() {
  if (!dashData.length) { toast('No data to export', true); return; }

  const headers = [
    'Date', 'Shift',
    'MC Tea Qty',     'MC Tea Total',
    'MC Plain Qty',   'MC Plain Total',  'MC Sub',
    'Biscuit Type',   'Biscuit Qty',     'Biscuit Total',
    'SAM Snack Qty',  'SAM Total',
    'Sujeewa Bfast',  'Sujeewa Total',
    'Nilu Lunch',     'Nilu Dinner',     'Nilu Total',
    'Walgama Lunch',  'Walgama Dinner',  'Walgama Total',
    'Manpower Total', 'OT Hours',        'OT Cost',
    'Daily Total'
  ];

  const rows = dashData.map(({ date, shift, suppliers = {}, mpEntry, otEntry }) => {
    const mc   = suppliers['MC Caters']      || {};
    const sam  = suppliers['SAM Bake House'] || {};
    const suj  = suppliers['Sujeewa']        || {};
    const nilu = suppliers['Nilu']           || {};
    const walg = suppliers['Walgama Hotel']  || {};

    // Recompute costs using current rate config
    const mcT  = mc.teaQty      || 0;
    const mcP  = mc.plainTeaQty || 0;
    const mcSub  = Math.round(mcT * COSTS.milkTea + mcP * COSTS.plainTea);

    const bQ = (mc.biscuitQty || 0) + (sam.biscuitQty || 0);
    const bT = Math.round(bQ * COSTS.biscuit);

    const sQ = sam.snackQty    || 0;
    const sT = Math.round(sQ  * COSTS.snack);

    const brQ = suj.breakfastQty || 0;
    const brT = Math.round(brQ   * COSTS.breakfast);

    const nL = nilu.lunchQty  || 0;
    const nD = nilu.dinnerQty || 0;
    const nT = Math.round((nL * COSTS.lunch) + (nD * COSTS.dinner));

    const wL = walg.lunchQty  || 0;
    const wD = walg.dinnerQty || 0;
    const wT = Math.round((wL * COSTS.lunch) + (wD * COSTS.dinner));

    // Manpower: only attribute the cost to DAY shift to avoid double-counting
    const mp = (shift === 'DAY' && mpEntry) ? (mpEntry.totalCost || 0) : 0;

    // OT: split by shift from the shared daily OT document
    let otH = 0, otC = 0;
    if (otEntry) {
      otH = shift === 'DAY' ? (otEntry.dayHours   || 0) : (otEntry.nightHours || 0);
      otC = shift === 'DAY' ? (otEntry.dayCost    || otCost(otH))
                             : (otEntry.nightCost || otCost(otH));
    }

    return [
      date, shift,
      mcT, Math.round(mcT * COSTS.milkTea),
      mcP, Math.round(mcP * COSTS.plainTea), mcSub,
      mc.biscuitType || '', bQ, bT,
      sQ, sT,
      brQ, brT,
      nL, nD, nT,
      wL, wD, wT,
      mp, otH, otC,
      mcSub + bT + sT + brT + nT + wT + mp + otC
    ];
  });

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `canteen_${document.getElementById('f-from').value}_to_${document.getElementById('f-to').value}.csv`;
  a.click();
  toast('CSV downloaded!');
}

// ── exportImage ──────────────────────────────────────────────
// Captures the full (non-clipped) dashboard table as a PNG
// using html2canvas at 3× scale for high resolution.
// Temporarily disables the overflow:auto clip on the scroll
// container so the entire table is rendered, then restores it.
async function exportImage() {
  const scrollDiv = document.getElementById('dashTable').parentElement;

  // Temporarily expand the container so html2canvas can see the full table
  const originalOverflow = scrollDiv.style.overflow;
  const originalWidth    = scrollDiv.style.width;
  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width    = scrollDiv.scrollWidth + 'px';

  const canvas = await html2canvas(scrollDiv, {
    scale:        3,                        // 3× for print-quality resolution
    width:        scrollDiv.scrollWidth,
    height:       scrollDiv.scrollHeight,
    windowWidth:  scrollDiv.scrollWidth,
    windowHeight: scrollDiv.scrollHeight
  });

  // Restore original styles
  scrollDiv.style.overflow = originalOverflow;
  scrollDiv.style.width    = originalWidth;

  // Trigger PNG download
  const link    = document.createElement('a');
  link.download = 'HR-Canteen-Full-Dashboard.png';
  link.href     = canvas.toDataURL('image/png');
  link.click();
}


// ════════════════════════════════════════════════════════════
//  10. DASHBOARD — CLEAR RECORDS
//  Permanently deletes all records in the selected date range
//  across all three Firestore collections:
//    • records           (canteen entries)
//    • ot_entries        (OT hours)
//    • manpower_entries  (headcount data)
//  Uses batched deletes to minimise Firestore write operations.
// ════════════════════════════════════════════════════════════

async function clearRangeRecords() {
  const from = document.getElementById('f-from').value;
  const to   = document.getElementById('f-to').value;

  if (!from || !to) { toast('Select a date range first', true); return; }

  // Require explicit confirmation — this action is irreversible
  const confirmed = confirm(
    `⚠️ This will permanently delete ALL records from ${from} to ${to}.\n\n` +
    `Includes: Canteen, OT, Manpower entries.\n\nAre you sure?`
  );
  if (!confirmed) return;

  toast('Deleting…');

  try {
    const collections = ['records', 'ot_entries', 'manpower_entries'];

    // Delete from each collection within the date range
    for (const col of collections) {
      const snap = await db.collection(col)
        .where('date', '>=', from)
        .where('date', '<=', to)
        .get();

      // Batch all deletes for this collection into a single commit
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    toast('✔ All records deleted for selected range!');

    // Clear the in-memory cache and refresh the (now empty) table
    dashData = [];
    renderTable();

  } catch (e) {
    toast('Error: ' + e.message, true);
  }
}


// ════════════════════════════════════════════════════════════
//  11. MANPOWER RATES
//  Stored in Firestore collection: manpower_rates
//  Each document represents a Company + Shift + Section
//  combination with a per-head daily rate.
//
//  These rates are referenced when building manpower entry rows
//  and when computing costs in the dashboard.
// ════════════════════════════════════════════════════════════

let mpRates = [];   // in-memory cache of all rate documents

// ── loadMpRates ──────────────────────────────────────────────
// Fetches all manpower rate documents ordered by company name,
// then rebuilds the rates table and the company dropdown in the
// Data Entry tab.
async function loadMpRates() {
  try {
    const snap = await db.collection('manpower_rates').orderBy('company').get();
    mpRates = [];
    snap.forEach(d => mpRates.push({ id: d.id, ...d.data() }));
    renderMpRatesTable();
    populateMpCompanyDropdown();
  } catch (e) {
    console.error('loadMpRates:', e);
  }
}

// ── renderMpRatesTable ───────────────────────────────────────
// Renders the rates management table in the Dashboard tab with
// a delete button on each row.
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
        <span class="${r.shift === 'DAY' ? 'badge-day' : 'badge-night'}">${r.shift}</span>
      </td>
      <td style="padding:6px 10px;text-align:center;">${r.section}</td>
      <td style="padding:6px 10px;text-align:center;color:#1a3a5c;font-weight:700;">
        Rs ${r.rate.toLocaleString()}
      </td>
      <td style="padding:6px 10px;text-align:center;">
        <button onclick="deleteMpRate('${r.id}')"
          style="background:#e74c3c;color:#fff;border:none;padding:3px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;">
          ✕ Delete
        </button>
      </td>
    </tr>`).join('');
}

// ── saveMpRate ───────────────────────────────────────────────
// Adds a new Company/Shift/Section/Rate document to Firestore,
// clears the form, and refreshes the rates list and dropdowns.
async function saveMpRate() {
  const company = document.getElementById('mp-r-company').value.trim();
  const shift   = document.getElementById('mp-r-shift').value;
  const section = document.getElementById('mp-r-section').value.trim();
  const rate    = parseFloat(document.getElementById('mp-r-rate').value) || 0;

  if (!company || !section || !rate) {
    toast('Fill company, section and rate', true);
    return;
  }

  try {
    await db.collection('manpower_rates').add({ company, shift, section, rate });

    // Clear input fields after successful save
    document.getElementById('mp-r-company').value = '';
    document.getElementById('mp-r-section').value = '';
    document.getElementById('mp-r-rate').value    = 0;

    document.getElementById('mp-rate-status').textContent = '✔ Added!';
    setTimeout(() => document.getElementById('mp-rate-status').textContent = '', 3000);

    // Reload rates to refresh table and dropdowns
    await loadMpRates();
    toast('Rate added!');
  } catch (e) {
    toast('Error: ' + e.message, true);
  }
}

// ── deleteMpRate ─────────────────────────────────────────────
// Deletes a single rate document by its Firestore document ID
// after user confirmation. Refreshes the list.
async function deleteMpRate(id) {
  if (!confirm('Delete this rate?')) return;
  try {
    await db.collection('manpower_rates').doc(id).delete();
    await loadMpRates();
    toast('Deleted!');
  } catch (e) {
    toast('Error: ' + e.message, true);
  }
}

// ── populateMpCompanyDropdown ────────────────────────────────
// Builds the Company dropdown in the Data Entry → Manpower
// section from the cached mpRates list. Uses a Set to dedupe
// company names. Also wires the onchange handler to then
// dynamically populate the Section dropdown.
function populateMpCompanyDropdown() {
  const selCompany = document.getElementById('mp-e-company');
  const selSection = document.getElementById('mp-e-section');

  if (!selCompany || !selSection) return;

  // Unique, sorted company names from the rates cache
  const companies = [...new Set(mpRates.map(r => r.company))].sort();

  selCompany.innerHTML =
    '<option value="">— select —</option>' +
    companies.map(c => `<option value="${c}">${c}</option>`).join('');

  // When company changes: reset dependent fields and reload section options
  selCompany.onchange = function () {
    const company = selCompany.value;

    // Clear dependent fields when company changes
    if (selSection) selSection.innerHTML = '<option value="">— select —</option>';

    // Populate sections available for this company
    const sections = [...new Set(
      mpRates
        .filter(r => r.company === company)
        .map(r => r.section)
    )].sort();

    selSection.innerHTML += sections
      .map(s => `<option value="${s}">${s}</option>`)
      .join('');
  };
}


// ════════════════════════════════════════════════════════════
//  12. MANPOWER ENTRY
//  Stored in Firestore collection: manpower_entries
//  Document ID: the date string (YYYY-MM-DD)
//  Each document stores an array of rows, one per
//  Company/Shift/Section combination recorded that day,
//  plus a pre-computed totalCost.
// ════════════════════════════════════════════════════════════

let mpRows = [];   // staging array for the current entry session's rows

// ── onMpCompanyOrShiftChange ─────────────────────────────────
// Triggered when the Company or Shift selector changes.
// Rebuilds the Section dropdown to show only sections that
// have a rate defined for the selected Company + Shift combo.
function onMpCompanyOrShiftChange() {
  const company = document.getElementById('mp-e-company').value;
  const shift   = document.getElementById('mp-e-shift').value;
  const secSel  = document.getElementById('mp-e-section');

  secSel.innerHTML = '<option value="">— select —</option>';
  if (!company || !shift) return;

  // Filter rates by company AND shift, then add matching sections
  mpRates
    .filter(r => r.company === company && r.shift === shift)
    .forEach(r => {
      const opt       = document.createElement('option');
      opt.value       = r.id;       // store rate document ID as the value
      opt.textContent = r.section;
      secSel.appendChild(opt);
    });
}

// ── onMpSectionChange ────────────────────────────────────────
// Triggered when the Section dropdown changes.
// Looks up the rate for the selected section and updates the
// (read-only) Rate and Cost preview fields.
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
  document.getElementById('mp-e-cost').value = heads
    ? 'Rs ' + Math.round(heads * rate.rate).toLocaleString()
    : '';
}

// ── onMpHeadsChange ──────────────────────────────────────────
// Triggered when the Heads (count) input changes.
// Recalculates and updates the cost preview field.
function onMpHeadsChange() {
  const rateId = document.getElementById('mp-e-section').value;
  const heads  = parseFloat(document.getElementById('mp-e-heads').value) || 0;
  const rate   = mpRates.find(r => r.id === rateId);
  if (!rate) return;
  document.getElementById('mp-e-cost').value =
    'Rs ' + Math.round(heads * rate.rate).toLocaleString();
}

// ── addMpEntryRow ────────────────────────────────────────────
// Validates the current form selection and adds a new row to
// the mpRows staging array, then re-renders the staging table.
// Does NOT save to Firestore yet — that happens in saveMpEntry.
function addMpEntryRow() {
  const rateId = document.getElementById('mp-e-section').value;
  const heads  = parseFloat(document.getElementById('mp-e-heads').value) || 0;
  const rate   = mpRates.find(r => r.id === rateId);

  if (!rate)  { toast('Select company, shift and section', true); return; }
  if (!heads) { toast('Enter number of heads', true); return; }

  // Push a snapshot of this row's data into the staging array
  mpRows.push({
    rateId:  rate.id,
    company: rate.company,
    shift:   rate.shift,
    section: rate.section,
    rate:    rate.rate,
    heads,
    cost:    Math.round(heads * rate.rate)
  });

  // Reset head count for the next row
  document.getElementById('mp-e-heads').value = 1;
  renderMpEntryRows();
}

// ── removeMpRow ──────────────────────────────────────────────
// Removes a staging row by its index and re-renders the table.
function removeMpRow(idx) {
  mpRows.splice(idx, 1);
  renderMpEntryRows();
}

// ── renderMpEntryRows ────────────────────────────────────────
// Renders the current mpRows staging array as an HTML table.
// Each row has a delete button. Shows a placeholder when empty.
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
      <td class="left"  style="padding:6px 8px;">${r.company}</td>
      <td style="padding:6px 8px;text-align:center;">
        <span class="${r.shift === 'DAY' ? 'badge-day' : 'badge-night'}">${r.shift}</span>
      </td>
      <td style="padding:6px 8px;text-align:center;">${r.section}</td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;">${r.heads}</td>
      <td style="padding:6px 8px;text-align:center;">
        <button onclick="removeMpRow(${i})"
          style="background:#e74c3c;color:#fff;border:none;padding:4px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;">
          ✕
        </button>
      </td>
      <td></td>
    </tr>`).join('');
}

// ── loadMpEntry ──────────────────────────────────────────────
// Fetches the manpower entry document for the selected date and
// loads its rows into the mpRows staging array.
// Called on page load and whenever the date picker changes.
async function loadMpEntry() {
  const date = document.getElementById('mp-date').value;
  if (!date) return;

  try {
    const doc = await db.collection('manpower_entries').doc(date).get();
    mpRows = doc.exists ? (doc.data().rows || []) : [];
    renderMpEntryRows();
  } catch (e) {
    console.error('loadMpEntry:', e);
  }
}

// ── saveMpEntry ──────────────────────────────────────────────
// Saves (or overwrites) the manpower entry for the selected
// date with the current mpRows staging array. Computes and
// stores totalCost as a convenience for the dashboard query.
async function saveMpEntry() {
  const date = document.getElementById('mp-date').value;

  if (!date)          { toast('Select a date', true); return; }
  if (!mpRows.length) { toast('Add at least one row first', true); return; }

  const totalCost = mpRows.reduce((s, r) => s + r.cost, 0);

  try {
    await db.collection('manpower_entries').doc(date).set({
      date,
      rows:      mpRows,
      totalCost,
      savedAt:   new Date().toISOString()
    });

    document.getElementById('mp-entry-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('mp-entry-status').textContent = '', 3000);
    toast('Manpower saved!');
  } catch (e) {
    toast('Error: ' + e.message, true);
  }
}


// ════════════════════════════════════════════════════════════
//  13. MANPOWER SUMMARY
//  Read-only summary table in the Dashboard tab.
//  Queries manpower_entries for the selected date range and
//  renders all rows grouped by date, with a grand total footer.
// ════════════════════════════════════════════════════════════

async function loadMpSummary() {
  const from  = document.getElementById('mp-from').value;
  const to    = document.getElementById('mp-to').value;
  const tbody = document.getElementById('mp-summary-body');

  if (!from || !to) { toast('Select date range', true); return; }

  tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    const snap = await db.collection('manpower_entries')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .orderBy('date')
      .get();

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No entries found.</td></tr>';
      document.getElementById('mp-summary-foot').innerHTML = '';
      return;
    }

    let html = '', grandTotal = 0;

    snap.forEach(d => {
      const entry = d.data();
      const fmtD  = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-LK', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
      });

      // Each entry can have multiple rows (one per company/shift/section)
      (entry.rows || []).forEach((r, i) => {
        grandTotal += r.cost;
        html += `
          <tr>
            <!-- Show the date only on the first row for this entry (row grouping) -->
            <td class="left" style="padding:6px 8px;white-space:nowrap;">
              ${i === 0 ? fmtD : ''}
            </td>
            <td class="left" style="padding:6px 8px;">${r.company}</td>
            <td style="padding:6px 8px;text-align:center;">
              <span class="${r.shift === 'DAY' ? 'badge-day' : 'badge-night'}">${r.shift}</span>
            </td>
            <td style="padding:6px 8px;text-align:center;">${r.section}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;">${r.heads}</td>
            <td style="padding:6px 8px;text-align:center;color:#1a3a5c;font-weight:700;">
              Rs ${r.rate.toLocaleString()}
            </td>
            <td style="padding:6px 8px;text-align:center;color:#c0392b;font-weight:800;">
              Rs ${r.cost.toLocaleString()}
            </td>
          </tr>`;
      });
    });

    tbody.innerHTML = html;

    // Grand total footer
    document.getElementById('mp-summary-foot').innerHTML = `
      <tr style="background:#1a3a5c;color:#fff;font-weight:800;font-size:.82rem;">
        <td colspan="6" style="padding:8px 12px;text-align:left;">GRAND TOTAL</td>
        <td style="padding:8px;text-align:center;">Rs ${grandTotal.toLocaleString()}</td>
      </tr>`;

  } catch (e) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-cell" style="color:red">
          Error: ${e.message}
        </td>
      </tr>`;
  }
}


// ════════════════════════════════════════════════════════════
//  14. EVENT LISTENERS
//  All DOM event bindings are grouped here for clarity.
// ════════════════════════════════════════════════════════════

// ── OT Entry ─────────────────────────────────────────────────
// Reload OT data whenever the date picker changes
document.getElementById('ot-date').addEventListener('change', loadOTEntry);

// ── Canteen Entry ─────────────────────────────────────────────
// Rebuild item dropdown when supplier changes
document.getElementById('e-supplier').addEventListener('change', renderSupplierFields);
// Show qty field and pre-fill when item changes
document.getElementById('e-itemType').addEventListener('change', renderItemFields);
// Pre-fill form when date or shift changes (in case there's an existing record)
document.getElementById('e-date').addEventListener('change',  loadEntryForm);
document.getElementById('e-shift').addEventListener('change', loadEntryForm);

// ── Manpower Entry ────────────────────────────────────────────
// Reload rows when date changes
document.getElementById('mp-date').addEventListener('change', loadMpEntry);
// Rebuild section dropdown when company or shift changes
document.getElementById('mp-e-company').addEventListener('change', onMpCompanyOrShiftChange);
document.getElementById('mp-e-shift').addEventListener('change',   onMpCompanyOrShiftChange);
// Update rate/cost preview when section is selected
document.getElementById('mp-e-section').addEventListener('change', onMpSectionChange);
// Update cost preview when head count changes
document.getElementById('mp-e-heads').addEventListener('input',    onMpHeadsChange);


// ════════════════════════════════════════════════════════════
//  15. UTILITY HELPERS
// ════════════════════════════════════════════════════════════

// ── n ────────────────────────────────────────────────────────
// Formats a number with locale commas, or returns a grey dash
// HTML span if the value is falsy (0, null, undefined).
const n = v => v ? v.toLocaleString() : '<span class="dash">–</span>';

// ── rs ───────────────────────────────────────────────────────
// Formats a number as "Rs 1,234" for currency cells.
// Returns a grey dash span if the value is falsy.
const rs = v => v ? 'Rs ' + v.toLocaleString() : '<span class="dash">–</span>';

// ── toast ─────────────────────────────────────────────────────
// Displays a temporary notification at the bottom-right of the
// screen.
//   msg  — the message string to display
//   err  — if true, uses the red error style; default is green
// The notification auto-dismisses after 3 seconds.
function toast(msg, err = false) {
  const t     = document.getElementById('toast');
  t.textContent = msg;
  t.className   = err ? 'show err' : 'show ok';
  setTimeout(() => t.className = '', 3000);
}
