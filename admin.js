// ==================== RND BACKUP SYSTEM v3.0 ====================
// ✅ Backup login ke BAAD start hota hai (rules ke saath permission-denied fix)
// ✅ Backup = exact mirror, DELETE kabhi backup se nahi hota (set() ki jagah update())
// ✅ Per-user restore: sirf UID daalo -> users + deposits + withdrawals + transactions + referrals + bumper offer + usernames + referralCodes sab wapas
// ✅ Restore sirf MISSING records likhta hai (live balances/records overwrite nahi hote), sirf user profile overwrite (confirm ke baad)
// ✅ Restore Full Database = sirf missing data wapas (purane backup se live data roll-back nahi hoga)
// ✅ Rules-denied paths skip hote hain, error nahi

// ==================== FIREBASE CONFIG ====================
const MAIN_CONFIG = {
    apiKey: "AIzaSyAz-TLmOhiy-_vHHmIjW8gyIOqTR_PT9o0",
    authDomain: "rnd2-70080.firebaseapp.com",
    databaseURL: "https://rnd2-70080-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "rnd2-70080",
    storageBucket: "rnd2-70080.firebasestorage.app",
    messagingSenderId: "468625887938",
    appId: "1:468625887938:web:5cb4ddbcf31b6fc0a4615b"
};
const BACKUP_CONFIG = {
    databaseURL: "https://myapp-ee226-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Rules me jo admin email hai (rules ke hisaab se admin-only paths isi se access hote hain)
const MAIN_ADMIN_EMAIL = 'admin@rndstaking.com';
const BUMPER = 'bumper_referral_offer_2026';

// Jo paths backup hote hain
const SYNC_PATHS = [
    'users', 'deposits', 'depositHistory', 'withdrawals', 'usedTransactions',
    'processingTransactions', 'settings', 'usernames', 'transactions', 'transfers',
    'referrals', 'referralCodes', 'notifications', 'transferRequests', 'direct_offer',
    'rankRewards',
    BUMPER + '/withdrawals', BUMPER + '/user_withdrawals', BUMPER + '/rewards',
    BUMPER + '/transactions', BUMPER + '/user_claims', BUMPER + '/purchases'
];
// Per-user restore: in paths me key = uid
const UID_KEYED = ['rankRewards', BUMPER + '/rewards', BUMPER + '/user_withdrawals', BUMPER + '/user_claims'];
// Per-user restore: in paths me value = uid (username -> uid, code -> uid)
const VALUE_IS_UID = ['usernames', 'referralCodes'];
// Per-user restore: in collections me record ka owner field uid ke barabar ho
const SCAN_PATHS = [
    'deposits', 'depositHistory', 'withdrawals', 'transactions', 'transfers', 'referrals',
    'notifications', 'transferRequests', 'usedTransactions', 'processingTransactions',
    BUMPER + '/withdrawals', BUMPER + '/transactions'
];
const OWNER_FIELDS = ['userId', 'uid', 'userUid', 'senderUid', 'receiverUid', 'fromUid', 'toUid', 'buyerUid'];

const SETUP_KEY = '1'; // ⚠️ isse lamba random secret bana lein (?setup=<key>)

// ==================== GLOBAL ====================
let mainApp, backupApp, mainDB, backupDB, auth;
let currentAdmin = null;
let pendingAction = null;
let backupStarted = false;
let backupListeners = [];
let isLoggingIn = false;
let cache = {};          // path -> {key: JSON} (duplicate writes rokne ke liye)
let skippedPaths = [];   // rules ki wajah se read nahi hue

// ==================== HELPERS ====================
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isDenied = e => e && (e.code === 'PERMISSION_DENIED' || /permission_denied/i.test(e.message || ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function retryOperation(op, maxRetries = 3, delay = 1000) {
    let last;
    for (let i = 1; i <= maxRetries; i++) {
        try { return await op(); } catch (e) {
            last = e;
            if (isDenied(e)) throw e; // retry se fayda nahi
            if (i < maxRetries) await sleep(delay * i);
        }
    }
    throw last;
}

function cleanMeta(d) {
    if (d && typeof d === 'object') { delete d._backupTime; delete d.backupUpdatedAt; }
    return d;
}

async function isMainAdmin() {
    const u = auth.currentUser;
    if (!u) return false;
    if (u.email === MAIN_ADMIN_EMAIL) return true;
    try { return (await mainDB.ref('users/' + u.uid + '/role').once('value')).val() === 'admin'; } catch (e) { return false; }
}

// Sirf keys (data download nahi) - REST shallow
async function shallowKeys(db, path, authed) {
    let url = `${db.app.options.databaseURL}/${path}.json?shallow=true`;
    if (authed) url += `&auth=${await auth.currentUser.getIdToken()}`;
    const r = await fetch(url);
    if (r.status === 401 || r.status === 403) return null; // denied
    if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + path + ')');
    const j = await r.json();
    if (j === null) return [];
    return typeof j === 'object' ? Object.keys(j) : ['(value)'];
}

async function saveBackupLog(uid, path, action, status, details) {
    try {
        await backupDB.ref('backupLogs').push({
            uid: uid || 'system', path: path || 'all', action: action || 'backup',
            status: status || 'success', details: details || '',
            timestamp: firebase.database.ServerValue.TIMESTAMP, date: new Date().toISOString()
        });
    } catch (e) { console.error('Log save failed:', e); }
}

// ==================== LISTENERS ====================
function cleanupBackupListeners() {
    backupListeners.forEach(i => { try { i.ref.off(i.event, i.callback); } catch (e) { } });
    backupListeners = [];
    backupStarted = false;
    cache = {};
}

function attachListeners(path) {
    const ref = mainDB.ref(path);
    const handler = action => async snap => {
        try {
            const k = snap.key, val = snap.val();
            if (val === null) return;
            const j = JSON.stringify(val);
            if (cache[path] && cache[path][k] === j) return; // koi change nahi
            await retryOperation(() => backupDB.ref(path + '/' + k).set(val));
            (cache[path] = cache[path] || {})[k] = j;
        } catch (e) {
            console.error('❌ Auto backup failed:', path, e);
            saveBackupLog(snap.key, path, action, 'failed', e.message);
        }
    };
    const onErr = e => console.error('Listener cancelled:', path, e.message);
    const add = handler('auto_backup_add'), chg = handler('auto_backup_update');
    ref.on('child_added', add, onErr);
    ref.on('child_changed', chg, onErr);
    backupListeners.push({ ref, event: 'child_added', callback: add }, { ref, event: 'child_changed', callback: chg });
    // child_removed ko JAAN-BUJH kar listen nahi kiya: DELETE backup me nahi jayega
}

// ==================== SYNC (main -> backup, sirf naya/badla hua) ====================
async function syncPath(path) {
    try {
        const data = (await mainDB.ref(path).once('value')).val();
        if (data === null) return { path, status: 'empty', written: 0 };
        if (typeof data !== 'object') {
            await backupDB.ref(path).set(data);
            return { path, status: 'ok', written: 1 };
        }
        const bdata = (await backupDB.ref(path).once('value')).val() || {};
        const changed = Object.keys(data).filter(k => JSON.stringify(data[k]) !== JSON.stringify(bdata[k]));
        for (let i = 0; i < changed.length; i += 100) {
            const chunk = {};
            changed.slice(i, i + 100).forEach(k => { chunk[k] = data[k]; });
            await retryOperation(() => backupDB.ref(path).update(chunk)); // update = koi purani key delete nahi hoti
        }
        cache[path] = {};
        Object.keys(data).forEach(k => { cache[path][k] = JSON.stringify(data[k]); });
        return { path, status: 'ok', written: changed.length };
    } catch (e) {
        if (isDenied(e)) return { path, status: 'denied' };
        console.error('Sync failed:', path, e);
        return { path, status: 'failed', error: e.message };
    }
}

async function syncAll(onProgress) {
    const results = [];
    for (let i = 0; i < SYNC_PATHS.length; i++) {
        if (onProgress) onProgress(SYNC_PATHS[i], i, SYNC_PATHS.length);
        results.push(await syncPath(SYNC_PATHS[i]));
    }
    skippedPaths = results.filter(r => r.status === 'denied').map(r => r.path);
    return results;
}

async function startBackupEngine() {
    if (backupStarted) return;
    backupStarted = true;
    try {
        if (!(await isMainAdmin())) {
            showNotification('⚠️ ' + MAIN_ADMIN_EMAIL + ' se login nahi hai - admin-only data ka backup/restore nahi hoga', 'warning', 9000);
        }
        const results = await syncAll();
        const written = results.reduce((a, r) => a + (r.written || 0), 0);
        const failed = results.filter(r => r.status === 'failed').length;
        results.filter(r => r.status === 'ok' || r.status === 'empty').forEach(r => attachListeners(r.path));
        addLog('Auto Sync', failed ? 'warning' : 'success',
            `${written} records synced, ${skippedPaths.length} paths denied by rules, ${failed} failed`);
        console.log('🚫 Skipped (rules):', skippedPaths);
        checkStatus(true);
    } catch (e) {
        console.error('Backup engine error:', e);
        addLog('Auto Sync', 'failed', e.message);
        backupStarted = false;
    }
}

// ==================== AUTH / INIT ====================
function initFirebase() {
    try { mainApp = firebase.app('mainApp'); } catch (e) { mainApp = firebase.initializeApp(MAIN_CONFIG, 'mainApp'); }
    try { backupApp = firebase.app('backupApp'); } catch (e) { backupApp = firebase.initializeApp(BACKUP_CONFIG, 'backupApp'); }
    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    auth = firebase.auth(mainApp);

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => console.error('Persistence error:', e));
    checkSetupMode();

    auth.onAuthStateChanged(async (user) => {
        if (isLoggingIn) return;
        if (user) {
            await handleAuthStateLogin(user);
        } else {
            localStorage.removeItem('adminSession');
            currentAdmin = null;
            cleanupBackupListeners();
            showLoginPage();
        }
    });
}

async function handleAuthStateLogin(user) {
    try {
        const snap = await backupDB.ref('admins/' + user.uid).once('value');
        if (!snap.exists()) {
            await auth.signOut();
            localStorage.removeItem('adminSession');
            currentAdmin = null;
            showLoginPage();
            return;
        }
        currentAdmin = { uid: user.uid, email: user.email, isAdmin: true };
        localStorage.setItem('adminSession', JSON.stringify(currentAdmin));
        showDashboardPage(user);
    } catch (e) {
        console.error('Auth state login error:', e);
        showLoginPage();
    }
}

function showLoginPage() {
    const lp = document.getElementById('loginPage'), dp = document.getElementById('dashboardPage');
    if (lp) lp.style.display = 'block';
    if (dp) dp.style.display = 'none';
    const b = document.getElementById('loginBtn');
    if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login'; }
    checkSetupMode();
}

function showDashboardPage(user) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('dashboardPage').style.display = 'block';
    document.getElementById('adminEmail').textContent = user.email;
    document.getElementById('adminAvatar').textContent = user.email.charAt(0).toUpperCase();
    loadDashboard();
    startBackupEngine(); // ✅ login ke BAAD
}

