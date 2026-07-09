// ==================== RND BACKUP SYSTEM v3.0 - COMPLETE LOGIC ====================

// ==================== FIREBASE CONFIG ====================
const MAIN_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAz-TLmOhiy-_vHHmIjW8gyIOqTR_PT9o0",
    authDomain: "rnd2-70080.firebaseapp.com",
    databaseURL: "https://rnd2-70080-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "rnd2-70080",
    storageBucket: "rnd2-70080.firebasestorage.app",
    messagingSenderId: "468625887938",
    appId: "1:468625887938:web:5cb4ddbcf31b6fc0a4615b"
};

const BACKUP_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCzHmIimieea8H9KzYFDSqD0lGOCZjxHYw",
    authDomain: "myapp-ee226.firebaseapp.com",
    databaseURL: "https://myapp-ee226-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "myapp-ee226",
    storageBucket: "myapp-ee226.firebasestorage.app",
    messagingSenderId: "272405753135",
    appId: "1:468625887938:web:598ec27c28bcf6b04105da"
};

// ==================== INITIALIZE ====================
let mainApp, backupApp, mainDB, backupDB, functions, auth;

function initializeFirebase() {
    try { mainApp = firebase.app('mainApp'); } catch(e) {
        mainApp = firebase.initializeApp(MAIN_FIREBASE_CONFIG, 'mainApp');
    }
    try { backupApp = firebase.app('backupApp'); } catch(e) {
        backupApp = firebase.initializeApp(BACKUP_FIREBASE_CONFIG, 'backupApp');
    }
    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    functions = firebase.functions(mainApp);
    auth = firebase.auth(mainApp);
}

// ==================== DATA PATHS ====================
const SYNC_PATHS = ['users', 'profiles', 'wallets', 'deposits', 'withdrawals', 'referrals', 'dailyReleases', 'staking', 'packages', 'transactions', 'incomeHistory', 'rewardHistory'];
const USER_DATA_PATHS = ['users', 'profiles', 'wallets', 'deposits', 'withdrawals', 'referrals', 'dailyReleases', 'staking', 'packages', 'transactions', 'incomeHistory', 'rewardHistory'];

// ==================== STATE ====================
const BackupState = {
    logs: [], deletedUsers: [], failedSyncCount: 0, lastSyncTime: null, lastBackupTime: null,
    load() {
        this.logs = JSON.parse(localStorage.getItem('rnd_backup_logs_v3') || '[]');
        this.deletedUsers = JSON.parse(localStorage.getItem('rnd_deleted_users_v3') || '[]');
        this.failedSyncCount = parseInt(localStorage.getItem('rnd_failed_sync_v3') || '0');
        this.lastSyncTime = localStorage.getItem('rnd_last_sync_v3');
        this.lastBackupTime = localStorage.getItem('rnd_last_backup_v3');
    },
    save() {
        localStorage.setItem('rnd_backup_logs_v3', JSON.stringify(this.logs));
        localStorage.setItem('rnd_deleted_users_v3', JSON.stringify(this.deletedUsers));
        localStorage.setItem('rnd_failed_sync_v3', this.failedSyncCount.toString());
        localStorage.setItem('rnd_last_sync_v3', this.lastSyncTime || '');
        localStorage.setItem('rnd_last_backup_v3', this.lastBackupTime || '');
    }
};

// ==================== UTILS ====================
const Utils = {
    formatDate(isoString) {
        if (!isoString) return '--';
        try { return new Date(isoString).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        catch(e) { return '--'; }
    },
    formatRelativeTime(isoString) {
        if (!isoString) return 'Never';
        const diff = Date.now() - new Date(isoString).getTime();
        const sec = Math.floor(diff / 1000), min = Math.floor(sec / 60), hr = Math.floor(min / 60), day = Math.floor(hr / 24);
        if (sec < 60) return 'Just now';
        if (min < 60) return min + 'm ago';
        if (hr < 24) return hr + 'h ago';
        if (day < 30) return day + 'd ago';
        return this.formatDate(isoString);
    },
    deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); },
    showNotification(msg, type, duration) {
        type = type || 'success'; duration = duration || 4000;
        const n = document.getElementById('notification');
        if (!n) return;
        const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
        n.style.background = colors[type] || colors.success;
        n.textContent = msg;
        n.className = 'notification-toast ' + type + ' show';
        clearTimeout(n._timeout);
        n._timeout = setTimeout(() => n.classList.remove('show'), duration);
    },
    isSuperAdmin() { return window.currentAdmin?.isSuperAdmin === true; },
    isLiveDomain() { const h = window.location.hostname; return !h.includes('localhost') && !h.includes('127.0.0.1'); }
};

