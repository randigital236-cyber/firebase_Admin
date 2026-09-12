// ==================== RND BACKUP SYSTEM v2.1 - SECURE ====================
// ✅ Fix 1: Signup ONLY via secret URL (?setup=1)
// ✅ Fix 2: Signup link hidden from login page
// ✅ Fix 3: Better error messages
// ✅ Fix 4: All previous fixes retained

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

const BACKUP_PATHS = [
    'users',
    'deposits',
    'depositHistory',
    'withdrawals',
    'usedTransactions',
    'processingTransactions',
    'settings',
    'usernames'
];

// ==================== SECRET SETUP KEY ====================
// Sirf aap jaante hain. Signup ke liye URL mein ?setup=1 lagana hoga
const SETUP_KEY = '1';

// ==================== GLOBAL ====================
let mainApp, backupApp, mainDB, backupDB, auth;
let currentAdmin = null;
let pendingAction = null;
let backupStarted = false;
let isInitialBackupDone = false;
let backupListeners = [];

// ==================== RETRY HELPER ====================
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (e) {
            lastError = e;
            console.log(`⏳ Retry ${attempt}/${maxRetries} failed:`, e.message);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delay * attempt));
            }
        }
    }
    throw lastError;
}

// ==================== SAVE BACKUP LOG ====================
async function saveBackupLog(uid, path, action, status, details) {
    try {
        const logData = {
            uid: uid || 'system',
            path: path || 'all',
            action: action || 'backup',
            status: status || 'success',
            details: details || '',
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            date: new Date().toISOString()
        };
        await backupDB.ref('backupLogs').push(logData);
    } catch (e) {
        console.error('❌ Failed to save log:', e);
    }
}

