// ============================================================
//  HR Canteen System — app.js
//
//  SECTIONS (in order):
//    1.  Live Clock
//    2.  Firebase Auth — Login / Logout / State Observer
//    3.  Tab Navigation (click)
//    3a. Tab Navigation — Swipe Gesture (mobile, one tab per swipe)
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
//   16.  Attendance — Master Data (Firestore: attendance_masters)
//   17.  Attendance — Daily Entry (Firestore: attendance_daily)
//   18.  OT Plan — Monthly Master (Firestore: ot_plans)
//   19.  OT Daily Entry + Plan vs Actual Dashboard (Firestore: ot_daily)
//   20.  HR Attendance Dashboard — As Per Date (read-only mirror)
//   21.  Meal System — Shift Roster (rotation engine)
//   22.  Meal System — Employee Register (Firestore: employees)
//   23.  Meal System — Meal Request (Firestore: meal_requests)
//   24.  Meal System — Daily Meal Request Log
//   25.  Meal System — Meal Issue
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
      window.location.reload();   // cleanest reset — reloads to login screen
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
    // Show app
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display  = 'block';

    // Show logged-in user email in header
    // Show only the name part before the @ symbol
      document.getElementById('user-email').textContent =
  '👤 ' + user.email.split('@')[0];

    // Update Firebase badge
    const badge = document.getElementById('db-badge');
    badge.className   = 'db-badge connected';
    badge.textContent = '🟢 Connected';

    // Load all data then auto-trigger all dashboards for today
    loadCosts().then(async () => {

      // ── Masters ──────────────────────────────────────────
      await loadMpRates();
      await loadAttMasters();
      await loadShiftRoster();
      await loadEmployees();

      // ── Daily entries (today) ────────────────────────────
      loadMpEntry();
      loadOTEntry();
      initAttDailyDate();   // sets today + loads attendance entry
      initOTPlan();         // sets current month in OT plan picker
      initOTDaily();        // sets today in OT daily picker
      initMealRequestLog();
      updateActiveSlotBanner();

      // ── Auto-load all dashboards for today ───────────────
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      const month = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;

      // Canteen dashboard — uses f-from / f-to already set by initDates()
      loadDashboard();

      // Manpower summary
      document.getElementById('mp-from').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
      document.getElementById('mp-to').value   = today;
      loadMpSummary();

      // HR Attendance dashboard
      document.getElementById('hrd-date').value = today;
      loadHRDashboard();

      // OT Plan vs Actual dashboard
      document.getElementById('otd-dash-month').value = month;
      loadOTDashboard();

      // OT daily entry — load today
      document.getElementById('otd-date').value = today;
      loadOTDaily();
    });

  } else {
    // Signed out
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContent').style.display  = 'none';
    document.getElementById('user-email').textContent    = '';
  }
});


// ════════════════════════════════════════════════════════════
//  3. TAB NAVIGATION (click)
//  Switches between top-level tabs.
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

  // Keep the newly active tab visible inside the scrollable strip
  // (covers both click and the swipe handler below, which also
  // calls .click() on a tab button to reuse this same function).
  btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}


// ════════════════════════════════════════════════════════════
//  3a. TAB NAVIGATION — SWIPE GESTURE (mobile)
//  On touch devices, swiping left/right on the tab strip moves
//  exactly ONE tab per swipe — never more, regardless of swipe
//  speed or distance. This replaces relying on momentum/snap
//  scrolling, which could overshoot multiple tabs on a fast
//  swipe. Reuses switchTab() via a real .click() on the target
//  tab button, so all existing tab-switch logic (dashboard
//  auto-load, etc.) keeps working untouched.
// ════════════════════════════════════════════════════════════

(function initTabSwipe() {
  const tabsEl = document.querySelector('.tabs');
  if (!tabsEl) return;

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const SWIPE_THRESHOLD_PX = 35;   // minimum horizontal distance to count as a swipe

  tabsEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  tabsEl.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;

    const endX  = e.changedTouches[0].clientX;
    const endY  = e.changedTouches[0].clientY;
    const diffX = startX - endX;
    const diffY = startY - endY;

    // Ignore mostly-vertical gestures — that's the user scrolling
    // the page, not trying to switch tabs.
    if (Math.abs(diffY) > Math.abs(diffX)) return;
    if (Math.abs(diffX) < SWIPE_THRESHOLD_PX) return;

    const tabs        = Array.from(tabsEl.querySelectorAll('.tab'));
    const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
    if (activeIndex === -1) return;

    let targetIndex = activeIndex;
    if (diffX > 0 && activeIndex < tabs.length - 1) {
      targetIndex = activeIndex + 1;   // swiped left  → next tab
    } else if (diffX < 0 && activeIndex > 0) {
      targetIndex = activeIndex - 1;   // swiped right → previous tab
    }

    if (targetIndex !== activeIndex) {
      tabs[targetIndex].click();   // fires the existing onclick="switchTab(...)"
    } else {
      // No tab change (already at an edge) — still re-center
      // in case the strip drifted slightly during the touch.
      tabs[targetIndex].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, { passive: true });
})();


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

    document.getElementById('dash-date-label').textContent =
  `Period: ${from}  to  ${to}  |  Shift: ${shift}`;

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
  const table     = document.getElementById('dashTable');

  const origOv = scrollDiv.style.overflow;
  const origW  = scrollDiv.style.width;
  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width    = table.scrollWidth + 'px';

  await new Promise(r => setTimeout(r, 80));

  const canvas = await html2canvas(scrollDiv, {
    scale:      3,
    useCORS:    true,
    allowTaint: true,
    scrollX:    0,
    scrollY:    -window.scrollY
  });

  scrollDiv.style.overflow = origOv;
  scrollDiv.style.width    = origW;

  const link    = document.createElement('a');
  link.download = `Canteen_Dashboard_${document.getElementById('f-from').value}_to_${document.getElementById('f-to').value}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
  toast('Captured!');
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


// ════════════════════════════════════════════════════════════
//  16. ATTENDANCE — MASTER DATA
//  Firestore collection : attendance_masters
//  Document ID          : "{dept}_{shift}"
//
//  Two manually entered values per row:
//    revised → Total Required Carder (Revised)
//    onRoll  → Current On Roll
// ════════════════════════════════════════════════════════════

const ATT_DEPTS = [
  { dept: 'Stores',          shift: 'General'  },
  { dept: 'Stores',          shift: 'Shift A'  },
  { dept: 'Stores',          shift: 'Shift B'  },
  { dept: 'Quality',         shift: 'General'  },
  { dept: 'Quality',         shift: 'Shift A'  },
  { dept: 'Quality',         shift: 'Shift B'  },
  { dept: 'Quality',         shift: 'Orit'     },
  { dept: 'Special Section', shift: 'General'  },
  { dept: 'Washing',         shift: 'General'  },
  { dept: 'Washing',         shift: 'Shift A'  },
  { dept: 'Washing',         shift: 'Shift B'  },
  { dept: 'Sub Chemical',    shift: 'General'  },
  { dept: 'Sub Chemical',    shift: 'Shift A'  },
  { dept: 'Sub Chemical',    shift: 'Shift B'  },
  { dept: 'Sample',          shift: 'General'  },
  { dept: 'Sample',          shift: 'Shift A'  },
  { dept: 'Sample',          shift: 'Shift B'  },
  { dept: 'Maintenance',     shift: 'General'  },
  { dept: 'Maintenance',     shift: 'Shift A'  },
  { dept: 'Maintenance',     shift: 'Shift B'  },
  { dept: 'R & D',           shift: 'General'  },
  { dept: 'ERP',             shift: 'Shift A'  },
  { dept: 'ERP',             shift: 'Shift B'  },
  { dept: 'Marketing',       shift: 'General'  },
  { dept: 'HR',              shift: 'General'  },
  { dept: 'Staff',           shift: 'General'  },   // ← added
];

let attMasters    = {};
let attMasterEditId = null;

// ── loadAttMasters ───────────────────────────────────────────
async function loadAttMasters() {
  try {
    const snap = await db.collection('attendance_masters').get();
    attMasters = {};
    snap.forEach(d => { attMasters[d.id] = { id: d.id, ...d.data() }; });

    // Seed missing rows with zeros
    const batch = db.batch();
    let needsWrite = false;
    ATT_DEPTS.forEach(({ dept, shift }) => {
      const key = `${dept}_${shift}`;
      if (!attMasters[key]) {
        const ref = db.collection('attendance_masters').doc(key);
        batch.set(ref, { dept, shift, revised: 0, onRoll: 0 });
        attMasters[key] = { id: key, dept, shift, revised: 0, onRoll: 0 };
        needsWrite = true;
      }
    });
    if (needsWrite) await batch.commit();

    renderAttMasterTable();
  } catch (e) {
    console.error('loadAttMasters:', e);
    toast('Error loading attendance masters: ' + e.message, true);
  }
}

// ── renderAttMasterTable ─────────────────────────────────────
function renderAttMasterTable() {
  const tbody    = document.getElementById('att-master-body');
  let   html     = '';
  let   lastDept = null;

  ATT_DEPTS.forEach(({ dept, shift }) => {
    const key = `${dept}_${shift}`;
    const r   = attMasters[key] || { revised: 0, onRoll: 0 };

    const deptCell = dept !== lastDept
      ? `<td class="left" style="padding:6px 10px;font-weight:700;">${dept}</td>`
      : `<td class="left" style="padding:6px 10px;color:#ccc;">↳</td>`;
    lastDept = dept;

    const badge = shift === 'General'
      ? `<span class="badge-day">${shift}</span>`
      : `<span class="badge-night">${shift}</span>`;

    html += `<tr>
      ${deptCell}
      <td style="padding:6px 10px;text-align:center;">${badge}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:700;color:#1a3a5c;">
        ${r.revised || '—'}
      </td>
      <td style="padding:6px 10px;text-align:center;font-weight:700;">
        ${r.onRoll || '—'}
      </td>
      <td style="padding:6px 10px;text-align:center;">
        <button onclick="openAttEdit('${key}')"
          style="background:#e8f0f8;color:#1a3a5c;border:none;padding:4px 12px;
          border-radius:4px;cursor:pointer;font-size:.75rem;font-weight:600;">
          ✎ Edit
        </button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;
}

