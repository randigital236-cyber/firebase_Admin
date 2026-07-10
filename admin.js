// ==================== ADD THESE FUNCTIONS TO admin.js ====================

// ==================== GET RECOVERY SNAPSHOTS ====================
async function getRecoverySnapshots() {
    try {
        const result = await cloud.call('getRecoverySnapshots', {});
        return result;
    } catch(e) {
        console.error('Get snapshots error:', e);
        Utils.showNotification('Failed to load snapshots: ' + e.message, 'error');
        return { success: false, snapshots: [] };
    }
}

// ==================== RESTORE FROM SNAPSHOT ====================
async function restoreFromSnapshot(snapshotId) {
    if (!confirm('⚠️ WARNING: This will restore data from snapshot: ' + snapshotId + '. Are you sure?')) return;
    if (!confirm('🔴 Type "RESTORE SNAPSHOT" to confirm.')) return;

    const btn = document.querySelector('#snapshotRestoreBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> Restoring...';
    }

    try {
        const result = await cloud.call('restoreFromSnapshot', { snapshotId });
        Utils.showNotification('Snapshot restored! ' + result.restored + ' paths restored', 'success');
        Logger.add('Restore From Snapshot', 'success', 'Snapshot: ' + snapshotId);
        loadDashboard();
        loadSnapshots();
    } catch(e) {
        Utils.showNotification('Restore failed: ' + e.message, 'error');
        Logger.add('Restore From Snapshot', 'failed', e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore Snapshot';
        }
    }
}

// ==================== LOAD SNAPSHOTS UI ====================
async function loadSnapshots() {
    const container = document.getElementById('snapshotList');
    if (!container) return;

    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Loading snapshots...</p></div>';

    try {
        const result = await getRecoverySnapshots();
        if (!result.success || result.snapshots.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><h3>No Snapshots</h3><p>Snapshots are created automatically before restore operations</p></div>';
            return;
        }

        let html = `
            <div style="margin-bottom:12px;color:var(--text-muted);font-size:0.9rem;">
                <strong style="color:var(--text);">${result.snapshots.length}</strong> recovery snapshots available
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Date/Time</th>
                            <th>Reason</th>
                            <th>Users</th>
                            <th>Admin</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        result.snapshots.forEach(snapshot => {
            const meta = snapshot._metadata || {};
            html += `
                <tr>
                    <td>${Utils.formatDate(meta.date)}</td>
                    <td><span class="tag tag-info">${meta.reason || 'Unknown'}</span></td>
                    <td>${meta.totalUsers || 0}</td>
                    <td>${meta.adminUid ? meta.adminUid.slice(0,12) : 'System'}</td>
                    <td class="actions">
                        <button class="btn btn-danger btn-sm" onclick="restoreFromSnapshot('${snapshot.id}')">
                            <i class="fas fa-rotate-left"></i> Restore
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="viewSnapshot('${snapshot.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

    } catch(e) {
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-circle-exclamation"></i> Error loading snapshots: ' + e.message + '</div>';
    }
}

// ==================== VIEW SNAPSHOT DETAILS ====================
async function viewSnapshot(snapshotId) {
    try {
        const result = await cloud.call('getRecoverySnapshots', {});
        const snapshot = result.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) {
            Utils.showNotification('Snapshot not found', 'error');
            return;
        }

        let html = `
            <div style="margin-bottom:16px;">
                <p><strong>Snapshot ID:</strong> ${snapshot.id}</p>
                <p><strong>Created:</strong> ${Utils.formatDate(snapshot._metadata?.date)}</p>
                <p><strong>Reason:</strong> ${snapshot._metadata?.reason || 'Unknown'}</p>
                <p><strong>Total Users:</strong> ${snapshot._metadata?.totalUsers || 0}</p>
                <p><strong>Admin:</strong> ${snapshot._metadata?.adminUid || 'System'}</p>
            </div>
            <div style="background:var(--darker);padding:16px;border-radius:8px;max-height:300px;overflow-y:auto;">
                <pre style="color:var(--text-muted);font-size:0.75rem;margin:0;white-space:pre-wrap;word-break:break-all;">
                    ${JSON.stringify(snapshot, null, 2)}
                </pre>
            </div>
        `;

        openModal('Snapshot Details: ' + snapshotId.slice(0,12), html);
    } catch(e) {
        Utils.showNotification('Error loading snapshot: ' + e.message, 'error');
    }
}

// ==================== CREATE MANUAL SNAPSHOT ====================
async function createManualSnapshot() {
    const reason = prompt('Enter reason for creating snapshot:');
    if (!reason) return;

    const btn = document.querySelector('#createSnapshotBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> Creating...';
    }

    try {
        const result = await cloud.call('createRecoverySnapshot', { reason, adminUid: window.currentAdmin?.uid });
        if (result.success) {
            Utils.showNotification('Snapshot created successfully! ID: ' + result.snapshotId, 'success');
            Logger.add('Create Snapshot', 'success', 'Reason: ' + reason);
            loadSnapshots();
        } else {
            Utils.showNotification('Snapshot creation failed: ' + result.error, 'error');
        }
    } catch(e) {
        Utils.showNotification('Error: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-camera"></i> Create Snapshot';
        }
    }
}

// ==================== ADD TO UI ====================
// Add this section to index.html

// Add in the HTML:
/*
<!-- ==================== RECOVERY SNAPSHOTS ==================== -->
<div id="snapshots" class="page-section">
    <div class="top-bar">
        <div class="left"><h1><i class="fas fa-clock-rotate-left"></i> Recovery Snapshots</h1></div>
        <div class="right">
            <button class="btn btn-primary btn-sm" id="createSnapshotBtn" onclick="createManualSnapshot()">
                <i class="fas fa-camera"></i> Create Snapshot
            </button>
            <button class="btn btn-outline btn-sm" onclick="loadSnapshots()">
                <i class="fas fa-rotate"></i> Refresh
            </button>
        </div>
    </div>
    <div class="section">
        <div style="margin-bottom:16px;padding:12px;background:var(--darker);border-radius:8px;">
            <p style="color:var(--text-muted);font-size:0.85rem;">
                <i class="fas fa-info-circle"></i> Snapshots are automatically created before any restore operation.
                You can also create manual snapshots to save the current state of your database.
                <br><strong>Last 10 snapshots are kept.</strong>
            </p>
        </div>
        <div id="snapshotList"></div>
    </div>
</div>
*/

// Add to nav-menu:
/*
<a class="nav-item" onclick="showSection('snapshots')">
    <i class="fas fa-clock-rotate-left"></i> Snapshots
    <span class="badge info">RECOVERY</span>
</a>
*/