// ==================== LOGGER ====================
const Logger = {
    add(action, status, details) {
        const log = { id: Date.now() + Math.random().toString(36).substr(2, 5), timestamp: new Date().toISOString(), action, status, details, admin: window.currentAdmin?.email || 'Admin' };
        BackupState.logs.unshift(log);
        if (BackupState.logs.length > 1000) BackupState.logs.pop();
        BackupState.save();
        updateLogBadge();
        return log;
    },
    getRecent(limit) { return BackupState.logs.slice(0, limit || 100); },
    clear() { BackupState.logs = []; BackupState.save(); updateLogBadge(); },
    export() { return JSON.stringify(BackupState.logs, null, 2); }
};

// ==================== CLOUD FUNCTIONS ====================
const cloud = {
    async call(name, data) {
        try {
            const fn = functions.httpsCallable(name);
            const result = await fn(data || {});
            return result.data;
        } catch(e) {
            console.error('Cloud Function error:', e);
            throw e;
        }
    },
    async restoreUser(uid) { return this.call('restoreUser', { uid }); },
    async restoreAllUsers() { return this.call('restoreAllUsers', {}); },
    async downloadBackup() { return this.call('downloadBackup', {}); },
    async runHealthCheck() { return this.call('runHealthCheck', {}); }
};

// ==================== UI FUNCTIONS ====================

function updateLogBadge() {
    const badge = document.getElementById('logBadge');
    if (badge) {
        const count = BackupState.logs.length;
        badge.textContent = count > 0 ? count : '';
        badge.style.display = count > 0 ? 'inline' : 'none';
    }
}

function renderLogs() {
    const container = document.getElementById('activityLog');
    if (!container) return;
    const logs = Logger.getRecent(100);
    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><h3>No Activity Logs</h3><p>Backup activities will appear here</p></div>';
        return;
    }
    let html = '';
    logs.forEach(log => {
        const cls = log.status === 'success' ? 'success' : log.status === 'failed' ? 'failed' : 'warning';
        html += `<div class="log-entry"><span class="log-time">${Utils.formatDate(log.timestamp)}</span><span class="log-badge ${cls}">${log.status}</span><span><strong>${log.action}</strong></span><span style="color:var(--text-muted);margin-left:auto;font-size:0.8rem;">${log.details || ''}</span></div>`;
    });
    container.innerHTML = html;
}

function refreshLogs() { renderLogs(); Utils.showNotification('Logs refreshed', 'info'); }
function clearLogs() { if (!confirm('Clear all logs?')) return; Logger.clear(); renderLogs(); Utils.showNotification('Logs cleared', 'info'); }
function exportLogs() {
    const data = Logger.export();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RND_Backup_Logs_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    Utils.showNotification('Logs exported', 'success');
}

function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const items = document.querySelectorAll('.nav-item');
    items.forEach(item => {
        const text = item.textContent.trim().toLowerCase();
        const id = sectionId.replace('-', ' ');
        if (text.includes(id) || id.includes(text)) item.classList.add('active');
    });
    if (window.innerWidth <= 768) toggleSidebar(false);
    if (sectionId === 'logs') renderLogs();
    if (sectionId === 'deleted') renderDeletedUsers();
    if (sectionId === 'status') checkBackupStatus();
    if (sectionId === 'dashboard') loadDashboard();
    if (sectionId === 'health') runHealthCheck();
}

function toggleSidebar(force) {
    const s = document.getElementById('sidebar'), o = document.getElementById('mobileOverlay');
    const open = s.classList.contains('open');
    if (force === false || (force === undefined && open)) { s.classList.remove('open'); o.classList.remove('active'); }
    else { s.classList.add('open'); o.classList.add('active'); }
}

