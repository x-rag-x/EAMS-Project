/**
 * config/pageRegistry.js
 * 
 * Source-of-truth for registered pages, valid tabs, and allowed actions in EAMS.
 * Used by server-side authorization gates (requirePage, auth.routes.js) and served
 * to client-side Guard (GET /api/auth/access).
 */

const PAGE_KEYS = [
  'admin',
  'manage',
  'control',
  'bulk',
  'export',
  'logs',
  'maintenance',
  'rooms',
  'settings',
  'timetable'
];

const IMPLICIT_PAGE_KEYS = [
  'teacher',
  'controller',
  'selector',
  'student',
  'attendance'
];

const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'assign',
  'change',
  'approve',
  'publish'
];

const PAGE_REGISTRY = {
  admin: {
    file: 'admin.html',
    name: 'Admin Dashboard',
    tabs: ['dash', 'depts', 'struct', 'students', 'teachers', 'roles', 'reports', 'logs', 'trust'],
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'export'],
    tabAliases: { dept: 'depts', department: 'depts', departments: 'depts' }
  },
  manage: {
    file: 'manage.html',
    name: 'Manage Portal',
    tabs: ['overview', 'calendar', 'exam', 'years', 'settings'],
    actions: ['view', 'create', 'edit', 'export', 'change', 'publish']
  },
  control: {
    file: 'control.html',
    name: 'Control Panel',
    tabs: ['overview', 'usergrid', 'broadcasts', 'data', 'backup', 'undo', 'maintenance', 'recycle-bin'],
    actions: ['view', 'create', 'edit', 'delete', 'export', 'change'],
    tabAliases: { 'recycle-bin': 'undo', recyclebin: 'undo', trash: 'undo', undo: 'recycle-bin' }
  },
  bulk: {
    file: 'bulk.html',
    name: 'Bulk Upload',
    tabs: ['dept', 'teacher', 'class', 'subject', 'student', 'restore'],
    actions: ['view', 'create', 'approve']
  },
  export: {
    file: 'export.html',
    name: 'Export Center',
    tabs: ['dash', 'student', 'class', 'subject', 'teacher', 'dept', 'bulk', 'scheduled', 'templates', 'history'],
    actions: ['view', 'create', 'export']
  },
  logs: {
    file: 'logs.html',
    name: 'Activity Logs',
    tabs: ['overview', 'security', 'system', 'auth', 'user', 'attendance', 'export', 'error'],
    actions: ['view', 'edit', 'export']
  },
  maintenance: {
    file: 'maintenance-admin.html',
    name: 'Maintenance Controls',
    tabs: [],
    actions: ['view', 'create', 'publish']
  },
  'maintenance-admin': {
    file: 'maintenance-admin.html',
    name: 'Maintenance Admin',
    tabs: [],
    actions: ['view', 'create', 'publish'],
    aliasOf: 'maintenance'
  },
  rooms: {
    file: 'rooms.html',
    name: 'Room & Board Manager',
    tabs: ['explorer', 'boards', 'maintenance', 'audit'],
    actions: ['view', 'create', 'edit', 'export', 'change', 'publish']
  },
  settings: {
    file: 'settings.html',
    name: 'System Settings',
    tabs: ['institution', 'pages', 'attendance', 'models', 'academic', 'security', 'broadcast', 'history', 'advanced', 'trust'],
    actions: ['view', 'create', 'edit', 'change', 'publish']
  },
  timetable: {
    file: 'timetable.html',
    name: 'Timetable Manager',
    tabs: ['dashboard', 'production', 'grid', 'editor', 'workload', 'faculty', 'free', 'rooms', 'overview', 'exports', 'approvals', 'subjects', 'history', 'attendance'],
    tabAliases: { dash: 'dashboard', matrix: 'grid', subject: 'subjects' },
    actions: ['view', 'create', 'edit', 'delete', 'export', 'change', 'approve', 'publish']
  },
  // Implicit pages (not grants, mapped by role/specials)
  teacher: {
    file: 'teacher.html',
    name: 'Teacher Portal',
    tabs: [],
    actions: ['view', 'create', 'edit', 'delete', 'export']
  },
  controller: {
    file: 'controller.html',
    name: 'Controller Hub',
    tabs: [],
    actions: ['view', 'edit', 'export']
  },
  selector: {
    file: 'selector.html',
    name: 'App Hub',
    tabs: [],
    actions: ['view']
  },
  student: {
    file: 'student.html',
    name: 'Student Portal',
    tabs: [],
    actions: ['view']
  },
  attendance: {
    file: 'attendance.html',
    name: 'Attendance Pass',
    tabs: [],
    actions: ['view', 'create']
  }
};