// ── openAttEdit ──────────────────────────────────────────────
function openAttEdit(key) {
  const r = attMasters[key];
  if (!r) return;
  attMasterEditId = key;
  document.getElementById('att-edit-label').textContent   = `${r.dept} — ${r.shift}`;
  document.getElementById('att-e-revised').value          = r.revised || 0;
  document.getElementById('att-e-onroll').value           = r.onRoll  || 0;
  document.getElementById('att-m-status').textContent     = '';
  document.getElementById('att-edit-panel').style.display = '';
  document.getElementById('att-edit-panel')
    .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── closeAttEdit ─────────────────────────────────────────────
function closeAttEdit() {
  attMasterEditId = null;
  document.getElementById('att-edit-panel').style.display = 'none';
}

// ── saveAttMaster ────────────────────────────────────────────
async function saveAttMaster() {
  if (!attMasterEditId) return;
  const revised = parseFloat(document.getElementById('att-e-revised').value) || 0;
  const onRoll  = parseFloat(document.getElementById('att-e-onroll').value)  || 0;
  try {
    await db.collection('attendance_masters')
      .doc(attMasterEditId)
      .update({ revised, onRoll, savedAt: new Date().toISOString() });

    attMasters[attMasterEditId].revised = revised;
    attMasters[attMasterEditId].onRoll  = onRoll;

    renderAttMasterTable();
    closeAttEdit();
    toast('Carder updated!');
    document.getElementById('att-m-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('att-m-status').textContent = '', 3000);
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}


// ════════════════════════════════════════════════════════════
//  17. ATTENDANCE — DAILY ENTRY
//  Firestore collection : attendance_daily
//  Document ID          : "{date}"
//
//  Entered  : present, informed, uninformed, dayoff,
//             longabsent, turnover, recruitment
//  From master : revised, onRoll (both per dept+shift)
//  Calculated:
//    totalAbsent  = informed + uninformed
//    excess       = onRoll − revised          (+ = excess, − = shortage)
//    absPct       = totalAbsent / onRoll      (dept level, not shift level)
//    turnoverPct  = turnover / onRoll
// ════════════════════════════════════════════════════════════

let attDailyRows = {};   // keyed by "{dept}_{shift}"

// ── initAttDailyDate ─────────────────────────────────────────
function initAttDailyDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('att-date').value =
    `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  loadAttDaily();
}

// ── loadAttDaily ─────────────────────────────────────────────
async function loadAttDaily() {
  const date = document.getElementById('att-date').value;
  if (!date) return;

  const tbody = document.getElementById('att-entry-body');
  tbody.innerHTML = '<tr><td colspan="13" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    const doc   = await db.collection('attendance_daily').doc(date).get();
    const saved = doc.exists ? (doc.data().rows || []) : [];

    const savedMap = {};
    saved.forEach(r => { savedMap[`${r.dept}_${r.shift}`] = r; });

    attDailyRows = {};
    ATT_DEPTS.forEach(({ dept, shift }) => {
      const key = `${dept}_${shift}`;
      const s   = savedMap[key] || {};
      attDailyRows[key] = {
        dept, shift,
        present:     s.present     || 0,
        informed:    s.informed    || 0,
        uninformed:  s.uninformed  || 0,
        dayoff:      s.dayoff      || 0,
        longabsent:  s.longabsent  || 0,
        turnover:    s.turnover    || 0,
        recruitment: s.recruitment || 0,
      };
    });

    renderAttEntryTable();
  } catch (e) {
    console.error('loadAttDaily:', e);
    toast('Error loading attendance: ' + e.message, true);
  }
}

// ── renderAttEntryTable ──────────────────────────────────────
// Absenteeism % — calculated per dept (sum all shifts), shown
// as a rowspan cell spanning all shift rows of that dept,
// centred — mimicking a merged cell like in Excel.
function renderAttEntryTable() {
  const tbody    = document.getElementById('att-entry-body');
  const tfoot    = document.getElementById('att-entry-foot');
  let   lastDept = null;

  // ── Step 1: Per-dept absenteeism % (avg of shift %s) ──────
  const deptMeta = {};
  ATT_DEPTS.forEach(({ dept, shift }) => {
    const key         = `${dept}_${shift}`;
    const r           = attDailyRows[key] || {};
    const master      = attMasters[key]   || { onRoll: 0 };
    const onRoll      = master.onRoll || 0;
    const totalAbsent = (r.informed || 0) + (r.uninformed || 0);
    const shiftAbsPct = onRoll > 0 ? (totalAbsent / onRoll) * 100 : 0;

    if (!deptMeta[dept]) deptMeta[dept] = { rowspan: 0, shiftPctSum: 0 };
    deptMeta[dept].rowspan++;
    deptMeta[dept].shiftPctSum += shiftAbsPct;
  });
  Object.keys(deptMeta).forEach(dept => {
    const m  = deptMeta[dept];
    m.absPct = m.rowspan > 0
      ? (m.shiftPctSum / m.rowspan).toFixed(2) + '%'
      : '—';
  });

  // ── Step 2: Track which depts have already rendered their
  //           absenteeism cell so we skip it on subsequent rows
  const deptAbsRendered = {};

  // ── Step 3: Grand total accumulators ──────────────────────
  let GT = {
    revised:0, onRoll:0, present:0, informed:0, uninformed:0,
    totalAbsent:0, dayoff:0, longabsent:0, turnover:0,
    recruitment:0, excess:0
  };

  // ── Step 4: Build rows ─────────────────────────────────────
  let rows = [];

  ATT_DEPTS.forEach(({ dept, shift }) => {
    const key    = `${dept}_${shift}`;
    const r      = attDailyRows[key] || {};
    const master = attMasters[key]   || { revised: 0, onRoll: 0 };
    const meta   = deptMeta[dept];

    const revised     = master.revised || 0;
    const onRoll      = master.onRoll  || 0;
    const totalAbsent = (r.informed || 0) + (r.uninformed || 0);
    const excess      = onRoll - revised;
    const tvPct       = onRoll > 0
      ? ((r.turnover || 0) / onRoll * 100).toFixed(1) + '%'
      : '—';

    // Accumulate grand totals
    GT.revised     += revised;
    GT.onRoll      += onRoll;
    GT.present     += r.present     || 0;
    GT.informed    += r.informed    || 0;
    GT.uninformed  += r.uninformed  || 0;
    GT.totalAbsent += totalAbsent;
    GT.dayoff      += r.dayoff      || 0;
    GT.longabsent  += r.longabsent  || 0;
    GT.turnover    += r.turnover    || 0;
    GT.recruitment += r.recruitment || 0;
    GT.excess      += excess;

    const isFirstRow = dept !== lastDept;
    lastDept = dept;

    // Dept name cell — first row only
    const deptCell = isFirstRow
      ? `<td class="left" style="padding:6px 8px;font-weight:700;white-space:nowrap;
           vertical-align:middle;" rowspan="${meta.rowspan}">${dept}</td>`
      : '';

    // Shift badge
    const badge = shift === 'General'
      ? `<span class="badge-day">${shift}</span>`
      : `<span class="badge-night">${shift}</span>`;

    // Excess display
    const exStyle   = excess >= 0
      ? 'color:#1e8449;font-weight:700;'
      : 'color:#c0392b;font-weight:700;';
    const exDisplay = excess > 0
      ? `+${excess}`
      : excess < 0 ? `(${Math.abs(excess)})` : '—';

    // Absenteeism % — rowspan cell on first row only, blank on others
    const absPctCell = !deptAbsRendered[dept]
      ? `<td style="padding:6px 8px;text-align:center;font-weight:700;
              vertical-align:middle;border-left:2px solid #d9e5f2;
              background:#f5f8fd;"
            rowspan="${meta.rowspan}">
            ${meta.absPct}
          </td>`
      : '';
    deptAbsRendered[dept] = true;

    // Inline input helper
    const inp = (field, val) =>
      `<input type="number" min="0" value="${val}"
        style="width:52px;padding:4px 5px;border:1px solid #d0d8e4;border-radius:4px;
               font-size:.82rem;text-align:center;background:#f8fafc;"
        oninput="attInput('${key}','${field}',this.value)"/>`;

    rows.push(`<tr>
      ${deptCell}
      <td style="padding:5px 8px;text-align:center;">${badge}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:700;color:#1a3a5c;">${revised || '—'}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:700;">${onRoll || '—'}</td>
      <td style="padding:4px 5px;">${inp('present',     r.present     || 0)}</td>
      <td style="padding:4px 5px;">${inp('informed',    r.informed    || 0)}</td>
      <td style="padding:4px 5px;">${inp('uninformed',  r.uninformed  || 0)}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:700;">${totalAbsent || '—'}</td>
      <td style="padding:4px 5px;">${inp('dayoff',      r.dayoff      || 0)}</td>
      <td style="padding:4px 5px;">${inp('longabsent',  r.longabsent  || 0)}</td>
      <td style="padding:4px 5px;">${inp('turnover',    r.turnover    || 0)}</td>
      <td style="padding:4px 5px;">${inp('recruitment', r.recruitment || 0)}</td>
      <td style="padding:5px 8px;text-align:center;${exStyle}">${exDisplay}</td>
      ${absPctCell}
      <td style="padding:5px 8px;text-align:center;">${tvPct}</td>
    </tr>`);
  });

  tbody.innerHTML = rows.join('');

  // ── Grand total footer ─────────────────────────────────────
  const gtAbsPct = GT.onRoll > 0
    ? ((GT.totalAbsent / GT.onRoll) * 100).toFixed(2) + '%' : '—';
  const gtTvPct  = GT.onRoll > 0
    ? ((GT.turnover    / GT.onRoll) * 100).toFixed(2) + '%' : '—';
  const gtEx     = GT.excess > 0
    ? `+${GT.excess}` : GT.excess < 0 ? `(${Math.abs(GT.excess)})` : '—';

  tfoot.innerHTML = `<tr class="grand-row">
    <td colspan="2" class="left" style="padding-left:10px;">TOTAL</td>
    <td style="padding:7px 8px;text-align:center;">${GT.revised}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.onRoll}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.present}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.informed}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.uninformed}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.totalAbsent}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.dayoff}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.longabsent}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.turnover}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.recruitment}</td>
    <td style="padding:7px 8px;text-align:center;">${gtEx}</td>
    <td style="padding:7px 8px;text-align:center;border-left:2px solid rgba(255,255,255,.3);">${gtAbsPct}</td>
    <td style="padding:7px 8px;text-align:center;">${gtTvPct}</td>
  </tr>`;
}


// ── attInput ─────────────────────────────────────────────────
// Updates in-memory value and re-renders so calculated
// columns and dept absenteeism % refresh live.
function attInput(key, field, value) {
  if (!attDailyRows[key]) return;
  attDailyRows[key][field] = parseFloat(value) || 0;
  renderAttEntryTable();
}

// ── saveAttDaily ─────────────────────────────────────────────
async function saveAttDaily() {
  const date = document.getElementById('att-date').value;
  if (!date) { toast('Select a date first', true); return; }

  const rows = ATT_DEPTS.map(({ dept, shift }) => {
    const key    = `${dept}_${shift}`;
    const r      = attDailyRows[key] || {};
    const master = attMasters[key]   || { revised: 0, onRoll: 0 };

    const present     = r.present     || 0;
    const informed    = r.informed    || 0;
    const uninformed  = r.uninformed  || 0;
    const dayoff      = r.dayoff      || 0;
    const longabsent  = r.longabsent  || 0;
    const turnover    = r.turnover    || 0;
    const recruitment = r.recruitment || 0;
    const revised     = master.revised || 0;
    const onRoll      = master.onRoll  || 0;

    const totalAbsent  = informed + uninformed;
    const excess       = onRoll - revised;
    const turnoverPct  = onRoll > 0 ? turnover / onRoll : 0;

    return {
      dept, shift, revised, onRoll,
      present, informed, uninformed, dayoff,
      longabsent, turnover, recruitment,
      totalAbsent, excess, turnoverPct
    };
  });

  // Document-level totals for quick dashboard reads
  const totals = rows.reduce((acc, r) => {
    acc.revised     += r.revised;
    acc.onRoll      += r.onRoll;
    acc.present     += r.present;
    acc.totalAbsent += r.totalAbsent;
    acc.turnover    += r.turnover;
    acc.recruitment += r.recruitment;
    acc.longabsent  += r.longabsent;
    return acc;
  }, { revised:0, onRoll:0, present:0, totalAbsent:0, turnover:0, recruitment:0, longabsent:0 });

  try {
    await db.collection('attendance_daily').doc(date).set({
      date, rows, totals,
      savedAt: new Date().toISOString()
    });
    document.getElementById('att-daily-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('att-daily-status').textContent = '', 3000);
    toast('Attendance saved!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── exportAttImage ───────────────────────────────────────────
// Captures the full attendance entry table as a high-res PNG
// using html2canvas (same library already loaded for the
// canteen dashboard export). Temporarily removes the overflow
// clip so the entire wide table is rendered, then restores it.
async function exportAttImage() {
  const date      = document.getElementById('att-date').value || 'attendance';
  const scrollDiv = document.getElementById('att-entry-table').parentElement;

  // Expand container so html2canvas sees the full table width
  const origOverflow = scrollDiv.style.overflow;
  const origWidth    = scrollDiv.style.width;
  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width    = scrollDiv.scrollWidth + 'px';

  const canvas = await html2canvas(scrollDiv, {
    scale:        3,                        // 3× for print-quality resolution
    width:        scrollDiv.scrollWidth,
    height:       scrollDiv.scrollHeight,
    windowWidth:  scrollDiv.scrollWidth,
    windowHeight: scrollDiv.scrollHeight,
    backgroundColor: '#ffffff'             // force white background
  });

  // Restore original styles
  scrollDiv.style.overflow = origOverflow;
  scrollDiv.style.width    = origWidth;

  // Trigger PNG download
  const link    = document.createElement('a');
  link.download = `Attendance_${date}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();

  toast('Attendance captured!');
}
// ── Wire date change ─────────────────────────────────────────
document.getElementById('att-date').addEventListener('change', loadAttDaily);


// ════════════════════════════════════════════════════════════
//  18. OT PLAN — MONTHLY MASTER
//  Firestore collection : ot_plans
//  Document ID          : "YYYY-MM"  e.g. "2026-05"
//
//  Structure per document:
//    month   : "2026-05"
//    depts   : [ { dept, heads, weekdayHrs, saturdayHrs,
//                  overrides: { "2026-05-10": hrs, ... } } ]
//    holidays: [ "2026-05-01", ... ]  ← all-dept zero days
//
//  Calculated on render (not stored):
//    monthlyTotal  = sum of all day columns
//    otToDate      = sum from day 1 → today
//    hrsPerHead    = monthlyTotal / heads
//    each day cell = weekdayHrs | saturdayHrs | 0 (Sun/holiday)
//                    overridden if dept has an override for that date
// ════════════════════════════════════════════════════════════

// Fixed dept list — same across all modules
const OT_DEPTS = [
  'Stores', 'Quality', 'Special Section', 'Washing',
  'Sub Chemical', 'Sample', 'Maintenance', 'R & D',
  'ERP', 'Marketing', 'HR'
];

// In-memory plan for the currently loaded month
let otPlan = null;   // full document data
let otPlanMonth = '';  // "YYYY-MM"

// ── initOTPlan ───────────────────────────────────────────────
// Sets the month picker to current month on page load.
function initOTPlan() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('otp-month').value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// ── loadOTPlan ───────────────────────────────────────────────
// Loads existing plan for selected month, or creates a blank
// new plan if none exists. Then renders the full grid.
async function loadOTPlan() {
  const month = document.getElementById('otp-month').value;
  if (!month) { toast('Select a month', true); return; }

  otPlanMonth = month;

  try {
    const doc = await db.collection('ot_plans').doc(month).get();

    if (doc.exists) {
      // Load existing plan
      otPlan = doc.data();
    } else {
      // Build blank plan for this month
      otPlan = {
        month,
        holidays: [],
        depts: OT_DEPTS.map(dept => ({
          dept,
          heads:       0,
          weekdayHrs:  0,
          saturdayHrs: 0,
          overrides:   {}   // { "YYYY-MM-DD": hrs }
        }))
      };
    }

    document.getElementById('otp-setup').style.display = '';
    renderOTPlan();
  } catch (e) {
    toast('Error loading OT plan: ' + e.message, true);
  }
}

// ── getDaysInMonth ───────────────────────────────────────────
// Returns array of Date objects for every day in "YYYY-MM".
function getDaysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const days   = [];
  const total  = new Date(y, m, 0).getDate();   // last day of month
  for (let d = 1; d <= total; d++) {
    days.push(new Date(y, m - 1, d));
  }
  return days;
}

// ── dayType ──────────────────────────────────────────────────
// Returns "sun" | "sat" | "weekday" for a given Date.
function dayType(date) {
  const dow = date.getDay();   // 0=Sun, 6=Sat
  if (dow === 0) return 'sun';
  if (dow === 6) return 'sat';
  return 'weekday';
}

// ── dateKey ──────────────────────────────────────────────────
// Returns "YYYY-MM-DD" string for a Date object.
function dateKey(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

// ── getShiftDate ──────────────────────────────────────────────
// Returns the correct "shift date" for reporting purposes.
//
// RULE: Night shift runs 7pm → 7am, crossing midnight into the
// next calendar day. Everything that happens during that whole
// shift — including early-morning teas at 12am-1am and 4am-5am —
// must be reported under the date the shift STARTED, not the
// calendar date it physically occurred on.
//
// For Day and General shifts, shiftDate always equals the
// normal calendar date (no adjustment needed).
//
// Logic: if it's currently between midnight (00:00) and 7:00am,
// and the employee resolves to Night shift, roll the date back
// by one day. Otherwise, use today's date as-is.
function getShiftDate(empOrShiftCode, now) {
  const hour = now.getHours();

  // Resolve the employee's actual shift for "now" first using
  // today's calendar date (shift assignment doesn't change due
  // to the early-morning rollback — only the REPORTING date does)
  const shiftCode = typeof empOrShiftCode === 'string'
    ? empOrShiftCode
    : empOrShiftCode.shiftCode;

  const actualShift = resolveActualShift(shiftCode, now);

  if (actualShift === 'Night' && hour < 7) {
    // Early morning hours of a Night shift — roll back to
    // the date the shift actually started (yesterday)
    const shiftStartDate = new Date(now);
    shiftStartDate.setDate(now.getDate() - 1);
    return dateKey(shiftStartDate);
  }

  // Day, General, or Night shift after 7am — use today as-is
  return dateKey(now);
}

// ── getDeptOTHours ───────────────────────────────────────────
// Returns the planned OT hours for a dept on a specific date.
// Priority: override > holiday (0) > sat hrs > weekday hrs > sun (0)
function getDeptOTHours(deptObj, date, holidays) {
  const key  = dateKey(date);
  const type = dayType(date);

  // Sunday — always 0
  if (type === 'sun') return 0;

  // Dept-level override takes highest priority
  if (deptObj.overrides && deptObj.overrides[key] !== undefined) {
    return deptObj.overrides[key];
  }

  // All-dept holiday — 0
  if (holidays.includes(key)) return 0;

  // Saturday or weekday
  if (type === 'sat') return deptObj.saturdayHrs || 0;
  return deptObj.weekdayHrs || 0;
}

// ── renderOTPlan ─────────────────────────────────────────────
// Renders the full month OT plan as an editable grid.
// Columns: Dept | Heads | Weekday Hrs | Sat Hrs |
//          Monthly Total | OT to Date | Hrs/Head |
//          [day 1] [day 2] ... [day N]
function renderOTPlan() {
  if (!otPlan) return;

  const days     = getDaysInMonth(otPlanMonth);
  const today    = new Date();
  const todayKey = dateKey(today);
  const holidays = otPlan.holidays || [];

  // ── Build header ─────────────────────────────────────────
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const months   = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];

  let thDates = '';
  let thDays  = '';
  days.forEach(d => {
    const type   = dayType(d);
    const key    = dateKey(d);
    const isHol  = holidays.includes(key);
    const isPast = d <= today;

    // Column colour: Sunday=grey, Saturday=blue tint,
    // holiday=amber, past weekday=white, future=light
    const bg = type === 'sun'   ? '#f0f0f0'
             : isHol            ? '#fff8e1'
             : type === 'sat'   ? '#e8f0f8'
             : isPast           ? '#fff'
             :                    '#f9fbfd';

 thDates += `<th style="padding:5px 6px;min-width:48px;background:${bg};
              font-size:.72rem;text-align:center;">
              ${d.getDate()}
              <br/>
              <button onclick="clearOTPDay('${key}')"
                style="background:none;border:none;cursor:pointer;
                       font-size:.65rem;color:#c0392b;padding:0;
                       line-height:1.4;display:block;width:100%;
                       text-align:center;">✕</button>
            </th>`;
  thDays += `<th style="padding:4px 6px;min-width:48px;background:${bg};
              font-size:.68rem;text-align:center;color:#888;">
              ${dayNames[d.getDay()]}
            </th>`;
  });

  document.getElementById('otp-thead').innerHTML = `
    <tr class="th-group">
      <th rowspan="2" class="left" style="min-width:130px;padding:7px 10px;">Department</th>
      <th rowspan="2" style="min-width:60px;padding:7px 8px;">Heads</th>
      <th rowspan="2" style="min-width:70px;padding:7px 8px;">Weekday OT Hrs</th>
      <th rowspan="2" style="min-width:70px;padding:7px 8px;">Saturday OT Hrs</th>
      <th rowspan="2" style="min-width:80px;padding:7px 8px;background:#1a3a5c;color:#fff;">
        Monthly Total OT Hrs
      </th>
      <th rowspan="2" style="min-width:75px;padding:7px 8px;background:#155a35;color:#fff;">
        OT to Date
      </th>
      <th rowspan="2" style="min-width:65px;padding:7px 8px;">Hrs / Head</th>
      ${thDates}
    </tr>
    <tr class="th-rate">${thDays}</tr>`;

  // ── Build body rows ───────────────────────────────────────
  let html = '';
  let GT   = {
    heads: 0, monthlyTotal: 0, toDate: 0,
    dayTotals: new Array(days.length).fill(0)
  };

  otPlan.depts.forEach((deptObj, di) => {
    // Calculate each day's hours
    const dayHours = days.map(d => getDeptOTHours(deptObj, d, holidays));

    // Monthly total = sum all days
    const monthlyTotal = dayHours.reduce((s, h) => s + h, 0);

    // OT to date = sum days where date <= today
    const toDate = days.reduce((s, d, i) =>
      d <= today ? s + dayHours[i] : s, 0);

    const hrsPerHead = deptObj.heads > 0
      ? (monthlyTotal / deptObj.heads).toFixed(1)
      : '—';

    // Accumulate grand totals
    GT.heads        += deptObj.heads || 0;
    GT.monthlyTotal += monthlyTotal;
    GT.toDate       += toDate;
    dayHours.forEach((h, i) => GT.dayTotals[i] += h);

    // Day cells — editable only for non-Sunday cells
    let dayCells = '';
    days.forEach((d, i) => {
      const type  = dayType(d);
      const key   = dateKey(d);
      const isHol = holidays.includes(key);
      const hrs   = dayHours[i];

      const bg = type === 'sun'   ? '#f0f0f0'
               : isHol            ? '#fff8e1'
               : type === 'sat'   ? '#e8f0f8'
               : '#fff';

      if (type === 'sun') {
        // Sunday — always blank, not editable
      dayCells += `<td style="background:#f0f0f0;text-align:center;
               padding:4px 3px;color:#ccc;min-width:48px;">—</td>`;
      } else {
        // Editable cell — shows hours, HR can override per dept per date
      dayCells += `<td style="background:${bg};padding:3px 4px;
               text-align:center;min-width:48px;">
  <input type="number" min="0" value="${hrs}"
    style="width:55px;padding:4px 3px;border:1px solid #d0d8e4;
           border-radius:3px;font-size:.78rem;text-align:center;
           background:transparent;"
    oninput="otpCellEdit(${di},'${key}',this.value)"
    onkeydown="otpHandleTab(event,${di},'${key}','cell')"
     onblur="renderOTPlan()"/>
</td>`;
      }
    });

    html += `<tr>
      <td class="left" style="padding:6px 8px;font-weight:700;white-space:nowrap;">
        ${deptObj.dept}
      </td>
      <!-- Heads — editable -->
      <td style="padding:3px 5px;text-align:center;">
        <input type="number" min="0" value="${deptObj.heads || 0}"
          style="width:44px;padding:4px 5px;border:1px solid #d0d8e4;
                border-radius:4px;font-size:.82rem;text-align:center;"
          onchange="otpHeadEdit(${di},this.value)"
          onkeydown="otpHandleTab(event,${di},'',  'heads')"
          onblur="renderOTPlan()"/>
      </td>
      <!-- Weekday hours — editable, auto-fills all weekday cells -->
      <td style="padding:3px 5px;text-align:center;">
        <input type="number" min="0" value="${deptObj.weekdayHrs || 0}"
          style="width:58px;padding:4px 5px;border:1px solid #d0d8e4;
                 border-radius:4px;font-size:.82rem;text-align:center;"
          oninput="otpWeekdayEdit(${di},this.value)"
          onkeydown="otpHandleTab(event,${di},'',  'weekday')"
            onblur="renderOTPlan()"/>
      </td>
      <!-- Saturday hours — editable, auto-fills all Saturday cells -->
      <td style="padding:3px 5px;text-align:center;">
        <input type="number" min="0" value="${deptObj.saturdayHrs || 0}"
          style="width:58px;padding:4px 5px;border:1px solid #d0d8e4;
                 border-radius:4px;font-size:.82rem;text-align:center;"
          oninput="otpSatEdit(${di},this.value)"
          onkeydown="otpHandleTab(event,${di},'',  'sat')"
            onblur="renderOTPlan()"/>
      </td>
      <!-- Monthly total — calculated, read-only -->
      <td style="padding:6px 8px;text-align:center;font-weight:700;
                 color:#1a3a5c;background:#eef3f9;">
        ${monthlyTotal.toLocaleString()}
      </td>
      <!-- OT to date — calculated, read-only -->
      <td style="padding:6px 8px;text-align:center;font-weight:700;
                 color:#1e8449;background:#f0faf0;">
        ${toDate.toLocaleString()}
      </td>
      <!-- Hrs per head — calculated, read-only -->
      <td style="padding:6px 8px;text-align:center;">${hrsPerHead}</td>
      ${dayCells}
    </tr>`;
  });

  document.getElementById('otp-tbody').innerHTML = html;

  // ── Grand total footer ────────────────────────────────────
  const gtHrsPerHead = GT.heads > 0
    ? (GT.monthlyTotal / GT.heads).toFixed(1) : '—';

  let gtDayCells = '';
  days.forEach((d, i) => {
    const type = dayType(d);
    const bg   = type === 'sun' ? '#555' : type === 'sat' ? '#243f5c' : '';
    gtDayCells += `<td style="padding:6px 5px;text-align:center;
  min-width:48px;${bg ? 'background:'+bg+';' : ''}">
  ${GT.dayTotals[i] > 0 ? GT.dayTotals[i].toLocaleString() : '—'}
</td>`;
  });

  document.getElementById('otp-tfoot').innerHTML = `
    <tr class="grand-row">
      <td class="left" style="padding-left:10px;">GRAND TOTAL</td>
      <td style="padding:7px 8px;text-align:center;">${GT.heads}</td>
      <td colspan="2" style="padding:7px 8px;text-align:center;">—</td>
      <td style="padding:7px 8px;text-align:center;">${GT.monthlyTotal.toLocaleString()}</td>
      <td style="padding:7px 8px;text-align:center;">${GT.toDate.toLocaleString()}</td>
      <td style="padding:7px 8px;text-align:center;">${gtHrsPerHead}</td>
      ${gtDayCells}
    </tr>`;
}

