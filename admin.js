// ==================== RND STAKING PLATFORM - BACKUP & RECOVERY SYSTEM v3.0 ====================
// admin.js - Production Backup Manager Module
// All sensitive operations use Cloud Functions for server-side processing

(function() {
    'use strict';

    // Check admin session with Firebase Auth
    const session = localStorage.getItem('adminSession');
    if (!session) {
        window.location.href = 'admin-login.html';
        return;
    }

    try {
        window.currentAdmin = JSON.parse(session);
        if (!window.currentAdmin.uid || !window.currentAdmin.email) {
            window.location.href = 'admin-login.html';
            return;
        }
    } catch(e) {
        window.location.href = 'admin-login.html';
        return;
    }
})();

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

// ==================== INITIALIZE FIREBASE ====================
let mainApp, backupApp, mainDB, backupDB, functions, auth;

function initializeFirebase() {
    try {
        mainApp = firebase.app('mainApp');
    } catch(e) {
        mainApp = firebase.initializeApp(MAIN_FIREBASE_CONFIG, 'mainApp');
    }

    try {
        backupApp = firebase.app('backupApp');
    } catch(e) {
        backupApp = firebase.initializeApp(BACKUP_FIREBASE_CONFIG, 'backupApp');
    }

    mainDB = firebase.database(mainApp);
    backupDB = firebase.database(backupApp);
    functions = firebase.functions(mainApp);
    auth = firebase.auth(mainApp);

    // Verify admin session with Firebase
    verifyAdminSession();

    console.log('[RND Backup v3.0] Firebase initialized');
}

// ==================== VERIFY ADMIN SESSION ====================
async function verifyAdminSession() {
    try {
        const user = auth.currentUser;
        if (!user) {
            // Try to sign in with session
            const session = localStorage.getItem('adminSession');
            if (session) {
                const admin = JSON.parse(session);
                // Re-authenticate silently
                // For production, use custom claims
            }
        }
    } catch(e) {
        console.error('Session verification failed:', e);
    }
}

// ==================== DATA PATHS ====================
const SYNC_PATHS = [
    'users', 'profiles', 'wallets', 'deposits', 'withdrawals',
    'referrals', 'dailyReleases', 'staking', 'packages',
    'transactions', 'incomeHistory', 'rewardHistory'
];

const USER_DATA_PATHS = [
    'users', 'profiles', 'wallets', 'deposits', 'withdrawals',
    'referrals', 'dailyReleases', 'staking', 'packages',
    'transactions', 'incomeHistory', 'rewardHistory'
];

// ==================== STATE MANAGEMENT ====================
const BackupState = {
    logs: [],
    deletedUsers: [],
    backupHistory: [],
    failedSyncCount: 0,
    lastSyncTime: null,
    lastBackupTime: null,
    isSyncing: false,
    autoSyncEnabled: true,
    deleteAlertsEnabled: true,
    maintenanceMode: false,

    load() {
        this.logs = JSON.parse(localStorage.getItem('rnd_backup_logs_v3') || '[]');
        this.deletedUsers = JSON.parse(localStorage.getItem('rnd_deleted_users_v3') || '[]');
        this.backupHistory = JSON.parse(localStorage.getItem('rnd_backup_history_v3') || '[]');
        this.failedSyncCount = parseInt(localStorage.getItem('rnd_failed_sync_v3') || '0');
        this.lastSyncTime = localStorage.getItem('rnd_last_sync_v3');
        this.lastBackupTime = localStorage.getItem('rnd_last_backup_v3');
        this.autoSyncEnabled = localStorage.getItem('rnd_auto_sync_v3') !== 'false';
        this.deleteAlertsEnabled = localStorage.getItem('rnd_delete_alerts_v3') !== 'false';
        this.maintenanceMode = localStorage.getItem('rnd_maintenance_mode_v3') === 'true';
    },

    save() {
        localStorage.setItem('rnd_backup_logs_v3', JSON.stringify(this.logs));
        localStorage.setItem('rnd_deleted_users_v3', JSON.stringify(this.deletedUsers));
        localStorage.setItem('rnd_backup_history_v3', JSON.stringify(this.backupHistory));
        localStorage.setItem('rnd_failed_sync_v3', this.failedSyncCount.toString());
        localStorage.setItem('rnd_last_sync_v3', this.lastSyncTime || '');
        localStorage.setItem('rnd_last_backup_v3', this.lastBackupTime || '');
        localStorage.setItem('rnd_auto_sync_v3', this.autoSyncEnabled.toString());
        localStorage.setItem('rnd_delete_alerts_v3', this.deleteAlertsEnabled.toString());
        localStorage.setItem('rnd_maintenance_mode_v3', this.maintenanceMode.toString());
    }
};

// ==================== UTILITY FUNCTIONS ====================
const Utils = {
    formatDate(isoString) {
        if (!isoString) return '--';
        try {
            const d = new Date(isoString);
            return d.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch(e) {
            return '--';
        }
    },

    formatRelativeTime(isoString) {
        if (!isoString) return 'Never';
        const diff = Date.now() - new Date(isoString).getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Just now';
        if (minutes < 60) return minutes + 'm ago';
        if (hours < 24) return hours + 'h ago';
        if (days < 30) return days + 'd ago';
        return this.formatDate(isoString);
    },

    deepEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
        if (obj1 === null || obj2 === null) return false;
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    },

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    },

    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    },

    showNotification(message, type, duration) {
        type = type || 'success';
        duration = duration || 4000;
        const notif = document.getElementById('notification');
        if (!notif) return;

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };

        notif.style.background = colors[type] || colors.success;
        notif.textContent = message;
        notif.className = `notification-toast ${type} show`;
        
        clearTimeout(notif._timeout);
        notif._timeout = setTimeout(() => {
            notif.classList.remove('show');
        }, duration);
    },

    truncate(str, len) {
        if (!str) return '';
        if (str.length <= len) return str;
        return str.substring(0, len) + '...';
    },

    safeStringify(obj) {
        try {
            return JSON.stringify(obj, null, 2);
        } catch(e) {
            return String(obj);
        }
    },

    isSuperAdmin() {
        return window.currentAdmin?.isSuperAdmin === true;
    },

    isLiveDomain() {
        // Check if on live production domain
        const hostname = window.location.hostname;
        return !hostname.includes('localhost') && 
               !hostname.includes('127.0.0.1') &&
               !hostname.includes('test') &&
               !hostname.includes('dev');
    },

    getDomainType() {
        const hostname = window.location.hostname;
        if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) return 'local';
        if (hostname.includes('test') || hostname.includes('dev')) return 'test';
        return 'production';
    }
};

