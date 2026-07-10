// ==================== RND BACKUP SYSTEM v2.1 - COMPLETE FIXED ====================
// ✅ FIXED: init() order - Firebase first, then session check
// ✅ FIXED: auth.onAuthStateChanged - No premature redirect
// ✅ FIXED: checkSession() - Local Storage first
// ✅ FIXED: Session stays after page refresh

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

const SYNC_PATHS = ['users', 'deposits', 'withdrawals', 'usedTransactions', 'processingTransactions'];

// ==================== GLOBAL VARIABLES ====================
let mainApp, backupApp, mainDB, backupDB, auth;
let currentAdmin = null;
let pendingAction = null;
let authInitialized = false;

// ==================== INITIALIZE FIREBASE ====================
function initFirebase() {
    try {
        mainApp = firebase.app('mainApp');
    } catch(e) {
        mainApp = firebase.initializeApp(MAIN_CONFIG, 'mainApp');
    }

    try {
        backupApp = firebase.app('backupApp');
    } catch(e) {
        backupApp = firebase.initializeApp(BACKUP_CONFIG, 'backupApp');
    }

    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    auth = firebase.auth(mainApp);

    console.log('✅ Firebase initialized');
    authInitialized = true;
}

// ==================== UPDATE ADMIN UI ====================
function updateAdminUI() {
    if (currentAdmin) {
        const emailEl = document.getElementById('adminEmailDisplay');
        const avatarEl = document.getElementById('adminAvatar');
        if (emailEl) emailEl.textContent = currentAdmin.email;
        if (avatarEl) avatarEl.textContent = currentAdmin.email.charAt(0).toUpperCase();
    }
}

// ==================== SESSION MANAGEMENT ====================
function checkSession() {
    // ✅ पहले Local Storage देखें
    let session = localStorage.getItem('adminSession');
    
    if (session) {
        try {
            const admin = JSON.parse(session);
            if (admin.expiresAt && new Date(admin.expiresAt) > new Date()) {
                currentAdmin = admin;
                updateAdminUI();
                console.log('✅ Session found in localStorage:', admin.email);
                return true;
            } else {
                localStorage.removeItem('adminSession');
                console.log('⏰ Session expired');
            }
        } catch(e) {
            localStorage.removeItem('adminSession');
            console.log('❌ Invalid session');
        }
    }

    // ✅ अगर Local Storage में नहीं, तो Firebase Auth देखें
    if (auth && auth.currentUser) {
        const user = auth.currentUser;
        const adminSession = {
            uid: user.uid,
            email: user.email,
            isAdmin: true,
            loginTime: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        localStorage.setItem('adminSession', JSON.stringify(adminSession));
        currentAdmin = adminSession;
        updateAdminUI();
        console.log('✅ Session created from Firebase Auth:', user.email);
        return true;
    }

    // ❌ कोई Session नहीं
    console.log('❌ No session found');
    return false;
}

function adminLogout() {
    if (!confirm('Are you sure you want to logout?')) return;
    localStorage.removeItem('adminSession');
    if (auth) auth.signOut();
    window.location.href = 'admin-login.html';
}

// ==================== AUTH STATE LISTENER (FIXED) ====================
function setupAuthListener() {
    if (!auth) return;
    
    auth.onAuthStateChanged((user) => {
        if (user) {
            console.log('✅ Auth State: User logged in:', user.email);
            
            // ✅ Session बनाएं या Update करें
            const session = localStorage.getItem('adminSession');
            if (!session) {
                const adminSession = {
                    uid: user.uid,
                    email: user.email,
                    isAdmin: true,
                    loginTime: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                };
                localStorage.setItem('adminSession', JSON.stringify(adminSession));
                currentAdmin = adminSession;
                updateAdminUI();
                console.log('✅ Session created from Auth Listener');
            } else {
                try {
                    const admin = JSON.parse(session);
                    if (admin.email !== user.email) {
                        // Email mismatch - update session
                        const adminSession = {
                            uid: user.uid,
                            email: user.email,
                            isAdmin: true,
                            loginTime: new Date().toISOString(),
                            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                        };
                        localStorage.setItem('adminSession', JSON.stringify(adminSession));
                        currentAdmin = adminSession;
                        updateAdminUI();
                    }
                } catch(e) {}
            }
            
            // ✅ अगर Login Page पर है तो Dashboard पर Redirect करें
            if (window.location.pathname.includes('admin-login.html')) {
                window.location.href = 'index.html';
            }
            
        } else {
            console.log('❌ Auth State: No user');
            
            // ✅ अगर Session है तो Redirect मत करें (Wait for session check)
            if (localStorage.getItem('adminSession')) {
                console.log('⏳ Session exists, waiting for checkSession()');
                return;
            }
            
            // ✅ अगर Login Page पर नहीं हैं तो Redirect करें
            if (!window.location.pathname.includes('admin-login.html')) {
                window.location.href = 'admin-login.html';
            }
        }
    });
}

// ==================== NOTIFICATION ====================
function showNotification(message, type, duration) {
    type = type || 'success';
    duration = duration || 4000;

    const n = document.getElementById('notification');
    if (!n) return;

    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };

    n.style.background = colors[type] || colors.success;
    n.textContent = message;
    n.className = 'notification-toast ' + type + ' show';

    clearTimeout(n._timeout);
    n._timeout = setTimeout(() => {
        n.classList.remove('show');
    }, duration);
}