/**
 * Resolves allowed tab array for a given page and module filter expression.
 * Expressions:
 *  - '*' (all tabs)
 *  - '-depts,-logs' (all except depts, logs)
 *  - '+overview,+years' (only overview, years)
 */
function parseAllowedTabs(pageKey, moduleRule) {
  const reg = PAGE_REGISTRY[pageKey];
  if (!reg || !Array.isArray(reg.tabs) || reg.tabs.length === 0) {
    return ['*'];
  }
  const allTabs = reg.tabs;
  if (!moduleRule || moduleRule === '*') {
    return [...allTabs];
  }

  const rawTokens = String(moduleRule)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (!rawTokens.length) {
    return [...allTabs];
  }

  const hasPlus = rawTokens.some(t => t.startsWith('+'));
  const hasMinus = rawTokens.some(t => t.startsWith('-'));

  if (hasPlus && !hasMinus) {
    const included = rawTokens.map(t => {
      const clean = t.replace(/^\+/, '');
      return (reg.tabAliases && reg.tabAliases[clean]) || clean;
    });
    return allTabs.filter(t => included.includes(t));
  } else if (hasMinus && !hasPlus) {
    const excluded = rawTokens.map(t => {
      const clean = t.replace(/^-/, '');
      return (reg.tabAliases && reg.tabAliases[clean]) || clean;
    });
    return allTabs.filter(t => !excluded.includes(t));
  } else {
    // Exact list without prefix
    const list = rawTokens.map(t => (reg.tabAliases && reg.tabAliases[t]) || t);
    return allTabs.filter(t => list.includes(t));
  }
}

/**
 * Checks whether a specific tab on a page is allowed under a module rule.
 */
function isTabAllowed(pageKey, tabKey, moduleRule) {
  if (!tabKey) return true;
  const reg = PAGE_REGISTRY[pageKey];
  if (!reg || !reg.tabs || reg.tabs.length === 0) return true;
  const normalizedTab = (reg.tabAliases && reg.tabAliases[tabKey]) || tabKey;
  const allowed = parseAllowedTabs(pageKey, moduleRule);
  if (allowed.includes('*')) return true;
  return allowed.includes(normalizedTab);
}

/**
 * Resolves comprehensive pages dictionary for a user given their resolved access object.
 * Returns { [pageKey]: { module, actions, scope, dept, allowedTabs, tabActions? } }
 */