// ── otpHeadEdit ───────────────────────────────────────────────
// Updates heads count for a dept and re-renders.
function otpHeadEdit(di, value) {
  otPlan.depts[di].heads = parseFloat(value) || 0;
  //renderOTPlan();
}

// ── otpWeekdayEdit ────────────────────────────────────────────
// Updates weekday hours for a dept, clears all weekday
// overrides so the new value applies, then re-renders.
function otpWeekdayEdit(di, value) {
  const hrs     = parseFloat(value) || 0;
  const deptObj = otPlan.depts[di];
  deptObj.weekdayHrs = hrs;

  // Clear weekday overrides so the new global value takes effect
  const days = getDaysInMonth(otPlanMonth);
  days.forEach(d => {
    if (dayType(d) === 'weekday') {
      const key = dateKey(d);
      delete deptObj.overrides[key];
    }
  });
  //renderOTPlan();
}
// ── otpHandleTab ─────────────────────────────────────────────
// Intercepts Tab key on OT plan inputs to manually move focus
// to the next input in the table, then triggers a re-render
// of the current cell before leaving it.
function otpHandleTab(e, di, key, type) {
  if (e.key !== 'Tab') return;
  e.preventDefault();   // stop browser default tab behaviour

  // Save current cell value first
  const val = parseFloat(e.target.value) || 0;
  if      (type === 'heads')   otpHeadEdit(di, val);
  else if (type === 'weekday') otpWeekdayEdit(di, val);
  else if (type === 'sat')     otpSatEdit(di, val);
  else if (type === 'cell')    otpCellEdit(di, key, val);

  // Find all OT plan inputs in DOM order and move to next one
  const allInputs = Array.from(
    document.getElementById('otp-table').querySelectorAll('input[type="number"]')
  );
  const currentIdx = allInputs.indexOf(e.target);
  const nextIdx    = e.shiftKey
    ? currentIdx - 1   // Shift+Tab goes backwards
    : currentIdx + 1;

  if (nextIdx >= 0 && nextIdx < allInputs.length) {
    allInputs[nextIdx].focus();
    allInputs[nextIdx].select();   // select text so typing replaces it cleanly
  } else {
    // Reached last/first input — re-render to update calculated columns
    renderOTPlan();
  }
}
// ── otpSatEdit ────────────────────────────────────────────────
// Updates Saturday hours for a dept, clears Saturday overrides.
function otpSatEdit(di, value) {
  const hrs     = parseFloat(value) || 0;
  const deptObj = otPlan.depts[di];
  deptObj.saturdayHrs = hrs;

  // Clear Saturday overrides
  const days = getDaysInMonth(otPlanMonth);
  days.forEach(d => {
    if (dayType(d) === 'sat') {
      const key = dateKey(d);
      delete deptObj.overrides[key];
    }
  });
 //renderOTPlan();
}

// ── otpCellEdit ───────────────────────────────────────────────
// Stores a per-dept per-date override when HR manually edits
// a specific day cell. This persists through save.
function otpCellEdit(di, key, value) {
  otPlan.depts[di].overrides[key] = parseFloat(value) || 0;
  //renderOTPlan();
}

// ── addOTPHoliday ─────────────────────────────────────────────
// Marks a date as an all-dept holiday (sets all depts to 0
// for that date). HR can still override individual depts after.
function addOTPHoliday() {
  const date = document.getElementById('otp-holiday-date').value;
  if (!date) { toast('Select a date', true); return; }

  // Add to holidays list if not already there
  if (!otPlan.holidays.includes(date)) {
    otPlan.holidays.push(date);
  }

  // Clear any dept-level overrides for this date so holiday takes effect
  otPlan.depts.forEach(d => {
    if (d.overrides[date] !== undefined) delete d.overrides[date];
  });

  document.getElementById('otp-holiday-status').textContent = `✔ ${date} set as holiday`;
  setTimeout(() => document.getElementById('otp-holiday-status').textContent = '', 3000);

  renderOTPlan();
}

// ── clearOTPDay ───────────────────────────────────────────────
// Sets all dept hours to 0 for a specific date by storing a
// 0 override for every dept on that date. HR can still edit
// individual cells back after clearing.
function clearOTPDay(key) {
  if (!confirm(`Set all departments to 0 OT on ${key}?`)) return;

  otPlan.depts.forEach(d => {
    if (!d.overrides) d.overrides = {};
    d.overrides[key] = 0;
  });

  // Also add to holidays list so the column shows the holiday tint
  if (!otPlan.holidays.includes(key)) {
    otPlan.holidays.push(key);
  }

  renderOTPlan();
  toast(`All depts cleared for ${key}`);
}

