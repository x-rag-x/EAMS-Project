/**
 * utils/resolveAccess.js
 *
 * Single source of truth for user access evaluation (§5.1, role_access_plan.md).
 * Pure function with zero database calls. Evaluates:
 * - specials (who you are: HOD, Principal, Class Advisor, coordinators, Warden)
 * - pageRights (what admin pages you may open: Sudo, Super, Sub-Admin, scopes, actions, expiry)
 * - landing page, exemptions, and version hash.
 */

'use strict';

const crypto = require('crypto');
const { buildPagesDictionary } = require('../config/pageRegistry');

function hashEffective(pages) {
  try {
    const json = JSON.stringify(pages || {});
    return crypto.createHash('md5').update(json).digest('hex').slice(0, 8);
  } catch (_) {
    return '00000000';
  }
}

/**
 * Derives default landing page from resolved flags and environment (§3.3, signin_plan.md).
 */
function landingFor(flags, env = 'production') {
  if (flags.isSudo) {
    return 'admin.html';
  }
  if (flags.isPrincipal || flags.isHod) {
    return 'controller.html';
  }
  if (flags.isSuper || flags.isSub || flags.isAdmin || flags.bootstrap) {
    return 'selector.html';
  }
  return 'teacher.html';
}

/**
 * Pure access resolution function (§5.1).
 * Accepts either:
 *   resolveAccess(role, doc, options)
 *   resolveAccess(doc, options)
 */