function checkSetupMode() {
    const on = new URLSearchParams(window.location.search).get('setup') === SETUP_KEY;
    const s = document.getElementById('signupForm'), l = document.getElementById('loginForm');
    if (s && l) { s.style.display = on ? 'block' : 'none'; l.style.display = on ? 'none' : 'block'; }
}

// ==================== RESTORE ONE USER (UID se) ====================
async function restoreUserWithSafety(uid) {
    const container = document.getElementById('restoreResult');
    const spin = msg => container.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-sm"></div><p style="margin-top:8px;color:#94a3b8;">' + esc(msg) + '</p></div>';
    const alertBox = (cls, icon, html) => container.innerHTML = `<div class="alert alert-${cls}"><i class="fas fa-${icon}"></i><div>${html}</div></div>`;

    try {
        if (!(await isMainAdmin())) {
            alertBox('danger', 'circle-exclamation', 'Restore ke liye <b>' + MAIN_ADMIN_EMAIL + '</b> (main admin) se login karein - rules ke hisaab se admin-only data tabhi likha ja sakta hai.');
            return;
        }
        spin('Backup me user dhoondh rahe hain...');
        const bu = await backupDB.ref('users/' + uid).once('value');
        if (!bu.exists()) { alertBox('danger', 'circle-exclamation', 'User ' + esc(uid) + ' backup me nahi mila!'); return; }
        const userExists = (await mainDB.ref('users/' + uid).once('value')).exists();

        // ---- plan banao: fullPath -> data ----
        const plan = {};
        const profileKey = 'users/' + uid;
        plan[profileKey] = cleanMeta(bu.val());

        spin('Is user ka baaki data backup se collect ho raha hai...');
        for (const p of UID_KEYED) {
            const s = await backupDB.ref(p + '/' + uid).once('value');
            if (s.exists()) plan[p + '/' + uid] = cleanMeta(s.val());
        }
        for (const p of VALUE_IS_UID) {
            const val = (await backupDB.ref(p).once('value')).val() || {};
            Object.keys(val).forEach(k => { if (val[k] === uid) plan[p + '/' + k] = val[k]; });
        }
        for (const p of SCAN_PATHS) {
            const val = (await backupDB.ref(p).once('value')).val() || {};
            Object.keys(val).forEach(k => {
                const v = val[k];
                const owner = k === uid || k.startsWith(uid + '_') ||
                    (v && typeof v === 'object' && OWNER_FIELDS.some(f => v[f] === uid));
                if (owner) plan[p + '/' + k] = cleanMeta(v);
            });
        }

        // ---- main me jo pehle se maujood hai wo skip (profile ko chhod kar) ----
        const keys = Object.keys(plan).filter(k => k !== profileKey);
        const exist = await Promise.all(keys.map(k => mainDB.ref(k).once('value').then(s => s.exists())));
        const skipped = [];
        keys.forEach((k, i) => { if (exist[i]) { skipped.push(k); delete plan[k]; } });
        if (userExists && !confirm(`⚠️ User ${uid} main Firebase me pehle se hai.\nProfile (users/${uid}) backup se OVERWRITE hogi.\nBaaki records jo main me hain wo nahi badlenge.\n\nContinue?`)) {
            alertBox('warning', 'ban', 'Restore cancel kiya.');
            return;
        }

        const writeKeys = Object.keys(plan);
        const summary = {};
        writeKeys.forEach(k => { const top = k.split('/').slice(0, k.startsWith(BUMPER) ? 2 : 1).join('/'); summary[top] = (summary[top] || 0) + 1; });
        const lines = Object.entries(summary).map(([k, n]) => `${k}: ${n}`).join(' | ');
        spin('Restore ho raha hai (' + writeKeys.length + ' records)...');

        // ---- ek atomic update, fail ho to ek-ek karke ----
        let restored = 0; const failedKeys = [];
        try {
            await mainDB.ref().update(plan);
            restored = writeKeys.length;
        } catch (e) {
            for (const k of writeKeys) {
                try { await mainDB.ref(k).set(plan[k]); restored++; } catch (e2) { failedKeys.push(k + ' (' + (isDenied(e2) ? 'rules denied' : e2.message) + ')'); }
            }
        }

        alertBox(failedKeys.length ? 'warning' : 'success', failedKeys.length ? 'triangle-exclamation' : 'check-circle',
            `<strong>User ${esc(uid)} restore: ${restored}/${writeKeys.length} records</strong><br><small>${esc(lines)}</small>` +
            (skipped.length ? `<br><small>Pehle se main me the (skip): ${skipped.length}</small>` : '') +
            (userExists ? '<br><span style="color:#f59e0b;">⚠️ Profile overwrite hui</span>' : '') +
            (failedKeys.length ? '<br><small style="color:#fca5a5;">Failed: ' + failedKeys.map(esc).join(', ') + '</small>' : '') +
            '<br><small style="color:#94a3b8;">Note: Firebase Auth login account yahan se restore nahi hota.</small>');

        showNotification(`User ${uid} restored (${restored})`, failedKeys.length ? 'warning' : 'success');
        addLog('Restore User', failedKeys.length ? 'warning' : 'success', `UID: ${uid} (${restored}/${writeKeys.length})`);
        await saveBackupLog(uid, 'all', 'restore_user', failedKeys.length ? 'warning' : 'success', `${restored}/${writeKeys.length}, existed: ${userExists}`);
        document.getElementById('restoreUid').value = '';
        checkStatus(true);
    } catch (e) {
        alertBox('danger', 'circle-exclamation', 'Error: ' + esc(e.message));
        addLog('Restore User', 'failed', `UID: ${uid} - ${e.message}`);
        await saveBackupLog(uid, 'all', 'restore_user', 'failed', e.message);
    }
}