// ── saveOTPlan ────────────────────────────────────────────────
// Saves the full month plan to Firestore as ot_plans/{YYYY-MM}.
async function saveOTPlan() {
  if (!otPlan || !otPlanMonth) { toast('Load a month first', true); return; }

  try {
    await db.collection('ot_plans').doc(otPlanMonth).set({
      ...otPlan,
      savedAt: new Date().toISOString()
    });
    document.getElementById('otp-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('otp-status').textContent = '', 3000);
    toast('OT Plan saved!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── exportOTPImage ────────────────────────────────────────────
// Captures the full OT plan table as a PNG.
// Temporarily replaces all input elements with plain text so
// values are not clipped by html2canvas input rendering.
async function exportOTPImage() {
  const scrollDiv = document.getElementById('otp-table-wrap');

  // ── Step 1: Replace all inputs with styled spans ──────────
  const inputs = Array.from(scrollDiv.querySelectorAll('input[type="number"]'));
  inputs.forEach(inp => {
    const span = document.createElement('span');
    span.textContent          = inp.value || '0';
    span.dataset.replaceInput = 'true';
    span.style.cssText        =
      'display:inline-block;width:100%;text-align:center;' +
      'font-size:.78rem;font-weight:500;padding:4px 2px;';
    inp.parentNode.replaceChild(span, inp);
  });

  // ── Step 2: Expand container for full render ──────────────
  const origOv = scrollDiv.style.overflow;
  const origW  = scrollDiv.style.width;
  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width    = scrollDiv.scrollWidth + 'px';

  // ── Step 3: Capture ───────────────────────────────────────
  const canvas = await html2canvas(scrollDiv, {
    scale:           3,
    width:           scrollDiv.scrollWidth,
    height:          scrollDiv.scrollHeight,
    windowWidth:     scrollDiv.scrollWidth,
    windowHeight:    scrollDiv.scrollHeight,
    backgroundColor: '#ffffff'
  });

  // ── Step 4: Restore overflow ──────────────────────────────
  scrollDiv.style.overflow = origOv;
  scrollDiv.style.width    = origW;

  // ── Step 5: Re-render table to restore all inputs ─────────
  // Re-render is the cleanest way to restore — avoids having
  // to track and re-insert every input individually.
  renderOTPlan();

  // ── Step 6: Trigger download ──────────────────────────────
  const link    = document.createElement('a');
  link.download = `OT_Plan_${otPlanMonth}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
  toast('Captured!');
}


// ════════════════════════════════════════════════════════════
//  19. OT DAILY ENTRY + PLAN VS ACTUAL DASHBOARD
//
//  Daily Entry:
//    Collection : ot_daily
//    Doc ID     : "YYYY-MM-DD"
//    Fields     : date, depts: [{ dept, preApproval, actual }]
//
//  Dashboard:
//    Reads ot_plans/{YYYY-MM} for targets (full month + to date)
//    Sums all ot_daily docs from 1st → today for actuals
//
//  Columns:
//    Target OT Hrs          = monthly total from ot_plan
//    Assigned Target (toDate)= plan sum day1→today
//    Pre Approval OT        = sum of daily pre-approval day1→today
//    Actual OT              = sum of daily actual day1→today
//    Difference             = Pre Approval − Actual
//    No of Employees        = heads from ot_plan
//    Avg Hrs/Head (Initial) = Assigned Target / Heads
//    Avg Hrs/Head (Actual)  = Actual OT / Heads
//    Monthly Budgeted/Head  = Monthly Total / Heads
// ════════════════════════════════════════════════════════════

// In-memory daily entry rows — keyed by dept name
let otDailyRows = {};

// ── initOTDaily ──────────────────────────────────────────────
// Sets today's date in the entry picker and dash month picker.
function initOTDaily() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const month = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  document.getElementById('otd-date').value       = today;
  document.getElementById('otd-dash-month').value = month;
}

// ── loadOTDaily ──────────────────────────────────────────────
// Loads the daily entry for the selected date.
// Also loads the OT plan for that month so planned hours
// can be shown as a reference column.
async function loadOTDaily() {
  const date = document.getElementById('otd-date').value;
  if (!date) { toast('Select a date', true); return; }

  const month  = date.slice(0, 7);   // "YYYY-MM"
  const tbody  = document.getElementById('otd-entry-body');
  tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    // Load saved daily entry
    const dayDoc = await db.collection('ot_daily').doc(date).get();
    const saved  = dayDoc.exists ? (dayDoc.data().depts || []) : [];
    const savedMap = {};
    saved.forEach(r => { savedMap[r.dept] = r; });

    // Load OT plan for the month to show planned hours column
    const planDoc  = await db.collection('ot_plans').doc(month).get();
    const planData = planDoc.exists ? planDoc.data() : null;
    const planMap  = {};
    if (planData) {
      planData.depts.forEach(d => { planMap[d.dept] = d; });
    }

    // Build in-memory rows
    otDailyRows = {};
    OT_DEPTS.forEach(dept => {
      const s = savedMap[dept] || {};
      otDailyRows[dept] = {
        dept,
        preApproval: s.preApproval || 0,
        actual:      s.actual      || 0,
      };
    });

    renderOTDailyEntry(planMap, date);
  } catch (e) {
    toast('Error loading OT daily: ' + e.message, true);
    console.error(e);
  }
}

// ── renderOTDailyEntry ───────────────────────────────────────
// Renders the daily entry table with planned hours reference,
// editable Pre Approval and Actual columns, and live diff.
function renderOTDailyEntry(planMap, date) {
  const tbody = document.getElementById('otd-entry-body');
  const tfoot = document.getElementById('otd-entry-foot');
  let   html  = '';
  let   GT    = { planned: 0, preApproval: 0, actual: 0 };

  OT_DEPTS.forEach(dept => {
    const r       = otDailyRows[dept] || { preApproval: 0, actual: 0 };
    const planObj = planMap[dept];

    // Get planned hours for this specific date from the OT plan
    let planned = 0;
    if (planObj) {
      const dateObj = new Date(date + 'T00:00:00');
      planned = getDeptOTHours(planObj, dateObj, planMap._holidays || []);
    }

    const diff      = r.preApproval - r.actual;
    const diffStyle = diff >= 0
      ? 'color:#1e8449;font-weight:700;'
      : 'color:#c0392b;font-weight:700;';
    const diffDisp  = diff > 0 ? `+${diff}` : diff < 0 ? `(${Math.abs(diff)})` : '—';

    GT.planned     += planned;
    GT.preApproval += r.preApproval;
    GT.actual      += r.actual;

    // Tab-friendly inputs — onchange saves to memory, onblur re-renders
    html += `<tr>
      <td class="left" style="padding:6px 8px;font-weight:700;">${dept}</td>
      <td style="padding:6px 8px;text-align:center;color:#1a3a5c;font-weight:700;">
        ${planned || '—'}
      </td>
      <td style="padding:3px 5px;text-align:center;">
        <input type="number" min="0" value="${r.preApproval}"
          style="width:64px;padding:5px 6px;border:1px solid #d0d8e4;
                 border-radius:4px;font-size:.85rem;text-align:center;"
          onchange="otDailyInput('${dept}','preApproval',this.value)"
          onblur="renderOTDailyEntry(window._otdPlanMap, window._otdDate)"
          onkeydown="otdHandleTab(event,'${dept}','preApproval')"/>
      </td>
      <td style="padding:3px 5px;text-align:center;">
        <input type="number" min="0" value="${r.actual}"
          style="width:64px;padding:5px 6px;border:1px solid #d0d8e4;
                 border-radius:4px;font-size:.85rem;text-align:center;"
          onchange="otDailyInput('${dept}','actual',this.value)"
          onblur="renderOTDailyEntry(window._otdPlanMap, window._otdDate)"
          onkeydown="otdHandleTab(event,'${dept}','actual')"/>
      </td>
      <td style="padding:6px 8px;text-align:center;${diffStyle}">${diffDisp}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Store for re-render on blur
  window._otdPlanMap = planMap;
  window._otdDate    = date;

  // Grand total footer
  const gtDiff      = GT.preApproval - GT.actual;
  const gtDiffStyle = gtDiff >= 0 ? '' : 'color:#f78166;';
  const gtDiffDisp  = gtDiff > 0 ? `+${gtDiff}` : gtDiff < 0 ? `(${Math.abs(gtDiff)})` : '—';

  tfoot.innerHTML = `<tr class="grand-row">
    <td class="left" style="padding-left:10px;">TOTAL</td>
    <td style="padding:7px 8px;text-align:center;">${GT.planned}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.preApproval}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.actual}</td>
    <td style="padding:7px 8px;text-align:center;${gtDiffStyle}">${gtDiffDisp}</td>
  </tr>`;
}

// ── otDailyInput ─────────────────────────────────────────────
// Saves value to memory on every change without re-rendering.
function otDailyInput(dept, field, value) {
  if (!otDailyRows[dept]) otDailyRows[dept] = { preApproval: 0, actual: 0 };
  otDailyRows[dept][field] = parseFloat(value) || 0;
}

// ── otdHandleTab ─────────────────────────────────────────────
// Tab moves to next input without triggering re-render.
function otdHandleTab(e, dept, field) {
  if (e.key !== 'Tab') return;
  e.preventDefault();

  // Save current value first
  otDailyInput(dept, field, e.target.value);

  const allInputs = Array.from(
    document.getElementById('otd-entry-table')
      .querySelectorAll('input[type="number"]')
  );
  const idx  = allInputs.indexOf(e.target);
  const next = e.shiftKey ? idx - 1 : idx + 1;

  if (next >= 0 && next < allInputs.length) {
    allInputs[next].focus();
    allInputs[next].select();
  } else {
    renderOTDailyEntry(window._otdPlanMap, window._otdDate);
  }
}

// ── saveOTDaily ──────────────────────────────────────────────
// Saves all dept entries for the selected date to ot_daily.
async function saveOTDaily() {
  const date = document.getElementById('otd-date').value;
  if (!date) { toast('Select a date', true); return; }

  const depts = OT_DEPTS.map(dept => ({
    dept,
    preApproval: otDailyRows[dept]?.preApproval || 0,
    actual:      otDailyRows[dept]?.actual      || 0,
  }));

  try {
    await db.collection('ot_daily').doc(date).set({
      date, depts,
      savedAt: new Date().toISOString()
    });
    document.getElementById('otd-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('otd-status').textContent = '', 3000);
    toast('OT daily saved!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── loadOTDashboard ──────────────────────────────────────────
// Loads the OT plan for the month and sums all ot_daily docs
// from the 1st to today to build the dashboard.
async function loadOTDashboard() {
  const month = document.getElementById('otd-dash-month').value;
  if (!month) { toast('Select a month', true); return; }

  const tbody = document.getElementById('otd-dash-body');
  tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    // ── Fetch OT Plan ─────────────────────────────────────
    const planDoc = await db.collection('ot_plans').doc(month).get();
    if (!planDoc.exists) {
      tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">' +
        'No OT Plan found for this month. Create one in the OT Plan card above.</td></tr>';
      return;
    }
    const plan     = planDoc.data();
    const planMap  = {};
    plan.depts.forEach(d => { planMap[d.dept] = d; });
    const holidays = plan.holidays || [];

    // ── Fetch all ot_daily docs for this month ────────────
    const from = `${month}-01`;
    const now  = new Date();
    const pad  = n => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

    const dailySnap = await db.collection('ot_daily')
      .where('date', '>=', from)
      .where('date', '<=', todayStr)
      .get();

    // Sum preApproval and actual per dept across all daily docs
    const dailyTotals = {};   // { dept: { preApproval, actual } }
    OT_DEPTS.forEach(d => { dailyTotals[d] = { preApproval: 0, actual: 0 }; });

    dailySnap.forEach(doc => {
      const data = doc.data();
      (data.depts || []).forEach(r => {
        if (dailyTotals[r.dept]) {
          dailyTotals[r.dept].preApproval += r.preApproval || 0;
          dailyTotals[r.dept].actual      += r.actual      || 0;
        }
      });
    });

    // ── Compute plan targets ──────────────────────────────
    // Monthly total and to-date from the OT plan grid
    const days = getDaysInMonth(month);
    const planTargets = {};
    OT_DEPTS.forEach(dept => {
      const deptObj = planMap[dept];
      if (!deptObj) {
        planTargets[dept] = { monthlyTotal: 0, toDate: 0, heads: 0 };
        return;
      }
      const dayHours    = days.map(d => getDeptOTHours(deptObj, d, holidays));
      const monthlyTotal = dayHours.reduce((s, h) => s + h, 0);
      const toDate       = days.reduce((s, d, i) =>
        d <= now ? s + dayHours[i] : s, 0);
      planTargets[dept]  = { monthlyTotal, toDate, heads: deptObj.heads || 0 };
    });

    // Format current month name + as-at date
        const monthName = new Date(month + '-01').toLocaleDateString('en-LK', {
          month: 'long', year: 'numeric'
        });
        const asAtDate = now.toLocaleDateString('en-LK', {
          day: 'numeric', month: 'long', year: 'numeric'
        });

        document.getElementById('otd-month-label').textContent =
          `${monthName}  •  As at ${asAtDate}`;
            // ── Render dashboard table ────────────────────────────
            renderOTDashboard(planTargets, dailyTotals);

  } catch (e) {
    toast('Error loading OT dashboard: ' + e.message, true);
    console.error(e);
  }
}

// ── renderOTDashboard ────────────────────────────────────────
// Renders the Plan vs Actual summary table.
function renderOTDashboard(planTargets, dailyTotals) {
  const tbody = document.getElementById('otd-dash-body');
  const tfoot = document.getElementById('otd-dash-foot');
  let   html  = '';
  let   GT    = {
    monthlyTotal:0, toDate:0, preApproval:0,
    actual:0, heads:0
  };

  OT_DEPTS.forEach(dept => {
    const p   = planTargets[dept]  || { monthlyTotal:0, toDate:0, heads:0 };
    const d   = dailyTotals[dept]  || { preApproval:0,  actual:0 };

    const diff        = d.preApproval - d.actual;
    const avgInitial  = p.heads > 0 ? (p.toDate       / p.heads).toFixed(0) : '—';
    const avgActual   = p.heads > 0 ? (d.actual        / p.heads).toFixed(0) : '—';
    const budgetedPH  = p.heads > 0 ? (p.monthlyTotal  / p.heads).toFixed(0) : '—';

    const diffStyle = diff >= 0
      ? 'color:#1e8449;font-weight:700;'
      : 'color:#c0392b;font-weight:700;';
    const diffDisp  = diff > 0
      ? `+${diff}`
      : diff < 0 ? `(${Math.abs(diff)})` : '—';

    GT.monthlyTotal += p.monthlyTotal;
    GT.toDate       += p.toDate;
    GT.preApproval  += d.preApproval;
    GT.actual       += d.actual;
    GT.heads        += p.heads;

    html += `<tr>
      <td class="left" style="padding:6px 10px;font-weight:700;">${dept}</td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;
                 color:#1a3a5c;background:#eef3f9;">
        ${p.monthlyTotal.toLocaleString()}
      </td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;
                 color:#155a35;background:#f0faf0;">
        ${p.toDate.toLocaleString()}
      </td>
      <td style="padding:6px 8px;text-align:center;">
        ${d.preApproval.toLocaleString()}
      </td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;">
        ${d.actual.toLocaleString()}
      </td>
      <td style="padding:6px 8px;text-align:center;${diffStyle}">${diffDisp}</td>
      <td style="padding:6px 8px;text-align:center;">${p.heads || '—'}</td>
      <td style="padding:6px 8px;text-align:center;">${avgInitial}</td>
      <td style="padding:6px 8px;text-align:center;">${avgActual}</td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;
                 color:#6d5504;background:#fdf8e8;">
        ${budgetedPH}
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Grand total footer
  const gtDiff      = GT.preApproval - GT.actual;
  const gtDiffStyle = gtDiff >= 0 ? '' : 'color:#f78166;';
  const gtDiffDisp  = gtDiff > 0 ? `+${gtDiff}` : gtDiff < 0 ? `(${Math.abs(gtDiff)})` : '—';
  const gtAvgInit   = GT.heads > 0 ? (GT.toDate      / GT.heads).toFixed(0) : '—';
  const gtAvgAct    = GT.heads > 0 ? (GT.actual       / GT.heads).toFixed(0) : '—';
  const gtBudgetPH  = GT.heads > 0 ? (GT.monthlyTotal / GT.heads).toFixed(0) : '—';

  tfoot.innerHTML = `<tr class="grand-row">
    <td class="left" style="padding-left:10px;">GRAND TOTAL</td>
    <td style="padding:7px 8px;text-align:center;">
      ${GT.monthlyTotal.toLocaleString()}
    </td>
    <td style="padding:7px 8px;text-align:center;">
      ${GT.toDate.toLocaleString()}
    </td>
    <td style="padding:7px 8px;text-align:center;">
      ${GT.preApproval.toLocaleString()}
    </td>
    <td style="padding:7px 8px;text-align:center;">
      ${GT.actual.toLocaleString()}
    </td>
    <td style="padding:7px 8px;text-align:center;${gtDiffStyle}">
      ${gtDiffDisp}
    </td>
    <td style="padding:7px 8px;text-align:center;">${GT.heads}</td>
    <td style="padding:7px 8px;text-align:center;">${gtAvgInit}</td>
    <td style="padding:7px 8px;text-align:center;">${gtAvgAct}</td>
    <td style="padding:7px 8px;text-align:center;">${gtBudgetPH}</td>
  </tr>`;
}

// ── exportOTDashImage ────────────────────────────────────────
// Captures the Plan vs Actual dashboard as a PNG.
async function exportOTDashImage() {
  const month     = document.getElementById('otd-dash-month').value || 'ot';
  const scrollDiv = document.getElementById('otd-dash-wrap');
  const table     = document.getElementById('otd-dash-table');

  const origOv = scrollDiv.style.overflow;
  const origW  = scrollDiv.style.width;
  scrollDiv.style.overflow = 'visible';
  scrollDiv.style.width    = table.scrollWidth + 'px';

  await new Promise(r => setTimeout(r, 80));

  const canvas = await html2canvas(scrollDiv, {
    scale:      3,
    useCORS:    true,
    allowTaint: true,
    scrollX:    0,
    scrollY:    -window.scrollY
  });

  scrollDiv.style.overflow = origOv;
  scrollDiv.style.width    = origW;

  const link    = document.createElement('a');
  link.download = `OT_Dashboard_${month}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
  toast('Captured!');
}


// ════════════════════════════════════════════════════════════
//  20. HR ATTENDANCE DASHBOARD — AS PER DATE
//  Exact read-only mirror of renderAttEntryTable().
//  Loads attendance_daily/{date} and renders uneditable.
//  All calculations identical to daily entry.
// ════════════════════════════════════════════════════════════

// ── initHRDashboard ──────────────────────────────────────────
function initHRDashboard() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('hrd-date').value =
    `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}

// ── loadHRDashboard Attendance dashbord──────────────────────────────────────────
// Fetches attendance_daily/{date}, builds a read-only row map,
// then calls renderHRDashTable which mirrors renderAttEntryTable
// exactly — same columns, same calculations, no inputs.
async function loadHRDashboard() {
  const date  = document.getElementById('hrd-date').value;
  if (!date) { toast('Select a date', true); return; }

  const tbody = document.getElementById('hrd-body');
  tbody.innerHTML =
    '<tr><td colspan="15" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    const doc   = await db.collection('attendance_daily').doc(date).get();
    const saved = doc.exists ? (doc.data().rows || []) : [];

    // Build lookup map same as loadAttDaily
    const savedMap = {};
    saved.forEach(r => { savedMap[`${r.dept}_${r.shift}`] = r; });

    // Build read-only row data (same shape as attDailyRows)
    const rows = {};
    ATT_DEPTS.forEach(({ dept, shift }) => {
      const key = `${dept}_${shift}`;
      const s   = savedMap[key] || {};
      rows[key] = {
        present:     s.present     || 0,
        informed:    s.informed    || 0,
        uninformed:  s.uninformed  || 0,
        dayoff:      s.dayoff      || 0,
        longabsent:  s.longabsent  || 0,
        turnover:    s.turnover    || 0,
        recruitment: s.recruitment || 0,
      };
    });

    // Update as-at label
    const d = new Date(date + 'T00:00:00');
    document.getElementById('hrd-asat').textContent =
      `As at ${d.toLocaleDateString('en-LK', {
        weekday: 'long', day: 'numeric',
        month:   'long', year: 'numeric'
      })}`;

    renderHRDashTable(rows);

  } catch (e) {
    toast('Error: ' + e.message, true);
    console.error(e);
  }
}

// ── renderHRDashTable ────────────────────────────────────────
// Identical logic to renderAttEntryTable() but all data cells
// are plain <td> text — no inputs. Same columns, same order,
// same calculations, same rowspan merged absenteeism cell.
function renderHRDashTable(rowData) {
  const tbody          = document.getElementById('hrd-body');
  const tfoot          = document.getElementById('hrd-foot');
  let   lastDept       = null;
  let   html           = [];

  // ── Step 1: Pre-compute dept absenteeism % ─────────────────
  const deptMeta = {};
  ATT_DEPTS.forEach(({ dept, shift }) => {
    const key         = `${dept}_${shift}`;
    const r           = rowData[key]    || {};
    const master      = attMasters[key] || { onRoll: 0 };
    const onRoll      = master.onRoll   || 0;
    const totalAbsent = (r.informed || 0) + (r.uninformed || 0);
    const shiftAbsPct = onRoll > 0 ? (totalAbsent / onRoll) * 100 : 0;

    if (!deptMeta[dept]) deptMeta[dept] = { rowspan: 0, shiftPctSum: 0 };
    deptMeta[dept].rowspan++;
    deptMeta[dept].shiftPctSum += shiftAbsPct;
  });
  Object.keys(deptMeta).forEach(dept => {
    const m  = deptMeta[dept];
    m.absPct = m.rowspan > 0
      ? (m.shiftPctSum / m.rowspan).toFixed(2) + '%'
      : '—';
  });

  // ── Step 2: Grand total accumulators ──────────────────────
  let GT = {
    revised:0, onRoll:0, present:0, informed:0, uninformed:0,
    totalAbsent:0, dayoff:0, longabsent:0, turnover:0,
    recruitment:0, excess:0
  };

  // ── Step 3: Build rows ─────────────────────────────────────
  ATT_DEPTS.forEach(({ dept, shift }) => {
    const key    = `${dept}_${shift}`;
    const r      = rowData[key]    || {};
    const master = attMasters[key] || { revised: 0, onRoll: 0 };
    const meta   = deptMeta[dept];

    const revised     = master.revised || 0;
    const onRoll      = master.onRoll  || 0;
    const totalAbsent = (r.informed || 0) + (r.uninformed || 0);
    const excess      = onRoll - revised;
    const tvPct       = onRoll > 0
      ? ((r.turnover || 0) / onRoll * 100).toFixed(1) + '%'
      : '—';

    // Accumulate grand totals
    GT.revised     += revised;
    GT.onRoll      += onRoll;
    GT.present     += r.present     || 0;
    GT.informed    += r.informed    || 0;
    GT.uninformed  += r.uninformed  || 0;
    GT.totalAbsent += totalAbsent;
    GT.dayoff      += r.dayoff      || 0;
    GT.longabsent  += r.longabsent  || 0;
    GT.turnover    += r.turnover    || 0;
    GT.recruitment += r.recruitment || 0;
    GT.excess      += excess;

    const isFirstRow = dept !== lastDept;
    lastDept = dept;

    // ── Row background — first shift row of each dept ─────────
    const rowBg = isFirstRow ? '#e8f0f8' : '#ffffff';

    // ── Dept name cell — value on first row, empty on others ──
    const deptCell = `<td class="left"
      style="padding:6px 8px;font-weight:700;white-space:nowrap;
             background:${rowBg};">
      ${isFirstRow ? dept : ''}
    </td>`;

    // ── Shift badge ───────────────────────────────────────────
    const badge = shift === 'General'
      ? `<span class="badge-day">${shift}</span>`
      : `<span class="badge-night">${shift}</span>`;

    // ── Excess display ────────────────────────────────────────
    const exStyle   = excess >= 0
      ? 'color:#1e8449;font-weight:700;'
      : 'color:#c0392b;font-weight:700;';
    const exDisplay = excess > 0
      ? `+${excess}` : excess < 0 ? `(${Math.abs(excess)})` : '—';

    // ── Absenteeism % — value on first row, empty on others ───
    const absPctCell = `<td
      style="padding:6px 8px;text-align:center;font-weight:700;
             border-left:2px solid #d9e5f2;background:#f5f8fd;">
      ${isFirstRow ? meta.absPct : ''}
    </td>`;

    // ── Cell helper — applies row background + optional style ──
    const c = (val, extra = '') =>
      `<td style="padding:5px 8px;text-align:center;
                  background:${rowBg};${extra}">
         ${val || '—'}
       </td>`;

    html.push(`<tr>
      ${deptCell}
      <td style="padding:5px 8px;text-align:center;background:${rowBg};">
        ${badge}
      </td>
      ${c(revised,          'font-weight:700;color:#1a3a5c;')}
      ${c(onRoll,           'font-weight:700;')}
      ${c(r.present,        'color:#1e8449;font-weight:700;')}
      ${c(r.informed,       '')}
      ${c(r.uninformed,     '')}
      ${c(totalAbsent,      'font-weight:700;')}
      ${c(r.dayoff,         '')}
      ${c(r.longabsent,     '')}
      ${c(r.turnover,       '')}
      ${c(r.recruitment,    '')}
      <td style="padding:5px 8px;text-align:center;
                 background:${rowBg};${exStyle}">
        ${exDisplay}
      </td>
      ${absPctCell}
      <td style="padding:5px 8px;text-align:center;background:${rowBg};">
        ${tvPct}
      </td>
    </tr>`);
  });

  tbody.innerHTML = html.join('');

  // ── Grand total footer ─────────────────────────────────────
  const gtAbsPct  = GT.onRoll > 0
    ? ((GT.totalAbsent / GT.onRoll) * 100).toFixed(2) + '%' : '—';
  const gtTvPct   = GT.onRoll > 0
    ? ((GT.turnover    / GT.onRoll) * 100).toFixed(1) + '%' : '—';
  const gtEx      = GT.excess > 0
    ? `+${GT.excess}` : GT.excess < 0 ? `(${Math.abs(GT.excess)})` : '—';
  const gtExStyle = GT.excess >= 0 ? '' : 'color:#f78166;';

  tfoot.innerHTML = `<tr class="grand-row">
    <td colspan="2" class="left" style="padding-left:10px;">TOTAL</td>
    <td style="padding:7px 8px;text-align:center;">${GT.revised}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.onRoll}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.present}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.informed}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.uninformed}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.totalAbsent}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.dayoff}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.longabsent}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.turnover}</td>
    <td style="padding:7px 8px;text-align:center;">${GT.recruitment}</td>
    <td style="padding:7px 8px;text-align:center;${gtExStyle}">${gtEx}</td>
    <td style="padding:7px 8px;text-align:center;
               border-left:2px solid rgba(255,255,255,.3);">${gtAbsPct}</td>
    <td style="padding:7px 8px;text-align:center;">${gtTvPct}</td>
  </tr>`;
}
// ── exportHRDashImage ────────────────────────────────────────
// Replaces no inputs here (all plain text) so straight capture.
async function exportHRDashImage() {
  const date  = document.getElementById('hrd-date').value || 'hr';
  const wrap  = document.getElementById('hrd-wrap');
  const table = document.getElementById('hrd-table');

  const origOv = wrap.style.overflow;
  const origW  = wrap.style.width;
  wrap.style.overflow = 'visible';
  wrap.style.width    = table.scrollWidth + 'px';

  await new Promise(r => setTimeout(r, 80));

  const canvas = await html2canvas(wrap, {
    scale:      3,
    useCORS:    true,
    allowTaint: true,
    scrollX:    0,
    scrollY:    -window.scrollY
  });

  wrap.style.overflow = origOv;
  wrap.style.width    = origW;

  const link    = document.createElement('a');
  link.download = `HR_Attendance_${date}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
  toast('Captured!');
}