// ==================== CLEANUP LISTENERS ====================
function cleanupBackupListeners() {
    if (backupListeners.length > 0) {
        console.log('🧹 Cleaning up', backupListeners.length, 'listeners...');
        backupListeners.forEach(item => {
            try {
                item.ref.off(item.event, item.callback);
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        backupListeners = [];
        backupStarted = false;
        console.log('✅ Listeners cleaned up');
    }
}

// ==================== INIT ====================
function initFirebase() {
    try {
        mainApp = firebase.app('mainApp');
    } catch (e) {
        mainApp = firebase.initializeApp(MAIN_CONFIG, 'mainApp');
    }
    try {
        backupApp = firebase.app('backupApp');
    } catch (e) {
        backupApp = firebase.initializeApp(BACKUP_CONFIG, 'backupApp');
    }
    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    auth = firebase.auth(mainApp);
    console.log('✅ Firebase initialized');

    // Start initial backup then auto backup
    startInitialFullBackup().then(() => {
        startSafeAutoBackup();
    }).catch(e => {
        console.error('Init backup error:', e);
        startSafeAutoBackup();
    });

    checkSession();
    checkSetupMode();
}

// ==================== SECRET SETUP MODE CHECK ====================
function checkSetupMode() {
    const params = new URLSearchParams(window.location.search);
    const setupParam = params.get('setup');
    
    if (setupParam === SETUP_KEY) {
        // Secret signup mode - show signup form
        console.log('🔐 Secret setup mode activated');
        const signupForm = document.getElementById('signupForm');
        const loginForm = document.getElementById('loginForm');
        if (signupForm && loginForm) {
            signupForm.style.display = 'block';
            loginForm.style.display = 'none';
        }
    } else {
        // Normal mode - only login
        const signupForm = document.getElementById('signupForm');
        const loginForm = document.getElementById('loginForm');
        if (signupForm && loginForm) {
            signupForm.style.display = 'none';
            loginForm.style.display = 'block';
        }
    }
}

// ==================== INITIAL FULL BACKUP ====================
async function startInitialFullBackup() {
    if (isInitialBackupDone) {
        console.log('✅ Initial backup already done');
        return;
    }

    console.log('📦 Checking initial backup status...');

    try {
        const mainSnap = await mainDB.ref('users').once('value');
        const backupSnap = await backupDB.ref('users').once('value');

        const mainCount = Object.keys(mainSnap.val() || {}).length;
        const backupCount = Object.keys(backupSnap.val() || {}).length;

        console.log(`📊 Main Users: ${mainCount}, Backup Users: ${backupCount}`);

        if (mainCount === 0) {
            console.log('ℹ️ No users in Main Firebase, skipping initial backup');
            isInitialBackupDone = true;
            return;
        }

        if (backupCount >= mainCount) {
            console.log(`✅ Backup already has ${backupCount} users (>= ${mainCount}), skipping initial full backup`);
            isInitialBackupDone = true;
            return;
        }

        console.log(`🔄 Initial backup needed: Main ${mainCount} > Backup ${backupCount}`);
        addLog('Initial Full Backup', 'info', `Main: ${mainCount}, Backup: ${backupCount} - Starting...`);

        let synced = 0;
        let failed = 0;
        const total = BACKUP_PATHS.length;

        for (const path of BACKUP_PATHS) {
            try {
                const snap = await mainDB.ref(path).once('value');
                const data = snap.val();
                if (data) {
                    await retryOperation(async () => {
                        await backupDB.ref(path).set(data);
                    });
                    synced++;
                    console.log(`✅ Initial Backup: ${path} done`);
                } else {
                    synced++;
                }
            } catch (e) {
                failed++;
                console.error(`❌ Initial Backup failed for ${path}:`, e);
                await saveBackupLog('system', path, 'initial_backup', 'failed', e.message);
            }
            await new Promise(r => setTimeout(r, 100));
        }

        isInitialBackupDone = true;
        console.log(`✅ Initial Full Backup Complete: ${synced}/${total} paths`);
        addLog('Initial Full Backup', 'success', `${synced}/${total} paths (Users: ${mainCount})`);
        await saveBackupLog('system', 'all', 'initial_backup', 'success', `${synced}/${total} paths, Users: ${mainCount}`);

    } catch (e) {
        console.error('❌ Initial Full Backup failed:', e);
        addLog('Initial Full Backup', 'failed', e.message);
        await saveBackupLog('system', 'all', 'initial_backup', 'failed', e.message);
        isInitialBackupDone = true;
    }
}

// ==================== SAFE AUTO BACKUP ====================
function startSafeAutoBackup() {
    if (backupStarted) {
        console.log('⚠️ Auto Backup already started, skipping duplicate');
        return;
    }

    cleanupBackupListeners();

    backupStarted = true;
    console.log('🔄 Starting Safe Auto Backup...');
    console.log('✅ New Users, Deposits, Withdrawals will auto-backup');
    console.log('❌ DELETE will be IGNORED (Safe!)');

    BACKUP_PATHS.forEach(path => {
        const addCallback = async (snap) => {
            try {
                const key = snap.key;
                const data = snap.val();
                if (data) {
                    const dataWithTimestamp = {
                        ...data,
                        backupUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
                        _backupTime: new Date().toISOString()
                    };
                    await retryOperation(async () => {
                        await backupDB.ref(path + '/' + key).set(dataWithTimestamp);
                    });
                    console.log('✅ Auto Backup (ADD):', path, key);
                    await saveBackupLog(key, path, 'auto_backup_add', 'success');
                }
            } catch (e) {
                console.error('❌ Auto Backup (ADD) failed:', path, e);
                await saveBackupLog(snap.key, path, 'auto_backup_add', 'failed', e.message);
            }
        };
        mainDB.ref(path).on('child_added', addCallback);
        backupListeners.push({ ref: mainDB.ref(path), event: 'child_added', callback: addCallback });

        const changeCallback = async (snap) => {
            try {
                const key = snap.key;
                const data = snap.val();
                if (data) {
                    const dataWithTimestamp = {
                        ...data,
                        backupUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
                        _backupTime: new Date().toISOString()
                    };
                    await retryOperation(async () => {
                        await backupDB.ref(path + '/' + key).set(dataWithTimestamp);
                    });
                    console.log('✅ Auto Backup (UPDATE):', path, key);
                    await saveBackupLog(key, path, 'auto_backup_update', 'success');
                }
            } catch (e) {
                console.error('❌ Auto Backup (UPDATE) failed:', path, e);
                await saveBackupLog(snap.key, path, 'auto_backup_update', 'failed', e.message);
            }
        };
        mainDB.ref(path).on('child_changed', changeCallback);
        backupListeners.push({ ref: mainDB.ref(path), event: 'child_changed', callback: changeCallback });
    });

    addLog('Safe Auto Backup', 'success', 'Started - DELETE ignored');
    console.log('✅ Safe Auto Backup Started');
    console.log('📊 Monitoring:', BACKUP_PATHS.join(', '));
    console.log(`📌 ${backupListeners.length} listeners active`);
}

// ==================== RESTORE USER ====================
async function restoreUserWithSafety(uid) {
    const container = document.getElementById('restoreResult');
    container.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-sm"></div><p style="margin-top:8px;color:#94a3b8;">Checking user in Main Firebase...</p></div>';

    try {
        const mainCheck = await mainDB.ref('users/' + uid).once('value');
        const userExists = mainCheck.exists();

        if (userExists) {
            const confirmMsg = `⚠️ User ${uid} already exists in Main Firebase!\n\nAre you sure you want to OVERWRITE this user's data from backup?`;
            if (!confirm(confirmMsg)) {
                container.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-ban"></i>
                        <div>Restore cancelled. User ${uid} already exists in Main Firebase.</div>
                    </div>
                `;
                return;
            }
        }

        const backupSnap = await backupDB.ref('users/' + uid).once('value');
        if (!backupSnap.exists()) {
            container.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-circle-exclamation"></i>
                    User ${uid} not found in backup!
                </div>
            `;
            return;
        }

        container.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-sm"></div><p style="margin-top:8px;color:#94a3b8;">Restoring user ' + uid + '...</p></div>';

        let restored = 0;
        let failed = 0;

        for (const path of BACKUP_PATHS) {
            try {
                const snap = await backupDB.ref(path + '/' + uid).once('value');
                let data = snap.val();
                if (data) {
                    if (data._backupTime) delete data._backupTime;
                    if (data.backupUpdatedAt) delete data.backupUpdatedAt;

                    await retryOperation(async () => {
                        await mainDB.ref(path + '/' + uid).set(data);
                    });
                    restored++;
                    console.log(`✅ Restored ${path}/${uid}`);
                }
            } catch (e) {
                failed++;
                console.error('Restore failed for', path, e);
            }
        }

        container.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>User ${uid} restored!</strong>
                    <br><small>Restored: ${restored} paths | Failed: ${failed}</small>
                    ${userExists ? '<br><span style="color:#f59e0b;">⚠️ Existing user data was overwritten</span>' : ''}
                </div>
            </div>
        `;

        showNotification(`User ${uid} restored!`, 'success');
        addLog('Restore User', 'success', `UID: ${uid} (${restored} paths)`);
        await saveBackupLog(uid, 'all', 'restore_user', 'success', `${restored} paths, existed: ${userExists}`);

        document.getElementById('restoreUid').value = '';
        checkStatus();

    } catch (e) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${e.message}
            </div>
        `;
        addLog('Restore User', 'failed', `UID: ${uid} - ${e.message}`);
        await saveBackupLog(uid, 'all', 'restore_user', 'failed', e.message);
    }
}

// ==================== SIGNUP (Secret - sirf ?setup=1 se) ====================
async function handleSignup() {
    // ✅ Security check - sirf secret URL se signup
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') !== SETUP_KEY) {
        const errorEl = document.getElementById('loginError');
        errorEl.textContent = '⛔ Signup disabled. Contact administrator.';
        errorEl.classList.add('show');
        return;
    }

    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    const successEl = document.getElementById('loginSuccess');
    const btn = document.getElementById('signupBtn');

    if (!name) {
        errorEl.textContent = '❌ Please enter your full name';
        errorEl.classList.add('show');
        return;
    }
    if (!email) {
        errorEl.textContent = '❌ Please enter your email';
        errorEl.classList.add('show');
        return;
    }
    if (!password || password.length < 6) {
        errorEl.textContent = '❌ Password must be at least 6 characters';
        errorEl.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Creating...';
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const result = await auth.createUserWithEmailAndPassword(email, password);
        const user = result.user;

        await backupDB.ref('admins/' + user.uid).set({
            name: name,
            email: email,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        console.log('✅ Admin created in Backup Firebase:', email);
        successEl.textContent = '✅ Admin account created! Please login.';
        successEl.classList.add('show');

        await auth.signOut();

        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Admin Account';
            document.getElementById('signupForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('loginEmail').value = email;
            successEl.classList.remove('show');
            showNotification('Admin created! Please login.', 'success');
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 2000);

    } catch (err) {
        console.error('Signup error:', err);
        let msg = '❌ Signup failed. Please try again.';
        if (err.code === 'auth/email-already-in-use') {
            msg = '❌ Email already registered. Please login.';
        } else if (err.code === 'auth/weak-password') {
            msg = '❌ Password too weak.';
        } else if (err.code === 'auth/invalid-email') {
            msg = '❌ Invalid email format.';
        }
        errorEl.textContent = msg;
        errorEl.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Admin Account';
    }
}

// ==================== LOGIN ====================
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    const successEl = document.getElementById('loginSuccess');
    const btn = document.getElementById('loginBtn');

    if (!email) {
        errorEl.textContent = '❌ Please enter your email';
        errorEl.classList.add('show');
        return;
    }
    if (!password) {
        errorEl.textContent = '❌ Please enter your password';
        errorEl.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Logging in...';
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const result = await auth.signInWithEmailAndPassword(email, password);
        const user = result.user;

        // Check admin in Backup Firebase only
        const snap = await backupDB.ref('admins/' + user.uid).once('value');
        if (!snap.exists()) {
            await auth.signOut();
            errorEl.textContent = '⛔ Unauthorized: Not an admin. Please sign up first via setup URL.';
            errorEl.classList.add('show');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
            return;
        }

        const adminSession = {
            uid: user.uid,
            email: user.email,
            isAdmin: true,
            loginTime: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        localStorage.setItem('adminSession', JSON.stringify(adminSession));
        currentAdmin = adminSession;

        console.log('✅ Admin logged in:', email);
        successEl.textContent = '✅ Login successful!';
        successEl.classList.add('show');

        setTimeout(() => {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            document.getElementById('adminEmail').textContent = user.email;
            document.getElementById('adminAvatar').textContent = user.email.charAt(0).toUpperCase();
            loadDashboard();
        }, 1000);

    } catch (err) {
        console.error('Login error:', err);
        let msg = '❌ Login failed. Please try again.';
        if (err.code === 'auth/user-not-found') {
            msg = '❌ No account found. Please contact admin.';
        } else if (err.code === 'auth/wrong-password') {
            msg = '❌ Incorrect password.';
        } else if (err.code === 'auth/invalid-credential') {
            msg = '❌ Invalid email or password.';
        } else if (err.code === 'auth/too-many-requests') {
            msg = '❌ Too many attempts. Try again later.';
        } else if (err.code === 'auth/invalid-email') {
            msg = '❌ Invalid email format.';
        }
        errorEl.textContent = msg;
        errorEl.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
}

// ==================== LOGOUT ====================
function adminLogout() {
    if (!confirm('Logout?')) return;

    cleanupBackupListeners();
    localStorage.removeItem('adminSession');
    currentAdmin = null;
    auth.signOut();
    document.getElementById('dashboardPage').style.display = 'none';
    document.getElementById('loginPage').style.display = 'block';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('signupForm').style.display = 'none';

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
    const signupBtn = document.getElementById('signupBtn');
    if (signupBtn) {
        signupBtn.disabled = false;
        signupBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Admin Account';
    }

    console.log('👋 Logged out, listeners cleaned up');
}

// ==================== SESSION CHECK ====================
function checkSession() {
    const session = localStorage.getItem('adminSession');
    if (!session) return;

    try {
        const admin = JSON.parse(session);
        if (admin.expiresAt && new Date(admin.expiresAt) > new Date()) {
            currentAdmin = admin;
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            document.getElementById('adminEmail').textContent = admin.email;
            document.getElementById('adminAvatar').textContent = admin.email.charAt(0).toUpperCase();
            loadDashboard();
            return;
        } else {
            localStorage.removeItem('adminSession');
        }
    } catch (e) {
        localStorage.removeItem('adminSession');
    }
}

// ==================== UI TOGGLE ====================
function showLogin() {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('loginSuccess').classList.remove('show');
}

function showSignup() {
    // ✅ Block signup if not in setup mode
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') !== SETUP_KEY) {
        showNotification('⛔ Signup disabled', 'error');
        return;
    }
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('loginSuccess').classList.remove('show');
}

// ==================== NOTIFICATION ====================
function showNotification(msg, type, duration) {
    type = type || 'success';
    duration = duration || 4000;
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

// ==================== LOCAL LOGS ====================
function getLogs() {
    return JSON.parse(localStorage.getItem('rnd_backup_logs') || '[]');
}

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
    const container = document.getElementById('activityLog');
    if (!container) return;
    const logs = getLogs();
    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><p>No activity yet</p></div>';
        return;
    }
    let html = '';
    logs.forEach(log => {
        const cls = log.status === 'success' ? 'success' : log.status === 'failed' ? 'danger' : 'warning';
        html += `
            <div class="log-entry">
                <span><strong>${log.action}</strong> ${log.details ? '<span style="color:#94a3b8;font-size:0.8rem;">' + log.details + '</span>' : ''}</span>
                <span><span class="tag tag-${cls}">${log.status}</span></span>
                <span class="log-time">${formatDate(log.time)}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ==================== CONFIRM DIALOG ====================
function showConfirm(title, message, icon, action, actionLabel) {
    pendingAction = action;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmIcon').textContent = icon || '⚠️';
    document.getElementById('confirmIcon').className = 'icon ' + (icon === '🚨' ? 'danger' : 'warning');
    document.getElementById('confirmBtn').textContent = actionLabel || 'Confirm';
    document.getElementById('confirmOverlay').classList.add('active');
}

function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    pendingAction = null;
}

function executeConfirmed() {
    document.getElementById('confirmOverlay').classList.remove('active');
    if (pendingAction) {
        const action = pendingAction;
        pendingAction = null;
        action();
    }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
    await checkStatus();
    renderLogs();
    addLog('System Started', 'success', 'v2.1 - Secure');
    console.log('✅ RND Backup System Ready');
    console.log('📧 Admin:', currentAdmin?.email);
    console.log('📊 Backup Paths:', BACKUP_PATHS);
    console.log('🔄 Auto Backup: ACTIVE (DELETE ignored)');
    console.log(`📌 ${backupListeners.length} active listeners`);
}

// ==================== CHECK STATUS ====================
async function checkStatus() {
    showNotification('Checking status...', 'info');
    try {
        let mainTotal = 0, backupTotal = 0;
        for (const path of BACKUP_PATHS) {
            const m = await mainDB.ref(path).once('value');
            const b = await backupDB.ref(path).once('value');
            mainTotal += Object.keys(m.val() || {}).length;
            backupTotal += Object.keys(b.val() || {}).length;
        }
        document.getElementById('mainUsers').textContent = mainTotal;
        document.getElementById('backupUsers').textContent = backupTotal;
        const status = mainTotal === backupTotal ? '✅ Matched' : '⚠️ Mismatch';
        document.getElementById('statusCount').textContent = status;
        document.getElementById('statusCount').style.color = mainTotal === backupTotal ? '#10b981' : '#f59e0b';

        const logs = getLogs();
        const last = logs.find(l => l.action === 'Backup All Data' || l.action === 'Safe Auto Backup');
        document.getElementById('lastBackupTime').textContent = last ? formatDate(last.time) : '--';

        showNotification(mainTotal === backupTotal ? '✅ Data matched!' : '⚠️ Data mismatch found!', mainTotal === backupTotal ? 'success' : 'warning');
        addLog('Check Status', mainTotal === backupTotal ? 'success' : 'warning', `Main: ${mainTotal}, Backup: ${backupTotal}`);
    } catch (e) {
        showNotification('Error checking status: ' + e.message, 'error');
    }
}

// ==================== MANUAL BACKUP ====================
function confirmBackup() {
    showConfirm(
        '📦 Backup All Data?',
        'This will copy ALL data from Main Firebase to Backup Firebase. Continue?',
        '⚠️',
        function () { backupAllData(); },
        'Yes, Backup Now'
    );
}

async function backupAllData() {
    const btn = document.querySelector('.btn-success');
    const progressDiv = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-sm"></div> Backing up...';
    progressDiv.classList.remove('hidden');
    progressBar.style.width = '0%';

    let synced = 0, failed = 0;
    const total = BACKUP_PATHS.length;

    try {
        for (let i = 0; i < total; i++) {
            const path = BACKUP_PATHS[i];
            progressText.textContent = `Syncing: ${path}... (${i + 1}/${total})`;
            progressBar.style.width = ((i / total) * 100) + '%';
            try {
                const snap = await mainDB.ref(path).once('value');
                const data = snap.val();
                if (data) {
                    await retryOperation(async () => {
                        await backupDB.ref(path).set(data);
                    });
                    synced++;
                }
            } catch (e) {
                failed++;
                console.error('Backup failed for', path, e);
            }
            await new Promise(r => setTimeout(r, 50));
        }

        progressBar.style.width = '100%';
        progressText.textContent = `✅ Complete! ${synced}/${total} paths synced`;
        showNotification(`Backup complete! ${synced}/${total} paths`, failed > 0 ? 'warning' : 'success');
        addLog('Backup All Data', failed > 0 ? 'warning' : 'success', `${synced}/${total} paths`);
        await saveBackupLog('system', 'all', 'manual_backup', failed > 0 ? 'warning' : 'success', `${synced}/${total} paths`);
        checkStatus();

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate"></i> Backup All Data';
        }, 3000);

    } catch (e) {
        progressText.textContent = '❌ Error: ' + e.message;
        showNotification('Backup failed: ' + e.message, 'error');
        addLog('Backup All Data', 'failed', e.message);
        await saveBackupLog('system', 'all', 'manual_backup', 'failed', e.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate"></i> Backup All Data';
    }
}

// ==================== RESTORE USER ====================
function confirmRestoreUser() {
    const uid = document.getElementById('restoreUid').value.trim();
    if (!uid) {
        showNotification('Please enter a UID', 'warning');
        return;
    }
    restoreUserWithSafety(uid);
}

// ==================== RESTORE FULL ====================
function confirmRestoreAll() {
    showConfirm(
        '🚨 Restore Full Database?',
        '⚠️ WARNING: This will OVERWRITE ALL data in Main Firebase with Backup Firebase! This CANNOT be undone! Continue?',
        '🚨',
        function () { restoreAllDatabase(); },
        'Yes, Restore All'
    );
}

async function restoreAllDatabase() {
    const btn = document.querySelector('.btn-danger');
    const progressDiv = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-sm"></div> Restoring...';
    progressDiv.classList.remove('hidden');
    progressBar.style.width = '0%';

    try {
        const check = await backupDB.ref('users').once('value');
        if (!check.exists()) {
            showNotification('❌ No data in Backup Firebase!', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database';
            progressDiv.classList.add('hidden');
            return;
        }

        let restored = 0, failed = 0;
        const total = BACKUP_PATHS.length;

        for (let i = 0; i < total; i++) {
            const path = BACKUP_PATHS[i];
            progressText.textContent = `Restoring: ${path}... (${i + 1}/${total})`;
            progressBar.style.width = ((i / total) * 100) + '%';
            try {
                const snap = await backupDB.ref(path).once('value');
                let data = snap.val();
                if (data) {
                    Object.keys(data).forEach(key => {
                        if (data[key] && typeof data[key] === 'object') {
                            if (data[key]._backupTime) delete data[key]._backupTime;
                            if (data[key].backupUpdatedAt) delete data[key].backupUpdatedAt;
                        }
                    });
                    if (data._backupTime) delete data._backupTime;
                    if (data.backupUpdatedAt) delete data.backupUpdatedAt;

                    await retryOperation(async () => {
                        await mainDB.ref(path).set(data);
                    });
                    restored++;
                }
            } catch (e) {
                failed++;
                console.error('Restore failed for', path, e);
            }
            await new Promise(r => setTimeout(r, 50));
        }

        progressBar.style.width = '100%';
        progressText.textContent = `✅ Complete! ${restored}/${total} paths restored`;
        showNotification(`Restore complete! ${restored}/${total} paths`, failed > 0 ? 'warning' : 'success');
        addLog('Restore Full Database', failed > 0 ? 'warning' : 'success', `${restored}/${total} paths`);
        await saveBackupLog('system', 'all', 'restore_full', failed > 0 ? 'warning' : 'success', `${restored}/${total} paths`);
        checkStatus();

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database';
        }, 3000);

    } catch (e) {
        progressText.textContent = '❌ Error: ' + e.message;
        showNotification('Restore failed: ' + e.message, 'error');
        addLog('Restore Full Database', 'failed', e.message);
        await saveBackupLog('system', 'all', 'restore_full', 'failed', e.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database';
    }
}

// ==================== ENTER KEY ====================
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        if (loginForm && loginForm.style.display !== 'none') {
            handleLogin();
        } else if (signupForm && signupForm.style.display !== 'none') {
            handleSignup();
        }
    }
});

// ==================== INIT ====================
window.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});