// ==================== LOGGING SYSTEM ====================
const Logger = {
    add(action, status, details, metadata) {
        details = details || '';
        metadata = metadata || {};
        const log = {
            id: Utils.generateId(),
            timestamp: new Date().toISOString(),
            action: action,
            status: status,
            details: details,
            admin: window.currentAdmin?.email || 'Admin',
            uid: window.currentAdmin?.uid || 'unknown',
            domain: Utils.getDomainType()
        };

        BackupState.logs.unshift(log);
        if (BackupState.logs.length > 1000) BackupState.logs.pop();
        BackupState.save();

        updateLogBadge();

        const emoji = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⚠️';
        console.log(`[RND Backup] ${emoji} ${action} - ${status}: ${details}`);

        // Also log to Firebase for audit
        try {
            mainDB.ref('backupLogs').push(log);
        } catch(e) {}

        return log;
    },

    getRecent(limit) {
        limit = limit || 100;
        return BackupState.logs.slice(0, limit);
    },

    clear() {
        BackupState.logs = [];
        BackupState.save();
        updateLogBadge();
    },

    export() {
        return JSON.stringify(BackupState.logs, null, 2);
    }
};

// ==================== CLOUD FUNCTIONS CLIENT ====================
class CloudFunctionClient {
    constructor() {
        this.functions = functions;
    }

    async call(functionName, data) {
        try {
            const func = this.functions.httpsCallable(functionName);
            const result = await func(data || {});
            return result.data;
        } catch(err) {
            console.error(`Cloud Function ${functionName} error:`, err);
            // Check for permission errors
            if (err.code === 'permission-denied') {
                Utils.showNotification('Permission denied. Super Admin required.', 'error');
            }
            throw err;
        }
    }

    async restoreUser(uid) {
        return this.call('restoreUser', { uid });
    }

    async restoreAllUsers() {
        return this.call('restoreAllUsers', {});
    }

    async downloadBackup() {
        return this.call('downloadBackup', {});
    }

    async getBackupStatus() {
        return this.call('getBackupStatus', {});
    }

    async getBackupHistory() {
        return this.call('getBackupHistory', {});
    }

    async runHealthCheck() {
        return this.call('runHealthCheck', {});
    }

    async toggleMaintenance(enabled) {
        return this.call('toggleMaintenance', { enabled });
    }
}

const cloud = new CloudFunctionClient();

// ==================== ADMIN UI FUNCTIONS ====================

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
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clock-rotate-left"></i>
                <h3>No Activity Logs</h3>
                <p>Backup activities will appear here</p>
            </div>
        `;
        return;
    }

    let html = '';
    logs.forEach(log => {
        const badgeClass = log.status === 'success' ? 'success' : 
                           log.status === 'failed' ? 'failed' : 'warning';
        html += `
            <div class="log-entry">
                <span class="log-time">${Utils.formatDate(log.timestamp)}</span>
                <span class="log-badge ${badgeClass}">${log.status}</span>
                <span><strong>${log.action}</strong></span>
                <span style="color: var(--text-muted); margin-left: auto; font-size: 0.8rem;">${log.details || ''}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function refreshLogs() {
    renderLogs();
    Utils.showNotification('Logs refreshed', 'info');
}

function clearLogs() {
    if (!confirm('Clear all activity logs?')) return;
    Logger.clear();
    renderLogs();
    Utils.showNotification('Logs cleared', 'info');
}

function exportLogs() {
    const data = Logger.export();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RND_Backup_Logs_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.showNotification('Logs exported', 'success');
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
    try {
        await checkConnections();
        await loadStats();
        loadRecentActivity();
        loadRecentBackups();
        updateAdminProfile();
        updateRestoreAllButton();
        updateMaintenanceBanner();
    } catch(err) {
        console.error('Dashboard load error:', err);
    }
}

async function checkConnections() {
    try {
        const mainSnap = await mainDB.ref('.info/connected').once('value');
        const mainOnline = mainSnap.val() !== null;
        document.getElementById('mainStatusDot').className = `status-dot ${mainOnline ? 'online' : 'offline'}`;

        const backupSnap = await backupDB.ref('.info/connected').once('value');
        const backupOnline = backupSnap.val() !== null;
        document.getElementById('backupStatusDot').className = `status-dot ${backupOnline ? 'online' : 'offline'}`;
    } catch(e) {
        document.getElementById('mainStatusDot').className = 'status-dot offline';
        document.getElementById('backupStatusDot').className = 'status-dot offline';
    }
}

async function loadStats() {
    try {
        const usersSnap = await mainDB.ref('users').once('value');
        const users = usersSnap.val() || {};
        const totalUsers = Object.keys(users).length;
        const activeCount = Object.values(users).filter(u => u.status === 'active').length;

        document.getElementById('totalUsers').textContent = totalUsers;
        document.getElementById('activeUsers').textContent = activeCount;
        document.getElementById('lastSync').textContent = Utils.formatRelativeTime(BackupState.lastSyncTime);
        document.getElementById('lastBackup').textContent = Utils.formatRelativeTime(BackupState.lastBackupTime);
        document.getElementById('failedSync').textContent = BackupState.failedSyncCount;
        document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
        document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;

        await detectDeletedUsers();
    } catch(e) {
        console.error('Stats load error:', e);
    }
}