// ════════════════════════════════════════════════════════════
//  21. MEAL SYSTEM — SHIFT ROSTER (rotation engine)
//  Firestore collection : shift_roster
//  Document ID          : "current"  (single document)
//
//  Concept:
//    HR sets ONE anchor date — any Monday where Shift A is
//    known to be on DAY shift. From that single reference
//    point, the system calculates which shift (Day/Night)
//    Shift A and Shift B are on for ANY given date, forever,
//    by counting how many full weeks have passed since the
//    anchor and checking odd/even.
//
//    Even weeks since anchor → Shift A = DAY,   Shift B = NIGHT
//    Odd  weeks since anchor → Shift A = NIGHT, Shift B = DAY
//    General is never affected — always General/Day-window.
// ════════════════════════════════════════════════════════════

// In-memory roster anchor — loaded once at login
let shiftRosterAnchor = null;   // Date object

// ── loadShiftRoster ──────────────────────────────────────────
// Fetches the saved anchor date from Firestore. If none exists
// yet, leaves the field blank for HR to set up for the first time.
async function loadShiftRoster() {
  try {
    const doc = await db.collection('shift_roster').doc('current').get();
    if (doc.exists) {
      const data = doc.data();
      shiftRosterAnchor = new Date(data.anchorDate + 'T00:00:00');
      document.getElementById('roster-anchor-date').value = data.anchorDate;
    }
    updateRosterStatusDisplay();
  } catch (e) {
    console.error('loadShiftRoster:', e);
  }
}

