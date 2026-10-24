/**
 * middleware/pageAccess.js
 * 
 * Core Server Enforcement Middleware for EAMS Role Access System (§5.2, R2.2).
 * Implements requirePage, scopeFilter, assertInScope, and rate-limited denied-access logging.
 */

const { isSudo } = require('../utils/access');
const { isTabAllowed, PAGE_REGISTRY } = require('../config/pageRegistry');
const { logAction } = require('../utils/logAction');

// In-memory rate limiting map for access-denied logging (1 / min / user / page)
const deniedLogMap = new Map();
const RATE_LIMIT_MS = 60 * 1000;

// Periodic cleanup of stale rate-limit keys every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_MS;
  for (const [key, timestamp] of deniedLogMap.entries()) {
    if (timestamp < cutoff) {
      deniedLogMap.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

/**
 * requirePage(page, action, opts)
 * 
 * Enforces that the authenticated user possesses rights for the target page,
 * action, and optional tab override (§5.2).
 * 
 * On success:
 *   Attaches `req.scope = { type: 'institution' } | { type: 'department', deptId }`.
 * On failure:
 *   Emits rate-limited access-denied audit log and responds with 403.
 */
function requirePage(page, action = 'view', opts = {}) {
  const targetPage = String(page || '').toLowerCase().trim();
  const targetAction = String(action || 'view').toLowerCase().trim();
  const targetTab = opts.tab ? String(opts.tab).toLowerCase().trim() : null;

  return async function pageAccessGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }

    // 1. Sudo Admin has unconditional institution-wide authority
    if (isSudo(req)) {
      req.scope = { type: 'institution', deptId: null };
      return next();
    }

    const access = req.access || {};
    const pages = access.pages || {};
    const grant = pages[targetPage];

    let isAllowed = false;
    let deniedReason = '';

    if (!grant) {
      isAllowed = false;
      deniedReason = `No grant for page '${targetPage}'`;
    } else {
      // 2. Check tab allowance if tab is specified
      let tabAllowed = true;
      if (targetTab) {
        if (Array.isArray(grant.allowedTabs) && !grant.allowedTabs.includes('*') && !grant.allowedTabs.includes(targetTab)) {
          tabAllowed = false;
        } else if (!isTabAllowed(targetPage, targetTab, grant.module)) {
          tabAllowed = false;
        }
      }

      if (!tabAllowed) {
        isAllowed = false;
        deniedReason = `Tab '${targetTab}' on page '${targetPage}' is not accessible under module '${grant.module}'`;
      } else {
        // 3. Check action allowance (with tabActions priority)
        let actionAllowed = false;
        if (targetTab && grant.tabActions && Array.isArray(grant.tabActions[targetTab])) {
          actionAllowed = grant.tabActions[targetTab].includes(targetAction);
        } else if (Array.isArray(grant.actions)) {
          actionAllowed = grant.actions.includes(targetAction);
        }

        if (!actionAllowed) {
          isAllowed = false;
          deniedReason = `Action '${targetAction}' is not permitted for page '${targetPage}'${targetTab ? ` (tab: ${targetTab})` : ''}`;
        } else {
          isAllowed = true;
        }
      }
    }

    if (!isAllowed) {
      // 4. Rate-limited audit log (1 / min / user / page)
      const userTrackId = req.user.trackId || req.user.username || String(req.user._id || 'ANON');
      const rateKey = `${userTrackId}_${targetPage}_${targetAction}`;
      const lastLogged = deniedLogMap.get(rateKey) || 0;
      const now = Date.now();

      if (now - lastLogged >= RATE_LIMIT_MS) {
        deniedLogMap.set(rateKey, now);
        setImmediate(() => {
          logAction(
            req.user.trackId || req.user._id,
            req.user.name || req.user.username,
            req.user.role,
            'Access Denied',
            `Attempted ${targetAction.toUpperCase()} on '${targetPage}'${targetTab ? ` (tab: ${targetTab})` : ''}. Reason: ${deniedReason}`,
            'security',
            'warning',
            req.ip,
            req.user.sessionId,
            {
              module: targetPage,
              subType: 'access-denied',
              trackId: req.user.trackId,
              actingWithAdminRights: req.user.actingWithAdminRights,
              deniedAction: targetAction,
              deniedPage: targetPage,
              deniedTab: targetTab
            }
          ).catch(() => {});
        });
      }

      return res.status(403).json({
        error: 'Access denied: insufficient page rights',
        details: deniedReason,
        page: targetPage,
        action: targetAction,
        tab: targetTab
      });
    }

    // 5. Establish scope on request
    const scopeType = grant.scope || 'department';
    if (scopeType === 'institution') {
      req.scope = { type: 'institution', deptId: null, deptName: null };
    } else {
      req.scope = {
        type: 'department',
        deptId: grant.deptId || req.user.deptId || req.user.departmentId || null,
        deptName: grant.dept || req.user.department || req.user.deptName || null
      };
      if (!req.scope.deptId && grant.dept) {
        req.scope.deptId = grant.dept;
      }
    }

    next();
  };
}

/**
 * scopeFilter(req, fieldName = 'deptId')
 * 
 * Generates database query filter for list queries (§5.2).
 *  - Institution scope: `{}` (no department constraint)
 *  - Department scope: `{ [fieldName]: deptId }`
 */
function scopeFilter(req, fieldName = 'deptId') {
  if (!req || !req.scope || req.scope.type === 'institution') {
    return {};
  }
  if (req.scope.type === 'department' && req.scope.deptId) {
    return { [fieldName]: req.scope.deptId };
  }
  return {};
}

/**
 * assertInScope(req, targetDeptId)
 * 
 * Verifies that a target department is within the caller's allowed scope (§5.2).
 *  - Institution scope: returns true
 *  - Department scope: returns true if targetDeptId matches req.scope.deptId or req.scope.deptName, false otherwise.
 */
function assertInScope(req, targetDeptId) {
  if (!req || !req.scope || req.scope.type === 'institution') {
    return true;
  }
  if (!targetDeptId) return false;
  const userDeptId = String(req.scope.deptId || req.access?.pages?.admin?.deptId || req.access?.pages?.timetable?.deptId || req.user?.deptId || req.user?.departmentId || '');
  const userDeptName = String(req.scope.deptName || req.access?.pages?.admin?.dept || req.access?.pages?.timetable?.dept || req.user?.department || req.user?.deptName || req.user?.TTdeptName || '').trim().toLowerCase();
  const target = String(targetDeptId._id || targetDeptId).trim();
  if (userDeptId && userDeptId === target) {
    return true;
  }
  if (userDeptName && target.toLowerCase() === userDeptName) {
    return true;
  }
  return false;
}

module.exports = {
  requirePage,
  scopeFilter,
  assertInScope
};