function confirmRestoreUser() {
    const uid = document.getElementById('restoreUid').value.trim();
    if (!uid) { showNotification('Please enter a UID', 'warning'); return; }
    if (/[.#$\[\]\/]/.test(uid)) { showNotification('Invalid UID', 'error'); return; }
    restoreUserWithSafety(uid);
}

// ==================== SIGNUP (sirf ?setup=KEY se) ====================
async function handleSignup() {
    const errorEl = document.getElementById('loginError'), successEl = document.getElementById('loginSuccess');
    if (new URLSearchParams(window.location.search).get('setup') !== SETUP_KEY) {
        errorEl.textContent = '⛔ Signup disabled. Contact administrator.'; errorEl.classList.add('show'); return;
    }
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value.trim();
    const btn = document.getElementById('signupBtn');
    const fail = m => { errorEl.textContent = m; errorEl.classList.add('show'); };
    if (!name) return fail('❌ Please enter your full name');
    if (!email) return fail('❌ Please enter your email');
    if (!password || password.length < 6) return fail('❌ Password must be at least 6 characters');

    isLoggingIn = true;
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Creating...';
    errorEl.classList.remove('show'); successEl.classList.remove('show');
    try {
        const user = (await auth.createUserWithEmailAndPassword(email, password)).user;
        await backupDB.ref('admins/' + user.uid).set({ name, email, role: 'admin', createdAt: new Date().toISOString() });
        successEl.textContent = '✅ Admin account created! Please login.'; successEl.classList.add('show');
        await auth.signOut();
        setTimeout(() => {
            isLoggingIn = false;
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Admin Account';
            document.getElementById('signupForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('loginEmail').value = email;
            successEl.classList.remove('show');
            showNotification('Admin created! Please login.', 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 2000);
    } catch (err) {
        isLoggingIn = false;
        const map = { 'auth/email-already-in-use': '❌ Email already registered. Please login.', 'auth/weak-password': '❌ Password too weak.', 'auth/invalid-email': '❌ Invalid email format.' };
        fail(map[err.code] || '❌ Signup failed. Please try again.');
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Admin Account';
    }
}

// ==================== LOGIN / LOGOUT ====================
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError'), successEl = document.getElementById('loginSuccess');
    const btn = document.getElementById('loginBtn');
    const reset = () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login'; isLoggingIn = false; };
    const fail = m => { errorEl.textContent = m; errorEl.classList.add('show'); };
    if (!email) return fail('❌ Please enter your email');
    if (!password) return fail('❌ Please enter your password');

    isLoggingIn = true;
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Logging in...';
    errorEl.classList.remove('show'); successEl.classList.remove('show');
    try {
        const user = (await auth.signInWithEmailAndPassword(email, password)).user;
        const snap = await backupDB.ref('admins/' + user.uid).once('value');
        if (!snap.exists()) { await auth.signOut(); fail('⛔ Unauthorized: Not an admin.'); reset(); return; }
        currentAdmin = { uid: user.uid, email: user.email, isAdmin: true };
        localStorage.setItem('adminSession', JSON.stringify(currentAdmin));
        successEl.textContent = '✅ Login successful!'; successEl.classList.add('show');
        setTimeout(() => { isLoggingIn = false; showDashboardPage(user); }, 800);
    } catch (err) {
        const map = {
            'auth/user-not-found': '❌ No account found. Please contact admin.', 'auth/wrong-password': '❌ Incorrect password.',
            'auth/invalid-credential': '❌ Invalid email or password.', 'auth/too-many-requests': '❌ Too many attempts. Try again later.',
            'auth/invalid-email': '❌ Invalid email format.', 'auth/network-request-failed': '❌ Network error. Check your internet.'
        };
        fail(map[err.code] || '❌ Login failed. Please try again.');
        reset();
    }
}

function adminLogout() {
    if (!confirm('Logout? Aapko dobara login karna padega.')) return;
    cleanupBackupListeners();
    localStorage.removeItem('adminSession');
    currentAdmin = null;
    auth.signOut();
    showLoginPage();
}

function showLogin() {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('loginSuccess').classList.remove('show');
}
function showSignup() {
    if (new URLSearchParams(window.location.search).get('setup') !== SETUP_KEY) { showNotification('⛔ Signup disabled', 'error'); return; }
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('loginForm').style.display = 'none';
}

// ==================== UI ====================
function showNotification(msg, type, duration) {
    type = type || 'success'; duration = duration || 4000;
    const n = document.getElementById('notification');
    if (!n) return;
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
    n.style.background = colors[type] || colors.success;
    n.textContent = msg;
    n.className = 'notification-toast ' + type + ' show';
    clearTimeout(n._timeout);
    n._timeout = setTimeout(() => n.classList.remove('show'), duration);
}

function formatDate(ts) {
    if (!ts) return '--';
    try { return new Date(ts).toLocaleString('en-IN'); } catch (e) { return '--'; }
}

function getLogs() { try { return JSON.parse(localStorage.getItem('rnd_backup_logs') || '[]'); } catch (e) { return []; } }
function addLog(action, status, details) {
    const logs = getLogs();
    logs.unshift({ time: new Date().toISOString(), action, status, details: details || '' });
    if (logs.length > 50) logs.pop();
    localStorage.setItem('rnd_backup_logs', JSON.stringify(logs));
    renderLogs();
}
function clearLogs() {
    if (!confirm('Clear all logs?')) return;
    localStorage.setItem('rnd_backup_logs', '[]');
    renderLogs();
    showNotification('Logs cleared', 'success');
}
function renderLogs() {
    const c = document.getElementById('activityLog');
    if (!c) return;
    const logs = getLogs();
    if (!logs.length) { c.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><p>No activity yet</p></div>'; return; }
    c.innerHTML = logs.map(l => {
        const cls = l.status === 'success' ? 'success' : l.status === 'failed' ? 'danger' : 'warning';
        return `<div class="log-entry">
            <span><strong>${esc(l.action)}</strong> ${l.details ? '<span style="color:#94a3b8;font-size:0.8rem;">' + esc(l.details) + '</span>' : ''}</span>
            <span><span class="tag tag-${cls}">${esc(l.status)}</span></span>
            <span class="log-time">${formatDate(l.time)}</span></div>`;
    }).join('');
}

function showConfirm(title, message, icon, action, actionLabel) {
    pendingAction = action;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmIcon').textContent = icon || '⚠️';
    document.getElementById('confirmIcon').className = 'icon ' + (icon === '🚨' ? 'danger' : 'warning');
    document.getElementById('confirmBtn').textContent = actionLabel || 'Confirm';
    document.getElementById('confirmOverlay').classList.add('active');
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('active'); pendingAction = null; }
function executeConfirmed() {
    document.getElementById('confirmOverlay').classList.remove('active');
    if (pendingAction) { const a = pendingAction; pendingAction = null; a(); }
}

// ==================== DASHBOARD ====================
function loadDashboard() {
    renderLogs();
    addLog('System Started', 'success', 'v3.0');
}

// ==================== CHECK STATUS (shallow - data download nahi hota) ====================
async function checkStatus(quiet) {
    if (!quiet) showNotification('Checking status...', 'info');
    try {
        let missingTotal = 0, mainUsers = 0, backupUsers = 0; const skipped = [];
        for (const path of SYNC_PATHS) {
            const mk = await shallowKeys(mainDB, path, true);
            const bk = await shallowKeys(backupDB, path, false);
            if (mk === null || bk === null) { skipped.push(path); continue; }
            const bset = new Set(bk);
            missingTotal += mk.filter(k => !bset.has(k)).length;
            if (path === 'users') { mainUsers = mk.length; backupUsers = bk.length; }
        }
        document.getElementById('mainUsers').textContent = mainUsers;
        document.getElementById('backupUsers').textContent = backupUsers;
        const ok = missingTotal === 0;
        const st = document.getElementById('statusCount');
        st.textContent = ok ? '✅ Matched' : '⚠️ ' + missingTotal + ' missing';
        st.style.color = ok ? '#10b981' : '#f59e0b';
        const last = getLogs().find(l => l.action === 'Backup All Data' || l.action === 'Auto Sync');
        document.getElementById('lastBackupTime').textContent = last ? formatDate(last.time) : '--';
        if (!quiet) showNotification(ok ? '✅ Backup me sab maujood hai!' : '⚠️ ' + missingTotal + ' records backup me nahi hain', ok ? 'success' : 'warning');
        addLog('Check Status', ok ? 'success' : 'warning', `Missing in backup: ${missingTotal}` + (skipped.length ? `, rules-denied: ${skipped.length}` : ''));
    } catch (e) {
        showNotification('Error checking status: ' + e.message, 'error');
    }
}

// ==================== MANUAL BACKUP ====================
function confirmBackup() {
    showConfirm('📦 Backup All Data?', 'Main Firebase ka naya/badla hua data Backup me copy hoga. Backup me se kuch delete nahi hoga. Continue?', '⚠️', () => backupAllData(), 'Yes, Backup Now');
}

async function backupAllData() {
    const btn = document.querySelector('.btn-success');
    const pd = document.getElementById('progressContainer'), bar = document.getElementById('progressBar'), txt = document.getElementById('progressText');
    btn.disabled = true; btn.innerHTML = '<div class="spinner-sm"></div> Backing up...';
    pd.classList.remove('hidden'); bar.style.width = '0%';
    try {
        const results = await syncAll((p, i, t) => { txt.textContent = `Syncing: ${p}... (${i + 1}/${t})`; bar.style.width = ((i / t) * 100) + '%'; });
        const written = results.reduce((a, r) => a + (r.written || 0), 0);
        const failed = results.filter(r => r.status === 'failed').length;
        const denied = results.filter(r => r.status === 'denied').length;
        bar.style.width = '100%';
        txt.textContent = `✅ Complete! ${written} records updated` + (denied ? `, ${denied} paths rules se denied` : '') + (failed ? `, ${failed} failed` : '');
        showNotification('Backup complete!', failed ? 'warning' : 'success');
        addLog('Backup All Data', failed ? 'warning' : 'success', `${written} records, denied ${denied}, failed ${failed}`);
        await saveBackupLog('system', 'all', 'manual_backup', failed ? 'warning' : 'success', `${written} records`);
        checkStatus(true);
    } catch (e) {
        txt.textContent = '❌ Error: ' + e.message;
        showNotification('Backup failed: ' + e.message, 'error');
        addLog('Backup All Data', 'failed', e.message);
    }
    setTimeout(() => { pd.classList.add('hidden'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Backup All Data'; }, 3000);
}

// ==================== RESTORE FULL (sirf MISSING data) ====================
function confirmRestoreAll() {
    showConfirm('🚨 Restore Missing Data?',
        'Jo records Backup me hain par Main Firebase me NAHI hain (delete ho gaye), sirf wahi wapas aayenge. Jo main me pehle se hai wo overwrite nahi hoga. Continue?',
        '🚨', () => {
            if (prompt('Confirm karne ke liye RESTORE type karein') !== 'RESTORE') { showNotification('Cancelled', 'warning'); return; }
            restoreAllDatabase();
        }, 'Yes, Restore Missing');
}

async function restoreAllDatabase() {
    const btn = document.querySelector('.btn-danger');
    const pd = document.getElementById('progressContainer'), bar = document.getElementById('progressBar'), txt = document.getElementById('progressText');
    if (!btn) return;
    btn.disabled = true; btn.innerHTML = '<div class="spinner-sm"></div> Restoring...';
    pd.classList.remove('hidden'); bar.style.width = '0%';
    let restored = 0, failed = 0, denied = 0;
    try {
        if (!(await isMainAdmin())) throw new Error(MAIN_ADMIN_EMAIL + ' (main admin) se login karein');
        for (let i = 0; i < SYNC_PATHS.length; i++) {
            const path = SYNC_PATHS[i];
            txt.textContent = `Checking: ${path}... (${i + 1}/${SYNC_PATHS.length})`;
            bar.style.width = ((i / SYNC_PATHS.length) * 100) + '%';
            try {
                const mk = await shallowKeys(mainDB, path, true), bk = await shallowKeys(backupDB, path, false);
                if (mk === null || bk === null) { denied++; continue; }
                const mset = new Set(mk);
                const missing = bk.filter(k => !mset.has(k) && k !== '(value)');
                if (!missing.length) continue;
                const data = (await backupDB.ref(path).once('value')).val() || {};
                for (let j = 0; j < missing.length; j += 50) {
                    const chunk = {};
                    missing.slice(j, j + 50).forEach(k => { chunk[k] = cleanMeta(data[k]); });
                    await retryOperation(() => mainDB.ref(path).update(chunk));
                    restored += Object.keys(chunk).length;
                }
            } catch (e) {
                if (isDenied(e)) denied++; else failed++;
                console.error('Restore failed for', path, e);
            }
        }
        bar.style.width = '100%';
        txt.textContent = `✅ Complete! ${restored} missing records restored` + (denied ? `, ${denied} paths denied by rules` : '') + (failed ? `, ${failed} failed` : '');
        showNotification(`Restore complete! ${restored} records`, failed || denied ? 'warning' : 'success');
        addLog('Restore Missing Data', failed ? 'warning' : 'success', `${restored} records, denied ${denied}, failed ${failed}`);
        await saveBackupLog('system', 'all', 'restore_missing', failed ? 'warning' : 'success', `${restored} records`);
        checkStatus(true);
    } catch (e) {
        txt.textContent = '❌ Error: ' + e.message;
        showNotification('Restore failed: ' + e.message, 'error');
        addLog('Restore Missing Data', 'failed', e.message);
    }
    setTimeout(() => { pd.classList.add('hidden'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database'; }, 3000);
}

// ==================== ENTER KEY ====================
document.addEventListener('keypress', (e) => {
    if (e.key !== 'Enter') return;
    const l = document.getElementById('loginForm'), s = document.getElementById('signupForm');
    const lp = document.getElementById('loginPage');
    if (!lp || lp.style.display === 'none') return;
    if (l && l.style.display !== 'none') handleLogin();
    else if (s && s.style.display !== 'none') handleSignup();
});

window.addEventListener('DOMContentLoaded', initFirebase);