// ── saveShiftRoster ──────────────────────────────────────────
// Saves the anchor date HR has chosen. This date MUST be a
// Monday where Shift A is confirmed to be on DAY shift.
async function saveShiftRoster() {
  const dateStr = document.getElementById('roster-anchor-date').value;
  if (!dateStr) { toast('Select an anchor date', true); return; }

  // Validate it's a Monday (dayOfWeek 1) — warn but allow override
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() !== 1) {
    if (!confirm('Selected date is not a Monday. Continue anyway?')) return;
  }

  try {
    await db.collection('shift_roster').doc('current').set({
      anchorDate: dateStr,
      savedAt:    new Date().toISOString()
    });

    shiftRosterAnchor = d;
    updateRosterStatusDisplay();

    document.getElementById('roster-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('roster-status').textContent = '', 3000);
    toast('Shift roster anchor saved!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── getShiftAssignment ────────────────────────────────────────
// THE CORE ROTATION FUNCTION.
// Given any JS Date, returns which actual shift (Day/Night)
// Shift A and Shift B are assigned to for that date's week.
//
// Returns: { A: 'Day'|'Night', B: 'Day'|'Night' }
//
// Math: count full 7-day periods between the anchor Monday
// and the target date. Even count = A is Day. Odd = A is Night.
function getShiftAssignment(targetDate) {
  if (!shiftRosterAnchor) {
    // No anchor set yet — default safe fallback
    return { A: 'Day', B: 'Night' };
  }

  // Normalise both dates to midnight to avoid time-of-day drift
  const anchor = new Date(shiftRosterAnchor);
  anchor.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);

  // Find the Monday of the target date's week
  // (so any day within a week maps to the same week-count)
  const targetDay     = target.getDay();              // 0=Sun..6=Sat
  const daysFromMonday = targetDay === 0 ? 6 : targetDay - 1;
  const targetMonday  = new Date(target);
  targetMonday.setDate(target.getDate() - daysFromMonday);

  // Difference in days between anchor Monday and target Monday
  const msPerDay   = 24 * 60 * 60 * 1000;
  const diffDays   = Math.round((targetMonday - anchor) / msPerDay);
  const weeksSince = Math.floor(diffDays / 7);

  // Even weeks → A=Day, B=Night. Odd weeks → A=Night, B=Day.
  // Handles negative weeksSince (dates before anchor) correctly
  // using a safe modulo that always returns 0 or 1.
  const isEvenWeek = (((weeksSince % 2) + 2) % 2) === 0;

  return isEvenWeek
    ? { A: 'Day',   B: 'Night' }
    : { A: 'Night', B: 'Day'   };
}

// ── resolveActualShift ──────────────────────────────────────
// Converts an employee's fixed Shift Code (A/B/General) into
// their ACTUAL Day/Night assignment for a specific date.
// General always resolves to "General" (its own fixed window).
function resolveActualShift(shiftCode, targetDate) {
  if (shiftCode === 'General') return 'General';
  const assignment = getShiftAssignment(targetDate);
  return assignment[shiftCode];   // 'A' or 'B' → 'Day' or 'Night'
}

// ── updateRosterStatusDisplay ────────────────────────────────
// Shows HR a human-readable summary of the CURRENT week's
// rotation status, calculated live from the anchor date.
function updateRosterStatusDisplay() {
  const el = document.getElementById('roster-current-status');
  if (!shiftRosterAnchor) {
    el.value = 'Not set — select an anchor date';
    return;
  }
  const today      = new Date();
  const assignment = getShiftAssignment(today);
  el.value = `This week: Shift A = ${assignment.A}, Shift B = ${assignment.B}`;
}


// ════════════════════════════════════════════════════════════
//  22. MEAL SYSTEM — EMPLOYEE REGISTER
//  Firestore collection : employees
//  Document ID          : EPF No (e.g. "EPF1234")
//
//  This is the master list of every employee eligible for
//  meals. Department list reuses the same fixed dept names
//  used elsewhere in the system (ATT_DEPTS) for consistency.
// ════════════════════════════════════════════════════════════

// In-memory cache of all employees — keyed by EPF No
let employees = {};

// Tracks which EPF No is being edited (null = new record mode)
let employeeEditId = null;

// ── loadEmployees ─────────────────────────────────────────────
// Fetches all employee documents and populates both the
// in-memory cache and the Department dropdown (reusing the
// fixed dept list from ATT_DEPTS for consistency across modules).
async function loadEmployees() {
  try {
    // Populate department dropdown from the same fixed list
    // used in Attendance/OT modules — keeps dept names consistent
    const deptSelect   = document.getElementById('emp-dept');
    const uniqueDepts  = [...new Set(ATT_DEPTS.map(d => d.dept))];
    deptSelect.innerHTML = '<option value="">— select —</option>' +
      uniqueDepts.map(d => `<option value="${d}">${d}</option>`).join('');

    // Fetch all employees
    const snap = await db.collection('employees').orderBy('name').get();
    employees  = {};
    snap.forEach(d => { employees[d.id] = d.data(); });

    renderEmployeeTable();
  } catch (e) {
    console.error('loadEmployees:', e);
    toast('Error loading employees: ' + e.message, true);
  }
}

// ── saveEmployee ──────────────────────────────────────────────
// Validates the form, then creates a new employee document
// (keyed by EPF No) or updates an existing one if in edit mode.
async function saveEmployee() {
  const epfNo = document.getElementById('emp-epfno').value.trim();
  const name  = document.getElementById('emp-name').value.trim();
  const dept  = document.getElementById('emp-dept').value;
  const shiftCode = document.getElementById('emp-shiftcode').value;
  const type  = document.getElementById('emp-type').value;

  if (!epfNo || !name || !dept) {
    toast('Enter EPF No, Name and Department', true);
    return;
  }

  // Block duplicate EPF No when creating a NEW employee
  // (editing keeps the same ID so this check is skipped then)
  if (!employeeEditId && employees[epfNo]) {
    toast(`EPF No "${epfNo}" already exists. Use Edit to update it.`, true);
    return;
  }

  const payload = {
    epfNo, name, dept, shiftCode, type,
    active:  true,
    savedAt: new Date().toISOString()
  };

  try {
    // Document ID is always the EPF No — simple, guaranteed unique
    await db.collection('employees').doc(epfNo).set(payload);

    await loadEmployees();
    resetEmployeeForm();

    document.getElementById('emp-status').textContent = '✔ Saved!';
    setTimeout(() => document.getElementById('emp-status').textContent = '', 3000);
    toast(employeeEditId ? 'Employee updated!' : 'Employee added!');
  } catch (e) {
    toast('Save error: ' + e.message, true);
  }
}

// ── editEmployee ──────────────────────────────────────────────
// Pre-fills the form with an existing employee's details so
// HR can update them. EPF No field is locked during edit since
// it's the permanent document ID.
function editEmployee(epfNo) {
  const emp = employees[epfNo];
  if (!emp) return;

  employeeEditId = epfNo;

  document.getElementById('emp-epfno').value     = emp.epfNo;
  document.getElementById('emp-epfno').readOnly  = true;   // lock ID field during edit
  document.getElementById('emp-name').value      = emp.name;
  document.getElementById('emp-dept').value      = emp.dept;
  document.getElementById('emp-shiftcode').value = emp.shiftCode;
  document.getElementById('emp-type').value      = emp.type;

  document.getElementById('emp-save-btn').textContent     = '💾 Update Employee';
  document.getElementById('emp-cancel-btn').style.display = '';

  document.getElementById('emp-epfno').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── cancelEmployeeEdit ───────────────────────────────────────
function cancelEmployeeEdit() {
  resetEmployeeForm();
  toast('Edit cancelled.');
}

// ── deleteEmployee ────────────────────────────────────────────
// Permanently removes an employee record after confirmation.
async function deleteEmployee(epfNo) {
  const emp = employees[epfNo];
  if (!emp) return;

  if (!confirm(`Delete employee "${emp.name}" (${epfNo})?\n\nThis cannot be undone.`)) return;

  try {
    await db.collection('employees').doc(epfNo).delete();
    await loadEmployees();
    toast('Employee deleted!');
  } catch (e) {
    toast('Delete error: ' + e.message, true);
  }
}

// ── Pagination state for employee table ─────────────────────
let emp_currentPage = 1;

// ── empGoToPage ───────────────────────────────────────────────
// Changes the current page and re-renders, clamping within
// valid bounds (handled inside renderEmployeeTable itself).
function empGoToPage(page) {
  emp_currentPage = page;
  renderEmployeeTable();
}

// ── renderEmployeeTable ──────────────────────────────────────
// Renders a paginated, searchable view of the employee list.
// Search matches name or EPF No (case-insensitive, partial).
// Page size is controlled by the dropdown (default 15 rows).
function renderEmployeeTable() {
  const tbody      = document.getElementById('emp-table-body');
  const searchTerm = (document.getElementById('emp-search')?.value || '').toLowerCase().trim();
  const pageSize   = parseInt(document.getElementById('emp-page-size')?.value || 15);

  let list = Object.values(employees);

  // Apply search filter
  if (searchTerm) {
    list = list.filter(e =>
      e.name.toLowerCase().includes(searchTerm) ||
      e.epfNo.toLowerCase().includes(searchTerm)
    );
  }

  // Sort alphabetically by name
  list.sort((a, b) => a.name.localeCompare(b.name));

  const totalRows  = list.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  // Clamp current page within valid range
  if (emp_currentPage > totalPages) emp_currentPage = totalPages;
  if (emp_currentPage < 1)          emp_currentPage = 1;

  // Slice to current page only
  const startIdx = (emp_currentPage - 1) * pageSize;
  const pageList = list.slice(startIdx, startIdx + pageSize);

  if (!pageList.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No employees found.</td></tr>';
    document.getElementById('emp-page-info').textContent = '0 results';
    return;
  }

  tbody.innerHTML = pageList.map(emp => {
    const shiftBadge = emp.shiftCode === 'General'
      ? `<span class="badge-day">General</span>`
      : `<span class="badge-night">Shift ${emp.shiftCode}</span>`;

    const typeBadge = emp.type === 'Boarding'
      ? `<span style="background:#fde8e8;color:#c0392b;padding:2px 8px;
           border-radius:4px;font-size:.7rem;font-weight:700;">Boarding</span>`
      : `<span style="background:#e8f0f8;color:#1a3a5c;padding:2px 8px;
           border-radius:4px;font-size:.7rem;font-weight:700;">Home Living</span>`;

    return `<tr>
      <td class="left" style="padding:6px 10px;font-weight:700;">${emp.epfNo}</td>
      <td class="left" style="padding:6px 10px;">${emp.name}</td>
      <td style="padding:6px 10px;text-align:center;">${emp.dept}</td>
      <td style="padding:6px 10px;text-align:center;">${shiftBadge}</td>
      <td style="padding:6px 10px;text-align:center;">${typeBadge}</td>
      <td style="padding:6px 10px;text-align:center;">
        <button onclick="editEmployee('${emp.epfNo}')"
          style="background:#e8f0f8;color:#1a3a5c;border:none;padding:4px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;margin-right:4px;">
          ✎ Edit
        </button>
        <button onclick="deleteEmployee('${emp.epfNo}')"
          style="background:#fde8e8;color:#c0392b;border:none;padding:4px 10px;
          border-radius:4px;cursor:pointer;font-size:.75rem;">
          ✕ Delete
        </button>
      </td>
    </tr>`;
  }).join('');

  // Update pagination info display
  const showingFrom = startIdx + 1;
  const showingTo   = Math.min(startIdx + pageSize, totalRows);
  document.getElementById('emp-page-info').textContent =
    `Showing ${showingFrom}–${showingTo} of ${totalRows}  •  Page ${emp_currentPage} of ${totalPages}`;
}

// ── resetEmployeeForm ─────────────────────────────────────────
// Clears the form and exits edit mode, unlocking the EPF No
// field for the next new entry.
function resetEmployeeForm() {
  employeeEditId = null;

  document.getElementById('emp-epfno').value     = '';
  document.getElementById('emp-epfno').readOnly  = false;   // unlock for new entries
  document.getElementById('emp-name').value      = '';
  document.getElementById('emp-dept').value      = '';
  document.getElementById('emp-shiftcode').value = 'A';
  document.getElementById('emp-type').value      = 'HomeLiving';

  document.getElementById('emp-save-btn').textContent     = '➕ Add Employee';
  document.getElementById('emp-cancel-btn').style.display = 'none';
  document.getElementById('emp-status').textContent       = '';
}


// ════════════════════════════════════════════════════════════
//  23. MEAL SYSTEM — MEAL REQUEST
//  Firestore collection : meal_requests
//  Document ID          : auto
//
//  Fields per request document:
//    epfNo, name, dept, type, shiftCode,
//    actualShift   ('Day'|'Night'|'General' — resolved for forDate)
//    mealType      ('Breakfast'|'Lunch'|'Dinner'|'Tea1'|'Tea2')
//    forDate       (YYYY-MM-DD — the date this meal is served)
//    requestedAt   (ISO timestamp)
//    status        ('Pending'|'Issued'|'Missed')
//    issuedAt      (ISO timestamp, set when issued)
//
//  ── ELIGIBILITY RULES (the core logic of this step) ──────
//
//  HOME LIVING (request on entry, for THEIR shift TODAY only):
//    Day      → Lunch (today) + Tea1 + Tea2
//    Night    → Dinner (today) + Tea1 + Tea2
//    General  → Lunch (today) + Tea1 + Tea2
//
//  BOARDING (requests depend on shift + time of day):
//    Day shift, before 2:00 PM:
//       → Today's Lunch (entry) + Today's Dinner (deadline 2pm)
//         + Tomorrow's Breakfast (deadline 9pm) + Tea1 + Tea2
//    Day shift, after 2:00 PM but before 9:00 PM:
//       → Tomorrow's Breakfast only (Dinner window has closed)
//    Night shift (request at entry to shift, ~7pm):
//       → Tonight's Dinner (entry) + Tomorrow's Breakfast
//         + Tomorrow's Lunch (deadline 9pm) + Tea1 + Tea2
//
//  MAINTENANCE DEPT (any employee, boarding or home-living):
//    → Additional Breakfast option always available alongside
//      their normal entitlement (deadline 9pm prior day)
// ════════════════════════════════════════════════════════════

// Currently looked-up employee (set after scan/search)
let mrCurrentEmployee = null;

// html5-qrcode scanner instance — created/destroyed on toggle
let mrQrScanner = null;
let mrScannerActive = false;


// ── toggleQRScanner ──────────────────────────────────────────
// Starts or stops the camera-based QR scanner. Uses the
// html5-qrcode library which handles camera permissions and
// QR decoding. On successful scan, calls lookupEmployeeForRequest
// automatically and stops the camera to save battery/avoid
// duplicate scans.
async function toggleQRScanner() {
  const readerDiv = document.getElementById('mr-qr-reader');
  const btn       = document.getElementById('mr-scan-toggle-btn');

  if (mrScannerActive) {
    // ── Stop scanning ──────────────────────────────────────
    if (mrQrScanner) {
      await mrQrScanner.stop().catch(() => {});
      mrQrScanner.clear();
    }
    readerDiv.style.display = 'none';
    btn.textContent = '📷 Start Camera Scan';
    mrScannerActive = false;
    return;
  }

  // ── Start scanning ────────────────────────────────────────
  readerDiv.style.display = 'block';
  btn.textContent = '✕ Stop Camera';
  mrScannerActive = true;

  mrQrScanner = new Html5Qrcode('mr-qr-reader');

  try {
    await mrQrScanner.start(
      { facingMode: 'environment' },   // prefer rear camera on mobile
      { fps: 10, qrbox: 240 },
      (decodedText) => {
        // QR successfully decoded — look up employee, stop camera
        lookupEmployeeForRequest(decodedText.trim());
        toggleQRScanner();   // auto-stop after successful scan
      },
      () => { /* ignore per-frame scan failures — normal while aiming */ }
    );
  } catch (e) {
    toast('Camera error: ' + e.message + ' — use manual entry instead', true);
    readerDiv.style.display = 'none';
    btn.textContent = '📷 Start Camera Scan';
    mrScannerActive = false;
  }
}

// ── lookupEmployeeForRequest ──────────────────────────────────
// Looks up an employee by EPF No (from scan or manual entry),
// then renders their eligible meal options.
async function lookupEmployeeForRequest(epfNo) {
  epfNo = epfNo.trim();
  if (!epfNo) return;

  // Use cached employees if already loaded, else fetch fresh
  let emp = employees[epfNo];
  if (!emp) {
    try {
      const doc = await db.collection('employees').doc(epfNo).get();
      if (doc.exists) emp = doc.data();
    } catch (e) {
      console.error('lookupEmployeeForRequest:', e);
    }
  }

  if (!emp) {
    document.getElementById('mr-status').innerHTML =
      `<span style="color:#c0392b;">❌ No employee found for EPF No "${epfNo}"</span>`;
    document.getElementById('mr-employee-card').style.display = 'none';
    return;
  }

  mrCurrentEmployee = emp;
  document.getElementById('mr-manual-epf').value = '';
  document.getElementById('mr-status').textContent = '';

  await renderMealOptions();
}

// ── clearEmployeeLookup ───────────────────────────────────────
function clearEmployeeLookup() {
  mrCurrentEmployee = null;
  document.getElementById('mr-employee-card').style.display = 'none';
  document.getElementById('mr-manual-epf').value = '';
  document.getElementById('mr-manual-epf').focus();
}

// ── getMealEligibility ────────────────────────────────────────
// THE CORE ELIGIBILITY ENGINE.
// Given an employee and the current moment, returns an array
// of meal options they can currently request:
//   [{ mealType, forDate, label, deadlineNote }, ...]
//
// "now" is passed in (not read fresh) so the whole function
// is testable and consistent within a single render pass.
function getMealEligibility(emp, now) {
  const options = [];

  // Use shift-aware date instead of plain calendar date —
  // ensures Night shift early-morning requests still log
  // under the date the shift STARTED, not the next calendar day
  const todayStr     = getShiftDate(emp, now);
  const actualShift  = resolveActualShift(emp.shiftCode, now);

  // Tomorrow is still calculated from the actual calendar date
  // (tomorrow's breakfast/lunch genuinely means the next real day)
  const tomorrow    = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = dateKey(tomorrow);

  // Current hour as decimal (e.g. 14.5 = 2:30pm) for deadline checks
  const hourDecimal = now.getHours() + now.getMinutes() / 60;

  // ── Tea — both Tea 1 and Tea 2 offer a Milk/Plain choice ────
// Each slot shows two separate options so the employee can
// pick exactly one tea type per slot.
options.push({ mealType: 'Tea1_Milk',  forDate: todayStr, label: 'Tea 1 — Milk Tea'  });
options.push({ mealType: 'Tea1_Plain', forDate: todayStr, label: 'Tea 1 — Plain Tea' });
options.push({ mealType: 'Tea2_Milk',  forDate: todayStr, label: 'Tea 2 — Milk Tea'  });
options.push({ mealType: 'Tea2_Plain', forDate: todayStr, label: 'Tea 2 — Plain Tea' });

  // ── HOME LIVING RULES ──────────────────────────────────────
  if (emp.type === 'HomeLiving') {
    if (actualShift === 'Day' || actualShift === 'General') {
      options.push({ mealType: 'Lunch', forDate: todayStr, label: "Today's Lunch" });
    } else if (actualShift === 'Night') {
      options.push({ mealType: 'Dinner', forDate: todayStr, label: "Today's Dinner" });
    }
  }

  // ── BOARDING RULES ──────────────────────────────────────────
  if (emp.type === 'Boarding') {
    if (actualShift === 'Day' || actualShift === 'General') {
      // Day boarding: Lunch (entry) only requestable 6:00 AM – 11:00 AM
      if (hourDecimal >= 6 && hourDecimal < 11) {
        options.push({
          mealType: 'Lunch', forDate: todayStr,
          label: "Today's Lunch (entry)", deadlineNote: 'Deadline 11:00 AM today'
        });
      }

      // Today's Dinner — only requestable before 2:00 PM
      if (hourDecimal < 14) {
        options.push({
          mealType: 'Dinner', forDate: todayStr,
          label: "Today's Dinner", deadlineNote: 'Deadline 2:00 PM today'
        });
      }

      // Tomorrow's Breakfast — only requestable before 9:00 PM
      if (hourDecimal < 21) {
        options.push({
          mealType: 'Breakfast', forDate: tomorrowStr,
          label: "Tomorrow's Breakfast", deadlineNote: 'Deadline 9:00 PM today'
        });
      }
    } else if (actualShift === 'Night') {
      // Night boarding: Dinner on entry to shift
      options.push({ mealType: 'Dinner', forDate: todayStr, label: "Tonight's Dinner (entry)" });

      // Tomorrow's Breakfast + Lunch — only requestable before 9:00 PM
      if (hourDecimal < 21) {
        options.push({
          mealType: 'Breakfast', forDate: tomorrowStr,
          label: "Tomorrow's Breakfast", deadlineNote: 'Deadline 9:00 PM today'
        });
        options.push({
          mealType: 'Lunch', forDate: tomorrowStr,
          label: "Tomorrow's Lunch", deadlineNote: 'Deadline 9:00 PM today'
        });
      }
    }
  }

  // ── MAINTENANCE BONUS BREAKFAST ─────────────────────────────
  // Any maintenance employee (boarding or home-living) can
  // additionally request breakfast for early arrival, with the
  // same 9pm-prior-day deadline. Avoid duplicate if boarding
  // night-shift already added breakfast above.
  if (emp.dept === 'Maintenance' && hourDecimal < 21) {
    const alreadyHasBreakfast = options.some(
      o => o.mealType === 'Breakfast' && o.forDate === tomorrowStr
    );
    if (!alreadyHasBreakfast) {
      options.push({
        mealType: 'Breakfast', forDate: tomorrowStr,
        label: 'Tomorrow\'s Breakfast (Maintenance early arrival)',
        deadlineNote: 'Deadline 9:00 PM today'
      });
    }
  }

  return options;
}

// ── renderMealOptions ────────────────────────────────────────
// Renders the employee info card and their eligible meal
// buttons. Also fetches and shows any meals already requested
// for today/tomorrow so security doesn't duplicate-submit.
async function renderMealOptions() {
  const emp = mrCurrentEmployee;
  if (!emp) return;

  const now = new Date();

  // ── Show employee info ────────────────────────────────────
  document.getElementById('mr-employee-card').style.display = '';
  document.getElementById('mr-emp-name').textContent = `${emp.name}  (${emp.epfNo})`;

  const actualShift = resolveActualShift(emp.shiftCode, now);
  const typeBadge    = emp.type === 'Boarding' ? '🛏️ Boarding' : '🏠 Home Living';
  document.getElementById('mr-emp-meta').textContent =
    `${emp.dept}  •  Shift ${emp.shiftCode} (currently ${actualShift})  •  ${typeBadge}`;

  // ── Get eligible options ──────────────────────────────────
  const options = getMealEligibility(emp, now);

  // ── Fetch existing requests for today + tomorrow ──────────
  const todayStr    = dateKey(now);
  const tomorrow     = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr  = dateKey(tomorrow);

  const existingSnap = await db.collection('meal_requests')
    .where('epfNo', '==', emp.epfNo)
    .where('forDate', 'in', [todayStr, tomorrowStr])
    .get();

  const existing = {};   // key: "mealType_forDate" → status
  existingSnap.forEach(d => {
    const r = d.data();
    existing[`${r.mealType}_${r.forDate}`] = r.status;
  });
// ── Tea slot mutual exclusion ──────────────────────────────
// If Tea1_Milk is already requested, Tea1_Plain should also
// be considered "taken" for display purposes (and vice versa),
// since only one tea type is allowed per slot.
['Tea1', 'Tea2'].forEach(slot => {
  const milkKey  = `${slot}_Milk_${todayStr}`;
  const plainKey = `${slot}_Plain_${todayStr}`;
  if (existing[milkKey] && !existing[plainKey]) {
    existing[plainKey] = 'Skipped';   // mark sibling as unavailable
  }
  if (existing[plainKey] && !existing[milkKey]) {
    existing[milkKey] = 'Skipped';
  }
});


// ── Separate tea options from main meal options ─────────────
const teaOptions  = options.filter(o => o.mealType.startsWith('Tea'));
const mealOptions = options.filter(o => !o.mealType.startsWith('Tea'));


  // ── Render meal option buttons ─────────────────────────────
// ── Render main meal options (Breakfast/Lunch/Dinner) ───────
const optionsDiv = document.getElementById('mr-meal-options');
optionsDiv.innerHTML = mealOptions.map(opt => {
  const key         = `${opt.mealType}_${opt.forDate}`;
  const alreadyDone = existing[key];

  if (alreadyDone) {
    const statusColor = alreadyDone === 'Issued' ? '#1e8449'
                       : alreadyDone === 'Missed' ? '#c0392b' : '#854f0b';
    return `<div style="background:#f0f4f8;border:1px solid #d0d8e4;
                 border-radius:8px;padding:12px 14px;">
      <div style="font-weight:700;color:#5a6e84;">${opt.label}</div>
      <div style="font-size:.78rem;color:${statusColor};font-weight:700;margin-top:4px;">
        ${alreadyDone === 'Issued' ? '✔ Already Issued' :
          alreadyDone === 'Missed' ? '✕ Missed' : '⏳ Already Requested'}
      </div>
    </div>`;
  }

      return `<button onclick="submitMealRequest('${opt.mealType}','${opt.forDate}','${opt.label.replace(/'/g, "\\'")}')"
      style="background:#fff;border:2px solid #1a3a5c;border-radius:8px;
             padding:12px 14px;cursor:pointer;text-align:left;transition:.15s;"
      onmouseover="this.style.background='#eef3f9'"
      onmouseout="this.style.background='#fff'">
    <div style="font-weight:700;color:#1a3a5c;">${opt.label}</div>
    ${opt.deadlineNote
      ? `<div style="font-size:.72rem;color:#854f0b;margin-top:4px;">⏰ ${opt.deadlineNote}</div>`
      : ''}
  </button>`;
}).join('');


if (!mealOptions.length) {
  optionsDiv.innerHTML = `<div style="grid-column:1/-1;color:#888;font-style:italic;">
    No main meal options currently available.
  </div>`;


}
// ── Render tea options — grouped by slot, side-by-side ──────
const teaDiv = document.getElementById('mr-tea-options');
const slots  = ['Tea1', 'Tea2'];

teaDiv.innerHTML = slots.map(slot => {
  const slotLabel = slot === 'Tea1' ? 'Tea 1' : 'Tea 2';
  const milkOpt   = teaOptions.find(o => o.mealType === `${slot}_Milk`);
  const plainOpt  = teaOptions.find(o => o.mealType === `${slot}_Plain`);
  if (!milkOpt && !plainOpt) return '';

  // Small button renderer for one tea choice
  const teaBtn = (opt, type) => {
    if (!opt) return '';
    const key         = `${opt.mealType}_${opt.forDate}`;
    const alreadyDone = existing[key];

    if (alreadyDone) {
      const statusColor = alreadyDone === 'Issued'  ? '#1e8449'
                         : alreadyDone === 'Missed'  ? '#c0392b'
                         : alreadyDone === 'Skipped' ? '#aaa'
                         : '#854f0b';
      const statusLabel = alreadyDone === 'Issued'  ? '✔ Issued'
                         : alreadyDone === 'Missed'  ? '✕ Missed'
                         : alreadyDone === 'Skipped' ? '— Not chosen'
                         : '⏳ Requested';
      return `<div style="flex:1;background:#f0f4f8;border:1px solid #d0d8e4;
                   border-radius:6px;padding:8px 10px;text-align:center;">
        <div style="font-size:.78rem;font-weight:700;color:#5a6e84;">${type}</div>
        <div style="font-size:.7rem;color:${statusColor};font-weight:700;margin-top:2px;">
          ${statusLabel}
        </div>
      </div>`;
    }

    return `<button onclick="submitMealRequest('${opt.mealType}','${opt.forDate}','${slotLabel} — ${type}')"
        style="flex:1;background:#fff;border:2px solid #1a3a5c;border-radius:6px;
               padding:8px 10px;cursor:pointer;text-align:center;transition:.15s;"
        onmouseover="this.style.background='#eef3f9'"
        onmouseout="this.style.background='#fff'">
      <div style="font-size:.82rem;font-weight:700;color:#1a3a5c;">${type}</div>
    </button>`;
  };

  return `<div style="margin-bottom:10px;">
    <div style="font-size:.78rem;font-weight:700;color:#5a6e84;
                text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">
      ${slotLabel}
    </div>
    <div style="display:flex;gap:8px;">
      ${teaBtn(milkOpt,  '🍵 Milk Tea')}
      ${teaBtn(plainOpt, '🍃 Plain Tea')}
    </div>
  </div>`;
}).join('');
}

// ── submitMealRequest ────────────────────────────────────────
// Saves a new meal request document to Firestore for the
// currently looked-up employee, then refreshes the options
// view so the just-submitted meal shows as "Already Requested".
async function submitMealRequest(mealType, forDate, label) {
  const emp = mrCurrentEmployee;
  if (!emp) return;

  const now         = new Date();
  const actualShift = resolveActualShift(emp.shiftCode, now);

  try {
    await db.collection('meal_requests').add({
      epfNo:        emp.epfNo,
      name:         emp.name,
      dept:         emp.dept,
      type:         emp.type,
      shiftCode:    emp.shiftCode,
      actualShift,
      mealType,
      forDate,
      requestedAt:  new Date().toISOString(),
      status:       'Pending',
      issuedAt:     null
    });

    toast(`✔ ${label} requested for ${emp.name}`);
    await renderMealOptions();   // refresh to show updated status
  } catch (e) {
    toast('Request error: ' + e.message, true);
  }
  // Add at the end of submitMealRequest, after toast():
if (forDate === document.getElementById('mrl-date').value) {
  loadMealRequestLog();
}
}


// ════════════════════════════════════════════════════════════
//  24. MEAL SYSTEM — DAILY MEAL REQUEST LOG
//  Read-only view of all meal_requests for a selected date.
//  Reuses the same search + pagination pattern as Employee
//  Register for consistency.
// ════════════════════════════════════════════════════════════

let mealRequestLogCache = [];   // in-memory cache for current date
let mrl_currentPage     = 1;

// ── initMealRequestLog ───────────────────────────────────────
// Sets today's date and loads the log automatically.
function initMealRequestLog() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('mrl-date').value =
    `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  loadMealRequestLog();
}

// ── loadMealRequestLog ────────────────────────────────────────
// Fetches all meal_requests where forDate matches the selected
// date, caches them, then renders the filtered/paginated table.
async function loadMealRequestLog() {
  const date  = document.getElementById('mrl-date').value;
  if (!date) return;

  const tbody = document.getElementById('mrl-table-body');
  tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">⏳ Loading…</td></tr>';

  try {
    const snap = await db.collection('meal_requests')
      .where('forDate', '==', date)
      .orderBy('requestedAt', 'desc')
      .get();

    mealRequestLogCache = [];
    snap.forEach(d => mealRequestLogCache.push({ id: d.id, ...d.data() }));

    mrl_currentPage = 1;
    renderMealRequestLog();
  } catch (e) {
    console.error('loadMealRequestLog:', e);
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell" style="color:#c0392b;">
      Error: ${e.message}</td></tr>`;
  }
}

// ── mrlGoToPage ───────────────────────────────────────────────
function mrlGoToPage(page) {
  mrl_currentPage = page;
  renderMealRequestLog();
}

// ── renderMealRequestLog ──────────────────────────────────────
// Groups all requests by EPF No so each employee shows as ONE
// row per day, with all their requested meals listed together
// (each meal tagged with its own status).
function renderMealRequestLog() {
  const tbody        = document.getElementById('mrl-table-body');
  const searchTerm    = (document.getElementById('mrl-search')?.value || '').toLowerCase().trim();
  const statusFilter  = document.getElementById('mrl-status-filter')?.value || 'ALL';
  const pageSize      = 15;

  // Friendly meal type labels
  const mealLabels = {
    Breakfast:  '🍳 Breakfast',
    Lunch:      '🍛 Lunch',
    Dinner:     '🍽️ Dinner',
    Tea1_Milk:  '🍵 Tea1-Milk',
    Tea1_Plain: '🍃 Tea1-Plain',
    Tea2_Milk:  '🍵 Tea2-Milk',
    Tea2_Plain: '🍃 Tea2-Plain',
    Tea1:       'Tea1',   // legacy fallback for old test data
    Tea2:       'Tea2',
  };

  // ── Step 1: Group requests by EPF No ───────────────────────
  const grouped = {};   // { epfNo: { ...employee info, meals: [] } }
  mealRequestLogCache.forEach(r => {
    if (!grouped[r.epfNo]) {
      grouped[r.epfNo] = {
        epfNo: r.epfNo, name: r.name, dept: r.dept,
        type: r.type, actualShift: r.actualShift,
        meals: []
      };
    }
    grouped[r.epfNo].meals.push(r);
  });

  let list = Object.values(grouped);

  // ── Step 2: Apply search filter ────────────────────────────
  if (searchTerm) {
    list = list.filter(e =>
      e.name.toLowerCase().includes(searchTerm) ||
      e.epfNo.toLowerCase().includes(searchTerm)
    );
  }

  // ── Step 3: Apply status filter ────────────────────────────
  // Shows employee if AT LEAST ONE of their meals matches the filter
  if (statusFilter !== 'ALL') {
    list = list.filter(e => e.meals.some(m => m.status === statusFilter));
  }

  // Sort alphabetically by name
  list.sort((a, b) => a.name.localeCompare(b.name));

  const totalRows  = list.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (mrl_currentPage > totalPages) mrl_currentPage = totalPages;
  if (mrl_currentPage < 1)          mrl_currentPage = 1;

  const startIdx = (mrl_currentPage - 1) * pageSize;
  const pageList = list.slice(startIdx, startIdx + pageSize);

  if (!pageList.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No requests found.</td></tr>';
    document.getElementById('mrl-page-info').textContent = '0 results';
    return;
  }

  tbody.innerHTML = pageList.map(emp => {
    const typeBadge = emp.type === 'Boarding'
      ? `<span style="background:#fde8e8;color:#c0392b;padding:2px 8px;
           border-radius:4px;font-size:.7rem;font-weight:700;">Boarding</span>`
      : `<span style="background:#e8f0f8;color:#1a3a5c;padding:2px 8px;
           border-radius:4px;font-size:.7rem;font-weight:700;">Home Living</span>`;

    const shiftBadge = emp.actualShift === 'Night'
      ? `<span class="badge-night">Night</span>`
      : `<span class="badge-day">${emp.actualShift}</span>`;

    // ── Build the combined meals cell — each meal as a small tag
    // with its own status colour, all on one line, wrapping if needed
    const mealsCell = emp.meals.map(m => {
      const label = mealLabels[m.mealType] || m.mealType;
      const color = m.status === 'Issued' ? '#1e8449'
                  : m.status === 'Missed' ? '#c0392b' : '#854f0b';
      const icon  = m.status === 'Issued' ? '✔' : m.status === 'Missed' ? '✕' : '⏳';

      return `<span style="display:inline-block;background:#f0f4f8;
                   border:1px solid #d0d8e4;border-radius:5px;
                   padding:3px 8px;margin:2px 3px 2px 0;font-size:.74rem;
                   white-space:nowrap;">
        ${label}
        <span style="color:${color};font-weight:700;margin-left:3px;">${icon}</span>
      </span>`;
    }).join('');

    return `<tr>
      <td class="left" style="padding:6px 10px;font-weight:700;vertical-align:top;">${emp.epfNo}</td>
      <td class="left" style="padding:6px 10px;vertical-align:top;">${emp.name}</td>
      <td style="padding:6px 10px;text-align:center;vertical-align:top;">${emp.dept}</td>
      <td style="padding:6px 10px;text-align:center;vertical-align:top;">${typeBadge}</td>
      <td style="padding:6px 10px;text-align:center;vertical-align:top;">${shiftBadge}</td>
      <td style="padding:6px 10px;vertical-align:top;">${mealsCell}</td>
    </tr>`;
  }).join('');

  const showingFrom = startIdx + 1;
  const showingTo   = Math.min(startIdx + pageSize, totalRows);
  document.getElementById('mrl-page-info').textContent =
    `Showing ${showingFrom}–${showingTo} of ${totalRows} employees  •  Page ${mrl_currentPage} of ${totalPages}`;
}


// ════════════════════════════════════════════════════════════
//  25. MEAL SYSTEM — MEAL ISSUE
//  Same scan/search flow as Meal Request, but instead of
//  showing ELIGIBLE meals to request, this shows only the
//  meal/tea whose TIME SLOT is currently active right now,
//  filtered to requests with status = 'Pending'.
//
//  Time slots (server/local time based):
//    Breakfast  : 07:00 – 09:00
//    Lunch      : 12:30 – 15:00
//    Dinner     : 20:00 – 22:00
//    Day Tea1   : 10:00 – 11:00
//    Day Tea2   : 15:00 – 16:00
//    Night Tea1 : 00:00 – 01:00
//    Night Tea2 : 04:00 – 05:00
//
//  A meal is "issuable" only if:
//    1. Its mealType matches what's active RIGHT NOW
//    2. forDate matches the date that slot is serving
//       (today for same-day slots, or the relevant date
//        for overnight slots like Night Tea1/Tea2)
//    3. status === 'Pending' (not already issued/missed)
//
//  NOTE: A "TESTING MODE" block is currently active below,
//  showing ALL pending requests regardless of time slot.
//  The production time-slot-restricted logic is preserved at
//  the bottom of this section, commented out, ready to swap
//  back in when testing is complete.
// ════════════════════════════════════════════════════════════

let miCurrentEmployee = null;
let miQrScanner        = null;
let miScannerActive     = false;


// ── getActiveSlots ────────────────────────────────────────────
// Now requires the employee being checked, since the correct
// "today" depends on their shift (Night shift's early-morning
// hours belong to yesterday's shift date).
function getActiveSlots(now, emp) {
  const h         = now.getHours() + now.getMinutes() / 60;
  const today     = emp ? getShiftDate(emp, now) : dateKey(now);
  const slots     = [];

  // ── Breakfast 07:00–09:00 ───────────────────────────────
  if (h >= 7 && h < 9) {
    slots.push({ mealType: 'Breakfast', forDate: today, label: '🍳 Breakfast' });
  }
  // ── Lunch 12:30–15:00 ────────────────────────────────────
  if (h >= 12.5 && h < 15) {
    slots.push({ mealType: 'Lunch', forDate: today, label: '🍛 Lunch' });
  }
  // ── Dinner 20:00–22:00 ───────────────────────────────────
  if (h >= 20 && h < 22) {
    slots.push({ mealType: 'Dinner', forDate: today, label: '🍽️ Dinner' });
  }
  // ── Day Tea 1: 10:00–11:00 ───────────────────────────────
  if (h >= 10 && h < 11) {
    slots.push({ mealType: 'Tea1_Milk',  forDate: today, label: '🍵 Tea 1 — Milk Tea'  });
    slots.push({ mealType: 'Tea1_Plain', forDate: today, label: '🍃 Tea 1 — Plain Tea' });
  }
  // ── Day Tea 2: 15:00–16:00 ───────────────────────────────
  if (h >= 15 && h < 16) {
    slots.push({ mealType: 'Tea2_Milk',  forDate: today, label: '🍵 Tea 2 — Milk Tea'  });
    slots.push({ mealType: 'Tea2_Plain', forDate: today, label: '🍃 Tea 2 — Plain Tea' });
  }
  // ── Night Tea 1: 00:00–01:00 — belongs to PREVIOUS shift date
  if (h >= 0 && h < 1) {
    slots.push({ mealType: 'Tea1_Milk',  forDate: today, label: '🍵 Night Tea 1 — Milk Tea'  });
    slots.push({ mealType: 'Tea1_Plain', forDate: today, label: '🍃 Night Tea 1 — Plain Tea' });
  }
  // ── Night Tea 2: 04:00–05:00 — belongs to PREVIOUS shift date
  if (h >= 4 && h < 5) {
    slots.push({ mealType: 'Tea2_Milk',  forDate: today, label: '🍵 Night Tea 2 — Milk Tea'  });
    slots.push({ mealType: 'Tea2_Plain', forDate: today, label: '🍃 Night Tea 2 — Plain Tea' });
  }

  return slots;
}

// ── updateActiveSlotBanner ────────────────────────────────────
// Shows a banner telling security which slot(s) are currently
// open for issuing, or a message if nothing is active right now.
function updateActiveSlotBanner() {
  const now    = new Date();
  const active = getActiveSlots(now);
  const banner = document.getElementById('mi-active-slot-banner');

  if (!active.length) {
    banner.textContent = '⏸ No meal/tea slot is currently active. Issue button will activate during serving hours.';
    banner.style.background = '#f0f4f8';
    banner.style.borderColor = '#d0d8e4';
    banner.style.color = '#5a6e84';
    return;
  }

  const labels = [...new Set(active.map(s => s.label.replace(/^[^\s]+\s/, '')))].join(', ');
  banner.textContent = `🟢 Currently serving: ${labels}`;
  banner.style.background = '#f0faf0';
  banner.style.borderColor = '#1e8449';
  banner.style.color = '#1e8449';
}

// Refresh the banner every 30 seconds so it stays accurate
// without requiring a page reload during a shift.
setInterval(updateActiveSlotBanner, 30000);


// ── toggleIssueQRScanner ───────────────────────────────────────
// Identical pattern to toggleQRScanner from Step 2, using a
// separate scanner instance so Request and Issue tabs don't
// conflict if both happen to be open.
async function toggleIssueQRScanner() {
  const readerDiv = document.getElementById('mi-qr-reader');
  const btn       = document.getElementById('mi-scan-toggle-btn');

  if (miScannerActive) {
    if (miQrScanner) {
      await miQrScanner.stop().catch(() => {});
      miQrScanner.clear();
    }
    readerDiv.style.display = 'none';
    btn.textContent = '📷 Start Camera Scan';
    miScannerActive = false;
    return;
  }

  readerDiv.style.display = 'block';
  btn.textContent = '✕ Stop Camera';
  miScannerActive = true;

  miQrScanner = new Html5Qrcode('mi-qr-reader');

  try {
    await miQrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 240 },
      (decodedText) => {
        lookupEmployeeForIssue(decodedText.trim());
        toggleIssueQRScanner();
      },
      () => { /* ignore per-frame failures */ }
    );
  } catch (e) {
    toast('Camera error: ' + e.message + ' — use manual entry instead', true);
    readerDiv.style.display = 'none';
    btn.textContent = '📷 Start Camera Scan';
    miScannerActive = false;
  }
}

