const M = require('../../models');
const { isSudoAdmin, isSubAdmin: isSubAdminRbac } = require('../../utils/access');

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
  return false;
}

/**
 * List filter query builder for sidebar / batch query
 */
function listFilter(u) {
  if (!u) return { _id: null };
  if (isSudoCaller(u)) return {};
  if (isSubAdmin(u) && u.deptId) {
    return {
      $or: [
        { 'uploadedBy.userId': u._id },
        { 'uploadedBy.deptId': u.deptId }
      ]
    };
  }
  return { 'uploadedBy.userId': u._id };
}

/**
 * Express middleware to load a batch by :id with visibility and permission checks
 */
function loadBatch(rule = 'view') {
  return async (req, res, next) => {
    try {
      const b = await M.BulkImportBatch.findById(req.params.id, { fileBufferBase64: 0 });
      if (!b || !canView(req.user, b)) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      if (rule === 'sudo' && !isSudoCaller(req.user)) {
        return res.status(403).json({ error: 'Requires sudo administrator privileges' });
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
 * Sanitizes batch representation for client output
 * Strips fileBufferBase64, internal fileRef, and plaintext passwords from eligible rows
 */
function toClient(batch, user, opts = {}) {
  if (!batch) return null;
  const doc = batch.toObject ? batch.toObject() : JSON.parse(JSON.stringify(batch));
  delete doc.fileBufferBase64;
  delete doc.fileRef;

  if (Array.isArray(doc.eligibleRows)) {
    const totalEligible = doc.eligibleRows.length;
    if (opts.previewLimit && totalEligible > opts.previewLimit) {
      doc.eligibleRows = doc.eligibleRows.slice(0, opts.previewLimit);
      doc.hasMoreRows = true;
      doc.totalEligibleRows = totalEligible;
    }
    doc.eligibleRows = doc.eligibleRows.map(row => {
      if (row && row.data && row.data.password !== undefined) {
        const rowCopy = { ...row, data: { ...row.data } };
        delete rowCopy.data.password;
        return rowCopy;
      }
      return row;
    });
  }

  if (Array.isArray(doc.skippedRows)) {
    doc.skippedRows = doc.skippedRows.map(row => {
      if (row && row.data && row.data.password !== undefined) {
        const rowCopy = { ...row, data: { ...row.data } };
        delete rowCopy.data.password;
        return rowCopy;
      }
      return row;
    });
  }

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

module.exports = {
  isSudoCaller,
  isSubAdmin,
  canView,
  listFilter,
  loadBatch,
  toClient
};
