const mongoose = require('mongoose');
const M = require('../../models');
const { isSudoAdmin, isSubAdmin: isSubAdminRbac, isAdminUser } = require('../../utils/access');

/**
 * Checks whether user has full sudo / system admin privileges for bulk operations
 */
function isSudoCaller(u) {
  if (!u) return false;
  if (u.isSudoAdmin === true) return true;
  if (u.accessRole === 'sudoAdmin') return true;
  if (u.access && u.access.flags && u.access.flags.isSudo) return true;
  if (u.hasInstitutionReach === true && (u.isAdmin === true || u.role === 'admin')) return true;
  if (u.role === 'sudo' || (u.role === 'admin' && u.adminFlag !== 'subadmin')) return true;
  return Boolean(isSudoAdmin(u));
}

/**
 * Sub-admin check helper
 */
function isSubAdmin(u) {
  if (!u) return false;
  if (u.role === 'admin' && u.adminFlag === 'subadmin') return true;
  if (u.isSubAdmin === true) return true;
  if (typeof isSubAdminRbac === 'function' && isSubAdminRbac(u)) return true;
  return false;
}

/**
 * Checks whether user has any administrative role (Sudo, Super Admin, Sub-admin)
 * Enforces server-side Drive folder & backup metadata redaction for non-admins (A6)
 */
function isAdminRole(u) {
  if (!u) return false;
  if (isSudoCaller(u)) return true;
  if (isSubAdmin(u)) return true;
  if (u.isSuperAdmin === true || u.accessRole === 'superAdmin') return true;
  if (['sudoAdmin', 'superAdmin'].includes(u.accessRole)) return true;
  if (typeof isAdminUser === 'function' && isAdminUser(u)) return true;
  return false;
}

/**
 * Evaluates view permission for a batch
 */
function canView(u, b) {
  if (!u || !b) return false;
  if (isSudoCaller(u)) return true;
  if (b.uploadedBy?.userId && String(b.uploadedBy.userId) === String(u._id)) return true;

  // D2: Department sub-admins can view chats in their department (read-only)
  if (isSubAdmin(u) && u.deptId && b.uploadedBy?.deptId && String(b.uploadedBy.deptId) === String(u.deptId)) {
    return true;
  }

  // Participants have view access
  if (Array.isArray(b.participants) && b.participants.some(p => p && String(p.userId) === String(u._id))) {
    return true;
  }

  return false;
}

/**
 * List filter query builder for sidebar / batch query
 */
function listFilter(u, options = {}) {
  if (!u) return { _id: null };
  const showDeleted = options.showDeleted === true;
  const deletedFilter = showDeleted ? { deletedAt: { $ne: null } } : { deletedAt: null };

  if (isSudoCaller(u)) {
    return { ...deletedFilter };
  }
  if (isSubAdmin(u) && u.deptId) {
    return {
      ...deletedFilter,
      $or: [
        { 'uploadedBy.userId': u._id },
        { 'uploadedBy.deptId': u.deptId },
        { 'participants.userId': u._id }
      ]
    };
  }
  return {
    ...deletedFilter,
    $or: [
      { 'uploadedBy.userId': u._id },
      { 'participants.userId': u._id }
    ]
  };
}

/**
 * Express middleware to load a batch by :id or :trackId with visibility and permission checks
 * Accepts Mongo ObjectId (24 hex), new trackId (TR-BK...), or legacy trackId (TR-BATCH-...)
 */

/**
 * Evaluates whether user can act on batch records (resolve skipped, verify, comment, upload)
 * Granted to Owner, Sudo admin, or Collaborator participants (A6, §8.2)
 */
/**
 * Evaluates whether user can manage the batch (add user, undo, delete, manage participants)
 * Granted to Sudo admin, Super Admin (in scope), or Owner (when not closed) (A6, §8.1)
 */
function canManage(u, b) {
  if (!u || !b) return false;
  if (isSudoCaller(u)) return true;
  if (b.closed && b.closed.at) return false;
  const isOwner = b.uploadedBy?.userId && String(b.uploadedBy.userId) === String(u._id);
  if (isOwner) return true;
  if (isSuperAdmin(u) && allRowsInScope(b, u)) return true;
  return false;
}

function canAct(u, b) {
  if (!u || !b) return false;
  if (isSudoCaller(u)) return true;
  if (b.uploadedBy?.userId && String(b.uploadedBy.userId) === String(u._id)) return true;
  if (Array.isArray(b.participants) && b.participants.some(p => p && String(p.userId) === String(u._id) && p.level === 'collaborator')) {
    return true;
  }
  return false;
}