// ==================== DATE FORMAT ====================
function formatDate(isoString) {
    if (!isoString) return '--';
    try {
        return new Date(isoString).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch(e) {
        return '--';
    }
}

// ==================== LOGS MANAGEMENT ====================
function getLogs() {
    return JSON.parse(localStorage.getItem('backupLogs_v2') || '[]');
}

function addLog(action, status, details) {
    const logs = getLogs();
    logs.unshift({
        time: new Date().toISOString(),
        action: action,
        status: status,
        details: details || ''
    });

    if (logs.length > 100) logs.pop();
    localStorage.setItem('backupLogs_v2', JSON.stringify(logs));
    renderLogs();
}

function clearAllLogs() {
    if (!confirm('Clear all activity logs?')) return;
    localStorage.setItem('backupLogs_v2', '[]');
    renderLogs();
    showNotification('Logs cleared', 'info');
}

function renderLogs() {
    const container = document.getElementById('recentLogs');
    if (!container) return;

    const logs = getLogs();

    if (logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clock"></i>
                <p>No activity yet</p>
            </div>
        `;
        return;
    }

    let html = '';
    logs.slice(0, 20).forEach(log => {
        const badgeClass = log.status === 'success' ? 'success' :
                           log.status === 'failed' ? 'failed' :
                           log.status === 'warning' ? 'warning' : 'info';

        html += `
            <div class="log-entry">
                <span><strong>${log.action}</strong></span>
                <span style="color:#94a3b8;font-size:0.8rem;">${log.details || ''}</span>
                <span><span class="log-badge ${badgeClass}">${log.status}</span></span>
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
    document.getElementById('confirmIcon').className = 'icon ' + (icon === '⚠️' ? 'warning' : icon === '🚨' ? 'danger' : 'info');
    document.getElementById('confirmBtn').textContent = actionLabel || 'Confirm';
    document.getElementById('confirmBtn').className = 'btn ' + (icon === '🚨' ? 'btn-danger' : 'btn-warning');
    document.getElementById('confirmOverlay').classList.add('active');
}

function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    pendingAction = null;
}

function executeConfirmed() {
    document.getElementById('confirmOverlay').classList.remove('active');
    if (pendingAction) {
        pendingAction();
        pendingAction = null;
    }
}

// ==================== LOAD STATS ====================
async function loadStats() {
    try {
        const mainSnap = await mainDB.ref('users').once('value');
        const backupSnap = await backupDB.ref('users').once('value');

        const mainUsers = Object.keys(mainSnap.val() || {}).length;
        const backupUsers = Object.keys(backupSnap.val() || {}).length;

        document.getElementById('totalUsers').textContent = mainUsers;
        document.getElementById('backupUsers').textContent = backupUsers;

        const logs = getLogs();
        const lastSync = logs.find(l => l.action === 'Full Backup');
        document.getElementById('lastSyncTime').textContent = lastSync ? formatDate(lastSync.time) : '--';

        await loadDeletedUsers();
        updateStatusDot();

    } catch(e) {
        console.error('Stats error:', e);
    }
}

async function updateStatusDot() {
    try {
        const snap = await mainDB.ref('.info/connected').once('value');
        const dot = document.getElementById('statusDot');
        if (dot) {
            dot.className = 'status-dot ' + (snap.val() !== null ? 'online' : 'offline');
        }
    } catch(e) {}
}

// ==================== FULL SYNC (WITH CONFIRMATION) ====================
function confirmBackup() {
    showConfirm(
        '📦 Take Backup?',
        'This will copy ALL data from Main Firebase to Backup Firebase. Are you sure you want to continue?',
        '⚠️',
        function() { fullSync(); },
        'Yes, Backup Now'
    );
}

async function fullSync() {
    const btn = document.querySelector('.btn-success');
    const progressDiv = document.getElementById('syncProgress');
    const progressBar = document.getElementById('syncProgressBar');
    const progressText = document.getElementById('syncProgressText');

    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Backing up...';
    progressDiv.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting backup...';

    let synced = 0;
    let failed = 0;
    const total = SYNC_PATHS.length;

    try {
        for (let i = 0; i < total; i++) {
            const path = SYNC_PATHS[i];
            progressText.textContent = `Syncing: ${path}... (${i+1}/${total})`;
            progressBar.style.width = ((i / total) * 100) + '%';

            try {
                const snap = await mainDB.ref(path).once('value');
                const data = snap.val();
                if (data && Object.keys(data).length > 0) {
                    await backupDB.ref(path).set(data);
                    synced++;
                } else {
                    synced++;
                }
            } catch(e) {
                failed++;
                console.error('Sync failed for', path, e);
                progressText.textContent = `❌ Failed: ${path}`;
            }

            await new Promise(r => setTimeout(r, 100));
        }

        progressBar.style.width = '100%';
        progressText.innerHTML = `
            ✅ Backup complete! 
            <span class="highlight">${synced}</span>/${total} paths synced
            ${failed > 0 ? `<span style="color:#ef4444;">(${failed} failed)</span>` : ''}
        `;

        showNotification(
            failed > 0 ? `Backup complete! ${synced}/${total} paths, ${failed} failed` : `Backup complete! ${synced}/${total} paths`,
            failed > 0 ? 'warning' : 'success'
        );

        addLog('Full Backup', failed > 0 ? 'warning' : 'success', `${synced}/${total} paths`);

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate"></i> Backup Now';
        }, 3000);

        await loadStats();

    } catch(e) {
        progressText.textContent = '❌ Error: ' + e.message;
        showNotification('Backup failed: ' + e.message, 'error');
        addLog('Full Backup', 'failed', e.message);

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate"></i> Backup Now';

        setTimeout(() => {
            progressDiv.classList.add('hidden');
        }, 3000);
    }
}