function openModal(title, body, footer) {
    document.getElementById('modalTitle').innerHTML = '<i class="fas fa-info-circle"></i> ' + title;
    document.getElementById('modalBody').innerHTML = body || '';
    document.getElementById('modalFooter').innerHTML = footer || '';
    document.getElementById('modal').style.display = 'flex';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

// ==================== DASHBOARD ====================
async function loadDashboard() {
    try {
        await checkConnections();
        await loadStats();
        loadRecentActivity();
        updateAdminProfile();
        updateRestoreAllButton();
    } catch(e) { console.error('Dashboard error:', e); }
}

async function checkConnections() {
    try {
        const ms = await mainDB.ref('.info/connected').once('value');
        document.getElementById('mainStatusDot').className = 'status-dot ' + (ms.val() !== null ? 'online' : 'offline');
        const bs = await backupDB.ref('.info/connected').once('value');
        document.getElementById('backupStatusDot').className = 'status-dot ' + (bs.val() !== null ? 'online' : 'offline');
    } catch(e) {
        document.getElementById('mainStatusDot').className = 'status-dot offline';
        document.getElementById('backupStatusDot').className = 'status-dot offline';
    }
}

async function loadStats() {
    try {
        const snap = await mainDB.ref('users').once('value');
        const users = snap.val() || {};
        const total = Object.keys(users).length;
        const active = Object.values(users).filter(u => u.status === 'active').length;
        document.getElementById('totalUsers').textContent = total;
        document.getElementById('activeUsers').textContent = active;
        document.getElementById('lastSync').textContent = Utils.formatRelativeTime(BackupState.lastSyncTime);
        document.getElementById('lastBackup').textContent = Utils.formatRelativeTime(BackupState.lastBackupTime);
        document.getElementById('failedSync').textContent = BackupState.failedSyncCount;
        document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
        document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;
        await detectDeletedUsers();
    } catch(e) { console.error('Stats error:', e); }
}

function loadRecentActivity() {
    const container = document.getElementById('recentActivity');
    if (!container) return;
    const logs = Logger.getRecent(10);
    if (logs.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">No recent activity</div>';
        return;
    }
    let html = '';
    logs.forEach(log => {
        const cls = log.status === 'success' ? 'success' : log.status === 'failed' ? 'failed' : 'warning';
        html += `<div class="log-entry"><span class="log-time">${Utils.formatDate(log.timestamp)}</span><span class="log-badge ${cls}">${log.status}</span><span><strong>${log.action}</strong></span><span style="color:var(--text-muted);margin-left:auto;font-size:0.8rem;">${log.details || ''}</span></div>`;
    });
    container.innerHTML = html;
}

function updateAdminProfile() {
    const admin = window.currentAdmin;
    if (!admin) return;
    const avatar = document.getElementById('adminAvatar');
    if (avatar) avatar.textContent = admin.email.charAt(0).toUpperCase();
    const nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.textContent = admin.email;
    const roleEl = document.getElementById('adminRole');
    if (roleEl) roleEl.innerHTML = admin.isSuperAdmin ? '<span class="super">★ Super Admin</span>' : '<span>Admin</span>';
}

function updateRestoreAllButton() {
    const btn = document.getElementById('restoreAllBtn');
    const badge = document.getElementById('restoreAllBadge');
    const perm = document.getElementById('restoreAllPermission');
    const warn = document.getElementById('restoreAllWarning');
    const isSuper = Utils.isSuperAdmin();
    const isLive = Utils.isLiveDomain();
    if (btn) {
        if (isSuper && !isLive) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users'; btn.className = 'btn btn-danger btn-lg'; }
        else if (isSuper && isLive) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-lock"></i> 🔒 Live Domain Locked'; btn.className = 'btn btn-outline btn-lg'; }
        else { btn.disabled = true; btn.innerHTML = '<i class="fas fa-lock"></i> Super Admin Only'; btn.className = 'btn btn-outline btn-lg'; }
    }
    if (badge) { badge.textContent = (isSuper && !isLive) ? 'UNLOCKED' : 'LOCKED'; badge.className = 'badge ' + ((isSuper && !isLive) ? 'success' : 'danger'); }
    if (perm) perm.innerHTML = (isSuper && !isLive) ? '<span style="color:var(--secondary);">✓ Super Admin Access</span>' : '<span style="color:var(--danger);">❌ Super Admin Required</span>';
    if (warn) { warn.innerHTML = (isSuper && !isLive) ? '⚠️ Type <strong>"RESTORE ALL"</strong> to confirm' : '🔒 <strong>Restore All</strong> is locked for security'; }
}

// ==================== SEARCH ====================
async function searchUser() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) { Utils.showNotification('Enter a search query', 'warning'); return; }
    const container = document.getElementById('searchResults');
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Searching...</p></div>';
    try {
        const snap = await mainDB.ref('users').once('value');
        const users = snap.val() || {};
        const results = [];
        const q = query.toLowerCase();
        Object.entries(users).forEach(([uid, user]) => {
            if (uid.toLowerCase().includes(q) || (user.email && user.email.toLowerCase().includes(q)) || (user.name && user.name.toLowerCase().includes(q))) {
                results.push({ uid, ...user });
            }
        });
        if (results.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><h3>No Users Found</h3><p>Try a different search term</p></div>';
            return;
        }
        let html = `<div style="margin-bottom:12px;color:var(--text-muted);font-size:0.9rem;">Found <strong style="color:var(--text);">${results.length}</strong> users</div><div class="table-responsive"><table class="data-table"><thead><tr><th>UID</th><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
        results.forEach(user => {
            html += `<tr><td class="uid-cell">${user.uid.slice(0,12)}</td><td>${user.name || 'N/A'}</td><td>${user.email || 'N/A'}</td><td><span class="tag ${user.status === 'active' ? 'tag-success' : 'tag-warning'}">${user.status || 'N/A'}</span></td><td class="actions"><button class="btn btn-outline btn-sm" onclick="compareSingleUser('${user.uid}')"><i class="fas fa-code-compare"></i></button><button class="btn btn-success btn-sm" onclick="syncSingleUser('${user.uid}')"><i class="fas fa-rotate"></i></button><button class="btn btn-danger btn-sm" onclick="restoreSingleUser('${user.uid}')"><i class="fas fa-rotate-left"></i></button></td></tr>`;
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error: ' + e.message + '</div>';
    }
}

// ==================== COMPARE ====================
async function compareUserData() {
    const uid = document.getElementById('compareInput').value.trim();
    if (!uid) { Utils.showNotification('Enter a UID', 'warning'); return; }
    await compareSingleUser(uid);
}

async function compareSingleUser(uid) {
    const container = document.getElementById('compareResults');
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Comparing data...</p></div>';
    try {
        const main = {}, backup = {};
        let mismatch = false, total = 0, matched = 0;
        for (const path of USER_DATA_PATHS) {
            total++;
            const ms = await mainDB.ref(path + '/' + uid).once('value');
            const bs = await backupDB.ref(path + '/' + uid).once('value');
            main[path] = ms.val();
            backup[path] = bs.val();
            if (!Utils.deepEqual(main[path], backup[path])) mismatch = true;
            else matched++;
        }
        let html = `<div style="margin-bottom:16px;">${mismatch ? '<div class="alert alert-warning"><i class="fas fa-triangle-exclamation"></i><div><strong>Mismatch Found!</strong><br>' + matched + '/' + total + ' paths matched</div></div>' : '<div class="alert alert-success"><i class="fas fa-check-circle"></i><div><strong>Data Matched!</strong><br>All ' + total + ' paths are identical</div></div>'}</div>`;
        html += '<div class="compare-grid"><div class="compare-column main"><h4><i class="fas fa-server"></i> Main Firebase</h4>';
        for (const path of USER_DATA_PATHS) {
            const isMis = !Utils.deepEqual(main[path], backup[path]);
            html += `<div class="compare-row ${isMis ? 'mismatch' : ''}"><span class="label">${path}</span><span class="value" style="${isMis ? 'color:var(--danger);' : 'color:var(--secondary);'}">${main[path] !== null ? 'Present' : 'Missing'} ${isMis ? '❌' : '✓'}</span></div>`;
        }
        html += '</div><div class="compare-column backup"><h4><i class="fas fa-shield-halved"></i> Backup Firebase</h4>';
        for (const path of USER_DATA_PATHS) {
            const isMis = !Utils.deepEqual(main[path], backup[path]);
            html += `<div class="compare-row ${isMis ? 'mismatch' : ''}"><span class="label">${path}</span><span class="value" style="${isMis ? 'color:var(--danger);' : 'color:var(--secondary);'}">${backup[path] !== null ? 'Present' : 'Missing'} ${isMis ? '❌' : '✓'}</span></div>`;
        }
        html += '</div></div>';
        if (mismatch) html += `<div style="margin-top:20px;text-align:center;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;"><button class="btn btn-success" onclick="syncSingleUser('${uid}')"><i class="fas fa-rotate"></i> Sync Now</button><button class="btn btn-danger" onclick="restoreSingleUser('${uid}')"><i class="fas fa-rotate-left"></i> Restore</button></div>`;
        container.innerHTML = html;
        Logger.add('Compare Data', 'success', 'UID: ' + uid + (mismatch ? ' - Mismatch' : ' - Matched'));
    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error: ' + e.message + '</div>';
        Logger.add('Compare Data', 'failed', 'UID: ' + uid + ' - ' + e.message);
    }
}

// ==================== SYNC ====================
async function syncUser() {
    const uid = document.getElementById('syncInput').value.trim();
    if (!uid) { Utils.showNotification('Enter a UID', 'warning'); return; }
    await syncSingleUser(uid);
}

async function syncSingleUser(uid) {
    const container = document.getElementById('syncResults');
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Syncing user data...</p></div>';
    try {
        let paths = [];
        for (const path of USER_DATA_PATHS) {
            const snap = await mainDB.ref(path + '/' + uid).once('value');
            const data = snap.val();
            if (data !== null) { await backupDB.ref(path + '/' + uid).set(data); paths.push(path); }
        }
        BackupState.lastSyncTime = new Date().toISOString();
        BackupState.save();
        container.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i><div><strong>User synced!</strong><br>UID: <code>${uid}</code><br><small>Synced: ${paths.join(', ') || 'None'}</small></div></div>`;
        Logger.add('Sync User', 'success', 'UID: ' + uid + ' - ' + paths.length + ' paths');
        Utils.showNotification('User synced!');
        loadDashboard();
    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error: ' + e.message + '</div>';
        Logger.add('Sync User', 'failed', 'UID: ' + uid + ' - ' + e.message);
    }
}