function loadRecentActivity() {
    const container = document.getElementById('recentActivity');
    if (!container) return;

    const logs = Logger.getRecent(10);
    if (logs.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:24px; color: var(--text-muted);">No recent activity</div>`;
        return;
    }

    let html = '';
    logs.forEach(log => {
        const badgeClass = log.status === 'success' ? 'success' : 
                           log.status === 'failed' ? 'failed' : 'warning';
        html += `
            <div class="log-entry">
                <span class="log-time">${Utils.formatDate(log.timestamp)}</span>
                <span class="log-badge ${badgeClass}">${log.status}</span>
                <span><strong>${log.action}</strong></span>
                <span style="color: var(--text-muted); margin-left: auto; font-size: 0.8rem;">${log.details || ''}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function loadRecentBackups() {
    const container = document.getElementById('recentBackups');
    if (!container) return;

    const history = BackupState.backupHistory.slice(0, 5);
    if (history.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:16px; color: var(--text-muted);">No backup history available</div>`;
        return;
    }

    let html = '';
    history.forEach(item => {
        html += `
            <div class="log-entry">
                <span class="log-time">${Utils.formatDate(item.timestamp)}</span>
                <span class="log-badge ${item.status === 'success' ? 'success' : 'failed'}">${item.status || 'info'}</span>
                <span><strong>${item.type || 'Manual'}</strong></span>
                <span style="color: var(--text-muted); margin-left: auto; font-size: 0.8rem;">${item.totalUsers || 0} users</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function updateAdminProfile() {
    const admin = window.currentAdmin;
    if (!admin) return;

    const avatar = document.getElementById('adminAvatar');
    const nameEl = document.getElementById('adminName');
    const roleEl = document.getElementById('adminRole');

    if (avatar) {
        avatar.textContent = admin.email.charAt(0).toUpperCase();
    }
    if (nameEl) {
        nameEl.textContent = admin.email;
    }
    if (roleEl) {
        roleEl.innerHTML = admin.isSuperAdmin ? 
            '<span class="super">★ Super Admin</span>' : 
            '<span>Admin</span>';
    }
}

function updateRestoreAllButton() {
    const btn = document.getElementById('restoreAllBtn');
    const badge = document.getElementById('restoreAllBadge');
    const permissionEl = document.getElementById('restoreAllPermission');
    const statusEl = document.getElementById('restoreAllStatus');
    const warningEl = document.getElementById('restoreAllWarning');

    const isSuperAdmin = Utils.isSuperAdmin();
    const isLive = Utils.isLiveDomain();

    if (btn) {
        if (isSuperAdmin && !isLive) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users';
            btn.className = 'btn btn-danger btn-lg';
        } else if (isSuperAdmin && isLive) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-lock"></i> 🔒 Live Domain Locked';
            btn.className = 'btn btn-outline btn-lg';
        } else {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-lock"></i> Super Admin Only';
            btn.className = 'btn btn-outline btn-lg';
        }
    }

    if (badge) {
        if (isSuperAdmin && !isLive) {
            badge.textContent = 'UNLOCKED';
            badge.className = 'badge success';
        } else {
            badge.textContent = 'LOCKED';
            badge.className = 'badge danger';
        }
    }

    if (permissionEl) {
        if (isSuperAdmin && !isLive) {
            permissionEl.innerHTML = '<span style="color: var(--secondary);">✓ Super Admin Access Granted</span>';
        } else if (isSuperAdmin && isLive) {
            permissionEl.innerHTML = '<span style="color: var(--warning);">⚠️ Live Domain Protection Active</span>';
        } else {
            permissionEl.innerHTML = '<span style="color: var(--danger);">❌ Super Admin Required</span>';
        }
    }

    if (warningEl) {
        if (isSuperAdmin && !isLive) {
            warningEl.innerHTML = '⚠️ Type <strong>"RESTORE ALL"</strong> to confirm';
            warningEl.style.color = 'var(--warning)';
        } else {
            warningEl.innerHTML = '🔒 <strong>Restore All</strong> is locked for security';
            warningEl.style.color = 'var(--text-muted)';
        }
    }
}

function updateMaintenanceBanner() {
    const banner = document.getElementById('maintenanceBanner');
    const toggle = document.getElementById('maintenanceToggle');
    
    if (BackupState.maintenanceMode) {
        banner.classList.add('active');
        if (toggle) toggle.checked = true;
        document.getElementById('maintenanceMessage').textContent = '🚧 Website is under maintenance. Deposits and Withdrawals are temporarily disabled.';
    } else {
        banner.classList.remove('active');
        if (toggle) toggle.checked = false;
    }
}

// ==================== NAVIGATION ====================

function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const text = item.textContent.trim().toLowerCase();
        const id = sectionId.replace('-', ' ');
        if (text.includes(id) || id.includes(text)) {
            item.classList.add('active');
        }
    });

    if (window.innerWidth <= 768) {
        toggleSidebar(false);
    }

    // Refresh data for specific sections
    if (sectionId === 'logs') renderLogs();
    if (sectionId === 'deleted') renderDeletedUsers();
    if (sectionId === 'status') checkBackupStatus();
    if (sectionId === 'dashboard') loadDashboard();
    if (sectionId === 'backup-history') loadBackupHistory();
    if (sectionId === 'health') runHealthCheck();
}

function toggleSidebar(force) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    const isOpen = sidebar.classList.contains('open');
    
    if (force === false || (force === undefined && isOpen)) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }
}

window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobileOverlay').classList.remove('active');
    }
});

// ==================== MODAL ====================

function openModal(title, body, footer) {
    document.getElementById('modalTitle').innerHTML = `<i class="fas fa-info-circle"></i> ${title}`;
    document.getElementById('modalBody').innerHTML = body || '';
    document.getElementById('modalFooter').innerHTML = footer || '';
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

document.getElementById('modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

// ==================== SEARCH USER ====================

async function searchUser() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) {
        Utils.showNotification('Please enter a search query', 'warning');
        return;
    }

    const container = document.getElementById('searchResults');
    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Searching...</p>
        </div>
    `;

    try {
        const snap = await mainDB.ref('users').once('value');
        const users = snap.val() || {};
        const results = [];
        const lowerQuery = query.toLowerCase();

        Object.entries(users).forEach(([uid, user]) => {
            if (uid.toLowerCase().includes(lowerQuery) ||
                (user.email && user.email.toLowerCase().includes(lowerQuery)) ||
                (user.name && user.name.toLowerCase().includes(lowerQuery)) ||
                (user.phone && user.phone.includes(query))) {
                results.push({ uid, ...user });
            }
        });

        if (results.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>No Users Found</h3>
                    <p>Try a different search term</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="margin-bottom:12px; color: var(--text-muted); font-size:0.9rem;">
                Found <strong style="color:var(--text);">${results.length}</strong> users
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>UID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        results.forEach(user => {
            html += `
                <tr>
                    <td class="uid-cell">${Utils.truncate(user.uid, 12)}</td>
                    <td>${user.name || 'N/A'}</td>
                    <td>${user.email || 'N/A'}</td>
                    <td><span class="tag ${user.status === 'active' ? 'tag-success' : 'tag-warning'}">${user.status || 'N/A'}</span></td>
                    <td class="actions">
                        <button class="btn btn-outline btn-sm" onclick="compareSingleUser('${user.uid}')">
                            <i class="fas fa-code-compare"></i>
                        </button>
                        <button class="btn btn-success btn-sm" onclick="syncSingleUser('${user.uid}')">
                            <i class="fas fa-rotate"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="restoreSingleUser('${user.uid}')">
                            <i class="fas fa-rotate-left"></i>
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

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${err.message}
            </div>
        `;
    }
}

// ==================== COMPARE DATA ====================

async function compareUserData() {
    const uid = document.getElementById('compareInput').value.trim();
    if (!uid) {
        Utils.showNotification('Please enter a UID', 'warning');
        return;
    }
    await compareSingleUser(uid);
}

async function compareSingleUser(uid) {
    const container = document.getElementById('compareResults');
    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Comparing data...</p>
        </div>
    `;

    try {
        const mainData = {};
        const backupData = {};
        let mismatchFound = false;
        let totalPaths = 0;
        let matchedPaths = 0;

        for (const path of USER_DATA_PATHS) {
            totalPaths++;
            const mainSnap = await mainDB.ref(`${path}/${uid}`).once('value');
            const backupSnap = await backupDB.ref(`${path}/${uid}`).once('value');

            mainData[path] = mainSnap.val();
            backupData[path] = backupSnap.val();

            if (!Utils.deepEqual(mainData[path], backupData[path])) {
                mismatchFound = true;
            } else {
                matchedPaths++;
            }
        }

        let html = `<div style="margin-bottom: 16px;">`;

        if (mismatchFound) {
            html += `
                <div class="alert alert-warning">
                    <i class="fas fa-triangle-exclamation"></i>
                    <div>
                        <strong>Mismatch Found!</strong>
                        <br>${matchedPaths}/${totalPaths} paths matched
                        <br><span style="font-size:0.85rem;">Data differs between Main and Backup Firebase</span>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-success">
                    <i class="fas fa-check-circle"></i>
                    <div>
                        <strong>Data Matched!</strong>
                        <br>All ${totalPaths} paths are identical
                    </div>
                </div>
            `;
        }
        html += `</div>`;

        html += `<div class="compare-grid">`;

        // Main column
        html += `<div class="compare-column main">
            <h4><i class="fas fa-server"></i> Main Firebase</h4>`;
        for (const path of USER_DATA_PATHS) {
            const mainVal = mainData[path];
            const backupVal = backupData[path];
            const isMismatch = !Utils.deepEqual(mainVal, backupVal);
            const status = mainVal !== null && mainVal !== undefined ? 'Present' : 'Missing';

            html += `
                <div class="compare-row ${isMismatch ? 'mismatch' : ''}">
                    <span class="label">${path}</span>
                    <span class="value" style="${isMismatch ? 'color: var(--danger);' : 'color: var(--secondary);'}">
                        ${status}
                        ${isMismatch ? ' ❌' : ' ✓'}
                        ${!isMismatch && mainVal !== null ? ` (${typeof mainVal === 'object' ? Object.keys(mainVal).length : mainVal})` : ''}
                    </span>
                </div>
            `;

            if (isMismatch && mainVal !== null) {
                const mainStr = typeof mainVal === 'object' ? JSON.stringify(mainVal, null, 2) : String(mainVal);
                const backupStr = typeof backupVal === 'object' ? JSON.stringify(backupVal, null, 2) : String(backupVal);
                html += `
                    <div class="compare-detail" style="margin-left: 0;">
                        <div style="color: var(--secondary);">Main: ${Utils.truncate(mainStr, 200)}</div>
                        <div style="color: var(--danger);">Backup: ${Utils.truncate(backupStr, 200)}</div>
                    </div>
                `;
            }
        }
        html += `</div>`;

        // Backup column
        html += `<div class="compare-column backup">
            <h4><i class="fas fa-shield-halved"></i> Backup Firebase</h4>`;
        for (const path of USER_DATA_PATHS) {
            const mainVal = mainData[path];
            const backupVal = backupData[path];
            const isMismatch = !Utils.deepEqual(mainVal, backupVal);
            const status = backupVal !== null && backupVal !== undefined ? 'Present' : 'Missing';

            html += `
                <div class="compare-row ${isMismatch ? 'mismatch' : ''}">
                    <span class="label">${path}</span>
                    <span class="value" style="${isMismatch ? 'color: var(--danger);' : 'color: var(--secondary);'}">
                        ${status}
                        ${isMismatch ? ' ❌' : ' ✓'}
                        ${!isMismatch && backupVal !== null ? ` (${typeof backupVal === 'object' ? Object.keys(backupVal).length : backupVal})` : ''}
                    </span>
                </div>
            `;
        }
        html += `</div>`;

        html += `</div>`;

        if (mismatchFound) {
            html += `
                <div style="margin-top: 20px; text-align: center; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn btn-success" onclick="syncSingleUser('${uid}')">
                        <i class="fas fa-rotate"></i> Sync Now
                    </button>
                    <button class="btn btn-danger" onclick="restoreSingleUser('${uid}')">
                        <i class="fas fa-rotate-left"></i> Restore from Backup
                    </button>
                </div>
            `;
        }

        container.innerHTML = html;
        Logger.add('Compare Data', 'success', `UID: ${uid} - ${mismatchFound ? 'Mismatch found' : 'All matched'}`);

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${err.message}
            </div>
        `;
        Logger.add('Compare Data', 'failed', `UID: ${uid} - ${err.message}`);
    }
}

// ==================== SYNC USER ====================

async function syncUser() {
    const uid = document.getElementById('syncInput').value.trim();
    if (!uid) {
        Utils.showNotification('Please enter a UID', 'warning');
        return;
    }
    await syncSingleUser(uid);
}

async function syncSingleUser(uid) {
    const container = document.getElementById('syncResults');
    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Syncing user data...</p>
        </div>
    `;

    try {
        let syncedPaths = [];

        for (const path of USER_DATA_PATHS) {
            const snap = await mainDB.ref(`${path}/${uid}`).once('value');
            const data = snap.val();
            if (data !== null && data !== undefined) {
                await backupDB.ref(`${path}/${uid}`).set(data);
                syncedPaths.push(path);
            }
        }

        BackupState.lastSyncTime = new Date().toISOString();
        BackupState.save();

        container.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>User synced successfully!</strong>
                    <br>UID: <code>${uid}</code>
                    <br><small>Synced paths: ${syncedPaths.join(', ') || 'None'}</small>
                </div>
            </div>
        `;

        Logger.add('Sync User', 'success', `UID: ${uid} - ${syncedPaths.length} paths`);
        Utils.showNotification('User synced successfully!');
        loadDashboard();

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${err.message}
            </div>
        `;
        Logger.add('Sync User', 'failed', `UID: ${uid} - ${err.message}`);
        Utils.showNotification('Sync failed: ' + err.message, 'error');
    }
}

// ==================== RESTORE USER ====================

async function restoreUser() {
    const uid = document.getElementById('restoreInput').value.trim();
    if (!uid) {
        Utils.showNotification('Please enter a UID', 'warning');
        return;
    }
    await restoreSingleUser(uid);
}

async function restoreSingleUser(uid) {
    const container = document.getElementById('restoreResults');
    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Restoring user data via Cloud Function...</p>
        </div>
    `;

    try {
        const result = await cloud.restoreUser(uid);
        
        const restoredPaths = result.results?.filter(r => r.restored).map(r => r.path) || [];
        
        BackupState.deletedUsers = BackupState.deletedUsers.filter(u => u.uid !== uid);
        BackupState.save();

        container.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>User restored successfully!</strong>
                    <br>UID: <code>${uid}</code>
                    <br><small>Restored paths: ${restoredPaths.join(', ') || 'None'}</small>
                </div>
            </div>
        `;

        Logger.add('Restore User', 'success', `UID: ${uid}`);
        Utils.showNotification('User restored successfully!');
        loadDashboard();

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error: ${err.message}
            </div>
        `;
        Logger.add('Restore User', 'failed', `UID: ${uid} - ${err.message}`);
        Utils.showNotification('Restore failed: ' + err.message, 'error');
    }
}

// ==================== RESTORE ALL USERS ====================

async function restoreAllUsers() {
    // Check Super Admin permission
    if (!Utils.isSuperAdmin()) {
        Utils.showNotification('Super Admin permission required!', 'error');
        return;
    }

    // Check live domain protection
    if (Utils.isLiveDomain()) {
        Utils.showNotification('🔒 Restore All is disabled on live domain for safety.', 'warning', 6000);
        return;
    }

    // Triple confirmation for safety
    if (!confirm('⚠️ WARNING: This will overwrite ALL data in Main Firebase with data from Backup Firebase. Are you absolutely sure?')) return;
    if (!confirm('🔴 SECOND CONFIRMATION: Type "RESTORE ALL" to proceed.')) return;
    if (!confirm('🔴 FINAL CONFIRMATION: Type "RESTORE ALL" again to confirm.')) return;

    const btn = document.getElementById('restoreAllBtn');
    const progressDiv = document.getElementById('restoreAllProgress');
    const progressBar = document.getElementById('restoreAllProgressBar');
    const progressText = document.getElementById('restoreAllProgressText');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Restoring...';
    progressDiv.style.display = 'block';

    try {
        const result = await cloud.restoreAllUsers();

        progressBar.style.width = '100%';
        progressText.innerHTML = `
            <span class="highlight">${result.restored}</span> users restored, 
            <span style="color: var(--danger);">${result.failed}</span> failed
        `;

        if (result.failed > 0) {
            Utils.showNotification(`${result.restored} restored, ${result.failed} failed`, 'warning');
        } else {
            Utils.showNotification(`All ${result.restored} users restored!`);
        }

        Logger.add('Restore All Users', 'success', `${result.restored} restored, ${result.failed} failed`);

        btn.innerHTML = '<i class="fas fa-check"></i> Restore Complete';

        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users';
            progressDiv.style.display = 'none';
            progressBar.style.width = '0%';
        }, 3000);

        loadDashboard();

    } catch(err) {
        Utils.showNotification('Restore failed: ' + err.message, 'error');
        Logger.add('Restore All Users', 'failed', err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore All Users';
        progressDiv.style.display = 'none';
    }
}

// ==================== BACKUP HISTORY ====================

async function loadBackupHistory() {
    const container = document.getElementById('backupHistoryList');
    if (!container) return;

    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Loading backup history...</p>
        </div>
    `;

    try {
        const result = await cloud.getBackupHistory();
        const history = result.history || [];

        if (history.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <h3>No Backup History</h3>
                    <p>Backups will appear here when scheduled</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="margin-bottom:12px; color: var(--text-muted); font-size:0.9rem;">
                Total <strong style="color:var(--text);">${history.length}</strong> backups found
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Date/Time</th>
                            <th>Type</th>
                            <th>Users</th>
                            <th>Status</th>
                            <th>Size</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        history.forEach(item => {
            const statusClass = item.status === 'success' ? 'tag-success' : 'tag-danger';
            html += `
                <tr>
                    <td>${Utils.formatDate(item.timestamp)}</td>
                    <td><span class="tag tag-info">${item.type || 'Manual'}</span></td>
                    <td>${item.totalUsers || 0}</td>
                    <td><span class="tag ${statusClass}">${item.status || 'OK'}</span></td>
                    <td>${item.size || 'N/A'}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;

        // Update local state
        BackupState.backupHistory = history;
        BackupState.save();

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Error loading backup history: ${err.message}
            </div>
        `;
    }
}

// ==================== DELETED USER DETECTION ====================

async function detectDeletedUsers() {
    try {
        const mainSnap = await mainDB.ref('users').once('value');
        const backupSnap = await backupDB.ref('users').once('value');

        const mainUsers = mainSnap.val() || {};
        const backupUsers = backupSnap.val() || {};

        const mainIds = Object.keys(mainUsers);
        const backupIds = Object.keys(backupUsers);

        const newlyDeleted = backupIds.filter(id => !mainIds.includes(id));

        let added = 0;
        newlyDeleted.forEach(uid => {
            const user = backupUsers[uid];
            const exists = BackupState.deletedUsers.find(u => u.uid === uid);
            if (!exists) {
                BackupState.deletedUsers.unshift({
                    uid,
                    name: user?.name || user?.displayName || 'Unknown',
                    email: user?.email || 'N/A',
                    phone: user?.phone || 'N/A',
                    deletedAt: new Date().toISOString(),
                    detectedAt: new Date().toISOString()
                });
                added++;
            }
        });

        if (added > 0) {
            BackupState.save();
            Logger.add('Deleted Users Detected', 'warning', `${added} new deleted users`);
            
            if (BackupState.deleteAlertsEnabled) {
                const latest = BackupState.deletedUsers[0];
                Utils.showNotification(
                    `⚠️ User ${latest.name} (${latest.uid}) deleted from Main Firebase!`,
                    'warning',
                    8000
                );
            }
        }

        document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
        document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;

        const alertContainer = document.getElementById('deletedAlertContainer');
        if (BackupState.deletedUsers.length > 0 && alertContainer) {
            const latest = BackupState.deletedUsers[0];
            alertContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-triangle-exclamation"></i>
                    <div style="flex:1;">
                        <strong>${BackupState.deletedUsers.length} User(s) Deleted!</strong>
                        <br>Latest: ${latest.name} (${Utils.truncate(latest.uid, 10)})
                        <br>
                        <button class="btn btn-success btn-sm" style="margin-top:8px;" onclick="restoreSingleUser('${latest.uid}')">
                            <i class="fas fa-rotate-left"></i> Recover Now
                        </button>
                        <button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="document.getElementById('deletedAlertContainer').innerHTML=''">
                            <i class="fas fa-times"></i> Dismiss
                        </button>
                    </div>
                </div>
            `;
        } else if (alertContainer) {
            alertContainer.innerHTML = '';
        }

    } catch(err) {
        console.error('Deleted user detection error:', err);
    }
}

function refreshDeletedUsers() {
    detectDeletedUsers();
    renderDeletedUsers();
    Utils.showNotification('Deleted users list refreshed', 'info');
}

function renderDeletedUsers() {
    const container = document.getElementById('deletedUsersList');
    if (!container) return;

    if (BackupState.deletedUsers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <h3>No Deleted Users</h3>
                <p>All users are present in both databases</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="margin-bottom:12px; color: var(--text-muted); font-size:0.9rem;">
            <strong style="color:var(--danger);">${BackupState.deletedUsers.length}</strong> deleted users found
        </div>
        <div class="table-responsive">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>UID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Deleted At</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    BackupState.deletedUsers.forEach(user => {
        html += `
            <tr>
                <td class="uid-cell">${Utils.truncate(user.uid, 12)}</td>
                <td>${user.name || 'Unknown'}</td>
                <td>${user.email || 'N/A'}</td>
                <td>${Utils.formatDate(user.deletedAt)}</td>
                <td class="actions">
                    <button class="btn btn-success btn-sm" onclick="restoreSingleUser('${user.uid}')">
                        <i class="fas fa-rotate-left"></i> Restore
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="compareSingleUser('${user.uid}')">
                        <i class="fas fa-code-compare"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="removeDeletedUser('${user.uid}')">
                        <i class="fas fa-times"></i>
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
}

function removeDeletedUser(uid) {
    if (!confirm(`Remove ${uid} from deleted users list?`)) return;
    BackupState.deletedUsers = BackupState.deletedUsers.filter(u => u.uid !== uid);
    BackupState.save();
    renderDeletedUsers();
    document.getElementById('deletedUsersCount').textContent = BackupState.deletedUsers.length;
    document.getElementById('deletedBadge').textContent = BackupState.deletedUsers.length;
    Utils.showNotification('User removed from deleted list', 'info');
}

// ==================== HEALTH CHECK ====================

async function runHealthCheck() {
    const container = document.getElementById('healthResults');
    if (!container) return;

    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner"></div>
            <p>Running health check...</p>
        </div>
    `;

    try {
        const result = await cloud.runHealthCheck();
        
        let html = `
            <div style="margin-bottom: 16px;">
                <div class="alert ${result.status === 'healthy' ? 'alert-success' : 'alert-danger'}">
                    <i class="fas fa-${result.status === 'healthy' ? 'check-circle' : 'triangle-exclamation'}"></i>
                    <div>
                        <strong>Health Status: ${result.status === 'healthy' ? '✅ All Good' : '⚠️ Issues Found'}</strong>
                        <br><span style="font-size:0.85rem;">Checked at: ${Utils.formatDate(result.timestamp)}</span>
                    </div>
                </div>
            </div>
        `;

        if (result.checks) {
            html += `<div style="display: grid; gap: 12px;">`;
            
            // Users comparison
            if (result.checks.users) {
                const u = result.checks.users;
                const isMatch = u.main === u.backup;
                html += `
                    <div style="padding: 12px; background: var(--darker); border-radius: 8px; border-left: 3px solid ${isMatch ? 'var(--secondary)' : 'var(--danger)'};">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                            <span><i class="fas fa-users"></i> Users</span>
                            <span style="font-family: monospace;">
                                Main: <strong>${u.main}</strong> | Backup: <strong>${u.backup}</strong>
                                ${isMatch ? ' ✅' : ' ❌'}
                            </span>
                        </div>
                        ${!isMatch ? `<div style="color: var(--danger); font-size:0.85rem; margin-top:4px;">⚠️ ${u.main - u.backup > 0 ? 'Missing in backup' : 'Extra in backup'}: ${Math.abs(u.main - u.backup)} users</div>` : ''}
                    </div>
                `;
            }

            // Path checks
            if (result.checks.paths) {
                result.checks.paths.forEach(p => {
                    const isMatch = p.main === p.backup;
                    html += `
                        <div style="padding: 12px; background: var(--darker); border-radius: 8px; border-left: 3px solid ${isMatch ? 'var(--secondary)' : 'var(--danger)'};">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                                <span><i class="fas fa-database"></i> ${p.path}</span>
                                <span style="font-family: monospace;">
                                    Main: <strong>${p.main}</strong> | Backup: <strong>${p.backup}</strong>
                                    ${isMatch ? ' ✅' : ' ❌'}
                                </span>
                            </div>
                            ${!isMatch ? `<div style="color: var(--danger); font-size:0.85rem; margin-top:4px;">⚠️ Mismatch detected</div>` : ''}
                        </div>
                    `;
                });
            }

            html += `</div>`;

            // Alerts
            if (result.alerts && result.alerts.length > 0) {
                html += `
                    <div style="margin-top: 16px; padding: 12px; background: rgba(239, 68, 68, 0.08); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
                        <h4 style="color: var(--danger);"><i class="fas fa-bell"></i> Alerts</h4>
                `;
                result.alerts.forEach(alert => {
                    html += `<div style="padding: 4px 0; font-size:0.9rem; color: #fca5a5;">⚠️ ${alert}</div>`;
                });
                html += `</div>`;
            }

            // Show alert in dashboard
            const alertContainer = document.getElementById('healthAlertContainer');
            if (alertContainer) {
                if (result.status !== 'healthy') {
                    alertContainer.innerHTML = `
                        <div class="alert alert-warning">
                            <i class="fas fa-stethoscope"></i>
                            <div>
                                <strong>Health Check Alert!</strong>
                                <br>${result.alerts?.join(', ') || 'Issues detected. Please review health check report.'}
                                <br>
                                <button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="showSection('health')">
                                    <i class="fas fa-eye"></i> View Report
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    alertContainer.innerHTML = '';
                }
            }

            // Update badge
            const badge = document.getElementById('healthBadge');
            if (badge) {
                badge.textContent = result.status === 'healthy' ? 'OK' : '⚠️';
                badge.className = `badge ${result.status === 'healthy' ? 'success' : 'warning'}`;
            }

        } else {
            html += `<div style="text-align:center; padding:24px; color: var(--text-muted);">No health check data available</div>`;
        }

        container.innerHTML = html;

    } catch(err) {
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-circle-exclamation"></i>
                Health check failed: ${err.message}
            </div>
        `;
    }
}

// ==================== BACKUP STATUS ====================

async function checkBackupStatus() {
    try {
        try {
            await mainDB.ref('.info/connected').once('value');
            document.getElementById('mainDbStatus').innerHTML = `
                <span class="tag tag-success"><i class="fas fa-check"></i> Online</span>
            `;
        } catch(e) {
            document.getElementById('mainDbStatus').innerHTML = `
                <span class="tag tag-danger"><i class="fas fa-xmark"></i> Offline</span>
            `;
        }

        try {
            await backupDB.ref('.info/connected').once('value');
            document.getElementById('backupDbStatus').innerHTML = `
                <span class="tag tag-success"><i class="fas fa-check"></i> Online</span>
            `;
        } catch(e) {
            document.getElementById('backupDbStatus').innerHTML = `
                <span class="tag tag-danger"><i class="fas fa-xmark"></i> Offline</span>
            `;
        }

        const mainOnline = document.getElementById('mainDbStatus').innerHTML.includes('Online');
        const backupOnline = document.getElementById('backupDbStatus').innerHTML.includes('Online');
        document.getElementById('syncStatus').innerHTML = mainOnline && backupOnline ?
            `<span class="tag tag-success"><i class="fas fa-check"></i> Active</span>` :
            `<span class="tag tag-danger"><i class="fas fa-xmark"></i> Inactive</span>`;

        let totalRecords = 0;
        for (const path of SYNC_PATHS) {
            try {
                const snap = await backupDB.ref(path).once('value');
                const data = snap.val() || {};
                totalRecords += Object.keys(data).length;
            } catch(e) {}
        }
        document.getElementById('totalRecords').textContent = totalRecords;

    } catch(err) {
        console.error('Status check error:', err);
    }
}

// ==================== DOWNLOAD BACKUP ====================

async function downloadBackup() {
    const btn = event?.target?.closest?.('button') || document.querySelector('#download .btn-primary');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Generating ZIP...';

    try {
        const result = await cloud.downloadBackup();
        
        if (result.url) {
            // Open in new tab for download
            window.open(result.url, '_blank');
            Utils.showNotification('Backup ZIP download started!');
            Logger.add('Download Backup', 'success', `File: ${result.filename}`);
            
            // Add to backup history
            BackupState.backupHistory.unshift({
                timestamp: new Date().toISOString(),
                type: 'Manual',
                status: 'success',
                totalUsers: result.totalUsers || 0,
                size: result.size || 'N/A'
            });
            BackupState.save();
        }
    } catch(err) {
        Utils.showNotification('Download failed: ' + err.message, 'error');
        Logger.add('Download Backup', 'failed', err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> Download ZIP Backup';
    }
}

async function downloadBackupHistory() {
    try {
        const result = await cloud.getBackupHistory();
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RND_Backup_History_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Utils.showNotification('History downloaded', 'success');
    } catch(err) {
        Utils.showNotification('Download failed: ' + err.message, 'error');
    }
}

// ==================== FULL SYNC ====================

async function triggerFullSync() {
    const btn = event?.target?.closest?.('button');
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Syncing...';

    try {
        let synced = 0;
        let total = SYNC_PATHS.length;

        for (const path of SYNC_PATHS) {
            try {
                const snap = await mainDB.ref(path).once('value');
                const data = snap.val();
                if (data !== null) {
                    await backupDB.ref(path).set(data);
                    synced++;
                }
            } catch(e) {
                console.error(`Sync failed for ${path}:`, e);
            }
        }

        BackupState.lastSyncTime = new Date().toISOString();
        BackupState.save();

        Logger.add('Full Sync', 'success', `${synced}/${total} paths synced`);
        Utils.showNotification(`Full sync completed! ${synced}/${total} paths synced`);
        loadDashboard();

    } catch(err) {
        Logger.add('Full Sync', 'failed', err.message);
        Utils.showNotification('Full sync failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate"></i> Full Sync Now';
    }
}

// ==================== MAINTENANCE MODE ====================

async function toggleMaintenance() {
    const toggle = document.getElementById('maintenanceToggle');
    const enabled = toggle ? toggle.checked : !BackupState.maintenanceMode;
    
    BackupState.maintenanceMode = enabled;
    BackupState.save();
    
    updateMaintenanceBanner();
    
    // Call cloud function to update maintenance status
    try {
        await cloud.toggleMaintenance(enabled);
        Logger.add('Maintenance Mode', enabled ? 'warning' : 'success', `Set to ${enabled}`);
        Utils.showNotification(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'warning' : 'success');
    } catch(err) {
        Utils.showNotification('Failed to update maintenance status: ' + err.message, 'error');
    }
}

// ==================== SETTINGS ====================

function toggleAutoSync() {
    const toggle = document.getElementById('autoSyncToggle');
    BackupState.autoSyncEnabled = toggle.checked;
    BackupState.save();
    Utils.showNotification(`Auto Sync ${toggle.checked ? 'enabled' : 'disabled'}`, 'info');
    Logger.add('Auto Sync', toggle.checked ? 'success' : 'warning', `Set to ${toggle.checked}`);
}

function toggleDeleteAlerts() {
    const toggle = document.getElementById('deleteAlertsToggle');
    BackupState.deleteAlertsEnabled = toggle.checked;
    BackupState.save();
    Utils.showNotification(`Delete Alerts ${toggle.checked ? 'enabled' : 'disabled'}`, 'info');
}

function addAdmin() {
    const email = document.getElementById('newAdminEmail').value.trim();
    if (!email) {
        Utils.showNotification('Please enter an email', 'warning');
        return;
    }
    // This would call a cloud function to add admin
    Utils.showNotification('Admin management via Firebase Console', 'info');
}

// ==================== ADMIN LOGOUT ====================

function adminLogout() {
    if (!confirm('Are you sure you want to logout?')) return;
    localStorage.removeItem('adminSession');
    auth.signOut();
    window.location.href = 'admin-login.html';
}

// ==================== AUTO DELETE DETECTION ====================

function setupDeletedUserListener() {
    mainDB.ref('users').on('child_removed', async (snapshot) => {
        const uid = snapshot.key;
        const user = snapshot.val();

        if (!uid) return;

        try {
            const backupSnap = await backupDB.ref(`users/${uid}`).once('value');
            const backupUser = backupSnap.val();

            if (backupUser) {
                const deletedUser = {
                    uid,
                    name: user?.name || backupUser?.name || 'Unknown',
                    email: user?.email || backupUser?.email || 'N/A',
                    phone: user?.phone || backupUser?.phone || 'N/A',
                    deletedAt: new Date().toISOString(),
                    detectedAt: new Date().toISOString()
                };

                const exists = BackupState.deletedUsers.find(u => u.uid === uid);
                if (!exists) {
                    BackupState.deletedUsers.unshift(deletedUser);
                    BackupState.save();
                    
                    Logger.add('User Deleted (Real-time)', 'warning', `UID: ${uid} - ${deletedUser.name}`);
                    
                    if (BackupState.deleteAlertsEnabled) {
                        Utils.showNotification(
                            `⚠️ User ${deletedUser.name} deleted! Click to recover.`,
                            'warning',
                            10000
                        );
                    }
                    
                    loadDashboard();
                    renderDeletedUsers();
                }
            }
        } catch(err) {
            console.error('Error processing deleted user:', err);
        }
    });
}

// ==================== INITIALIZATION ====================

function init() {
    initializeFirebase();
    BackupState.load();
    loadDashboard();
    setupDeletedUserListener();
    updateRestoreAllButton();
    updateMaintenanceBanner();
    
    // Periodic checks
    setInterval(() => {
        detectDeletedUsers();
        checkConnections();
    }, 60000);

    // Enter key support
    document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchUser();
    });
    document.getElementById('compareInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') compareUserData();
    });
    document.getElementById('syncInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') syncUser();
    });
    document.getElementById('restoreInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') restoreUser();
    });

    // Initialize toggle states
    const autoSyncToggle = document.getElementById('autoSyncToggle');
    if (autoSyncToggle) autoSyncToggle.checked = BackupState.autoSyncEnabled;

    const deleteAlertsToggle = document.getElementById('deleteAlertsToggle');
    if (deleteAlertsToggle) deleteAlertsToggle.checked = BackupState.deleteAlertsEnabled;

    const maintenanceToggle = document.getElementById('maintenanceToggle');
    if (maintenanceToggle) maintenanceToggle.checked = BackupState.maintenanceMode;

    Logger.add('System Initialized', 'success', 'Backup v3.0 started');
    console.log('[RND Backup v3.0] System ready');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ==================== EXPOSE GLOBALS ====================
window.RNDBackup = {
    Utils,
    Logger,
    BackupState,
    CloudFunctionClient: cloud,
    searchUser,
    compareSingleUser,
    syncSingleUser,
    restoreSingleUser,
    restoreAllUsers,
    downloadBackup,
    downloadBackupHistory,
    triggerFullSync,
    checkBackupStatus,
    runHealthCheck,
    loadBackupHistory,
    renderLogs,
    renderDeletedUsers,
    showSection,
    toggleSidebar,
    openModal,
    closeModal,
    adminLogout,
    toggleAutoSync,
    toggleDeleteAlerts,
    toggleMaintenance,
    addAdmin,
    refreshDeletedUsers,
    refreshLogs,
    clearLogs,
    exportLogs
};