function buildPagesDictionary(userDoc, access) {
  const pages = {};
  if (!access) return pages;

  const role = userDoc?.role || '';
  const isStudent = role === 'student' || access.kind === 'student';
  const isBoard = role === 'board' || access.kind === 'board';

  // 1. Student identity
  if (isStudent) {
    pages.student = {
      module: '*',
      actions: ['view'],
      scope: 'own',
      dept: null,
      allowedTabs: ['*']
    };
    pages.attendance = {
      module: '*',
      actions: ['view', 'create'],
      scope: 'own',
      dept: null,
      allowedTabs: ['*']
    };
    return pages;
  }

  // 2. Board identity
  if (isBoard) {
    pages.board = {
      module: '*',
      actions: ['view'],
      scope: 'institution',
      dept: null,
      allowedTabs: ['*']
    };
    return pages;
  }

  const userDept = userDoc?.department || userDoc?.deptName || userDoc?.dept || null;
  const userDeptId = userDoc?.deptId || userDoc?.departmentId || null;
  const flags = access.flags || {};

  // 3. Sudo Admin identity (all pages with all actions)
  if (flags.isSudo || access.isSudoAdmin || access.tier === 'sudoAdmin') {
    for (const key of PAGE_KEYS) {
      const reg = PAGE_REGISTRY[key];
      pages[key] = {
        module: '*',
        actions: [...reg.actions],
        scope: 'institution',
        dept: null,
        deptId: null,
        allowedTabs: reg.tabs && reg.tabs.length ? [...reg.tabs] : ['*']
      };
    }
    // Implicit staff pages for sudo
    pages.teacher = {
      module: '*',
      actions: ['view', 'create', 'edit', 'delete', 'export'],
      scope: 'institution',
      dept: null,
      deptId: null,
      allowedTabs: ['*']
    };
    pages.selector = {
      module: '*',
      actions: ['view'],
      scope: 'institution',
      dept: null,
      deptId: null,
      allowedTabs: ['*']
    };
    pages.controller = {
      module: '*',
      actions: ['view', 'edit', 'export'],
      scope: 'institution',
      dept: null,
      deptId: null,
      allowedTabs: ['*']
    };
    // Include alias
    pages['maintenance-admin'] = { ...pages.maintenance };
    return pages;
  }

  // 4. Super Admin identity (Template grants from role_access_plan.md §4.4)
  if (flags.isSuper || access.isSuperAdmin || access.tier === 'superAdmin') {
    pages.admin = {
      module: '-depts,-logs',
      actions: ['view', 'create', 'edit', 'delete', 'assign'],
      scope: 'department',
      dept: userDept,
      deptId: userDeptId,
      allowedTabs: parseAllowedTabs('admin', '-depts,-logs'),
      tabActions: {
        students: ['view', 'create', 'edit', 'delete'],
        teachers: ['view', 'create', 'edit', 'delete'],
        roles: ['view', 'assign'],
        struct: ['view'],
        reports: ['view']
      }
    };
    pages.manage = {
      module: '-settings',
      actions: ['view'],
      scope: 'department',
      dept: userDept,
      deptId: userDeptId,
      allowedTabs: parseAllowedTabs('manage', '-settings')
    };
    pages.export = {
      module: '-history',
      actions: ['view', 'export'],
      scope: 'department',
      dept: userDept,
      deptId: userDeptId,
      allowedTabs: parseAllowedTabs('export', '-history')
    };

    // Check if bulk is explicitly enabled for this Super Admin
    const rawGrants = Array.isArray(userDoc?.pageRights)
      ? userDoc.pageRights
      : (userDoc?.pageRights?.grants || access.pageRights || []);

    const bulkGrant = rawGrants.find(g => g && g.enabled !== false && (g.page === 'bulk' || g.page === '*'));
    if (bulkGrant) {
      pages.bulk = {
        module: bulkGrant.module || '-dept',
        actions: bulkGrant.actions && bulkGrant.actions.length ? bulkGrant.actions : ['view', 'create'],
        scope: 'department',
        dept: userDept,
        deptId: userDeptId,
        allowedTabs: parseAllowedTabs('bulk', bulkGrant.module || '-dept')
      };
    }
    if (!pages.timetable) {
      pages.timetable = {
        module: '*',
        actions: ['view', 'create', 'edit', 'delete', 'export', 'change', 'approve', 'publish'],
        scope: 'department',
        dept: userDept,
        deptId: userDeptId,
        allowedTabs: ['*']
      };
    }
  }

  // 5. Explicit Page Rights / Grants (Sub-Admin or additional grants)
  const activeGrants = Array.isArray(access.pageRights)
    ? access.pageRights
    : (Array.isArray(userDoc?.pageRights) ? userDoc.pageRights : (userDoc?.pageRights?.grants || []));

  for (const grant of activeGrants) {
    if (!grant || grant.enabled === false) continue;
    const targetPages = (grant.page === '*' || grant.page === 'all')
      ? PAGE_KEYS
      : [grant.page];

    for (const p of targetPages) {
      const reg = PAGE_REGISTRY[p];
      if (!reg) continue;

      const moduleRule = grant.module || '*';
      const existing = pages[p];
      const newActions = Array.isArray(grant.actions) && grant.actions.length ? grant.actions : ['view'];
      const combinedActions = existing
        ? Array.from(new Set([...existing.actions, ...newActions]))
        : newActions;

      pages[p] = {
        module: moduleRule,
        actions: combinedActions,
        scope: grant.scope || 'department',
        dept: grant.dept || userDept || null,
        deptId: grant.deptId || userDeptId || null,
        allowedTabs: parseAllowedTabs(p, moduleRule),
        tabActions: grant.tabActions || existing?.tabActions || null
      };
    }
  }

  // 6. Implicit staff pages
  // All staff can open Teacher Portal & Selector Hub
  pages.teacher = {
    module: '*',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
    scope: 'own',
    dept: userDept,
    allowedTabs: ['*']
  };
  pages.selector = {
    module: '*',
    actions: ['view'],
    scope: 'own',
    dept: userDept,
    allowedTabs: ['*']
  };

  // Controller Hub accessible to Principal, HOD, and Acting HOD
  if (flags.isPrincipal || flags.isHod || access.isPrincipal || access.isHod) {
    pages.controller = {
      module: '*',
      actions: ['view', 'edit', 'export'],
      scope: flags.isPrincipal ? 'institution' : 'department',
      dept: userDept,
      allowedTabs: ['*']
    };
  }

  // Timetable Manager accessible to Timetable Coordinator, HOD, and Principal
  const specialsList = Array.isArray(userDoc?.specials) ? userDoc.specials : [];
  const isTtCoord = Boolean(
    userDoc?.isTimeTableCoordinator ||
    access?.isTimeTableCoordinator ||
    flags?.isTimeTableCoordinator ||
    specialsList.some(s => s && s.option === 'isTimeTableCoordinator' && s.value !== false && s.value !== 'false')
  );

  let ttDept = userDoc?.TTdeptName || null;
  if (!ttDept && specialsList.length) {
    const s = specialsList.find(x => x && x.option === 'isTimeTableCoordinator');
    if (s) {
      if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') ttDept = s.value.trim();
      else if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isTimeTableCoordinator') && s.key !== 'true') ttDept = s.key.trim();
    }
  }
  if (!ttDept) ttDept = userDept;

  if (isTtCoord && !pages.timetable) {
    const reg = PAGE_REGISTRY.timetable;
    pages.timetable = {
      module: '*',
      actions: reg ? [...reg.actions] : ['view', 'create', 'edit', 'delete', 'export', 'change', 'approve', 'publish'],
      scope: 'department',
      dept: ttDept,
      deptId: userDeptId,
      allowedTabs: ['*']
    };
  }

  const isHod = Boolean(
    flags.isHod ||
    access.isHod ||
    userDoc?.isHod ||
    specialsList.some(s => s && s.option === 'isHod' && s.value !== false && s.value !== 'false')
  );
  if (isHod && !pages.timetable) {
    const reg = PAGE_REGISTRY.timetable;
    pages.timetable = {
      module: '*',
      actions: reg ? [...reg.actions] : ['view', 'create', 'edit', 'export', 'change', 'approve', 'publish'],
      scope: 'department',
      dept: userDept,
      deptId: userDeptId,
      allowedTabs: ['*']
    };
  }

  const isPrincipal = Boolean(
    flags.isPrincipal ||
    access.isPrincipal ||
    userDoc?.isPrincipal ||
    specialsList.some(s => s && s.option === 'isPrincipal' && s.value !== false && s.value !== 'false')
  );
  if (isPrincipal && !pages.timetable) {
    const reg = PAGE_REGISTRY.timetable;
    pages.timetable = {
      module: '*',
      actions: reg ? [...reg.actions] : ['view', 'create', 'edit', 'export', 'change', 'approve', 'publish'],
      scope: 'institution',
      dept: null,
      deptId: null,
      allowedTabs: ['*']
    };
  }

  // Maintenance admin alias mirroring maintenance if present
  if (pages.maintenance) {
    pages['maintenance-admin'] = { ...pages.maintenance };
  }

  return pages;
}

module.exports = {
  PAGE_KEYS,
  IMPLICIT_PAGE_KEYS,
  ACTIONS,
  PAGE_REGISTRY,
  parseAllowedTabs,
  isTabAllowed,
  buildPagesDictionary
};