// ==================== RESTORE ====================
async function restoreUser() {
    const uid = document.getElementById('restoreInput').value.trim();
    if (!uid) { Utils.showNotification('Enter a UID', 'warning'); return; }
    await restoreSingleUser(uid);
}

async function restoreSingleUser(uid) {
    const container = document.getElementById('restoreResults');
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Restoring user...</p></div>';
    try {
        const result = await cloud.restoreUser(uid);
        const paths = result.results?.filter(r => r.restored).map(r => r.path) || [];
        BackupState.deletedUsers = BackupState.deletedUsers.filter(u => u.uid !== uid);
        BackupState.save();
        container.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i><div><strong>User restored!</strong><br>UID: <code>${uid}</code><br><small>Restored: ${paths.join(', ') || 'None'}</small></div></div>`;
        Logger.add('Restore User', 'success', 'UID: ' + uid);
        Utils.showNotification('User restored!');
        loadDashboard();
    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error: ' + e.message + '</div>';
        Logger.add('Restore User', 'failed', 'UID: ' + uid + ' - ' + e.message);
    }
}

// ==================== RESTORE ALL ====================
async function restoreAllUsers() {
    if (!Utils.isSuperAdmin()) { Utils.showNotification('Super Admin required!', 'error'); return; }
    if (Utils.isLiveDomain()) { Utils.showNotification('🔒 Disabled on live domain', 'warning', 6000); return; }
    if (!confirm('⚠️ WARNING: This will overwrite ALL data. Are you sure?')) return;
    if (!confirm('🔴 Type "RESTORE ALL" to confirm.')) return;
    if (!confirm('🔴 FINAL: Type "RESTORE ALL" again.')) return;

    const btn = document.getElementById('restoreAllBtn');
    const prog = document.getElementById('restoreAllProgress');
    const bar = document.getElementById('restoreAllProgressBar');
    const text = document.getElementById('restoreAllProgressText');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Restoring...';
    prog.style.display = 'block';

    try {
        const result = await cloud.restoreAllUsers();
        bar.style.width = '100%';
        text.innerHTML = '<span class="highlight">' + result.restored + '</span> users restored, <span style="color:var(--danger);">' + result.failed + '</span> failed';
        Utils.showNotification(result.failed > 0 ? result.restored + ' restored, ' + result.failed + ' failed' : 'All ' + result.restored + ' users restored!', result.failed > 0 ? 'warning' : 'success');
        Logger.add('Restore All Users', 'success', result.restored + ' restored, ' + result.failed + ' failed');
        btn.innerHTML = '<i class="fas fa-check"></i> Complete';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users'; prog.style.display = 'none'; bar.style.width = '0%'; }, 3000);
        loadDashboard();
    } catch(e) {
        Utils.showNotification('Restore failed: ' + e.message, 'error');
        Logger.add('Restore All Users', 'failed', e.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users';
        prog.style.display = 'none';
    }
}

// ==================== DELETED USERS ====================
async function detectDeletedUsers() {
    try {
        const ms = await mainDB.ref('users').once('value');
        const bs = await backupDB.ref('users').once('value');
        const main = ms.val() || {}, backup = bs.val() || {};
        const mainIds = Object.keys(main), backupIds = Object.keys(backup);
        const newDeleted = backupIds.filter(id => !mainIds.includes(id));
        let added = 0;
        newDeleted.forEach(uid => {
            const user = backup[uid];
            if (!BackupState.deletedUsers.find(u => u.uid === uid)) {
                BackupState.deletedUsers.unshift({ uid, name: user?.name || 'Unknown', email: user?.email || 'N/A', deletedAt: new Date().toISOString() });
                added++;
            }
        });
        if (added > 0) { BackupState.save(); Logger.add('Deleted Users', 'warning', added + ' new'); }
        document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
        document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;
        const alertContainer = document.getElementById('deletedAlertContainer');
        if (BackupState.deletedUsers.length > 0 && alertContainer) {
            const latest = BackupState.deletedUsers[0];
            alertContainer.innerHTML = `<div class="alert alert-danger"><i class="fas fa-triangle-exclamation"></i><div style="flex:1;"><strong>${BackupState.deletedUsers.length} User(s) Deleted!</strong><br>Latest: ${latest.name} (${latest.uid.slice(0,10)})<br><button class="btn btn-success btn-sm" style="margin-top:8px;" onclick="restoreSingleUser('${latest.uid}')"><i class="fas fa-rotate-left"></i> Recover</button><button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="document.getElementById('deletedAlertContainer').innerHTML=''"><i class="fas fa-times"></i> Dismiss</button></div></div>`;
        } else if (alertContainer) { alertContainer.innerHTML = ''; }
    } catch(e) { console.error('Deleted detection error:', e); }
}

function refreshDeletedUsers() { detectDeletedUsers(); renderDeletedUsers(); Utils.showNotification('Refreshed', 'info'); }

function renderDeletedUsers() {
    const container = document.getElementById('deletedUsersList');
    if (!container) return;
    if (BackupState.deletedUsers.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>No Deleted Users</h3><p>All users are present in both databases</p></div>';
        return;
    }
    let html = `<div style="margin-bottom:12px;color:var(--text-muted);font-size:0.9rem;"><strong style="color:var(--danger);">${BackupState.deletedUsers.length}</strong> deleted users</div><div class="table-responsive"><table class="data-table"><thead><tr><th>UID</th><th>Name</th><th>Email</th><th>Deleted At</th><th>Actions</th></tr></thead><tbody>`;
    BackupState.deletedUsers.forEach(user => {
        html += `<tr><td>${user.uid.slice(0,12)}</td><td>${user.name}</td><td>${user.email}</td><td>${Utils.formatDate(user.deletedAt)}</td><td class="actions"><button class="btn btn-success btn-sm" onclick="restoreSingleUser('${user.uid}')"><i class="fas fa-rotate-left"></i> Restore</button><button class="btn btn-outline btn-sm" onclick="compareSingleUser('${user.uid}')"><i class="fas fa-code-compare"></i></button><button class="btn btn-danger btn-sm" onclick="removeDeletedUser('${user.uid}')"><i class="fas fa-times"></i></button></td></tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function removeDeletedUser(uid) {
    if (!confirm('Remove ' + uid + ' from deleted list?')) return;
    BackupState.deletedUsers = BackupState.deletedUsers.filter(u => u.uid !== uid);
    BackupState.save();
    renderDeletedUsers();
    document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
    document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;
}

// ==================== STATUS ====================
async function checkBackupStatus() {
    try {
        await mainDB.ref('.info/connected').once('value');
        document.getElementById('mainDbStatus').innerHTML = '<span class="tag tag-success"><i class="fas fa-check"></i> Online</span>';
    } catch(e) { document.getElementById('mainDbStatus').innerHTML = '<span class="tag tag-danger"><i class="fas fa-xmark"></i> Offline</span>'; }
    try {
        await backupDB.ref('.info/connected').once('value');
        document.getElementById('backupDbStatus').innerHTML = '<span class="tag tag-success"><i class="fas fa-check"></i> Online</span>';
    } catch(e) { document.getElementById('backupDbStatus').innerHTML = '<span class="tag tag-danger"><i class="fas fa-xmark"></i> Offline</span>'; }
    const mainOnline = document.getElementById('mainDbStatus').innerHTML.includes('Online');
    const backupOnline = document.getElementById('backupDbStatus').innerHTML.includes('Online');
    document.getElementById('syncStatus').innerHTML = mainOnline && backupOnline ? '<span class="tag tag-success"><i class="fas fa-check"></i> Active</span>' : '<span class="tag tag-danger"><i class="fas fa-xmark"></i> Inactive</span>';
    let total = 0;
    for (const path of SYNC_PATHS) {
        try { const snap = await backupDB.ref(path).once('value'); total += Object.keys(snap.val() || {}).length; } catch(e) {}
    }
    document.getElementById('totalRecords').textContent = total;
}

// ==================== HEALTH ====================
async function runHealthCheck() {
    const container = document.getElementById('healthResults');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Running health check...</p></div>';
    try {
        const result = await cloud.runHealthCheck();
        let html = `<div style="margin-bottom:16px;"><div class="alert ${result.status === 'healthy' ? 'alert-success' : 'alert-danger'}"><i class="fas fa-${result.status === 'healthy' ? 'check-circle' : 'triangle-exclamation'}"></i><div><strong>Health: ${result.status === 'healthy' ? '✅ All Good' : '⚠️ Issues Found'}</strong><br><span style="font-size:0.85rem;">Checked: ${Utils.formatDate(result.timestamp)}</span></div></div></div>`;
        if (result.checks?.users) {
            const u = result.checks.users;
            const match = u.main === u.backup;
            html += `<div style="padding:12px;background:var(--darker);border-radius:8px;margin-bottom:8px;border-left:3px solid ${match ? 'var(--secondary)' : 'var(--danger)'};"><div style="display:flex;justify-content:space-between;"><span><i class="fas fa-users"></i> Users</span><span>Main: <strong>${u.main}</strong> | Backup: <strong>${u.backup}</strong> ${match ? '✅' : '❌'}</span></div></div>`;
        }
        if (result.checks?.paths) {
            result.checks.paths.forEach(p => {
                const match = p.main === p.backup;
                html += `<div style="padding:12px;background:var(--darker);border-radius:8px;margin-bottom:8px;border-left:3px solid ${match ? 'var(--secondary)' : 'var(--danger)'};"><div style="display:flex;justify-content:space-between;"><span><i class="fas fa-database"></i> ${p.path}</span><span>Main: <strong>${p.main}</strong> | Backup: <strong>${p.backup}</strong> ${match ? '✅' : '❌'}</span></div></div>`;
            });
        }
        if (result.alerts?.length > 0) {
            html += `<div style="margin-top:16px;padding:12px;background:rgba(239,68,68,0.08);border-radius:8px;border:1px solid rgba(239,68,68,0.2);"><h4 style="color:var(--danger);"><i class="fas fa-bell"></i> Alerts</h4>`;
            result.alerts.forEach(a => { html += `<div style="padding:4px 0;color:#fca5a5;">⚠️ ${a}</div>`; });
            html += '</div>';
        }
        container.innerHTML = html;
        const badge = document.getElementById('healthBadge');
        if (badge) { badge.textContent = result.status === 'healthy' ? 'OK' : '⚠️'; badge.className = 'badge ' + (result.status === 'healthy' ? 'success' : 'warning'); }
        const alertContainer = document.getElementById('healthAlertContainer');
        if (alertContainer) {
            if (result.status !== 'healthy') {
                alertContainer.innerHTML = `<div class="alert alert-warning"><i class="fas fa-stethoscope"></i><div><strong>Health Alert!</strong><br>${result.alerts?.join(', ') || 'Issues detected'}<br><button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="showSection('health')"><i class="fas fa-eye"></i> View</button></div></div>`;
            } else { alertContainer.innerHTML = ''; }
        }
    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Health check failed: ' + e.message + '</div>';
    }
}

// ==================== DOWNLOAD ====================
async function downloadBackup() {
    const btn = document.querySelector('#download .btn-primary');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Generating...';
    try {
        const result = await cloud.downloadBackup();
        if (result.url) { window.open(result.url, '_blank'); Utils.showNotification('Backup download started!'); Logger.add('Download Backup', 'success'); }
    } catch(e) { Utils.showNotification('Download failed: ' + e.message, 'error'); Logger.add('Download Backup', 'failed', e.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download Backup'; }
}

// ==================== FULL SYNC ====================
async function triggerFullSync() {
    const btn = document.querySelector('#dashboard .btn-success');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Syncing...';
    try {
        let synced = 0;
        for (const path of SYNC_PATHS) {
            try { const snap = await mainDB.ref(path).once('value'); const data = snap.val(); if (data) { await backupDB.ref(path).set(data); synced++; } } catch(e) { console.error('Sync failed for', path, e); }
        }
        BackupState.lastSyncTime = new Date().toISOString();
        BackupState.save();
        Logger.add('Full Sync', 'success', synced + '/' + SYNC_PATHS.length + ' paths');
        Utils.showNotification('Full sync completed! ' + synced + '/' + SYNC_PATHS.length + ' paths');
        loadDashboard();
    } catch(e) { Logger.add('Full Sync', 'failed', e.message); Utils.showNotification('Full sync failed: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Full Sync'; }
}

// ==================== SETTINGS ====================
function toggleAutoSync() {
    const t = document.getElementById('autoSyncToggle');
    Utils.showNotification('Auto Sync ' + (t.checked ? 'enabled' : 'disabled'), 'info');
    Logger.add('Auto Sync', t.checked ? 'success' : 'warning', 'Set to ' + t.checked);
}

function toggleDeleteAlerts() {
    const t = document.getElementById('deleteAlertsToggle');
    Utils.showNotification('Delete Alerts ' + (t.checked ? 'enabled' : 'disabled'), 'info');
}

// ==================== LOGOUT ====================
function adminLogout() {
    if (!confirm('Logout?')) return;
    localStorage.removeItem('adminSession');
    sessionStorage.removeItem('adminSession');
    auth.signOut();
    window.location.href = 'admin-login.html';
}

// ==================== AUTO DELETE LISTENER ====================
function setupDeletedListener() {
    mainDB.ref('users').on('child_removed', async (snap) => {
        const uid = snap.key;
        const user = snap.val();
        if (!uid) return;
        try {
            const bs = await backupDB.ref('users/' + uid).once('value');
            if (bs.val()) {
                const du = { uid, name: user?.name || bs.val()?.name || 'Unknown', email: user?.email || bs.val()?.email || 'N/A', deletedAt: new Date().toISOString() };
                if (!BackupState.deletedUsers.find(u => u.uid === uid)) {
                    BackupState.deletedUsers.unshift(du);
                    BackupState.save();
                    Logger.add('User Deleted (Real-time)', 'warning', 'UID: ' + uid);
                    Utils.showNotification('⚠️ User ' + du.name + ' deleted!', 'warning', 8000);
                    loadDashboard();
                    renderDeletedUsers();
                }
            }
        } catch(e) { console.error('Deleted listener error:', e); }
    });
}

// ==================== SESSION CHECK ====================
function checkSession() {
    let session = localStorage.getItem('adminSession');
    if (!session) session = sessionStorage.getItem('adminSession');
    if (!session) { window.location.href = 'admin-login.html'; return false; }
    try {
        const admin = JSON.parse(session);
        if (admin.expiresAt && new Date(admin.expiresAt) < new Date()) {
            localStorage.removeItem('adminSession');
            sessionStorage.removeItem('adminSession');
            window.location.href = 'admin-login.html';
            return false;
        }
        window.currentAdmin = admin;
        return true;
    } catch(e) { window.location.href = 'admin-login.html'; return false; }
}

// ==================== INIT ====================
function init() {
    if (!checkSession()) return;
    initializeFirebase();
    BackupState.load();
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    loadDashboard();
    setupDeletedListener();
    renderLogs();
    renderDeletedUsers();
    checkBackupStatus();
    updateRestoreAllButton();
    document.getElementById('autoSyncToggle').checked = true;
    document.getElementById('deleteAlertsToggle').checked = true;
    Logger.add('System Started', 'success', 'v3.0');
    // Enter key support
    document.getElementById('searchInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') searchUser(); });
    document.getElementById('compareInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') compareUserData(); });
    document.getElementById('syncInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') syncUser(); });
    document.getElementById('restoreInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') restoreUser(); });
    // Click outside modal
    document.getElementById('modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ==================== EXPOSE ====================
window.Utils = Utils;
window.Logger = Logger;
window.BackupState = BackupState;
window.searchUser = searchUser;
window.compareSingleUser = compareSingleUser;
window.syncSingleUser = syncSingleUser;
window.restoreSingleUser = restoreSingleUser;
window.restoreAllUsers = restoreAllUsers;
window.downloadBackup = downloadBackup;
window.triggerFullSync = triggerFullSync;
window.checkBackupStatus = checkBackupStatus;
window.runHealthCheck = runHealthCheck;
window.renderLogs = renderLogs;
window.renderDeletedUsers = renderDeletedUsers;
window.showSection = showSection;
window.toggleSidebar = toggleSidebar;
window.openModal = openModal;
window.closeModal = closeModal;
window.adminLogout = adminLogout;
window.toggleAutoSync = toggleAutoSync;
window.toggleDeleteAlerts = toggleDeleteAlerts;
window.refreshDeletedUsers = refreshDeletedUsers;
window.refreshLogs = refreshLogs;
window.clearLogs = clearLogs;
window.exportLogs = exportLogs;
window.compareUserData = compareUserData;
window.syncUser = syncUser;
window.restoreUser = restoreUser;
window.loadDashboard = loadDashboard;