function loadBatch(rule = 'view') {
  return async (req, res, next) => {
    try {
      const rawId = String(req.params.id || '').trim();
      let b;
      if (mongoose.isValidObjectId(rawId)) {
        b = await M.BulkImportBatch.findById(req.params.id, { fileBufferBase64: 0 });
      } else {
        b = await M.BulkImportBatch.findOne({ batchTrackId: rawId }, { fileBufferBase64: 0 });
      }
      if (!b || !canView(req.user, b)) {
        return res.status(404).json({ error: 'Batch not found' });
      }

            if (rule === 'manage') {
        if (!canManage(req.user, b)) {
          return res.status(403).json({ error: 'Permission denied: owner, super admin, or sudo only' });
        }
      }

      if (rule === 'sudo' && !isSudoCaller(req.user)) {
        return res.status(403).json({ error: 'Requires sudo administrator privileges' });
      }

            if (rule === 'collab') {
        if (!canAct(req.user, b)) {
          return res.status(403).json({ error: 'Permission denied: collaborator, owner, or sudo only' });
        }
      }

      if (rule === 'ownerOrSudo') {
        const isOwner = b.uploadedBy?.userId && String(b.uploadedBy.userId) === String(req.user._id);
        if (!isOwner && !isSudoCaller(req.user)) {
          return res.status(403).json({ error: 'Permission denied: owner or sudo only' });
        }
      }

      req.batch = b;
      next();
    } catch (err) {
      console.error('[BulkAccess loadBatch Error]:', err.message);
      return res.status(500).json({ error: 'Error loading import batch: ' + err.message });
    }
  };
}

/**
 * Redacts sensitive fields from batch objects before transmitting to client
 * Removes Google Drive links & uploads from non-admins, and strips passwords for all
 */
function redact(doc, viewer) {
  if (!doc) return doc;
  const admin = isAdminRole(viewer);

  if (!admin) {
    delete doc.drive;
    delete doc.uploads;
    if (doc.backup) {
      delete doc.backup.driveFileId;
      delete doc.backup.driveWebViewLink;
      delete doc.backup.localPath;
    }
  }

  delete doc.fileRef;
  delete doc.fileBufferBase64;

  if (Array.isArray(doc.eligibleRows)) {
    for (const r of doc.eligibleRows) {
      if (r && r.data && r.data.password !== undefined) {
        delete r.data.password;
      }
    }
  }

  if (Array.isArray(doc.skippedRows)) {
    for (const r of doc.skippedRows) {
      if (r && r.data && r.data.password !== undefined) {
        delete r.data.password;
      }
    }
  }

  return doc;
}

/**
 * Sanitizes batch representation for client output
 */
function toClient(batch, user, opts = {}) {
  if (!batch) return null;
  const doc = batch.toObject ? batch.toObject() : JSON.parse(JSON.stringify(batch));

  if (Array.isArray(doc.eligibleRows)) {
    const totalEligible = doc.eligibleRows.length;
    if (opts.previewLimit && totalEligible > opts.previewLimit) {
      doc.eligibleRows = doc.eligibleRows.slice(0, opts.previewLimit);
      doc.hasMoreRows = true;
      doc.totalEligibleRows = totalEligible;
    }
  }

  // Apply server-side redactions
  redact(doc, user);

  const isOwner = doc.uploadedBy?.userId && user?._id && String(doc.uploadedBy.userId) === String(user._id);
  const isSudo = isSudoCaller(user);

  doc.can = {
    edit: isOwner || isSudo,
    approveInitial: isSudo,
    approveFinal: isSudo,
    retry: isOwner || isSudo,
    comment: isOwner || isSudo,
    archive: true
  };

  return doc;
}


/**
 * Super-admin check helper
 */
function isSuperAdmin(u) {
  if (!u) return false;
  if (u.isSuperAdmin === true || u.accessRole === 'superAdmin') return true;
  if (u.role === 'superadmin') return true;
  return false;
}

/**
 * Checks whether all rows in the batch match the user's assigned scope/department
 */
function allRowsInScope(batch, user) {
  if (!user) return false;
  const scopeDept = user.deptId ? String(user.deptId) : null;
  if (!scopeDept) return true; // Unrestricted scope if user has no assigned dept limitation

  const checkRow = (r) => {
    if (!r || !r.data) return true;
    const d = r.data.department || r.data.dept;
    if (!d) return true;
    return String(d).toLowerCase() === String(scopeDept).toLowerCase() ||
           String(d).toLowerCase() === String(user.deptName || '').toLowerCase();
  };

  if (Array.isArray(batch.eligibleRows) && !batch.eligibleRows.every(checkRow)) return false;
  if (Array.isArray(batch.skippedRows) && !batch.skippedRows.every(checkRow)) return false;
  return true;
}

/**
 * Pure function: canAutoApprove(user, batch)
 * Sudo admin always auto-approves.
 * Super Admin auto-approves if all rows are in scope and batch is not 'dept'.
 */
function canAutoApprove(user, batch) {
  if (!user || !batch) return false;
  if (isSudoCaller(user)) return true;

  if (isSuperAdmin(user)) {
    // Departments can only be created / approved by Sudo admin
    if (batch.type === 'dept') return false;
    const hasScope = Boolean(batch.uploadedBy?.scope || user.deptId || user.hasInstitutionReach);
    if (hasScope && allRowsInScope(batch, user)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isSudoCaller,
  isSubAdmin,
  isSuperAdmin,
  isAdminRole,
  allRowsInScope,
  canAutoApprove,
  canManage,
  canAct,
  canView,
  listFilter,
  loadBatch,
  redact,
  toClient
};