// ==================== RESTORE ALL DATABASE ====================
function confirmRestoreAll() {
    showConfirm(
        '🚨 Restore All Database?',
        '⚠️ WARNING: This will OVERWRITE all data in Main Firebase with data from Backup Firebase! This action CANNOT be undone. Are you absolutely sure?',
        '🚨',
        function() { restoreAllDatabase(); },
        'Yes, Restore All'
    );
}

async function restoreAllDatabase() {
    const btn = document.querySelector('.btn-danger');
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Restoring All...';

    showNotification('Starting full database restore...', 'info');

    try {
        const backupCheck = await backupDB.ref('users').once('value');
        if (!backupCheck.exists()) {
            showNotification('❌ No data found in Backup Firebase!', 'error');
            addLog('Restore All', 'failed', 'No data in backup');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-database"></i> Restore All Database';
            return;
        }

        let restored = 0;
        let failed = 0;
        const total = SYNC_PATHS.length;

        for (const path of SYNC_PATHS) {
            try {
                const snap = await backupDB.ref(path).once('value');
                const data = snap.val();
                if (data && Object.keys(data).length > 0) {
                    await mainDB.ref(path).set(data);
                    restored++;
                }
            } catch(e) {
                failed++;
                console.error('Restore All failed for', path, e);
            }
        }

        showNotification(
            failed > 0 ? `✅ Restore complete! ${restored}/${total} paths, ${failed} failed` : `✅ All ${restored} paths restored successfully!`,
            failed > 0 ? 'warning' : 'success'
        );

        addLog('Restore All Database', failed > 0 ? 'warning' : 'success', `${restored}/${total} paths`);

        await loadStats();
        await loadDeletedUsers();

    } catch(e) {
        showNotification('❌ Restore All failed: ' + e.message, 'error');
        addLog('Restore All Database', 'failed', e.message);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-database"></i> Restore All Database';
}

// ==================== RESTORE USER (WITH CONFIRMATION) ====================
function confirmRestoreUser() {
    const uid = document.getElementById('restoreUid').value.trim();
    if (!uid) {
        showNotification('Please enter a UID first', 'warning');
        return;
    }

    showConfirm(
        '🔄 Restore User?',
        `Are you sure you want to restore user "${uid}" from Backup Firebase to Main Firebase?`,
        '⚠️',
        function() { restoreUser(uid); },
        'Yes, Restore User'
    );
}

async function restoreUser(uid) {
    const container = document.getElementById('restoreResult');

    container.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spinner"></div>
            <p style="margin-top:8px;color:#94a3b8;">Restoring user ${uid}...</p>
        </div>
    `;

    try {
        const backupSnap = await backupDB.ref('users/' + uid).once('value');
        if (!backupSnap.exists()) {
            container.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-circle-exclamation"></i>
                    User <strong>${uid}</strong> not found in backup!
                </div>
            `;
            return;
        }

        let restored = 0;
        let failed = 0;
        const failedPaths = [];

        for (const path of SYNC_PATHS) {
            try {
                const snap = await backupDB.ref(path + '/' + uid).once('value');
                const data = snap.val();
                if (data && Object.keys(data).length > 0) {
                    await mainDB.ref(path + '/' + uid).set(data);
                    restored++;
                }
            } catch(e) {
                failed++;
                failedPaths.push(path);
                console.error('Restore failed for', path, e);
            }
        }

        container.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>User ${uid} restored successfully!</strong>
                    <br><small>Restored: ${restored} paths | Failed: ${failed} ${failedPaths.length > 0 ? '('+failedPaths.join(', ')+')' : ''}</small>
                </div>
            </div>
        `;

        showNotification(`User ${uid} restored!`, 'success');
        addLog('Restore User', 'success', `UID: ${uid} (${restored} paths)`);

        await loadDeletedUsers();
        await loadStats();

        document.getElementById('restoreUid').value = '';

    } catch(e) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${e.message}
            </div>
        `;
        addLog('Restore User', 'failed', `UID: ${uid} - ${e.message}`);
    }
}

