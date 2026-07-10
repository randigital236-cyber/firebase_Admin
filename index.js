// ==================== RND BACKUP SYSTEM v3.0 - ULTIMATE PRODUCTION ====================
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// ==================== CONFIG ====================
const MAIN_DB = admin.database();

// Backup Firebase Config
const BACKUP_CONFIG = {
    databaseURL: 'https://myapp-ee226-default-rtdb.asia-southeast1.firebasedatabase.app'
};

let backupApp;
try {
    backupApp = admin.initializeApp(BACKUP_CONFIG, 'backupApp');
} catch(e) {
    backupApp = admin.app('backupApp');
}
const BACKUP_DB = backupApp.database();

const SYNC_PATHS = ['users', 'deposits', 'withdrawals', 'usedTransactions', 'processingTransactions'];
const MAX_SNAPSHOTS = 10;

// ==================== ADMIN CHECK HELPER ====================
function checkAdmin(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Authentication required. Please login first.'
        );
    }
    return context.auth.uid;
}

// ==================== AUDIT LOG HELPER ====================
async function addAuditLog(action, details, adminUid) {
    try {
        const log = {
            action: action,
            details: details,
            adminUid: adminUid,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            date: new Date().toISOString()
        };
        await MAIN_DB.ref('auditLogs').push(log);
        return true;
    } catch(e) {
        console.error('Audit log error:', e);
        return false;
    }
}

// ==================== VALIDATE BACKUP DATA ====================
function validateBackupData(data, path) {
    if (!data) {
        return { valid: false, error: 'No data found for path: ' + path };
    }
    if (typeof data !== 'object') {
        return { valid: false, error: 'Invalid data format for path: ' + path };
    }
    if (Object.keys(data).length === 0) {
        return { valid: false, error: 'Empty data for path: ' + path };
    }
    return { valid: true };
}

// ==================== CREATE RECOVERY SNAPSHOT ====================
async function createRecoverySnapshot(reason, adminUid) {
    try {
        console.log('📸 Creating recovery snapshot... Reason:', reason);
        
        const snapshot = {};
        for (const path of SYNC_PATHS) {
            const snap = await MAIN_DB.ref(path).once('value');
            snapshot[path] = snap.val() || {};
        }

        // Add metadata
        const snapshotData = {
            ...snapshot,
            _metadata: {
                reason: reason,
                adminUid: adminUid,
                timestamp: admin.database.ServerValue.TIMESTAMP,
                date: new Date().toISOString(),
                totalUsers: Object.keys(snapshot.users || {}).length
            }
        };

        // Save snapshot
        const snapshotRef = BACKUP_DB.ref('recoverySnapshots');
        const newSnapRef = await snapshotRef.push(snapshotData);
        
        // ✅ Keep only last MAX_SNAPSHOTS
        const allSnapshots = await snapshotRef.orderByChild('_metadata/timestamp').once('value');
        const snapshots = allSnapshots.val() || {};
        const keys = Object.keys(snapshots);
        
        if (keys.length > MAX_SNAPSHOTS) {
            const toDelete = keys.slice(0, keys.length - MAX_SNAPSHOTS);
            for (const key of toDelete) {
                await snapshotRef.child(key).remove();
                console.log('🗑️ Removed old snapshot:', key);
            }
        }

        // ✅ AUDIT LOG
        await addAuditLog('createSnapshot', {
            reason: reason,
            totalUsers: Object.keys(snapshot.users || {}).length,
            snapshotId: newSnapRef.key
        }, adminUid);

        console.log('✅ Snapshot created successfully:', newSnapRef.key);
        return { success: true, snapshotId: newSnapRef.key };
    } catch(e) {
        console.error('❌ Snapshot creation failed:', e);
        return { success: false, error: e.message };
    }
}