// ── lookupEmployeeForIssue ────────────────────────────────────
// Looks up the employee, then renders only the meals that are
// BOTH currently active (time-slot wise) AND still Pending for
// this employee.
async function lookupEmployeeForIssue(epfNo) {
  epfNo = epfNo.trim();
  if (!epfNo) return;

  let emp = employees[epfNo];
  if (!emp) {
    try {
      const doc = await db.collection('employees').doc(epfNo).get();
      if (doc.exists) emp = doc.data();
    } catch (e) {
      console.error('lookupEmployeeForIssue:', e);
    }
  }

  if (!emp) {
    document.getElementById('mi-status').innerHTML =
      `<span style="color:#c0392b;">❌ No employee found for EPF No "${epfNo}"</span>`;
    document.getElementById('mi-employee-card').style.display = 'none';
    return;
  }

  miCurrentEmployee = emp;
  document.getElementById('mi-manual-epf').value = '';
  document.getElementById('mi-status').textContent = '';

  await renderIssueOptions();
}

// ── clearIssueLookup ───────────────────────────────────────────
function clearIssueLookup() {
  miCurrentEmployee = null;
  document.getElementById('mi-employee-card').style.display = 'none';
  document.getElementById('mi-manual-epf').value = '';
  document.getElementById('mi-manual-epf').focus();
}

 // ── renderIssueOptions ─────────────────────────────────────────
