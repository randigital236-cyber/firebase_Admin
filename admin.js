// ==================== RND BACKUP SYSTEM - PRODUCTION READY ====================
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
    'users', 'deposits', 'depositHistory', 'withdrawals',
    'usedTransactions', 'processingTransactions', 'settings', 'usernames'
];

// ==================== GLOBAL ====================
let mainApp, backupApp, mainDB, backupDB, auth;
let currentAdmin = null;
let pendingAction = null;
let isSignup = false;

// ==================== INIT ====================
function initFirebase() {
    try { mainApp = firebase.app('mainApp'); } catch(e) {
        mainApp = firebase.initializeApp(MAIN_CONFIG, 'mainApp');
    }
    try { backupApp = firebase.app('backupApp'); } catch(e) {
        backupApp = firebase.initializeApp(BACKUP_CONFIG, 'backupApp');
    }
    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    auth = firebase.auth(mainApp);
    console.log('✅ Firebase initialized');
    
    // Check session
    checkSession();
}

// ==================== UI TOGGLE ====================
function showLogin() {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('loginSuccess').classList.remove('show');
}

function showSignup() {
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('loginSuccess').classList.remove('show');
}

// ==================== SIGNUP ====================
async function handleSignup() {
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

        await mainDB.ref('admins/' + user.uid).set({
            name: name,
            email: email,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        console.log('✅ Admin created:', email);
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
        }, 2000);

    } catch(err) {
        console.error('Signup error:', err);
        let msg = '❌ Signup failed. Please try again.';
        if (err.code === 'auth/email-already-in-use') {
            msg = '❌ Email already registered. Please login.';
        } else if (err.code === 'auth/weak-password') {
            msg = '❌ Password too weak.';
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

        // Check admin
        const snap = await backupDB.ref('admins/' + user.uid).once('value');
        if (!snap.exists()) {
            await auth.signOut();
            errorEl.textContent = '⛔ Unauthorized: Not an admin';
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

        console.log('✅ Admin logged in:', email);
        successEl.textContent = '✅ Login successful!';
        successEl.classList.add('show');

        setTimeout(() => {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            loadDashboard();
        }, 1000);

    } catch(err) {
        console.error('Login error:', err);
        let msg = '❌ Login failed. Please try again.';
        if (err.code === 'auth/user-not-found') {
            msg = '❌ No account found. Please sign up first.';
        } else if (err.code === 'auth/wrong-password') {
            msg = '❌ Incorrect password.';
        } else if (err.code === 'auth/too-many-requests') {
            msg = '❌ Too many attempts. Try again later.';
        }
        errorEl.textContent = msg;
        errorEl.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
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
        }
    } catch(e) {}
}

// ==================== LOGOUT ====================
function adminLogout() {
    if (!confirm('Logout?')) return;
    localStorage.removeItem('adminSession');
    auth.signOut();
    document.getElementById('dashboardPage').style.display = 'none';
    document.getElementById('loginPage').style.display = 'block';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('signupForm').style.display = 'none';
}

// ==================== NOTIFICATION ====================
function showNotification(msg, type, duration) {
    type = type || 'success';
    duration = duration || 4000;
    const n = document.getElementById('notification');
    if (!n) return;
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b' };
    n.style.background = colors[type] || colors.success;
    n.textContent = msg;
    n.className = 'notification-toast ' + type + ' show';
    clearTimeout(n._timeout);
    n._timeout = setTimeout(() => n.classList.remove('show'), duration);
}

function formatDate(ts) {
    if (!ts) return '--';
    try { return new Date(ts).toLocaleString('en-IN'); } catch(e) { return '--'; }
}

// ==================== LOGS ====================
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
    showNotification('Logs cleared', 'info');
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
                <span><strong>${log.action}</strong> ${log.details ? '<span style="color:#94a3b8;font-size:0.8rem;">'+log.details+'</span>' : ''}</span>
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
    addLog('System Started', 'success', 'v1.0');
    console.log('✅ RND Backup System Ready');
    console.log('📧 Admin:', currentAdmin?.email);
    console.log('📊 Backup Paths:', BACKUP_PATHS);
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
        const last = logs.find(l => l.action === 'Backup All Data');
        document.getElementById('lastBackupTime').textContent = last ? formatDate(last.time) : '--';
        
        showNotification(mainTotal === backupTotal ? '✅ Data matched!' : '⚠️ Data mismatch found!', mainTotal === backupTotal ? 'success' : 'warning');
        addLog('Check Status', mainTotal === backupTotal ? 'success' : 'warning', `Main: ${mainTotal}, Backup: ${backupTotal}`);
    } catch(e) {
        showNotification('Error checking status: ' + e.message, 'error');
    }
}