// ==================== GET RECOVERY SNAPSHOTS ====================
exports.getRecoverySnapshots = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const snap = await BACKUP_DB.ref('recoverySnapshots')
            .orderByChild('_metadata/timestamp')
            .limitToLast(MAX_SNAPSHOTS)
            .once('value');
        
        const snapshots = snap.val() || {};
        const snapshotList = Object.entries(snapshots).map(([id, data]) => ({
            id: id,
            ...data,
            _metadata: data._metadata || {}
        })).reverse();

        return {
            success: true,
            snapshots: snapshotList,
            count: snapshotList.length
        };
    } catch(e) {
        console.error('Get snapshots error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== RESTORE FROM SNAPSHOT ====================
exports.restoreFromSnapshot = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const { snapshotId } = data;
        if (!snapshotId) {
            throw new functions.https.HttpsError('invalid-argument', 'Snapshot ID is required');
        }

        // ✅ VERIFY SNAPSHOT EXISTS
        const snapRef = BACKUP_DB.ref('recoverySnapshots').child(snapshotId);
        const snap = await snapRef.once('value');
        
        if (!snap.exists()) {
            throw new functions.https.HttpsError('not-found', 'Snapshot not found');
        }

        const snapshotData = snap.val();
        
        // ✅ CREATE ANOTHER SNAPSHOT BEFORE RESTORE (Safety)
        await createRecoverySnapshot('pre-restore-from-snapshot-' + snapshotId, adminUid);

        // ✅ RESTORE EACH PATH
        let restored = 0;
        let failed = 0;
        const failedPaths = [];

        for (const path of SYNC_PATHS) {
            try {
                const data = snapshotData[path];
                if (data) {
                    const validation = validateBackupData(data, path);
                    if (validation.valid) {
                        await MAIN_DB.ref(path).set(data);
                        restored++;
                    } else {
                        failed++;
                        failedPaths.push(path + ' (validation failed)');
                    }
                }
            } catch(e) {
                failed++;
                failedPaths.push(path + ' (' + e.message + ')');
                console.error('Restore from snapshot failed for path:', path, e);
            }
        }

        // ✅ AUDIT LOG
        await addAuditLog('restoreFromSnapshot', {
            snapshotId: snapshotId,
            restored: restored,
            failed: failed,
            failedPaths: failedPaths
        }, adminUid);

        return {
            success: true,
            restored: restored,
            failed: failed,
            failedPaths: failedPaths
        };
    } catch(e) {
        console.error('Restore from snapshot error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 1. FULL SYNC ====================
exports.fullSync = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const { paths } = data;
        const syncPaths = paths || SYNC_PATHS;
        let synced = 0;
        let failed = 0;
        const failedPaths = [];

        for (const path of syncPaths) {
            try {
                const snap = await MAIN_DB.ref(path).once('value');
                const data = snap.val();
                if (data) {
                    await BACKUP_DB.ref(path).update(data);
                    synced++;
                }
            } catch(e) {
                failed++;
                failedPaths.push(path);
                console.error('Sync failed for path:', path, e);
            }
        }

        await addAuditLog('fullSync', {
            synced: synced,
            failed: failed,
            failedPaths: failedPaths,
            total: syncPaths.length
        }, adminUid);

        await BACKUP_DB.ref('backupHistory').push({
            type: 'fullSync',
            status: failed === 0 ? 'success' : 'partial',
            synced: synced,
            failed: failed,
            total: syncPaths.length,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            admin: adminUid
        });

        return {
            success: true,
            synced: synced,
            failed: failed,
            failedPaths: failedPaths,
            total: syncPaths.length,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        console.error('Full sync error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 2. SYNC USER ====================
exports.syncUser = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const { uid } = data;
        if (!uid) {
            throw new functions.https.HttpsError('invalid-argument', 'UID is required');
        }

        const syncedPaths = [];
        const failedPaths = [];

        for (const path of SYNC_PATHS) {
            try {
                const snap = await MAIN_DB.ref(path + '/' + uid).once('value');
                const userData = snap.val();
                if (userData) {
                    await BACKUP_DB.ref(path + '/' + uid).update(userData);
                    syncedPaths.push(path);
                }
            } catch(e) {
                failedPaths.push(path);
                console.error('Sync failed for path:', path, e);
            }
        }

        await addAuditLog('syncUser', {
            uid: uid,
            syncedPaths: syncedPaths,
            failedPaths: failedPaths
        }, adminUid);

        return {
            success: true,
            uid: uid,
            syncedPaths: syncedPaths,
            failedPaths: failedPaths
        };
    } catch(e) {
        console.error('Sync user error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 3. RESTORE USER (WITH SNAPSHOT) ====================
exports.restoreUser = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const { uid } = data;
        if (!uid) {
            throw new functions.https.HttpsError('invalid-argument', 'UID is required');
        }

        // ✅ CREATE SNAPSHOT BEFORE RESTORE
        await createRecoverySnapshot('pre-restore-user-' + uid, adminUid);

        // ✅ VERIFY BACKUP DATA EXISTS
        const backupUserSnap = await BACKUP_DB.ref('users/' + uid).once('value');
        if (!backupUserSnap.exists()) {
            throw new functions.https.HttpsError('not-found', 'User not found in backup');
        }

        const restoredPaths = [];
        const failedPaths = [];

        for (const path of SYNC_PATHS) {
            try {
                const snap = await BACKUP_DB.ref(path + '/' + uid).once('value');
                const backupData = snap.val();
                
                if (backupData) {
                    const validation = validateBackupData(backupData, path);
                    if (validation.valid) {
                        await MAIN_DB.ref(path + '/' + uid).set(backupData);
                        restoredPaths.push(path);
                    } else {
                        failedPaths.push(path + ' (validation failed: ' + validation.error + ')');
                    }
                }
            } catch(e) {
                failedPaths.push(path + ' (' + e.message + ')');
                console.error('Restore failed for path:', path, e);
            }
        }

        await addAuditLog('restoreUser', {
            uid: uid,
            restoredPaths: restoredPaths,
            failedPaths: failedPaths
        }, adminUid);

        return {
            success: true,
            uid: uid,
            restoredPaths: restoredPaths,
            failedPaths: failedPaths
        };
    } catch(e) {
        console.error('Restore user error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 4. RESTORE ALL USERS (WITH SNAPSHOT) ====================
exports.restoreAllUsers = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        // ✅ CREATE SNAPSHOT BEFORE RESTORE
        await createRecoverySnapshot('pre-restore-all-users', adminUid);

        const backupUsersSnap = await BACKUP_DB.ref('users').once('value');
        if (!backupUsersSnap.exists()) {
            throw new functions.https.HttpsError('not-found', 'No users found in backup');
        }

        const backupUsers = backupUsersSnap.val() || {};
        const userIds = Object.keys(backupUsers);
        
        if (userIds.length === 0) {
            throw new functions.https.HttpsError('not-found', 'No users found in backup');
        }

        let restored = 0;
        let failed = 0;
        const failedUsers = [];

        for (const uid of userIds) {
            try {
                let userValid = false;
                for (const path of SYNC_PATHS) {
                    const snap = await BACKUP_DB.ref(path + '/' + uid).once('value');
                    const data = snap.val();
                    if (data) {
                        const validation = validateBackupData(data, path);
                        if (validation.valid) {
                            userValid = true;
                            break;
                        }
                    }
                }

                if (!userValid) {
                    failed++;
                    failedUsers.push(uid + ' (no valid data)');
                    continue;
                }

                for (const path of SYNC_PATHS) {
                    try {
                        const snap = await BACKUP_DB.ref(path + '/' + uid).once('value');
                        const data = snap.val();
                        if (data) {
                            await MAIN_DB.ref(path + '/' + uid).set(data);
                        }
                    } catch(e) {
                        console.error('Restore failed for path:', path, uid, e);
                    }
                }
                restored++;
            } catch(e) {
                failed++;
                failedUsers.push(uid + ' (' + e.message + ')');
                console.error('Restore failed for user:', uid, e);
            }
        }

        await addAuditLog('restoreAllUsers', {
            restored: restored,
            failed: failed,
            failedUsers: failedUsers,
            total: userIds.length
        }, adminUid);

        return {
            success: true,
            restored: restored,
            failed: failed,
            failedUsers: failedUsers,
            total: userIds.length
        };
    } catch(e) {
        console.error('Restore all users error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 5. DOWNLOAD BACKUP ====================
exports.downloadBackup = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const backup = {};
        for (const path of SYNC_PATHS) {
            const snap = await BACKUP_DB.ref(path).once('value');
            backup[path] = snap.val() || {};
        }

        try {
            const bucket = admin.storage().bucket();
            const filename = 'backups/backup_' + Date.now() + '.json';
            const file = bucket.file(filename);

            await file.save(JSON.stringify(backup, null, 2), {
                contentType: 'application/json'
            });

            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: Date.now() + 24 * 60 * 60 * 1000
            });

            await addAuditLog('downloadBackup', {
                filename: filename,
                size: JSON.stringify(backup).length
            }, adminUid);

            return {
                success: true,
                url: url,
                filename: filename
            };
        } catch(e) {
            console.warn('Storage not configured:', e);
            return {
                success: true,
                data: backup,
                warning: 'Storage not configured. Data returned directly.'
            };
        }
    } catch(e) {
        console.error('Download backup error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 6. HEALTH CHECK ====================
exports.runHealthCheck = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const checks = {};
        const alerts = [];

        const mainUsers = await MAIN_DB.ref('users').once('value');
        const backupUsers = await BACKUP_DB.ref('users').once('value');
        const mainCount = Object.keys(mainUsers.val() || {}).length;
        const backupCount = Object.keys(backupUsers.val() || {}).length;

        checks.users = { main: mainCount, backup: backupCount };

        if (mainCount !== backupCount) {
            alerts.push('User count mismatch: Main=' + mainCount + ', Backup=' + backupCount);
        }

        checks.paths = [];
        for (const path of SYNC_PATHS) {
            const mainSnap = await MAIN_DB.ref(path).once('value');
            const backupSnap = await BACKUP_DB.ref(path).once('value');
            const main = Object.keys(mainSnap.val() || {}).length;
            const backup = Object.keys(backupSnap.val() || {}).length;
            checks.paths.push({ path, main, backup });
            if (main !== backup) {
                alerts.push(path + ' count mismatch: Main=' + main + ', Backup=' + backup);
            }
        }

        const status = alerts.length === 0 ? 'healthy' : 'warning';

        await addAuditLog('healthCheck', {
            status: status,
            alerts: alerts,
            checks: checks
        }, adminUid);

        return {
            status: status,
            checks: checks,
            alerts: alerts,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        console.error('Health check error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 7. GET BACKUP STATUS ====================
exports.getBackupStatus = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        let totalRecords = 0;
        const pathStats = {};
        
        for (const path of SYNC_PATHS) {
            const snap = await BACKUP_DB.ref(path).once('value');
            const count = Object.keys(snap.val() || {}).length;
            totalRecords += count;
            pathStats[path] = count;
        }

        const lastBackupSnap = await BACKUP_DB.ref('backupHistory').orderByChild('timestamp').limitToLast(1).once('value');
        let lastBackup = null;
        if (lastBackupSnap.exists()) {
            const data = lastBackupSnap.val();
            const keys = Object.keys(data);
            if (keys.length > 0) {
                lastBackup = data[keys[0]];
            }
        }

        return {
            success: true,
            totalRecords: totalRecords,
            pathStats: pathStats,
            lastBackup: lastBackup,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        console.error('Get backup status error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 8. GET BACKUP HISTORY ====================
exports.getBackupHistory = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const snap = await BACKUP_DB.ref('backupHistory').orderByChild('timestamp').limitToLast(50).once('value');
        const history = snap.val() || {};
        const historyArray = Object.values(history).reverse();

        return {
            success: true,
            history: historyArray,
            count: historyArray.length
        };
    } catch(e) {
        console.error('Get backup history error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 9. GET AUDIT LOGS ====================
exports.getAuditLogs = functions.https.onCall(async (data, context) => {
    const adminUid = checkAdmin(context);
    
    try {
        const limit = data?.limit || 50;
        const snap = await MAIN_DB.ref('auditLogs').orderByChild('timestamp').limitToLast(limit).once('value');
        const logs = snap.val() || {};
        const logArray = Object.values(logs).reverse();

        return {
            success: true,
            logs: logArray,
            count: logArray.length
        };
    } catch(e) {
        console.error('Get audit logs error:', e);
        throw new functions.https.HttpsError('internal', e.message);
    }
});

// ==================== 10. AUTO BACKUP - Daily at Midnight ====================
exports.autoBackup = functions.pubsub.schedule('0 0 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        try {
            console.log('🔄 Auto backup started at:', new Date().toISOString());
            let synced = 0;
            let failed = 0;
            const failedPaths = [];

            for (const path of SYNC_PATHS) {
                try {
                    const snap = await MAIN_DB.ref(path).once('value');
                    const data = snap.val();
                    if (data) {
                        await BACKUP_DB.ref(path).update(data);
                        synced++;
                    }
                } catch(e) {
                    failed++;
                    failedPaths.push(path);
                    console.error('Auto backup failed for path:', path, e);
                }
            }

            await BACKUP_DB.ref('backupHistory').push({
                type: 'autoBackup',
                status: failed === 0 ? 'success' : 'partial',
                synced: synced,
                failed: failed,
                failedPaths: failedPaths,
                total: SYNC_PATHS.length,
                timestamp: admin.database.ServerValue.TIMESTAMP,
                source: 'scheduled'
            });

            await addAuditLog('autoBackup', {
                synced: synced,
                failed: failed,
                failedPaths: failedPaths
            }, 'system');

            console.log('✅ Auto backup completed:', synced + '/' + SYNC_PATHS.length + ' paths');
            return null;
        } catch(e) {
            console.error('❌ Auto backup failed:', e);
            return null;
        }
    });

// ==================== 11. CLEANUP OLD BACKUPS ====================
exports.cleanupOldBackups = functions.pubsub.schedule('0 1 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        try {
            console.log('🧹 Starting cleanup...');
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            
            const snap = await BACKUP_DB.ref('backupHistory').orderByChild('timestamp').once('value');
            const history = snap.val() || {};
            
            let deleted = 0;
            for (const [key, value] of Object.entries(history)) {
                if (value.timestamp < thirtyDaysAgo) {
                    await BACKUP_DB.ref('backupHistory').child(key).remove();
                    deleted++;
                }
            }
            
            console.log('✅ Cleanup completed. Deleted:', deleted, 'old backups');
            return null;
        } catch(e) {
            console.error('❌ Cleanup failed:', e);
            return null;
        }
    });