// TESTING MODE: shows ALL Pending requests for the employee,
// regardless of current time slot. Time-slot filtering logic
// is commented out below — restore it by uncommenting and
// removing the testing block when ready for production.
async function renderIssueOptions() {
  const emp = miCurrentEmployee;
  if (!emp) return;

  const now = new Date();
  document.getElementById('mi-employee-card').style.display = '';
  document.getElementById('mi-emp-name').textContent = `${emp.name}  (${emp.epfNo})`;

  const actualShift = resolveActualShift(emp.shiftCode, now);
  const typeBadge    = emp.type === 'Boarding' ? '🛏️ Boarding' : '🏠 Home Living';
  document.getElementById('mi-emp-meta').textContent =
    `${emp.dept}  •  Shift ${emp.shiftCode} (currently ${actualShift})  •  ${typeBadge}`;

  // Friendly meal labels for display
  const mealLabels = {
    Breakfast:  '🍳 Breakfast',
    Lunch:      '🍛 Lunch',
    Dinner:     '🍽️ Dinner',
    Tea1_Milk:  '🍵 Tea 1 — Milk Tea',
    Tea1_Plain: '🍃 Tea 1 — Plain Tea',
    Tea2_Milk:  '🍵 Tea 2 — Milk Tea',
    Tea2_Plain: '🍃 Tea 2 — Plain Tea',
  };

  // ═══════════════════════════════════════════════════════════
  // 🧪 TESTING MODE — shows ALL pending requests, no time check
  // ═══════════════════════════════════════════════════════════
  let pendingSnap;
  try {
    pendingSnap = await db.collection('meal_requests')
      .where('epfNo', '==', emp.epfNo)
      .where('status', '==', 'Pending')
      .get();
  } catch (e) {
    toast('Error fetching requests: ' + e.message, true);
    return;
  }

  const optionsDiv = document.getElementById('mi-issue-options');

  if (pendingSnap.empty) {
    optionsDiv.innerHTML = `<div style="grid-column:1/-1;color:#888;font-style:italic;">
      No pending requests for this employee.
    </div>`;
    return;
  }

  optionsDiv.innerHTML = pendingSnap.docs.map(doc => {
    const r     = doc.data();
    const label = `${mealLabels[r.mealType] || r.mealType} (${r.forDate})`;

    return `<button onclick="issueMeal('${doc.id}','${label.replace(/'/g, "\\'")}')"
        style="background:#fff;border:2px solid #1e8449;border-radius:8px;
               padding:14px;cursor:pointer;text-align:center;transition:.15s;"
        onmouseover="this.style.background='#f0faf0'"
        onmouseout="this.style.background='#fff'">
      <div style="font-weight:700;color:#1e8449;font-size:.95rem;">
        ${mealLabels[r.mealType] || r.mealType}
      </div>
      <div style="font-size:.72rem;color:#888;margin-top:4px;">For: ${r.forDate}</div>
      <div style="font-size:.72rem;color:#888;margin-top:2px;">Tap to Issue</div>
    </button>`;
  }).join('');
}


// ── issueMeal ──────────────────────────────────────────────────
// Marks a meal_requests document as Issued with a timestamp,
// then refreshes the issue options view.
async function issueMeal(docId, label) {
  try {
    await db.collection('meal_requests').doc(docId).update({
      status:   'Issued',
      issuedAt: new Date().toISOString()
    });

    toast(`✔ ${label} issued to ${miCurrentEmployee.name}`);
    await renderIssueOptions();

    // Refresh the daily log if it's showing today's date
    const today = dateKey(new Date());
    if (document.getElementById('mrl-date')?.value === today) {
      loadMealRequestLog();
    }
  } catch (e) {
    toast('Issue error: ' + e.message, true);
  }
}

  /* ═══════════════════════════════════════════════════════════
     🔒 PRODUCTION LOGIC (commented out during testing)
     Uncomment this block and delete the TESTING MODE block
     above when ready to enforce time-slot restrictions.
  ═══════════════════════════════════════════════════════════

  // ── Get currently active slots ─────────────────────────────
  const activeSlots = getActiveSlots(now, emp);

  if (!activeSlots.length) {
    document.getElementById('mi-issue-options').innerHTML =
      `<div style="grid-column:1/-1;color:#888;font-style:italic;">
        No meal/tea slot is active right now.
      </div>`;
    return;
  }

  // ── Fetch this employee's Pending requests for relevant dates
  const relevantDates = [...new Set(activeSlots.map(s => s.forDate))];
  const pendingSnap2 = await db.collection('meal_requests')
    .where('epfNo', '==', emp.epfNo)
    .where('status', '==', 'Pending')
    .where('forDate', 'in', relevantDates)
    .get();

  const pendingMap = {};
  pendingSnap2.forEach(d => {
    const r = d.data();
    pendingMap[`${r.mealType}_${r.forDate}`] = d.id;
  });

  const issuable = activeSlots.filter(s =>
    pendingMap[`${s.mealType}_${s.forDate}`]
  );

  const optionsDiv2 = document.getElementById('mi-issue-options');

  if (!issuable.length) {
    optionsDiv2.innerHTML = `<div style="grid-column:1/-1;color:#888;font-style:italic;">
      No pending request for this employee in the currently active slot(s).
    </div>`;
    return;
  }

  optionsDiv2.innerHTML = issuable.map(slot => {
    const docId = pendingMap[`${slot.mealType}_${slot.forDate}`];
    return `<button onclick="issueMeal('${docId}','${slot.label.replace(/'/g, "\\'")}')"
        style="background:#fff;border:2px solid #1e8449;border-radius:8px;
               padding:14px;cursor:pointer;text-align:center;transition:.15s;">
      <div style="font-weight:700;color:#1e8449;font-size:.95rem;">${slot.label}</div>
      <div style="font-size:.72rem;color:#888;margin-top:4px;">Tap to Issue</div>
    </button>`;
  }).join('');
}
  ═══════════════════════════════════════════════════════════ */