/**
 * EAMS Access Control and RBAC Utilities
 *
 * Centralizes capability derivation for Admin Unification:
 * - Pure functions with no direct database queries.
 * - Sudo Admin: institution-wide administrator.
 * - Super Admin: department-scoped administrator (reserved, fails closed for institution scope).
 * - Sub-admin: staff with specific pageRights.
 */

const ALLOWED_PAGES = ['*', 'control', 'manage', 'bulk', 'settings', 'timetable', 'export', 'logs'];
const ALLOWED_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'assign', 'publish'];
const ALLOWED_ROLES = ['sudoAdmin', 'superAdmin', 'principal', 'hod', 'classAdvisor', 'ttCoordinator', 'examCoordinator', 'placementCoordinator', 'warden', 'staff'];
const ALLOWED_SCOPES = ['institution', 'department', 'assigned', 'own'];


/**
 * Reads a special option off a user document.
 * Option must be present and its value must not be false.
 */
function hasSpecial(doc, option) {
  if (!doc) return false;
  const specials = Array.isArray(doc.specials) ? doc.specials : [];
  const s = specials.find(x => x && x.option === option);
  if (!s) return false;
  if (option === 'isAdmin') {
    return s.value !== false && s.value !== 'false';
  }
  return s.value !== false && s.value !== 'false';
}

/**
 * Returns true if the user possesses admin identity/capabilities.
 */
function isAdminUser(u) {
  if (!u) return false;
  if (u.isAdmin === true || u.isSudoAdmin === true || u.isSuperAdmin === true || u.isSubAdmin === true) return true;
  if (['admin', 'sudo'].includes(u.role)) return true;
  if (!u.role || u.role === 'teacher') {
    return hasSpecial(u, 'isAdmin') || u.isAdmin === true;
  }
  return false;
}

/**
 * Normalizes an array of pageRights entries according to system invariants.
 * Rejects invalid entries on write and ignores them on read.
 */
function normalizePageRights(entries) {
  let list = entries;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    if (Array.isArray(entries.grants)) {
      list = entries.grants;
    } else {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const valid = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const page = typeof raw.page === 'string' ? raw.page.trim().toLowerCase() : '';
    if (!page) continue;

    const accessRole = ALLOWED_ROLES.includes(raw.accessRole) ? raw.accessRole : 'staff';
    let scope = ALLOWED_SCOPES.includes(raw.scope) ? raw.scope : 'own';
    let deptId = raw.deptId || null;

    // Invariant: sudoAdmin requires scope 'institution'
    if (accessRole === 'sudoAdmin') {
      if (scope !== 'institution') continue;
      deptId = null;
    }

    // Invariant: superAdmin can have scope 'institution' (full access) or 'department' (dept-scoped)
    if (accessRole === 'superAdmin') {
      if (scope === 'institution') {
        deptId = null;
      } else if (scope === 'department') {
        if (!deptId) continue;
      } else {
        continue;
      }
    }

    // Invariant: principal has controller scope across departments (defaults to 'institution')
    if (accessRole === 'principal') {
      if (scope !== 'institution' && scope !== 'department') {
        scope = 'institution';
      }
      if (scope === 'institution') {
        deptId = null;
      }
    }

    const actions = Array.isArray(raw.actions)
      ? raw.actions.filter(a => ALLOWED_ACTIONS.includes(a))
      : ['view'];

    valid.push({
      page,
      module: typeof raw.module === 'string' && raw.module.trim() ? raw.module.trim() : '*',
      accessRole,
      scope,
      deptId,
      actions,
      enabled: raw.enabled !== false
    });
  }

  return valid;
}

/**
 * Returns true if the user is a Sudo Admin (full institution reach).
 */
function isSudoAdmin(u) {
  if (!u) return false;
  if (u.isSudoAdmin === true || (u.access && u.access.flags && u.access.flags.isSudo)) return true;
  if (u.accessRole === 'superAdmin' && u.scope !== 'institution') return false;
  if (u.adminFlag === 'subadmin') return false;
  if (['admin', 'sudo'].includes(u.role) && (!u.adminFlag || u.adminFlag === 'superadmin' || u.adminFlag === 'principal')) {
    return true;
  }
  if (!isAdminUser(u)) return false;
  if (u.pageRights && typeof u.pageRights === 'object' && !Array.isArray(u.pageRights) && u.pageRights.accessRole === 'sudoAdmin') {
    return true;
  }
  const pageRights = normalizePageRights(u.pageRights);
  return pageRights.some(entry =>
    entry.enabled &&
    entry.accessRole === 'sudoAdmin' &&
    entry.scope === 'institution' &&
    (entry.page === '*' || entry.page === 'all')
  );
}