// ==================== DELETED USERS ====================
async function loadDeletedUsers() {
    const container = document.getElementById('deletedUsersList');
    const alertContainer = document.getElementById('alertContainer');

    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spinner"></div>
            <p style="margin-top:8px;color:#94a3b8;">Checking for deleted users...</p>
        </div>
    `;

    try {
        const mainSnap = await mainDB.ref('users').once('value');
        const backupSnap = await backupDB.ref('users').once('value');

        const mainUsers = mainSnap.val() || {};
        const backupUsers = backupSnap.val() || {};

        const deleted = [];
        for (const uid of Object.keys(backupUsers)) {
            if (!mainUsers[uid]) {
                deleted.push({
                    uid: uid,
                    data: backupUsers[uid]
                });
            }
        }

        document.getElementById('deletedCount').textContent = deleted.length;

        if (deleted.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>No deleted users found</p>
                </div>
            `;
            if (alertContainer) {
                alertContainer.innerHTML = '';
            }
            return;
        }

        if (alertContainer) {
            const latest = deleted[0];
            alertContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-triangle-exclamation"></i>
                    <div style="flex:1;">
                        <strong>${deleted.length} user(s) deleted from Main Firebase!</strong>
                        <br>Latest: ${latest.uid} (${latest.data?.name || 'Unknown'})
                        <br>
                        <button class="btn btn-danger btn-sm" style="margin-top:8px;" 
                                onclick="document.getElementById('restoreUid').value='${latest.uid}';
                                        confirmRestoreUser();">
                            <i class="fas fa-rotate-left"></i> Recover Now
                        </button>
                        <button class="btn btn-outline btn-sm" style="margin-top:8px;" 
                                onclick="document.getElementById('alertContainer').innerHTML=''">
                            <i class="fas fa-times"></i> Dismiss
                        </button>
                    </div>
                </div>
            `;
        }

        let html = `
            <div style="margin-bottom:12px;color:#94a3b8;font-size:0.9rem;">
                <strong style="color:#ef4444;">${deleted.length}</strong> deleted users found
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>UID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        deleted.forEach(user => {
            const displayUid = user.uid.length > 20 ? user.uid.slice(0, 18) + '...' : user.uid;
            html += `
                <tr>
                    <td style="font-family:monospace;font-size:0.8rem;" title="${user.uid}">${displayUid}</td>
                    <td>${user.data?.name || user.data?.displayName || 'Unknown'}</td>
                    <td>${user.data?.email || 'N/A'}</td>
                    <td>
                        <button class="btn btn-danger btn-sm" 
                                onclick="document.getElementById('restoreUid').value='${user.uid}';
                                        confirmRestoreUser();">
                            <i class="fas fa-rotate-left"></i> Restore
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

    } catch(e) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${e.message}
            </div>
        `;
        console.error('Load deleted users error:', e);
    }
}

// ==================== CHECK BACKUP STATUS ====================
async function checkBackupStatus() {
    showNotification('Checking backup status...', 'info');

    try {
        let mainTotal = 0;
        let backupTotal = 0;
        let mainPaths = {};
        let backupPaths = {};

        for (const path of SYNC_PATHS) {
            const m = await mainDB.ref(path).once('value');
            const b = await backupDB.ref(path).once('value');
            const mainCount = Object.keys(m.val() || {}).length;
            const backupCount = Object.keys(b.val() || {}).length;

            mainTotal += mainCount;
            backupTotal += backupCount;
            mainPaths[path] = mainCount;
            backupPaths[path] = backupCount;
        }

        let statusMsg = `✅ Main: ${mainTotal} records | Backup: ${backupTotal} records`;
        let statusType = mainTotal === backupTotal ? 'success' : 'warning';

        let mismatch = false;
        let mismatchDetails = [];
        for (const path of SYNC_PATHS) {
            if (mainPaths[path] !== backupPaths[path]) {
                mismatch = true;
                mismatchDetails.push(`${path}: Main=${mainPaths[path]}, Backup=${backupPaths[path]}`);
            }
        }

        if (mismatch) {
            statusMsg = `⚠️ Mismatch found! ` + mismatchDetails.join(' | ');
            statusType = 'warning';
            addLog('Status Check', 'warning', mismatchDetails.join(', '));
        } else {
            addLog('Status Check', 'success', `Main: ${mainTotal}, Backup: ${backupTotal}`);
        }

        showNotification(statusMsg, statusType, 6000);

    } catch(e) {
        showNotification('Error checking status: ' + e.message, 'error');
        addLog('Status Check', 'failed', e.message);
    }
}

// ==================== AUTO DELETE LISTENER ====================
function setupDeleteListener() {
    mainDB.ref('users').on('child_removed', (snap) => {
        const uid = snap.key;
        const user = snap.val();

        if (!uid) return;

        showNotification(
            `⚠️ User ${uid} (${user?.name || 'Unknown'}) was deleted! Click "Check Deleted" to recover.`,
            'warning',
            8000
        );

        addLog('User Deleted', 'warning', `UID: ${uid} - ${user?.name || 'Unknown'}`);

        setTimeout(() => {
            loadDeletedUsers();
            loadStats();
        }, 1000);
    });
}

// ==================== KEYBOARD SHORTCUTS ====================
function setupKeyboardShortcuts() {
    const restoreInput = document.getElementById('restoreUid');
    if (restoreInput) {
        restoreInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmRestoreUser();
            }
        });
    }
}

// ==================== INIT (FIXED ORDER) ====================
async function init() {
    console.log('🚀 Starting RND Backup System...');

    // ✅ STEP 1: सबसे पहले Firebase Initialize करें
    initFirebase();

    // ✅ STEP 2: Auth Listener Setup
    setupAuthListener();

    // ✅ STEP 3: अब Session Check करें
    if (!checkSession()) {
        console.log('❌ Session check failed, redirecting to login...');
        window.location.href = 'admin-login.html';
        return;
    }

    console.log('✅ Session check passed, loading dashboard...');

    // ✅ STEP 4: Dashboard Load करें
    await loadStats();
    renderLogs();
    await loadDeletedUsers();

    setupDeleteListener();
    setupKeyboardShortcuts();

    // ✅ Periodic updates
    setInterval(updateStatusDot, 30000);
    setInterval(() => {
        loadDeletedUsers();
    }, 60000);

    addLog('System Started', 'success', 'v2.1');

    console.log('✅ RND Backup System v2.1 Started');
    console.log('📧 Admin:', currentAdmin?.email);
    console.log('📊 Sync Paths:', SYNC_PATHS);
}

// ✅ DOM Ready होने पर Start करें
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