// ==================== BACKUP ====================
function confirmBackup() {
    showConfirm(
        '📦 Backup All Data?',
        'This will copy ALL data from Main Firebase to Backup Firebase. Continue?',
        '⚠️',
        function() { backupAllData(); },
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
            progressText.textContent = `Syncing: ${path}... (${i+1}/${total})`;
            progressBar.style.width = ((i / total) * 100) + '%';
            try {
                const snap = await mainDB.ref(path).once('value');
                const data = snap.val();
                if (data) {
                    await backupDB.ref(path).set(data);
                    synced++;
                }
            } catch(e) {
                failed++;
                console.error('Backup failed for', path, e);
            }
            await new Promise(r => setTimeout(r, 50));
        }

        progressBar.style.width = '100%';
        progressText.textContent = `✅ Complete! ${synced}/${total} paths synced`;
        showNotification(`Backup complete! ${synced}/${total} paths`, failed > 0 ? 'warning' : 'success');
        addLog('Backup All Data', failed > 0 ? 'warning' : 'success', `${synced}/${total} paths`);
        checkStatus();

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate"></i> Backup All Data';
        }, 3000);

    } catch(e) {
        progressText.textContent = '❌ Error: ' + e.message;
        showNotification('Backup failed: ' + e.message, 'error');
        addLog('Backup All Data', 'failed', e.message);
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
    showConfirm(
        '🔄 Restore User?',
        `Restore user "${uid}" from Backup to Main Firebase?`,
        '⚠️',
        function() { restoreUser(uid); },
        'Yes, Restore'
    );
}

async function restoreUser(uid) {
    const container = document.getElementById('restoreResult');
    container.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-sm"></div><p style="margin-top:8px;color:#94a3b8;">Restoring user...</p></div>';

    try {
        const backupSnap = await backupDB.ref('users/' + uid).once('value');
        if (!backupSnap.exists()) {
            container.innerHTML = `<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> User ${uid} not found in backup!</div>`;
            return;
        }

        let restored = 0, failed = 0;
        for (const path of BACKUP_PATHS) {
            try {
                const snap = await backupDB.ref(path + '/' + uid).once('value');
                const data = snap.val();
                if (data) {
                    await mainDB.ref(path + '/' + uid).set(data);
                    restored++;
                }
            } catch(e) {
                failed++;
                console.error('Restore failed for', path, e);
            }
        }

        container.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <div><strong>User ${uid} restored!</strong><br><small>Restored: ${restored} paths | Failed: ${failed}</small></div>
            </div>
        `;
        showNotification(`User ${uid} restored!`, 'success');
        addLog('Restore User', 'success', `UID: ${uid} (${restored} paths)`);
        document.getElementById('restoreUid').value = '';
        checkStatus();

    } catch(e) {
        container.innerHTML = `<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error: ${e.message}</div>`;
        addLog('Restore User', 'failed', `UID: ${uid} - ${e.message}`);
    }
}

// ==================== RESTORE FULL ====================
function confirmRestoreAll() {
    showConfirm(
        '🚨 Restore Full Database?',
        '⚠️ WARNING: This will OVERWRITE ALL data in Main Firebase with Backup Firebase! This CANNOT be undone! Continue?',
        '🚨',
        function() { restoreAllDatabase(); },
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
            progressText.textContent = `Restoring: ${path}... (${i+1}/${total})`;
            progressBar.style.width = ((i / total) * 100) + '%';
            try {
                const snap = await backupDB.ref(path).once('value');
                const data = snap.val();
                if (data) {
                    await mainDB.ref(path).set(data);
                    restored++;
                }
            } catch(e) {
                failed++;
                console.error('Restore failed for', path, e);
            }
            await new Promise(r => setTimeout(r, 50));
        }

        progressBar.style.width = '100%';
        progressText.textContent = `✅ Complete! ${restored}/${total} paths restored`;
        showNotification(`Restore complete! ${restored}/${total} paths`, failed > 0 ? 'warning' : 'success');
        addLog('Restore Full Database', failed > 0 ? 'warning' : 'success', `${restored}/${total} paths`);
        checkStatus();

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database';
        }, 3000);

    } catch(e) {
        progressText.textContent = '❌ Error: ' + e.message;
        showNotification('Restore failed: ' + e.message, 'error');
        addLog('Restore Full Database', 'failed', e.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-database"></i> Restore Full Database';
    }
}

// ==================== ENTER KEY ====================
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (document.getElementById('loginForm').style.display !== 'none') {
            handleLogin();
        } else if (document.getElementById('signupForm').style.display !== 'none') {
            handleSignup();
        }
    }
});

// ==================== INIT ====================
initFirebase();