/**
 * Returns true if an admin user has institution-wide reach.
 * Super Admins with institution scope have institution reach.
 */
function hasInstitutionReach(u) {
  if (!isAdminUser(u)) return false;
  if (['admin', 'sudo'].includes(u.role)) return true;
  if (isSudoAdmin(u)) return true;

  const pageRights = normalizePageRights(u.pageRights);
  const enabledAdminEntries = pageRights.filter(e => e.enabled && ['sudoAdmin', 'superAdmin', 'staff'].includes(e.accessRole));
  
  if (enabledAdminEntries.length === 0) {
    // If no specific rights are configured yet, preserve baseline admin status
    return true;
  }

  // If ANY enabled entry has institution scope, institution reach is granted
  const hasInstitutionScope = enabledAdminEntries.some(e => e.scope === 'institution');
  if (hasInstitutionScope) return true;

  // If EVERY enabled entry is department-scoped, institution reach is denied
  const allDeptScoped = enabledAdminEntries.every(e => e.scope === 'department');
  return !allDeptScoped;
}

/**
 * Returns true if the user is a Super Admin (department-scoped admin).
 */
function isSuperAdmin(u) {
  if (!u) return false;
  if (isSudoAdmin(u)) return false;
  if (!isAdminUser(u)) return false;

  if (u.pageRights && typeof u.pageRights === 'object' && !Array.isArray(u.pageRights) && u.pageRights.accessRole === 'superAdmin') {
    return true;
  }
  const rawList = Array.isArray(u.pageRights) ? u.pageRights : (u.pageRights && Array.isArray(u.pageRights.grants) ? u.pageRights.grants : []);
  if (rawList.some(e => e && e.enabled !== false && e.accessRole === 'superAdmin')) {
    return true;
  }
  const pageRights = normalizePageRights(u.pageRights);
  if (pageRights.some(e => e.enabled && e.accessRole === 'superAdmin')) {
    return true;
  }
  if (['admin'].includes(u.role) && u.adminFlag === 'subadmin') {
    return true;
  }
  return false;
}

/**
 * Returns true if the user is a Super Admin for a specific department (or Sudo Admin).
 */
function isSuperAdminForDept(u, deptId) {
  if (!u) return false;
  if (isSudoAdmin(u)) return true;
  if (!isAdminUser(u)) return false;
  if (u.deptId && deptId && String(u.deptId) === String(deptId)) return true;
  const pageRights = normalizePageRights(u.pageRights);
  return pageRights.some(entry =>
    entry.enabled &&
    entry.accessRole === 'superAdmin' &&
    (entry.scope === 'institution' || (entry.scope === 'department' && deptId && String(entry.deptId) === String(deptId)))
  );
}

/**
 * Returns true if the user is a Sub-Admin (specific page rights/grants).
 */
function isSubAdmin(u) {
  if (!u) return false;
  if (isSudoAdmin(u) || isSuperAdmin(u)) return false;
  if (!isAdminUser(u)) return false;

  if (u.pageRights && typeof u.pageRights === 'object' && !Array.isArray(u.pageRights) && u.pageRights.accessRole === 'subAdmin') {
    return true;
  }
  const rawList = Array.isArray(u.pageRights) ? u.pageRights : (u.pageRights && Array.isArray(u.pageRights.grants) ? u.pageRights.grants : []);
  if (rawList.some(e => e && e.enabled !== false && (e.accessRole === 'subAdmin' || e.accessRole === 'staff'))) {
    return true;
  }
  const pageRights = normalizePageRights(u.pageRights);
  return pageRights.some(e => e.enabled);
}

/**
 * Returns true if the user has Principal role/special.
 */