function resolveAccess(first, second, third) {
  let role = '';
  let doc = {};
  let opts = {};

  if (typeof first === 'string') {
    role = first;
    doc = second || {};
    opts = third || {};
  } else {
    doc = first || {};
    role = doc.role || '';
    opts = second || {};
  }

  const env = opts.env || process.env.NODE_ENV || 'production';
  const now = opts.now ? new Date(opts.now) : new Date();
  const acting = Array.isArray(opts.acting) ? opts.acting : [];

  // 1. Student Identity
  if (role === 'student' || doc.role === 'student') {
    const studentPages = buildPagesDictionary(doc, { kind: 'student' });
    return {
      kind: 'student',
      tier: 'student',
      accessRole: 'none',
      landing: 'student.html',
      redirectTo: 'student.html',
      pages: studentPages,
      flags: {
        isSudo: false,
        isSuper: false,
        isSub: false,
        isPrincipal: false,
        isHod: false,
        bootstrap: false
      },
      exempt: {
        location: false,
        maintenance: false,
        multiSession: false
      },
      version: '0:student',
      // Compatibility shims
      isAdmin: false,
      isSudoAdmin: false,
      isSuperAdmin: false,
      isSubAdmin: false,
      isPrincipal: false,
      isHod: false,
      hasInstitutionReach: false,
      pageRights: [],
      adminFlag: 'none',
      access: { level: 'none', pages: [] }
    };
  }

  // 2. Smart Board Identity
  if (role === 'board' || doc.identityType === 'board') {
    const boardPages = buildPagesDictionary(doc, { kind: 'board' });
    return {
      kind: 'board',
      tier: 'board',
      accessRole: 'none',
      landing: 'board.html',
      redirectTo: 'board.html',
      pages: boardPages,
      flags: {
        isSudo: false,
        isSuper: false,
        isSub: false,
        isPrincipal: false,
        isHod: false,
        bootstrap: false
      },
      exempt: {
        location: true,
        maintenance: false,
        multiSession: false
      },
      version: '0:board',
      isAdmin: false,
      isSudoAdmin: false,
      isSuperAdmin: false,
      isSubAdmin: false,
      isPrincipal: false,
      isHod: false,
      hasInstitutionReach: false,
      pageRights: [],
      adminFlag: 'none',
      access: { level: 'none', pages: [] }
    };
  }

  // 3. Staff / Administrator Identity
  const specialsList = Array.isArray(doc.specials) ? doc.specials : [];
  const sp = new Set(specialsList.map(s => s && s.option).filter(Boolean));
  const pr = doc.pageRights || {};

  // Extract raw grants list supporting both object { accessRole, grants } and legacy array
  let prAccessRole = 'none';
  let prVersion = 0;
  let rawGrants = [];

  if (Array.isArray(pr)) {
    rawGrants = pr;
    if (pr.some(g => g && g.enabled !== false && g.accessRole === 'sudoAdmin')) {
      prAccessRole = 'sudoAdmin';
    } else if (pr.some(g => g && g.enabled !== false && g.accessRole === 'superAdmin')) {
      prAccessRole = 'superAdmin';
    } else if (pr.some(g => g && g.enabled !== false && g.accessRole === 'principal')) {
      prAccessRole = 'principal';
    } else if (pr.some(g => g && g.enabled !== false && g.accessRole === 'subAdmin')) {
      prAccessRole = 'subAdmin';
    }
  } else if (pr && typeof pr === 'object') {
    prAccessRole = pr.accessRole || 'none';
    prVersion = Number(pr.version || doc.accessVersion || 0);
    rawGrants = Array.isArray(pr.grants) ? pr.grants : [];
  }

  // Determine tier: derived from pageRights.accessRole & admin special (§3, §5.1)
  const hasAdminSpecial = sp.has('isAdmin') || doc.isAdmin === true;
  let tier = 'none';

  if (hasAdminSpecial && ['sudoAdmin', 'superAdmin'].includes(prAccessRole)) {
    tier = prAccessRole;
  } else if (prAccessRole === 'principal') {
    tier = 'principal';
  } else if (prAccessRole === 'subAdmin') {
    tier = 'subAdmin';
  } else if (['admin', 'sudo'].includes(doc.role)) {
    // Legacy Admin document compatibility
    tier = (doc.adminFlag === 'subadmin') ? 'subAdmin' : 'sudoAdmin';
  } else if (hasAdminSpecial && rawGrants.length > 0) {
    tier = rawGrants.some(g => g.accessRole === 'superAdmin') ? 'superAdmin' : 'subAdmin';
  }

  // Filter live grants: enabled and within validFrom / validTo window
  const liveGrants = rawGrants.filter(g => {
    if (!g || g.enabled === false) return false;
    if (g.validFrom && new Date(g.validFrom) > now) return false;
    if (g.validTo && new Date(g.validTo) <= now) return false;
    return true;
  });

  const isPrincipal = prAccessRole === 'principal' ||
    rawGrants.some(g => g && g.enabled !== false && g.accessRole === 'principal') ||
    sp.has('isPrincipal') || doc.isPrincipal === true ||
    (['admin', 'principal'].includes(doc.role) && doc.adminFlag === 'principal');
  const isHod = sp.has('isHod') || acting.some(a => a && a.role === 'hod') || doc.isHod === true;
  const isTimeTableCoordinator = sp.has('isTimeTableCoordinator') || doc.isTimeTableCoordinator === true;

  const flags = {
    isSudo: tier === 'sudoAdmin',
    isSuper: tier === 'superAdmin',
    isSub: tier === 'subAdmin' && (liveGrants.length > 0 || hasAdminSpecial),
    isAdmin: hasAdminSpecial || tier === 'sudoAdmin' || tier === 'superAdmin' || tier === 'subAdmin',
    isPrincipal,
    isHod,
    isTimeTableCoordinator,
    bootstrap: Boolean(doc.bootstrapPending)
  };

  const pages = buildPagesDictionary(doc, {
    kind: 'staff',
    tier,
    flags,
    pageRights: liveGrants
  });

  const landing = landingFor(flags, env);
  const effectiveHash = hashEffective(pages);
  const versionStr = `${prVersion || doc.accessVersion || 0}:${effectiveHash}`;

  const exempt = {
    location: flags.isSudo,
    maintenance: flags.isSudo || flags.isSuper,
    multiSession: flags.isSudo
  };

  // Backward-compatibility shims (§5.3)
  const isAdmin = flags.isSudo || flags.isSuper || flags.isSub;
  const adminFlag = flags.isSudo ? 'superadmin' : (flags.isSuper ? 'superadmin' : (flags.isSub ? 'subadmin' : (isPrincipal ? 'principal' : 'none')));
  const hasInstitutionReach = flags.isSudo || flags.isPrincipal || (flags.isSuper && liveGrants.some(g => g.scope === 'institution'));

  return {
    kind: 'staff',
    tier,
    accessRole: isPrincipal && (tier === 'none' || tier === 'staff' || tier === 'principal') ? 'principal' : (isTimeTableCoordinator && (tier === 'none' || tier === 'staff') ? 'ttCoordinator' : tier),
    flags,
    pages,
    landing,
    redirectTo: landing,
    exempt,
    version: versionStr,
    // Compat properties
    isAdmin,
    isSudoAdmin: flags.isSudo,
    isSuperAdmin: flags.isSuper,
    isSubAdmin: flags.isSub,
    isPrincipal: flags.isPrincipal,
    isHod: flags.isHod,
    isTimeTableCoordinator: flags.isTimeTableCoordinator,
    hasInstitutionReach,
    pageRights: liveGrants,
    adminFlag,
    access: {
      level: flags.isSudo ? 'full' : (flags.isSuper ? 'department' : (flags.isSub ? 'custom' : (flags.isTimeTableCoordinator || flags.isHod ? 'department' : 'none'))),
      pages: Object.keys(pages)
    }
  };
}

module.exports = {
  resolveAccess,
  landingFor,
  hashEffective
};