function isPrincipalUser(u) {
  if (!u) return false;
  if (u.accessRole === 'principal') return true;
  if (u.pageRights && typeof u.pageRights === 'object' && !Array.isArray(u.pageRights) && u.pageRights.accessRole === 'principal') {
    return true;
  }
  const rawList = Array.isArray(u.pageRights) ? u.pageRights : (u.pageRights && Array.isArray(u.pageRights.grants) ? u.pageRights.grants : []);
  if (rawList.some(e => e && e.enabled !== false && e.accessRole === 'principal')) {
    return true;
  }
  return hasSpecial(u, 'isPrincipal') || u.isPrincipal === true || (['admin', 'principal'].includes(u.role) && u.adminFlag === 'principal');
}

/**
 * Returns true if the user has HOD special.
 */
function isHodUser(u) {
  if (!u) return false;
  return hasSpecial(u, 'isHod') || u.isHod === true;
}

/**
 * Evaluates whether a user has a specific page and action right.
 */
function hasPageRight(u, page, action = 'view', { module = '*', deptId = null } = {}) {
  if (!isAdminUser(u)) return false;
  if (isSudoAdmin(u)) return true;

  const pageRights = normalizePageRights(u.pageRights);
  return pageRights.some(entry => {
    if (!entry.enabled) return false;
    
    // Page match (supports wildcard)
    if (entry.page !== '*' && entry.page !== page) return false;

    // Module match
    if (module && module !== '*' && entry.module !== '*' && entry.module !== module) return false;

    // Action match
    if (action && !entry.actions.includes('*') && !entry.actions.includes(action)) return false;

    // Scope check
    if (entry.scope === 'department') {
      if (!deptId || String(entry.deptId) !== String(deptId)) return false;
    }

    return true;
  });
}



/**
 * Precomputes access object for login response and frontend consumption.
 */
function getPrecomputedAccess(u) {
  if (!u || !isAdminUser(u)) {
    return { level: 'none', pages: [] };
  }

  if (isSudoAdmin(u)) {
    return {
      level: 'sudo',
      pages: ['control', 'manage', 'bulk', 'settings', 'timetable', 'export', 'logs']
    };
  }

  const pageRights = normalizePageRights(u.pageRights);
  const enabledEntries = pageRights.filter(e => e.enabled);

  const isSuper = enabledEntries.some(e => e.accessRole === 'superAdmin');
  const isSuperInstitution = enabledEntries.some(e => e.accessRole === 'superAdmin' && e.scope === 'institution');
  const pagesSet = new Set();

  for (const e of enabledEntries) {
    if (e.page === '*') {
      ['control', 'manage', 'bulk', 'settings', 'timetable', 'export'].forEach(p => pagesSet.add(p));
    } else if (ALLOWED_PAGES.includes(e.page)) {
      pagesSet.add(e.page);
    }
  }

  return {
    level: isSuperInstitution ? 'super' : (isSuper ? 'subadmin' : (enabledEntries.length > 0 ? 'staff' : 'none')),
    pages: Array.from(pagesSet)
  };
}

/**
 * Computes landing page based on user attributes, role tier, and environment.
 * Precedence defined in signin_plan.md §3.3:
 * 1. Student -> student.html
 * 2. Sudo Admin, bootstrap pending -> admin.html
 * 3. Sudo Admin, development -> admin.html
 * 4. Sudo Admin, production -> selector.html
 * 5. Principal or HOD -> controller.html
 * 6. Super Admin or Sub-Admin (active grants) -> selector.html
 * 7. Any other staff -> teacher.html
 * Smart board -> board.html
 */
function resolveLanding(userObj, { env } = {}) {
  if (!userObj) return 'teacher.html';
  const role = userObj.role || '';
  if (role === 'student') return 'student.html';
  if (role === 'board' || userObj.identityType === 'board') return 'board.html';

  const sudo = isSudoAdmin(userObj);

  // Admin users (Sudo Admin, Super Admin, Sub-Admin, or admin role) -> selector.html
  if (
    sudo ||
    userObj.isSudoAdmin ||
    userObj.isSuperAdmin ||
    userObj.isSubAdmin ||
    userObj.isAdmin ||
    isSuperAdmin(userObj) ||
    isSubAdmin(userObj) ||
    isAdminUser(userObj) ||
    role === 'admin' ||
    role === 'sudo'
  ) {
    return 'selector.html';
  }

  // Principal or HOD -> controller.html (§3.3: Principal/HOD with admin grants land on controller.html with Switch portal link)
  if (isPrincipalUser(userObj) || isHodUser(userObj)) {
    return 'controller.html';
  }

  // Any other staff -> teacher.html
  return 'teacher.html';
}

const { resolveAccess } = require('./resolveAccess');

/**
 * Resolves whether a request or user holds Sudo Admin authority (§5.2, R1.5).
 * Replaces every legacy admin role check.
 */
function isSudo(reqOrUser) {
  if (!reqOrUser) return false;
  const user = reqOrUser.user || reqOrUser;
  if (reqOrUser.access && reqOrUser.access.flags) {
    return Boolean(reqOrUser.access.flags.isSudo);
  }
  return isSudoAdmin(user);
}



const PRIVILEGE_BEARING_SPECIALS = [
  'isAdmin',
  'isPrincipal',
  'isHod',
  'isHOD',
  'HodDeptTrackId',
  'isClassAdvisor',
  'ClassAdvisorTrackId',
  'isWarden',
  'isExamCoordinator',
  'isPlacementCoordinator',
  'isTimeTableCoordinator'
];

/**
 * Enforces privilege ceiling:
 * - Only a Sudo Admin may add or remove isAdmin or isPrincipal special or touch pageRights.
 * - Block editing own isAdmin or pageRights.
 */
function canGrant(actor, targetTrackId) {
  if (!actor) return false;
  const targetId = targetTrackId && typeof targetTrackId === 'object' && targetTrackId.trackId
    ? targetTrackId.trackId
    : targetTrackId;

  // Block editing own admin privilege or pageRights
  if (actor.trackId && targetId && String(actor.trackId) === String(targetId)) {
    return false;
  }
  if (actor._id && targetId && String(actor._id) === String(targetId)) {
    return false;
  }

  // Only Sudo Admin can grant/revoke admin rights or pageRights
  return isSudoAdmin(actor);
}

/**
 * Filters requested specials and pageRights according to privilege ceiling.
 * If actor cannot grant, preserves target's existing privilege-bearing specials and pageRights.
 * Strips any newly requested or altered privilege-bearing specials unless canGrant passes.
 */
function sanitizeTeacherPrivileges(actor, existingDoc, newSpecials, newPageRights) {
  const targetId = existingDoc ? (existingDoc.trackId || existingDoc._id) : null;
  const allowed = canGrant(actor, targetId);

  let finalSpecials = Array.isArray(newSpecials) ? [...newSpecials] : (existingDoc?.specials ? [...existingDoc.specials] : []);
  let finalPageRights = Array.isArray(newPageRights)
    ? normalizePageRights(newPageRights)
    : (Array.isArray(existingDoc?.pageRights)
      ? [...existingDoc.pageRights]
      : (existingDoc?.pageRights && typeof existingDoc.pageRights === 'object'
        ? { ...existingDoc.pageRights }
        : []));

  if (!allowed) {
    if (existingDoc) {
      // Retain existing privilege-bearing specials
      const existingPrivileged = (Array.isArray(existingDoc.specials) ? existingDoc.specials : [])
        .filter(s => s && PRIVILEGE_BEARING_SPECIALS.includes(s.option));

      // Strip all requested privilege-bearing specials and restore existing
      finalSpecials = finalSpecials.filter(s => s && !PRIVILEGE_BEARING_SPECIALS.includes(s.option));
      finalSpecials.push(...existingPrivileged);

      // Retain existing pageRights
      finalPageRights = existingDoc.pageRights || [];
    } else {
      // New document: non-Sudo cannot grant any privilege-bearing specials or pageRights
      finalSpecials = finalSpecials.filter(s => s && !PRIVILEGE_BEARING_SPECIALS.includes(s.option));
      finalPageRights = [];
    }
  }

  return {
    specials: finalSpecials,
    pageRights: finalPageRights
  };
}

module.exports = {
  hasSpecial,
  isAdminUser,
  isSudo,
  isSudoAdmin,
  isSuperAdmin,
  isSuperAdminForDept,
  isSubAdmin,
  isPrincipalUser,
  isHodUser,
  hasInstitutionReach,
  hasPageRight,
  normalizePageRights,
  getPrecomputedAccess,
  resolveLanding,
  resolveAccess,
  canGrant,
  sanitizeTeacherPrivileges,
  PRIVILEGE_BEARING_SPECIALS,
  ALLOWED_PAGES,
  ALLOWED_ACTIONS,
  ALLOWED_ROLES,
  ALLOWED_SCOPES
};
