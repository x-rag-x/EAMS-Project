//  EAMS – TIMETABLE MANAGEMENT  (timetable.html)
//  Role-based, department-aware | Node/Express + MongoDB backend

const API_BASE = '/api';

// SESSION
// Supports both key formats:
//   teacher.html / student.html / admin.html → eams_user (JSON) + eams_token (string)
//   legacy eams_session → single JSON blob
const SESSION = (() => {
  try {
    // Primary: eams_user set by all portals
    const u = JSON.parse(sessionStorage.getItem('eams_user') || 'null');
    if (u) {
      u.token = sessionStorage.getItem('eams_token') || '';
      return u;
    }
    // Fallback: legacy unified key
    const s = JSON.parse(sessionStorage.getItem('eams_session') || 'null');
    if (s) return s;
    return {};
  } catch { return {}; }
})();

const ROLE = SESSION.role || '';
const IS_STUDENT = ROLE === 'student';
const IS_TEACHER = ROLE === 'teacher';
const IS_ADMIN = ROLE === 'admin' || (IS_TEACHER && SESSION.isAdmin && (SESSION.adminRights === 'all' || (Array.isArray(SESSION.adminRights) && (SESSION.adminRights.includes('all') || SESSION.adminRights.includes('timetablePage')))));
const IS_COORD = SESSION.isTimeTableCoordinator === true || (Array.isArray(SESSION.specials) && SESSION.specials.some(s => s.option === 'isTimeTableCoordinator'));
const IS_HOD = SESSION.isHod === true || (Array.isArray(SESSION.specials) && SESSION.specials.some(s => s.option === 'HodDeptTrackId' || s.option === 'isHod'));
let CAN_EDIT = false;
const CAN_APPROVE = IS_HOD || IS_ADMIN;
const CAN_VIEW = IS_STUDENT || IS_TEACHER || IS_COORD || IS_ADMIN || IS_HOD;

function updateCanEdit() {
  if (IS_ADMIN) {
    CAN_EDIT = false; // Per requirements: Admin opens read-only for all departments
    return;
  }
  if (IS_COORD) {
    // Full control of their own department, read-only for other departments
    if (S.coordDeptId && S.deptId) {
      CAN_EDIT = String(S.deptId) === String(S.coordDeptId);
    } else {
      CAN_EDIT = false;
    }
    return;
  }
  CAN_EDIT = false;
}

function resolveTTDept(session) {
  if (!session) return '';
  let v = session.TTdeptName;
  if (typeof v === 'string' && v.trim() && v !== 'true') return v.trim();
  if (Array.isArray(session.specials)) {
    const s = session.specials.find(x => x && x.option === 'isTimeTableCoordinator');
    if (s) {
      if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') return s.value.trim();
      if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isTimeTableCoordinator') && s.key !== 'true') return s.key.trim();
    }
  }
  if (typeof session.department === 'string' && session.department.trim()) return session.department.trim();
  if (typeof session.dept === 'string' && session.dept.trim()) return session.dept.trim();
  if (typeof session.deptName === 'string' && session.deptName.trim()) return session.deptName.trim();
  return '';
}
const TT_DEPT = resolveTTDept(SESSION);

// STATE
const S = {
  depts: [], deptId: null, deptName: null, deptCode: null,
  classes: [], classId: null, className: null, sectionId: null,
  tt: {},
  prodTT: {},
  draftDoc: null,
  mode: 'production',
  diffMode: false,
  activeCellKey: null,
  subjects: [],
  coordDeptId: null,
  coordIsService: false,
  tabs: [],
  activeTabId: null,
  conflicts: [],
  pendingHodDrafts: [],
  allClassesIndex: [],
  teacherAssignedClasses: [],
  // PLAN 2 HIERARCHY & ADVANCED SCHEDULING (FEATURES 4 & 13)
  tier: 'master', // 'master' | 'week' | 'day'
  weeks: [],
  selectedWeekId: null,
  selectedDate: null,
  dayOverrideDoc: null,
  activeTimingSet: null,
  currentClassYear: null,
  // PLAN 3 TEMPLATES & DRAG/DROP (FEATURES 5, 9, 10)
  templates: [],
  activeTemplateFilter: 'all',
  clipboardSlot: null,
  dragSource: null,
  pendingDragConflict: null,
};

// SUBJECT CELL COLORS (light pastels – one consistent color per subject)
const SUBJ_CELL_COLORS = [
  { bg: '#f0fdf4', border: '#4ade80', text: '#166534' },
  { bg: '#eff6ff', border: '#60a5fa', text: '#1e40af' },
  { bg: '#fefce8', border: '#facc15', text: '#854d0e' },
  { bg: '#fdf4ff', border: '#d946ef', text: '#6b21a8' },
  { bg: '#fff7ed', border: '#fb923c', text: '#9a3412' },
  { bg: '#ecfeff', border: '#22d3ee', text: '#155e75' },
  { bg: '#fdf2f8', border: '#f472b6', text: '#831843' },
  { bg: '#f0fdfa', border: '#2dd4bf', text: '#134e4a' },
  { bg: '#fff1f2', border: '#fb7185', text: '#9f1239' },
  { bg: '#f5f3ff', border: '#a78bfa', text: '#4c1d95' },
  { bg: '#fafaf9', border: '#a8a29e', text: '#44403c' },
  { bg: '#ecfdf5', border: '#34d399', text: '#065f46' },
];

function hashSubjColor(name) {
  if (!name) return SUBJ_CELL_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return SUBJ_CELL_COLORS[Math.abs(h) % SUBJ_CELL_COLORS.length];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// INSTITUTIONAL TIMING SETS WITH STAGGERED MORNING BREAKS (FEATURE 4)
const TIMING_SET_PERIODS = {
  SET_1: [
    { id: 1, label: 'P1', time: '08:30–09:15', start: '08:30', end: '09:15' },
    { id: 2, label: 'P2', time: '09:15–10:00', start: '09:15', end: '10:00' },
    { id: 'B1', label: 'BREAK', time: '10:00–10:15', isBreak: true, breakLbl: '☕ Break' },
    { id: 3, label: 'P3', time: '10:15–11:00', start: '10:15', end: '11:00' },
    { id: 4, label: 'P4', time: '11:00–11:45', start: '11:00', end: '11:45' },
    { id: 5, label: 'P5', time: '11:45–12:30', start: '11:45', end: '12:30' },
    { id: 6, label: 'P6', time: '12:30–13:15', start: '12:30', end: '13:15' },
    { id: 'L', label: 'LUNCH', time: '13:15–14:00', isBreak: true, breakLbl: '🍱 Lunch' },
    { id: 7, label: 'P7', time: '14:00–14:45', start: '14:00', end: '14:45' },
    { id: 8, label: 'P8', time: '14:45–15:30', start: '14:45', end: '15:30' },
    { id: 'B2', label: 'BREAK', time: '15:30–15:45', isBreak: true, breakLbl: '☕ Break' },
    { id: 9, label: 'P9', time: '15:45–16:30', start: '15:45', end: '16:30' },
  ],
  SET_2: [
    { id: 1, label: 'P1', time: '08:30–09:15', start: '08:30', end: '09:15' },
    { id: 2, label: 'P2', time: '09:15–10:00', start: '09:15', end: '10:00' },
    { id: 3, label: 'P3', time: '10:00–10:45', start: '10:00', end: '10:45' },
    { id: 'B1', label: 'BREAK', time: '10:45–11:00', isBreak: true, breakLbl: '☕ Break' },
    { id: 4, label: 'P4', time: '11:00–11:45', start: '11:00', end: '11:45' },
    { id: 5, label: 'P5', time: '11:45–12:30', start: '11:45', end: '12:30' },
    { id: 6, label: 'P6', time: '12:30–13:15', start: '12:30', end: '13:15' },
    { id: 'L', label: 'LUNCH', time: '13:15–14:00', isBreak: true, breakLbl: '🍱 Lunch' },
    { id: 7, label: 'P7', time: '14:00–14:45', start: '14:00', end: '14:45' },
    { id: 8, label: 'P8', time: '14:45–15:30', start: '14:45', end: '15:30' },
    { id: 'B2', label: 'BREAK', time: '15:30–15:45', isBreak: true, breakLbl: '☕ Break' },
    { id: 9, label: 'P9', time: '15:45–16:30', start: '15:45', end: '16:30' },
  ]
};

function getActivePeriods() {
  const yr = String(S.currentClassYear || '').trim();
  const code = S.activeTimingSet?.code || (['2', '3', 'II', 'III', '2nd Year', '3rd Year'].includes(yr) ? 'SET_2' : 'SET_1');
  return TIMING_SET_PERIODS[code] || TIMING_SET_PERIODS.SET_1;
}
let PERIODS = TIMING_SET_PERIODS.SET_1;
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

// SEMESTER CALCULATION
// Computes current semester from batch year, class year number, and current date
function computeSemester(cls) {
  if (!cls) return '';
  // Attempt to derive semester from class year field
  const yearNum = parseInt(cls.year, 10);
  if (!yearNum || yearNum < 1 || yearNum > 5) return '';

  // Determine odd/even semester based on current month
  // June-Nov = Odd semester (1,3,5,7), Dec-May = Even semester (2,4,6,8)
  const month = new Date().getMonth(); // 0=Jan, 5=Jun
  const isOddSem = month >= 5 && month <= 10; // Jun(5)–Nov(10) = Odd
  const semNum = (yearNum - 1) * 2 + (isOddSem ? 1 : 2);

  if (semNum < 1 || semNum > 10) return '';
  return `Semester ${semNum}`;
}

// INIT
async function initTimetable() {
  if (!CAN_VIEW) {
    document.getElementById('auth-gate').classList.add('show');
    return;
  }
  try {
    const pub = await fetch('/api/settings/public').then(r => r.json());
    if (pub.institution) {
      document.title = 'EAMS – Timetable | ' + (pub.institution.institutionShort || 'SIET');
    }
    if (!IS_ADMIN && pub.pages?.pageTimeTable) {
      if (pub.pages.pageTimeTable === 'hidden') {
        window.location.href = IS_STUDENT ? 'student.html' : 'teacher.html';
        return;
      } else if (pub.pages.pageTimeTable === 'disabled') {
        alert('Timetable Management portal is currently disabled for maintenance.');
        window.location.href = IS_STUDENT ? 'student.html' : 'teacher.html';
        return;
      }
    }
  } catch (e) { console.warn('Public settings fetch error', e); }

  setupUI();
  buildSidebar();
  initClassSearch();
  await bootstrap();

  // Show synced toast only for admin / coordinator / teacher — NOT for students
  if (!IS_STUDENT) {
    const ttCount = Object.keys(S.tt).length || 0;
    dbtoast(`Synced from MongoDB<br><span style="font-size:11px;opacity:0.85;">Depts: ${S.depts.length} | Periods: ${ttCount}</span>`, 'success');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTimetable);
} else {
  initTimetable();
}

// UI SETUP
function setupUI() {
  const name = SESSION.name || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  ['sb-av', 'tb-av'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = initials; });
  ['sb-name', 'tb-name'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = name; });

  let roleTxt, roleClass, subTxt, deptTxt;
  if (IS_ADMIN) {
    roleTxt = 'Admin'; roleClass = 'coord';
    subTxt = 'Full Timetable Access'; deptTxt = 'Administrator';
    const rl = document.getElementById('sb-role-lbl'); if (rl) rl.textContent = 'Administrator';
  } else if (IS_COORD) {
    roleTxt = TT_DEPT ? `${TT_DEPT} Coordinator` : 'TT Coordinator';
    roleClass = 'coord';
    subTxt = `TT Coordinator – ${TT_DEPT || 'All Depts'}`;
    deptTxt = SESSION.dept || '—';
    const rl = document.getElementById('sb-role-lbl'); if (rl) rl.textContent = 'TT Coordinator';
  } else if (IS_TEACHER) {
    roleTxt = 'Teacher'; roleClass = 'student';
    subTxt = `${SESSION.dept || '—'} · View Only`;
    deptTxt = SESSION.dept || '—';
    const rl = document.getElementById('sb-role-lbl'); if (rl) rl.textContent = 'Teacher';
  } else {
    roleTxt = 'Student'; roleClass = 'student';
    subTxt = `${SESSION.deptName || SESSION.dept || '—'} · View Only`;
    deptTxt = SESSION.deptName || SESSION.dept || '—';
    const rl = document.getElementById('sb-role-lbl'); if (rl) rl.textContent = 'Student';
  }

  const backBtn = document.getElementById('tt-back-btn');
  if (backBtn) {
    if (IS_TEACHER && SESSION.isAdmin) {
      backBtn.textContent = '← Back to Hub';
    } else {
      backBtn.textContent = '← Back to Dashboard';
    }
  }

  const tbSub = document.getElementById('tb-sub'); if (tbSub) tbSub.textContent = subTxt;
  const tbDept = document.getElementById('tb-dept'); if (tbDept) tbDept.textContent = deptTxt;
  const rp = document.getElementById('role-pill');
  if (rp) { rp.textContent = roleTxt; rp.className = `role-pill ${roleClass}`; }
}

function buildSidebar() {
  const isTeacherWithAdmin = IS_TEACHER && SESSION.isAdmin;
  const homeHref = isTeacherWithAdmin ? 'selector.html'
    : IS_ADMIN ? 'admin.html'
      : IS_STUDENT ? 'student.html'
        : 'teacher.html';

  const homeLabel = isTeacherWithAdmin ? 'Admin Hub'
    : IS_ADMIN ? 'Admin Panel'
      : 'Dashboard';

  // NAV ITEMS
  const navItems = [
    { ic: '🗓️', lbl: 'View Timetable', act: true, onclick: "goBack()" },
    { ic: '📑', lbl: 'TT Exports', onclick: "exportCSV()" },
    ...(IS_COORD ? [
      { ic: '📊', lbl: 'Workload Reports', onclick: "openTTReportsModal()" },
      { ic: '🏢', lbl: 'Room Availability', onclick: "openRoomAvailabilityModal()" },
      { ic: '📦', lbl: 'Backups', onclick: "openBackupsModal()" },
    ] : []),
  ];

  const bottomItems = [
    { ic: '🏠', lbl: homeLabel, href: homeHref },
    ...(IS_STUDENT ? [{ ic: '✅', lbl: 'Attendance', href: 'student.html' }] : []),
    ...((IS_TEACHER || IS_COORD) ? [
      { ic: '✅', lbl: 'Attendance', href: 'teacher.html' },
    ] : []),
    ...(ROLE === 'admin' ? [
      { ic: '🏛️', lbl: 'Departments', href: 'admin.html' },
      { ic: '⚙️', lbl: 'Control Panel', href: 'control.html' },
    ] : []),
  ];

  document.getElementById('sb-nav').innerHTML =
    `<div class="sb-section-label">Timetable</div>` +
    navItems.map(i =>
      `<button class="sb-item ${i.act ? 'act' : ''}" onclick="${i.onclick || `location.href='${i.href}'`}">
         <span class="sbi-ic">${i.ic}</span>${i.lbl}
       </button>`
    ).join('') +
    `<div class="sb-section-label" style="margin-top:8px;">Navigation</div>` +
    bottomItems.map(i =>
      `<button class="sb-item" onclick="location.href='${i.href}'">
         <span class="sbi-ic">${i.ic}</span>${i.lbl}
       </button>`
    ).join('');
}

// SIDEBAR TOGGLE
let sbOpen = true;
function toggleSb() {
  sbOpen = !sbOpen;
  const sb = document.getElementById('sidebar');
  const mc = document.getElementById('mc');
  const btn = document.getElementById('sb-toggle');
  if (sb) {
    sb.classList.toggle('sb-hidden', !sbOpen);
    sb.classList.toggle('sb-visible', sbOpen);
  }
  if (mc) mc.style.marginLeft = sbOpen ? 'var(--sb-w, 236px)' : '0';
  if (btn) {
    btn.classList.toggle('closed', !sbOpen);
    btn.textContent = sbOpen ? '✕' : '☰';
    btn.title = sbOpen ? 'Collapse sidebar' : 'Expand sidebar';
  }
}

// READ-ONLY NOTICE
function updateReadOnlyNotice() {
  const notice = document.getElementById('tt-readonly-notice');
  const txt = document.getElementById('tt-readonly-text');
  if (!notice) return;

  if (CAN_EDIT) {
    notice.style.display = 'none';
  } else {
    notice.style.display = 'flex';
    if (IS_ADMIN) {
      if (txt) txt.textContent = 'Admin Overview — Viewing live production schedule (Read-Only)';
    } else if (IS_COORD && S.coordDeptId && S.deptId && String(S.deptId) !== String(S.coordDeptId)) {
      if (txt) txt.textContent = `Read-Only Mode — Viewing ${S.deptName || 'other'} department live schedule. (Full edit control is restricted to your department)`;
    } else if (IS_TEACHER) {
      if (txt) txt.textContent = 'Faculty View — Viewing live production schedule (Read-Only)';
    } else {
      if (txt) txt.textContent = 'Read-Only Mode — Viewing live schedule';
    }
  }
}

// TEACHER ASSIGNED CLASSES PILLS BAR
function renderTeacherAssignedPills(assignedClasses) {
  const bar = document.getElementById('tt-assigned-bar');
  const pillsWrap = document.getElementById('tt-assigned-pills');
  if (!bar || !pillsWrap) return;
  if (!assignedClasses || !assignedClasses.length) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const curId = String(S.classId || S.sectionId || '');
  pillsWrap.innerHTML = assignedClasses.map(ac => {
    const isActive = curId && String(ac.classId) === curId;
    return `
      <button type="button" class="assigned-pill ${isActive ? 'active' : ''}" 
              onclick="selectClassDirectly('${ac.classId}')" 
              title="${e(ac.subjectName ? (ac.className + ' – ' + ac.subjectName) : ac.className)}">
        <span class="pill-badge">⭐</span>
        <span class="pill-name">${e(ac.className || 'Class')}</span>
        ${ac.subjectName ? `<span class="pill-subj">${e(ac.subjectName)}</span>` : ''}
      </button>
    `;
  }).join('');
}
window.renderTeacherAssignedPills = renderTeacherAssignedPills;

// DIRECT CLASS SELECTION (via Search or Assigned Pill)
async function selectClassDirectly(classId) {
  if (!classId) return;
  if (!S.allClassesIndex || !S.allClassesIndex.length) {
    S.allClassesIndex = await API.getAllClasses();
  }
  const cls = S.allClassesIndex.find(c => String(c._id) === String(classId));
  if (!cls) {
    dbtoast('Class not found', 'warn');
    return;
  }

  // Find department
  let dept = S.depts.find(d => String(d._id) === String(cls.deptId));
  if (!dept && cls.deptName) {
    dept = S.depts.find(d => (d.name || '').toLowerCase() === (cls.deptName || '').toLowerCase());
  }

  const deptId = dept ? dept._id : cls.deptId;
  const deptName = dept ? dept.name : (cls.deptName || 'Department');
  const deptCode = dept ? (dept.code || dept.name.substring(0, 4).toUpperCase()) : (cls.deptCode || 'DEPT');

  const deptClasses = await API.getClasses(deptId);
  await enterDept(deptId, deptName, deptCode, deptClasses, classId);

  if (S.teacherAssignedClasses && S.teacherAssignedClasses.length) {
    renderTeacherAssignedPills(S.teacherAssignedClasses);
  }
}
window.selectClassDirectly = selectClassDirectly;

// TOPBAR CLASS SEARCH MENU
function initClassSearch() {
  const searchInput = document.getElementById('tt-class-search');
  if (!searchInput) return;

  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('tt-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      closeClassSearch();
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeClassSearch();
    }
  });
}

function openClassSearch() {
  const input = document.getElementById('tt-class-search');
  const val = input ? input.value : '';
  onClassSearchInput(val);
}
window.openClassSearch = openClassSearch;

function closeClassSearch() {
  const results = document.getElementById('tt-search-results');
  if (results) results.style.display = 'none';
}
window.closeClassSearch = closeClassSearch;

function clearClassSearch() {
  const input = document.getElementById('tt-class-search');
  const clearBtn = document.getElementById('tt-search-clear');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (clearBtn) clearBtn.style.display = 'none';
  onClassSearchInput('');
}
window.clearClassSearch = clearClassSearch;

async function onClassSearchInput(query) {
  const clearBtn = document.getElementById('tt-search-clear');
  const results = document.getElementById('tt-search-results');
  if (!results) return;

  const q = String(query || '').trim().toLowerCase();
  if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';

  if (!S.allClassesIndex || !S.allClassesIndex.length) {
    S.allClassesIndex = await API.getAllClasses();
  }

  const allClasses = S.allClassesIndex || [];
  if (!allClasses.length) {
    results.innerHTML = `<div class="tt-search-no-results">No classes available</div>`;
    results.style.display = 'block';
    return;
  }

  let matched = [];
  if (!q) {
    if (IS_TEACHER && S.teacherAssignedClasses && S.teacherAssignedClasses.length) {
      const assignedIds = new Set(S.teacherAssignedClasses.map(a => String(a.classId)));
      matched = allClasses.filter(c => assignedIds.has(String(c._id)));
    }
    if (!matched.length) {
      matched = allClasses.slice(0, 8);
    }
  } else {
    matched = allClasses.filter(c => {
      const name = (c.name || '').toLowerCase();
      const code = (c.code || '').toLowerCase();
      const dept = (c.deptName || '').toLowerCase();
      const year = String(c.year || '').toLowerCase();
      const section = String(c.section || '').toLowerCase();
      const sem = computeSemester(c).toLowerCase();
      return name.includes(q) || code.includes(q) || dept.includes(q) || year.includes(q) || section.includes(q) || sem.includes(q);
    }).slice(0, 12);
  }

  if (!matched.length) {
    results.innerHTML = `<div class="tt-search-no-results">No classes matching "${e(q)}"</div>`;
    results.style.display = 'block';
    return;
  }

  results.innerHTML = matched.map(c => {
    const dept = S.depts.find(d => String(d._id) === String(c.deptId));
    const deptName = dept ? dept.name : (c.deptName || '');
    const deptIcon = dept ? (dept.icon || '🏛️') : '🏛️';
    const isAssigned = S.teacherAssignedClasses && S.teacherAssignedClasses.some(a => String(a.classId) === String(c._id));
    const semStr = computeSemester(c);

    return `
      <div class="tt-search-item" onclick="onSearchClassSelect('${c._id}')">
        <div class="tt-search-item-info">
          <div class="tt-search-item-name">
            ${isAssigned ? '<span class="tt-search-badge assigned">⭐ Assigned</span>' : ''}
            ${e(c.name)}
          </div>
          <div class="tt-search-item-sub">
            <span>${deptIcon} ${e(deptName)}</span>
            ${semStr ? `<span>• ${semStr}</span>` : (c.year ? `<span>• Year ${e(c.year)}</span>` : '')}
            ${c.section ? `<span>• Sec ${e(c.section)}</span>` : ''}
          </div>
        </div>
        <div class="tt-search-item-action">
          <span class="tt-search-action-btn">View Schedule →</span>
        </div>
      </div>
    `;
  }).join('');
  results.style.display = 'block';
}
window.onClassSearchInput = onClassSearchInput;

async function onSearchClassSelect(classId) {
  closeClassSearch();
  const input = document.getElementById('tt-class-search');
  const cls = (S.allClassesIndex || []).find(c => String(c._id) === String(classId));
  if (input && cls) {
    input.value = cls.name;
  }
  await selectClassDirectly(classId);
}
window.onSearchClassSelect = onSearchClassSelect;

// BOOTSTRAP – determine what to show based on role
async function bootstrap() {
  S.depts = await API.getDepts();
  populateDeptDropdown();

  // Pre-load all classes for quick search and direct jumping
  S.allClassesIndex = await API.getAllClasses();

  if (IS_STUDENT) { await loadStudentTT(); return; }

  if (IS_ADMIN) {
    S.mode = 'production';
    updateCanEdit();
    document.getElementById('dept-ps').textContent =
      'Administrator Overview — Browse all departments (Read-Only live schedule)';
    renderDeptGrid(S.depts);
    showView('view-dept');
    return;
  }

  if (IS_TEACHER && !IS_COORD) {
    S.mode = 'production';
    updateCanEdit();

    // Fetch teacher assignments
    const assignments = await API.getMyAssignments();
    const assignedClassMap = new Map();
    assignments.forEach(a => {
      if (a.classId && !assignedClassMap.has(String(a.classId))) {
        assignedClassMap.set(String(a.classId), a);
      }
    });
    const assignedClasses = Array.from(assignedClassMap.values());
    S.teacherAssignedClasses = assignedClasses;

    if (assignedClasses.length > 0) {
      renderTeacherAssignedPills(assignedClasses);
      const first = assignedClasses[0];
      await selectClassDirectly(first.classId);
      return;
    } else {
      document.getElementById('dept-ps').textContent =
        'No direct class assignments found. Select a department or use the search bar above to view timetables.';
      renderDeptGrid(S.depts);
      showView('view-dept');
      return;
    }
  }

  // COORDINATOR (isTimeTableCoordinator === true)
  const deptQuery = (TT_DEPT || SESSION.dept || SESSION.deptName || '').toLowerCase().trim();
  const myDept = S.depts.find(d => {
    if (!deptQuery) return false;
    const dName = (d.name || '').toLowerCase().trim();
    const dCode = (d.code || '').toLowerCase().trim();
    return dName === deptQuery || dCode === deptQuery ||
      dName.includes(deptQuery) || deptQuery.includes(dName);
  });

  if (!myDept) {
    updateCanEdit();
    renderDeptGrid(S.depts);
    showView('view-dept');
    return;
  }

  S.coordDeptId = myDept._id;
  const ownClasses = await API.getClasses(myDept._id);
  S.coordIsService = ownClasses.length === 0;

  if (S.coordIsService) {
    document.getElementById('dept-ps').textContent =
      `${myDept.name || TT_DEPT} Coordinator — Edit your subject across all departments`;
    renderDeptGrid(S.depts);
    showView('view-dept');
  } else {
    await enterDept(myDept._id, myDept.name, myDept.code || myDept.name.substring(0, 4).toUpperCase(), ownClasses);
  }
}

// DEPT GRID & DROPDOWN SELECTOR
function populateDeptDropdown() {
  const sel = document.getElementById('sel-dept');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Department —</option>';
  (S.depts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d._id;
    opt.textContent = `${d.code ? d.code + ' – ' : ''}${d.name}`;
    if (S.deptId === d._id) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.value = S.deptId || '';
}

async function onDeptSelectChange() {
  const sel = document.getElementById('sel-dept');
  if (!sel) return;
  const newDeptId = sel.value;
  if (!newDeptId) return;
  const d = S.depts.find(x => String(x._id) === String(newDeptId));
  if (!d) return;

  const classes = await API.getClasses(d._id);
  await enterDept(d._id, d.name, d.code || d.name.substring(0, 4).toUpperCase(), classes);
}
window.onDeptSelectChange = onDeptSelectChange;

function renderDeptGrid(depts) {
  const grid = document.getElementById('dept-grid');
  if (!depts || !depts.length) {
    grid.innerHTML = `<div class="state-sc" style="grid-column:1/-1;"><div class="state-icon">🏛️</div><div class="state-t">No Departments Found</div><div class="state-s">No departments found in the database.</div></div>`;
    return;
  }
  grid.innerHTML = depts.map(d => {
    const isServiceCard = S.coordIsService && d._id !== S.coordDeptId;
    const isMyDept = S.coordDeptId && d._id === S.coordDeptId;
    let badgeHtml = '';
    if (isMyDept) {
      badgeHtml = '<div style="font-size:9.5px;font-weight:700;color:var(--gM);margin-top:5px;display:flex;align-items:center;gap:4px;">⭐ COORDINATOR <span style="font-size:8px;background:var(--gM);color:#fff;padding:1px 4px;border-radius:4px;">FULL CONTROL</span></div>';
    } else if (IS_COORD) {
      badgeHtml = '<div style="font-size:9.5px;font-weight:500;color:var(--tdi);margin-top:5px;display:flex;align-items:center;gap:4px;">👁️ Read Only</div>';
    } else if (IS_ADMIN) {
      badgeHtml = '<div style="font-size:9.5px;font-weight:500;color:var(--tdi);margin-top:5px;display:flex;align-items:center;gap:4px;">👁️ Live Schedule</div>';
    }
    return `
      <div class="dept-card ${S.deptId === d._id ? 'sel' : ''} ${isServiceCard ? 'svc' : ''}"
           onclick="clickDept('${d._id}','${e(d.name)}','${e(d.code || '')}')"
           title="${isMyDept ? 'Your Department (Full Control)' : d.name}">
        <div class="dc-icon">${d.icon || '🏛️'}</div>
        <div class="dc-code">${d.code || d.name.substring(0, 4).toUpperCase()}</div>
        <div class="dc-name">${d.name}</div>
        ${badgeHtml}
      </div>`;
  }).join('');
}

async function clickDept(id, name, code) {
  const classes = await API.getClasses(id);
  await enterDept(id, name, code || name.substring(0, 4).toUpperCase(), classes);
}

async function enterDept(id, name, code, classes, autoSelectClassId = null) {
  S.deptId = id; S.deptName = name; S.deptCode = code;
  S.classes = classes || [];
  S.classId = autoSelectClassId || null; S.sectionId = autoSelectClassId || null; S.tt = {};

  updateCanEdit();
  S.mode = CAN_EDIT ? 'development' : 'production';

  const deptSel = document.getElementById('sel-dept');
  if (deptSel) deptSel.value = id;

  const ttH1 = document.getElementById('tt-h1');
  const ttPs = document.getElementById('tt-ps');
  if (ttH1) ttH1.textContent = name;
  if (ttPs) ttPs.textContent = `${code} Department — Select class and section`;

  await loadSubjectsForRole(id);
  populateClassSelect(autoSelectClassId);
  updateReadOnlyNotice();
  showView('view-tt');

  if (autoSelectClassId) {
    onClassChange();
  }
}

// CLASS + SECTION SELECTORS
function populateClassSelect(autoSelectId = null) {
  const sel = document.getElementById('sel-class');
  sel.innerHTML = '<option value="">— Select Class —</option>';
  if (!S.classes || !S.classes.length) {
    sel.innerHTML = '<option value="">— No Classes Found in DB —</option>';
    const secSel = document.getElementById('sel-section');
    secSel.innerHTML = '<option value="">— No Sections —</option>';
    secSel.disabled = true;
    document.getElementById('btn-load').disabled = true;
    hideCard();
    return;
  }
  const byYear = {};
  S.classes.forEach(c => { const y = c.year || 'Other'; (byYear[y] = byYear[y] || []).push(c); });
  Object.keys(byYear).sort().forEach(yr => {
    const og = document.createElement('optgroup');
    og.label = yr;
    byYear[yr].forEach(c => {
      const o = document.createElement('option');
      o.value = c._id;
      const isAssigned = S.teacherAssignedClasses && S.teacherAssignedClasses.some(a => String(a.classId) === String(c._id));
      o.textContent = isAssigned ? `⭐ ${c.name} (Assigned)` : c.name;
      if (autoSelectId && String(c._id) === String(autoSelectId)) {
        o.selected = true;
      }
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  if (autoSelectId) {
    sel.value = autoSelectId;
  }
  const secSel = document.getElementById('sel-section');
  secSel.innerHTML = '<option value="">— Select Section —</option>';
  secSel.disabled = true;
  document.getElementById('btn-load').disabled = true;
  hideCard();
}

function onClassChange() {
  const sel = document.getElementById('sel-class');
  S.classId = sel.value || null;
  const cls = S.classes.find(c => c._id === S.classId);
  S.className = cls?.name || null;
  const secSel = document.getElementById('sel-section');
  secSel.innerHTML = '<option value="">— Select Section —</option>';
  secSel.disabled = true;
  document.getElementById('btn-load').disabled = true;
  S.sectionId = null;
  hideCard();
  if (!cls) return;
  const semStr = computeSemester(cls);
  const o = document.createElement('option');
  o.value = cls._id;
  o.textContent = semStr ? `${semStr} · Section ${cls.section || 'A'}` : `Section ${cls.section || 'A'}`;
  secSel.appendChild(o);
  secSel.value = cls._id;
  S.sectionId = cls._id;
  document.getElementById('btn-load').disabled = !S.sectionId;
  if (S.sectionId) {
    loadTT();
  }
}

function onSectionChange() {
  S.sectionId = document.getElementById('sel-section').value || null;
  document.getElementById('btn-load').disabled = !S.sectionId;
}

function hideCard() {
  document.getElementById('tt-card').classList.add('hidden');
  document.getElementById('tt-placeholder').classList.remove('hidden');
}

// MODE TOGGLE & STATUS UI
function updateModeBarUI() {
  updateReadOnlyNotice();
  const bar = document.getElementById('tt-mode-bar');
  if (bar) {
    if (!CAN_EDIT && !CAN_APPROVE) {
      bar.style.display = 'none';
    } else {
      bar.style.display = 'flex';
    }
  }

  const modeBadge = document.getElementById('mode-badge');
  const modeNote = document.getElementById('mode-note');
  const switchWrap = document.getElementById('mode-switch-wrap');
  const heroAutogen = document.getElementById('btn-hero-autogen');
  const heroSwitch = document.getElementById('hero-mode-switch');
  const tabsBar = document.getElementById('tt-tabs-bar');

  if (S.mode === 'development') {
    if (tabsBar) tabsBar.style.display = 'flex';
    if (modeBadge) {
      if (S.draftDoc?.status === 'pending_hod_approval') {
        modeBadge.className = 'mode-badge dev';
        modeBadge.style.background = '#fef3c7';
        modeBadge.style.color = '#92400e';
        modeBadge.textContent = '⏳ PENDING HOD APPROVAL';
        if (modeNote) modeNote.textContent = 'Timetable submitted for HOD review. Further edits will create a new revision.';
      } else if (S.draftDoc?.status === 'changes_requested') {
        modeBadge.className = 'mode-badge dev';
        modeBadge.style.background = '#fee2e2';
        modeBadge.style.color = '#991b1b';
        modeBadge.textContent = '⚠️ CHANGES REQUESTED';
        if (modeNote) modeNote.textContent = `HOD Remarks: ${S.draftDoc.hodRemarks || 'Review comments'}`;
      } else {
        modeBadge.className = 'mode-badge dev';
        modeBadge.style.background = '';
        modeBadge.style.color = '';
        modeBadge.textContent = 'DEV MODE: DRAFT WORKSPACE';
        if (modeNote) modeNote.textContent = 'Changes saved to Draft. Not visible to students until published.';
      }
    }
    if (switchWrap) switchWrap.style.display = CAN_EDIT ? 'flex' : 'none';
    if (heroAutogen) heroAutogen.style.display = CAN_EDIT ? 'inline-flex' : 'none';
  } else {
    if (tabsBar) tabsBar.style.display = 'none';
    if (modeBadge) {
      modeBadge.className = 'mode-badge prod';
      modeBadge.style.background = '';
      modeBadge.style.color = '';
      modeBadge.textContent = 'LIVE SCHEDULE';
    }
    if (modeNote) modeNote.textContent = 'Showing current published timetable';
    if (switchWrap) switchWrap.style.display = CAN_EDIT ? 'flex' : 'none';
    if (heroAutogen) heroAutogen.style.display = 'none';
  }

  if (heroSwitch) {
    heroSwitch.className = `mode-switch is-${S.mode}`;
    heroSwitch.setAttribute('aria-checked', S.mode === 'production' ? 'true' : 'false');
    heroSwitch.style.pointerEvents = CAN_EDIT ? 'auto' : 'none';
    heroSwitch.style.opacity = CAN_EDIT ? '1' : '0.6';
  }

  // HOD Confirmation Banner check
  const hodBanner = document.getElementById('hod-banner');
  if (hodBanner) {
    if (CAN_APPROVE && S.draftDoc?.status === 'pending_hod_approval') {
      hodBanner.style.display = 'flex';
      const sub = document.getElementById('hod-banner-sub');
      if (sub) {
        sub.textContent = `Submitted by ${S.draftDoc.createdByName || 'TT Coordinator'} on ${new Date(S.draftDoc.submittedAt || Date.now()).toLocaleDateString('en-IN')}: "${S.draftDoc.submissionNote || 'Ready for review'}"`;
      }
    } else {
      hodBanner.style.display = 'none';
    }
  }
}

function switchTTMode(newMode) {
  if (!CAN_EDIT) {
    dbtoast('Editing is restricted. You are in read-only mode.', 'info');
    return;
  }
  if (newMode === S.mode) return;
  S.mode = newMode;
  S.diffMode = false;
  const classId = S.sectionId || S.classId;
  if (classId) {
    loadTT();
  } else {
    updateModeBarUI();
  }
}
window.switchTTMode = switchTTMode;

function toggleTTMode() {
  if (!CAN_EDIT) {
    dbtoast('Editing is restricted. You are in read-only mode.', 'info');
    return;
  }
  switchTTMode(S.mode === 'development' ? 'production' : 'development');
}
window.toggleTTMode = toggleTTMode;

// TAB MANAGEMENT (Dev Mode — Isolated State & Zero-Lag Switching)
function renderTabsBar() {
  const listEl = document.getElementById('tt-tab-list');
  if (!listEl) return;
  const curId = S.sectionId || S.classId;
  listEl.innerHTML = S.tabs.map(t => {
    const isActive = String(t.classId) === String(curId);
    return `
      <div class="tt-tab ${isActive ? 'active' : ''}" onclick="switchTab('${t.classId}')">
        <span>${e(t.className)}</span>
        <button class="tt-tab-close" onclick="closeTab('${t.classId}', event)" title="Close Tab">✕</button>
      </div>`;
  }).join('');
}

function syncActiveTabState() {
  const curId = S.sectionId || S.classId;
  if (!curId) return;
  let curTab = S.tabs.find(t => String(t.classId) === String(curId));
  if (!curTab) {
    curTab = { classId: curId, className: S.className || 'Class', cached: true };
    S.tabs.push(curTab);
  }
  curTab.tt = JSON.parse(JSON.stringify(S.tt || {}));
  curTab.prodTT = S.prodTT ? JSON.parse(JSON.stringify(S.prodTT)) : {};
  curTab.draftDoc = S.draftDoc ? JSON.parse(JSON.stringify(S.draftDoc)) : null;
  curTab.cached = true;
}

function addTab(classId, className, tt = null, prodTT = null, draftDoc = null) {
  let existing = S.tabs.find(t => String(t.classId) === String(classId));
  if (!existing) {
    existing = {
      classId,
      className,
      tt: tt ? JSON.parse(JSON.stringify(tt)) : (S.tt ? JSON.parse(JSON.stringify(S.tt)) : {}),
      prodTT: prodTT ? JSON.parse(JSON.stringify(prodTT)) : (S.prodTT || {}),
      draftDoc: draftDoc || S.draftDoc || null,
      cached: !!(tt || S.tt)
    };
    S.tabs.push(existing);
  } else {
    if (tt) existing.tt = JSON.parse(JSON.stringify(tt));
    if (prodTT) existing.prodTT = JSON.parse(JSON.stringify(prodTT));
    if (draftDoc) existing.draftDoc = draftDoc;
    existing.cached = true;
  }
  renderTabsBar();
}

async function switchTab(classId) {
  if (!classId) return;
  const currentId = S.sectionId || S.classId;

  // 1. Sync current tab before leaving
  syncActiveTabState();

  if (String(currentId) === String(classId)) {
    renderTabsBar();
    return;
  }

  // 2. Set new active class
  S.sectionId = classId;
  S.classId = classId;
  const cls = S.classes.find(c => String(c._id) === String(classId));
  if (cls) {
    S.className = cls.name;
    S.currentClassYear = cls.year || '';
  }

  const targetTab = S.tabs.find(t => String(t.classId) === String(classId));
  if (targetTab && targetTab.cached && targetTab.tt) {
    // Instant switch from in-memory cache! Zero lag!
    S.tt = JSON.parse(JSON.stringify(targetTab.tt));
    S.prodTT = targetTab.prodTT || {};
    S.draftDoc = targetTab.draftDoc || null;

    renderTabsBar();
    updateModeBarUI();

    // Card title & subtitle
    const cardTitle = document.getElementById('tt-card-title');
    const cardSub = document.getElementById('tt-card-sub');
    if (cardTitle) cardTitle.textContent = `${S.deptCode || ''} – ${S.className || ''}`;
    const semStr = computeSemester(cls);
    if (cardSub) {
      cardSub.textContent = `${S.deptName || ''} Department${semStr ? ' · ' + semStr : ''} · ${S.mode === 'development' ? '🛠 Development Mode (Draft)' : '📋 Production Mode (Live)'}`;
    }

    renderClassMetaChips(classId);

    buildTTTable(classId);
    buildCardActions(classId);
    buildSummary();
    if (typeof runLiveConflictCheck === 'function') runLiveConflictCheck();
    if (typeof setupCrosshairHighlight === 'function') setupCrosshairHighlight();
  } else {
    // If not cached yet, load via API
    renderTabsBar();
    await loadTT();
  }
}
window.switchTab = switchTab;

function closeTab(classId, event) {
  if (event) event.stopPropagation();
  S.tabs = S.tabs.filter(t => String(t.classId) !== String(classId));
  const currentId = S.sectionId || S.classId;
  if (String(currentId) === String(classId)) {
    if (S.tabs.length) {
      switchTab(S.tabs[0].classId);
    } else {
      hideCard();
    }
  }
  renderTabsBar();
}
window.closeTab = closeTab;

function openNewTabDialog() {
  const selCls = document.getElementById('tab-modal-class');
  selCls.innerHTML = '<option value="">— Select Class —</option>' +
    S.classes.map(c => `<option value="${c._id}">${e(c.name)}</option>`).join('');
  const secSel = document.getElementById('tab-modal-section');
  secSel.innerHTML = '<option value="">— Select Section —</option>';
  secSel.disabled = true;
  openModal('modal-new-tab');
}
window.openNewTabDialog = openNewTabDialog;

function onTabModalClassChange() {
  const val = document.getElementById('tab-modal-class').value;
  const secSel = document.getElementById('tab-modal-section');
  secSel.innerHTML = '<option value="">— Select Section —</option>';
  if (!val) { secSel.disabled = true; return; }
  const cls = S.classes.find(c => c._id === val);
  if (cls) {
    const sem = computeSemester(cls);
    secSel.innerHTML += `<option value="${cls._id}">${sem ? `${sem} · ` : ''}Section ${cls.section || 'A'}</option>`;
    secSel.value = cls._id;
    secSel.disabled = false;
  }
}
window.onTabModalClassChange = onTabModalClassChange;

function confirmOpenNewTab() {
  const targetId = document.getElementById('tab-modal-section').value || document.getElementById('tab-modal-class').value;
  if (!targetId) { dbtoast('Please select a class', 'warn'); return; }
  const cls = S.classes.find(c => c._id === targetId);
  closeModal('modal-new-tab');
  if (cls) {
    addTab(cls._id, cls.name);
    switchTab(cls._id);
  }
}
window.confirmOpenNewTab = confirmOpenNewTab;

// LOAD TIMETABLE
async function loadTT() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;

  const btn = document.getElementById('btn-load');
  const orgBtnText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;vertical-align:middle;"></span> Loading…';
    btn.disabled = true;
  }

  try {
    const cls = S.classes.find(c => c._id === classId);
    S.className = cls?.name || S.className || '—';
    S.currentClassYear = cls?.year || '';

    // Fetch class timing set
    try {
      const tsRes = await API.getClassTimingSet(classId);
      if (tsRes?.timingSet) {
        S.activeTimingSet = tsRes.timingSet;
      }
    } catch { }

    const badge = document.getElementById('tt-timing-badge');
    if (badge) {
      const yr = String(S.currentClassYear || '').trim();
      const defName = ['2', '3', 'II', 'III', '2nd Year', '3rd Year'].includes(yr) ? 'Timing Set 2 (Years II & III)' : 'Timing Set 1 (Years I & IV)';
      badge.textContent = `⏱ ${S.activeTimingSet?.name || defName}`;
    }

    // CLASS INFO CARD — Title & Subtitle
    const cardTitle = document.getElementById('tt-card-title');
    const cardSub = document.getElementById('tt-card-sub');
    if (cardTitle) cardTitle.textContent = `${S.deptCode} – ${S.className}`;

    // Semester calculation from year + batch
    const semStr = computeSemester(cls);

    if (cardSub) {
      cardSub.textContent = `${S.deptName} Department${semStr ? ' · ' + semStr : ''} · ${S.mode === 'development' ? '🛠 Development Mode (Draft)' : '📋 Production Mode (Live)'}`;
    }

    if (S.mode === 'development' && CAN_EDIT) {
      // Dev Mode: Fetch draft doc (and live production for diff)
      const [draft, prod] = await Promise.all([
        API.getDraft(classId),
        API.getTimetable(classId)
      ]);
      S.draftDoc = draft;
      S.tt = draft?.slots || {};
      S.prodTT = prod || {};
      addTab(classId, S.className, S.tt, S.prodTT, S.draftDoc);
    } else {
      // Production Mode
      const data = await API.getTimetable(classId);
      S.tt = data || {};
      S.prodTT = S.tt;
      S.draftDoc = null;
    }

    renderClassMetaChips(classId);

    updateModeBarUI();
    buildTTTable(classId);
    buildCardActions(classId);
    buildSummary();
    if (S.teacherAssignedClasses && S.teacherAssignedClasses.length) {
      renderTeacherAssignedPills(S.teacherAssignedClasses);
    }

    document.getElementById('tt-placeholder').classList.add('hidden');
    document.getElementById('tt-card').classList.remove('hidden');

    applyZoom();
    setupCrosshairHighlight();
  } finally {
    if (btn) {
      btn.innerHTML = orgBtnText;
      btn.disabled = false;
    }
  }
}

// STUDENT FLOW – direct to their class TT
async function loadStudentTT() {
  let classId = SESSION.classId;
  let className = SESSION.className || '—';
  let deptName = SESSION.deptName || SESSION.dept || '—';

  if (!classId) {
    try {
      const profile = await API.getStudentProfile();
      classId = profile?.classId; className = profile?.className || '—'; deptName = profile?.deptName || '—';
    } catch { }
  }

  if (!classId) {
    document.getElementById('dept-grid').innerHTML = `
      <div class="state-sc" style="grid-column:1/-1">
        <div class="state-icon">⚠️</div>
        <div class="state-t">Class Not Assigned</div>
        <div class="state-s">Your class has not been assigned yet. Contact your class advisor.</div>
      </div>`;
    showView('view-dept');
    return;
  }

  document.getElementById('tt-h1').textContent = className;
  document.getElementById('tt-ps').textContent = `${deptName} · Read Only`;
  document.getElementById('sel-panel').classList.add('hidden');
  document.getElementById('tt-placeholder').classList.add('hidden');

  const data = await API.getTimetable(classId);
  S.tt = data || {};
  document.getElementById('tt-card-title').textContent = className;
  document.getElementById('tt-card-sub').textContent = `${deptName} · Read Only`;
  buildTTTable(classId);
  buildCardActions(classId);
  document.getElementById('tt-card').classList.remove('hidden');
  showView('view-tt');
}

// TT TABLE
function buildTTTable(classId) {
  const table = document.getElementById('tt-table');
  PERIODS = getActivePeriods();

  let html = `<thead><tr><th class="day-th">Day</th>`;
  PERIODS.forEach(p => {
    html += p.isBreak
      ? `<th style="color:var(--amber);font-size:9.5px;">BREAK<br><span style="opacity:.6;font-weight:400;">${p.time}</span></th>`
      : `<th>${p.label}<br><span style="font-size:9px;font-weight:400;opacity:.7;">${p.time}</span></th>`;
  });
  html += `</tr></thead><tbody>`;

  DAYS.forEach(day => {
    const dupBtn = (CAN_EDIT && S.mode === 'development')
      ? `<button class="btn-dup-day" onclick="openDuplicateDayModal('${day}')" title="Duplicate ${day}'s schedule">📋 Dup</button>`
      : '';
    html += `<tr><td class="day-cell"><div class="day-n">${day}</div><div class="day-s">${day.substring(0, 3).toUpperCase()}</div>${dupBtn}</td>`;
    let skipCount = 0;
    PERIODS.forEach((p, pIdx) => {
      if (skipCount > 0) {
        skipCount--;
        return; // Spanned by continuous period cell
      }
      if (p.isBreak) {
        html += `<td><div class="tt-cell brk"><span class="brk-lbl">${p.breakLbl || '☕ Break'}</span></div></td>`;
        return;
      }
      const key = `${day}-${p.id}`;
      const cell = S.tt[key] || null;
      const span = (cell && Number(cell.span) > 1) ? Number(cell.span) : 1;
      if (span > 1) {
        skipCount = span - 1;
      }

      const colspanAttr = span > 1 ? `colspan="${span}"` : '';
      const isDev = CAN_EDIT && S.mode === 'development';
      const isReadonly = !isDev;
      const click = isDev
        ? `openEditCell('${key}','${day}','${p.label}','${p.time}')`
        : (cell?.subject ? `openDetailCell('${key}','${day}','${p.label}','${p.time}')` : '');

      let diffClass = '';
      if (S.diffMode) {
        const prodCell = S.prodTT[key] || null;
        if (cell?.subject && !prodCell?.subject) {
          diffClass = 'cell-diff-added';
        } else if (cell?.subject && prodCell?.subject && (cell.subject !== prodCell.subject || cell.staff !== prodCell.staff || cell.hall !== prodCell.hall)) {
          diffClass = 'cell-diff-modified';
        }
      }

      const conflictItem = S.conflicts.find(c => c.slotKey === key);
      const conflictClass = conflictItem ? 'cell-conflict-alert' : '';
      const contClass = span > 1 ? (cell?.type?.toLowerCase() === 'lab' ? 'cell-continuous cell-continuous-lab' : 'cell-continuous') : '';
      const cancelClass = cell?.isCancelled ? 'cell-cancelled' : '';
      const dragAttrs = isDev ? `
        ondragover="handleDragOver(event, '${key}')"
        ondragleave="handleDragLeave(event, '${key}')"
        ondrop="handleDrop(event, '${key}', '${day}', ${p.id})"
      ` : '';

      if (cell?.subject) {
        const col = hashSubjColor(cell.subject);
        const cellDragAttrs = isDev ? `
          draggable="true"
          ondragstart="handleDragStart(event, '${key}', '${day}', ${p.id}, ${span})"
          ondragend="handleDragEnd(event)"
        ` : '';

        const quickActs = isDev ? `
          <div class="cell-quick-acts" onclick="event.stopPropagation()">
            <button class="cell-quick-btn" onclick="copySlotToClipboard('${key}', event)" title="Copy Slot (Ctrl+C)">📋</button>
            <button class="cell-quick-btn" onclick="adjustSlotSpan('${key}', 1, event)" title="Extend Span (+1)">+</button>
            ${span > 1 ? `<button class="cell-quick-btn" onclick="adjustSlotSpan('${key}', -1, event)" title="Shrink Span (-1)">−</button>` : ''}
          </div>
        ` : '';

        html += `<td ${colspanAttr} ${dragAttrs} onclick="${click}"><div class="tt-cell filled ${isDev ? 'draggable' : ''} ${isReadonly ? 'is-readonly' : ''} ${diffClass} ${conflictClass} ${contClass} ${cancelClass}" ${cellDragAttrs} style="background:${col.bg};border-left:3px solid ${col.border};position:relative;">
          ${quickActs}
          ${span > 1 && CAN_EDIT ? `<button class="btn-split-period" onclick="event.stopPropagation(); splitContinuousSlot('${key}')" title="Split into single periods">✂ Split</button>` : ''}
          <span class="pno">${span > 1 ? `P${p.id}–P${p.id + span - 1}` : p.label}</span>
          <div class="c-subj" style="color:${col.text}">${e(cell.subject)}</div>
          ${cell.staff ? `<div class="c-staff">👤 ${e(cell.staff)}</div>` : ''}
          ${cell.hall ? `<div class="c-hall">📍 ${e(cell.hall)}</div>` : ''}
          ${span > 1 ? `<span class="continuous-tag">⚡ ${span} Periods (${cell.type || 'Lab'})</span>` : (cell.type ? `<span class="c-badge ${cell.type}">${cell.type.charAt(0).toUpperCase() + cell.type.slice(1)}</span>` : '')}
          ${cell.isCombined ? `<span class="combined-badge">👥 Combined${cell.combinedClassNames?.length ? ': ' + cell.combinedClassNames.join('+') : ''}</span>` : ''}
          ${cell.isSubstitute ? `<span class="badge-override-sub" title="Substitute Faculty: ${e(cell.staff || '')}${cell.originalTeacherName ? ' (Original: ' + e(cell.originalTeacherName) + ')' : ''}">🔄 Sub: ${e(cell.staff || cell.substituteTeacherName || 'Faculty')}</span>` : ''}
          ${cell.isCancelled ? `<span class="badge-override-cancel">❌ Cancelled</span>` : ''}
          ${conflictItem ? `<div style="color:#dc2626;font-size:8.5px;font-weight:700;margin-top:2px;">⚠️ Conflict</div>` : ''}
        </div></td>`;
      } else {
        html += `<td ${colspanAttr} ${dragAttrs} ${click ? `onclick="${click}"` : ''}><div class="tt-cell ${isReadonly ? 'is-readonly' : ''} ${diffClass}">
          <span class="pno">${p.label}</span>
          ${CAN_EDIT && !isReadonly ? `<div class="c-empty">Empty</div><div class="c-add">＋ Add</div>` : `<div class="c-empty">—</div>`}
        </div></td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody>`;
  table.innerHTML = html;
}

// CARD ACTIONS & ZOOM
let currentZoom = 1;
function applyZoom() {
  const table = document.getElementById('tt-table');
  const lbl = document.getElementById('tt-zoom-lbl');
  if (table) {
    table.style.zoom = currentZoom;
  }
  if (lbl) {
    lbl.textContent = Math.round(currentZoom * 100) + '%';
  }
}
function zoomTT(delta) {
  currentZoom = Math.round((currentZoom + delta) * 10) / 10;
  if (currentZoom < 0.6) currentZoom = 0.6;
  if (currentZoom > 1.6) currentZoom = 1.6;
  applyZoom();
}

function buildCardActions(classId) {
  const el = document.getElementById('tt-card-acts');
  const zoomHtml = `
    <div class="zoom-pill">
      <button onclick="zoomTT(-0.1)" title="Zoom Out">−</button>
      <span id="tt-zoom-lbl">${Math.round(currentZoom * 100)}%</span>
      <button onclick="zoomTT(0.1)" title="Zoom In">+</button>
    </div>
  `;

  if (!CAN_EDIT) {
    el.innerHTML = zoomHtml + `<button class="btn btn-outline-white btn-sm" onclick="exportCSV()">⬇ Export</button>`;
    return;
  }

  if (S.mode === 'development') {
    const isPending = S.draftDoc?.status === 'pending_hod_approval';
    el.innerHTML = zoomHtml + `
      <button class="btn btn-outline-white btn-sm" onclick="runDraftValidation()">🔍 Validate</button>
      <button class="btn btn-amber btn-sm" onclick="openAutoGen()">⚡ Auto Gen</button>
      <button class="btn btn-outline-white btn-sm" onclick="openTemplatesModal()">📑 Templates</button>
      <button class="btn btn-white btn-sm" onclick="saveTT('${classId}')">💾 Save Draft</button>
      <button class="btn btn-white btn-sm" onclick="openSubmitToHodModal()" ${isPending ? 'disabled title="Already submitted for approval"' : ''}>📤 Submit to HOD</button>
      <button class="btn btn-outline-white btn-sm" onclick="openVersionsModal()">🕒 History</button>`;
  } else {
    el.innerHTML = zoomHtml + `
      <button class="btn btn-outline-white btn-sm" onclick="exportCSV()">⬇ Export</button>
      <button class="btn btn-outline-white btn-sm" onclick="openTemplatesModal()">📑 Templates</button>
      <button class="btn btn-outline-white btn-sm" onclick="openVersionsModal()">🕒 Versions</button>`;
  }
}

// SUMMARY (coordinators)
function buildSummary() {
  const sum = document.getElementById('tt-summary');
  if (!CAN_EDIT) { sum.classList.add('hidden'); return; }
  sum.classList.remove('hidden');

  const map = {};
  Object.values(S.tt).forEach(cell => {
    if (!cell?.subject) return;
    const k = cell.subject;
    if (!map[k]) map[k] = { ...cell, hrs: 0 };
    map[k].hrs++;
  });
  const subjs = Object.values(map);
  const filled = subjs.reduce((a, s) => a + s.hrs, 0);
  const total = DAYS.length * PERIODS.filter(p => !p.isBreak).length;

  document.getElementById('stat-row').innerHTML = `
    <div class="stat-c"><div class="stat-n">${subjs.length}</div><div class="stat-l">Subjects</div></div>
    <div class="stat-c"><div class="stat-n">${filled}</div><div class="stat-l">Hrs Filled</div></div>
    <div class="stat-c"><div class="stat-n">${total - filled}</div><div class="stat-l">Hrs Empty</div></div>
    <div class="stat-c"><div class="stat-n">${total ? Math.round(filled / total * 100) : 0}%</div><div class="stat-l">Completion</div></div>`;

  const tbody = document.getElementById('sum-tbody');
  if (!subjs.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--tdi);">No subjects assigned yet</td></tr>`;
    return;
  }
  const barMax = Math.max(...subjs.map(s => s.hrs));
  tbody.innerHTML = subjs.map((s, i) => {
    const col = COLORS[i % COLORS.length];
    const pct = Math.round(s.hrs / barMax * 100);
    return `<tr>
      <td style="color:var(--tdi);font-size:11px;">${String(i + 1).padStart(2, '0')}</td>
      <td><span class="sdot" style="background:${col};margin-right:7px;"></span><strong>${e(s.subject)}</strong></td>
      <td style="font-size:11px;color:var(--tdi);">${e(s.code || '—')}</td>
      <td><span class="c-badge ${s.type || 'theory'}">${(s.type || 'Theory').charAt(0).toUpperCase() + (s.type || 'theory').slice(1)}</span></td>
      <td style="font-size:12px;">${e(s.staff || '—')}</td>
      <td style="font-size:11px;color:var(--tdi);">${e(s.hall || '—')}</td>
      <td style="color:var(--gD);font-weight:700;">${s.credit || '—'}</td>
      <td><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>&nbsp;<span style="font-size:11px;font-weight:600;">${s.hrs}</span></td>
    </tr>`;
  }).join('');
}

// SUBJECT LOADING (role-filtered)
async function loadSubjectsForRole(targetDeptId) {
  if (!CAN_EDIT) return;

  if (IS_ADMIN) {
    const all = await API.getSubjects(null);
    S.subjects = all;
  } else if (IS_COORD) {
    if (S.coordIsService) {
      S.subjects = await API.getSubjects(S.coordDeptId);
    } else {
      const own = await API.getSubjects(S.coordDeptId);
      const all = await API.getSubjects(null);
      const mainIds = new Set(S.depts.map(d => d._id));
      const svcSubjs = all.filter(s =>
        !own.find(o => o._id === s._id) &&
        ['maths', 'mathematics', 'english', 'tamil', 'physics', 'chemistry', 'biology']
          .some(kw => (s.deptName || '').toLowerCase().includes(kw))
      );
      S.subjects = [...own, ...svcSubjs];
    }
  }
}

// CELL EDIT MODAL
function openEditCell(key, day, period, time) {
  if (!CAN_EDIT || S.mode !== 'development') return;
  S.activeCellKey = key;
  const cell = S.tt[key] || {};
  document.getElementById('edit-title').textContent = `${day || 'Edit'} · Period ${period || ''}`;
  document.getElementById('edit-sub').textContent = time ? `Time Slot: ${time}` : '—';
  document.getElementById('edit-subj').value = cell.subject || '';
  document.getElementById('edit-subj-id').value = cell.subjectId || '';
  document.getElementById('edit-subj-code').value = cell.code || '';
  document.getElementById('edit-staff').value = cell.staff || '';
  document.getElementById('edit-hall').value = cell.hall || '';
  document.getElementById('edit-credit').value = cell.credit || '';
  document.getElementById('edit-type').value = (cell.type || 'theory').toLowerCase();

  const spanSel = document.getElementById('edit-span');
  if (spanSel) spanSel.value = cell.span || (cell.type?.toLowerCase() === 'lab' ? '3' : '1');

  const combCb = document.getElementById('edit-is-combined');
  if (combCb) {
    combCb.checked = !!cell.isCombined;
    toggleCombinedUI();
    if (cell.isCombined && cell.combinedClassIds) {
      document.querySelectorAll('.combined-section-cb').forEach(cb => {
        cb.checked = cell.combinedClassIds.includes(cb.value);
      });
    }
  }

  const hint = document.getElementById('edit-subj-hint');
  if (S.coordIsService)
    hint.textContent = `Service Coordinator: only ${TT_DEPT} subjects may be assigned here`;
  else if (IS_COORD)
    hint.textContent = 'Showing your dept subjects + service dept subjects';
  else hint.textContent = '';

  openModal('modal-edit');
}

function onEditTypeChange() {
  const typeVal = document.getElementById('edit-type').value;
  const spanSel = document.getElementById('edit-span');
  if (typeVal === 'lab' && spanSel && spanSel.value === '1') {
    spanSel.value = '3';
    dbtoast('Lab sessions default to 3 continuous periods', 'info');
  }
}
window.onEditTypeChange = onEditTypeChange;

function toggleCombinedUI() {
  const isCombined = document.getElementById('edit-is-combined')?.checked;
  const wrap = document.getElementById('edit-combined-sections-wrap');
  if (!wrap) return;
  wrap.style.display = isCombined ? 'block' : 'none';

  if (isCombined) {
    const listEl = document.getElementById('edit-combined-checkboxes');
    const currentClassId = S.sectionId || S.classId;
    const siblingClasses = S.classes.filter(c => c._id !== currentClassId);
    if (!siblingClasses.length) {
      listEl.innerHTML = `<span style="font-size:11px;color:var(--tmu);">No other sections available in this department</span>`;
      return;
    }
    listEl.innerHTML = siblingClasses.map(c => `
      <label style="display:flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer;">
        <input type="checkbox" class="combined-section-cb" value="${c._id}" data-name="${e(c.name)}">
        ${e(c.name)}
      </label>
    `).join('');
  }
}
window.toggleCombinedUI = toggleCombinedUI;

// SUBJECT DROPDOWN
function filterSubj(q) {
  const list = q
    ? S.subjects.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || (s.code || '').toLowerCase().includes(q.toLowerCase()))
    : S.subjects;
  renderSubjDrop(list);
}

function openSubjDrop() { renderSubjDrop(S.subjects); document.getElementById('sdrop').classList.add('open'); }
function closeSubjDrop() { setTimeout(() => document.getElementById('sdrop').classList.remove('open'), 180); }

function renderSubjDrop(list) {
  const dd = document.getElementById('sdrop');
  if (!list.length) { dd.innerHTML = `<div class="sdrop-empty">No subjects found</div>`; dd.classList.add('open'); return; }
  dd.innerHTML = list.slice(0, 30).map(s =>
    `<div class="sdrop-opt" onmousedown="pickSubj('${s._id}')">
       <div class="sdrop-name">${e(s.name)}</div>
       <div class="sdrop-meta">${e(s.code || '—')} · ${e(s.deptName || '—')} · ${s.credits || '?'} cr · ${s.type || 'Theory'}</div>
     </div>`
  ).join('');
  dd.classList.add('open');
}

function pickSubj(id) {
  const subj = S.subjects.find(s => s._id === id);

  if (!subj) return;
  document.getElementById('edit-subj').value = subj.name;
  document.getElementById('edit-subj-id').value = subj._id;
  document.getElementById('edit-subj-code').value = subj.code || '';
  document.getElementById('edit-credit').value = subj.credits || '';
  const subjType = (subj.type || 'theory').toLowerCase();
  document.getElementById('edit-type').value = subjType;
  if (subjType === 'lab') {
    const spanSel = document.getElementById('edit-span');
    if (spanSel && spanSel.value === '1') spanSel.value = '3';
  }
  const staffVal = subj.staff || subj.staffName || subj.defaultStaff || '';
  const hallVal = subj.hall || subj.hallNo || subj.defaultHall || '';
  if (staffVal) document.getElementById('edit-staff').value = staffVal;
  if (hallVal) document.getElementById('edit-hall').value = hallVal;
  document.getElementById('sdrop').classList.remove('open');
}

// SAVE / CLEAR CELL
document.getElementById('btn-save').addEventListener('click', async () => {
  const key = S.activeCellKey;
  if (!key) return;
  const subjName = document.getElementById('edit-subj').value.trim();
  if (!subjName) { dbtoast('Subject name is required', 'error'); return; }

  const span = parseInt(document.getElementById('edit-span').value, 10) || 1;
  const isCombined = document.getElementById('edit-is-combined')?.checked || false;
  const selectedCombIds = [];
  const selectedCombNames = [];
  if (isCombined) {
    document.querySelectorAll('.combined-section-cb:checked').forEach(cb => {
      selectedCombIds.push(cb.value);
      selectedCombNames.push(cb.getAttribute('data-name'));
    });
  }

  // Calculate start & end clock time from active timing set
  const parts = key.split('-');
  const pNum = parseInt(parts[1], 10);
  const activePeriods = getActivePeriods();
  const startP = activePeriods.find(p => p.id === pNum);
  const endP = activePeriods.find(p => p.id === pNum + span - 1) || startP;

  const payload = {
    subject: subjName,
    subjectId: document.getElementById('edit-subj-id').value || null,
    code: document.getElementById('edit-subj-code').value || '',
    staff: document.getElementById('edit-staff').value.trim(),
    hall: document.getElementById('edit-hall').value.trim(),
    credit: parseInt(document.getElementById('edit-credit').value) || null,
    type: document.getElementById('edit-type').value,
    span: span,
    start: startP?.start || '',
    end: endP?.end || '',
    isCombined: isCombined,
    combinedClassIds: selectedCombIds,
    combinedClassNames: selectedCombNames,
  };

  if (IS_COORD && S.coordIsService && S.subjects.length) {
    const allowed = S.subjects.find(s => s.name === subjName || s._id === payload.subjectId);
    if (!allowed) {
      dbtoast(`Only ${TT_DEPT} subjects can be assigned by this coordinator`, 'error');
      return;
    }
  }

  const classId = S.sectionId || S.classId;

  // Tier-aware save: week→local only, day→block free-form edits, master→persist
  if (S.tier === 'week') {
    S.tt[key] = payload;
    buildTTTable(classId);
    buildSummary();
    closeModal('modal-edit');
    dbtoast('Week-tier edit saved locally. Use "💾 Save Week" to persist.', 'info');
    return;
  } else if (S.tier === 'day') {
    dbtoast('Day-override tier: use the dedicated Day Override modal for edits.', 'warn');
    return;
  }

  S.tt[key] = payload;
  buildTTTable(classId);
  buildSummary();
  closeModal('modal-edit');

  if (S.mode === 'development') {
    const res = await API.updateDraftSlot(classId, key, payload);
    if (res?.hasConflict) {
      dbtoast('⚠️ Slot saved to Dev Draft, but cross-dept conflict flagged!', 'warn', 4500);
      runDraftValidation();
    } else {
      dbtoast('Draft Period saved ✓', 'success');
    }
  } else {
    const ok = await API.updateCell(classId, key, payload);
    dbtoast(ok ? 'Period saved ✓' : 'Saved locally (check connection)', ok ? 'success' : 'info');
  }
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  const key = S.activeCellKey;
  if (!key) return;
  const classId = S.sectionId || S.classId;

  // Tier-aware clear: week→local only, day→block free-form edits, master→persist
  if (S.tier === 'week') {
    delete S.tt[key];
    buildTTTable(classId);
    buildSummary();
    closeModal('modal-edit');
    dbtoast('Week-tier cell cleared locally. Use "💾 Save Week" to persist.', 'info');
    return;
  } else if (S.tier === 'day') {
    dbtoast('Day-override tier: use the dedicated Day Override modal for edits.', 'warn');
    return;
  }

  delete S.tt[key];
  buildTTTable(classId);
  buildSummary();
  closeModal('modal-edit');
  if (S.mode === 'development') {
    await API.updateDraftSlot(classId, key, null);
  } else {
    await API.updateCell(classId, key, null);
  }
  dbtoast('Period cleared', 'info');
});

// STUDENT DETAIL MODAL
function openDetailCell(key, day, period, time) {
  const cell = S.tt[key]; if (!cell?.subject) return;
  document.getElementById('det-period').textContent = `${day} · ${period} · ${time}`;
  document.getElementById('det-subj').textContent = cell.subject;
  document.getElementById('det-staff').textContent = cell.staff || '—';
  document.getElementById('det-hall').textContent = cell.hall || '—';
  document.getElementById('det-type').textContent = (cell.type || 'Theory').charAt(0).toUpperCase() + (cell.type || 'theory').slice(1);
  document.getElementById('det-code').textContent = cell.code || '—';
  document.getElementById('det-ring').textContent = cell.credit || '?';
  openModal('modal-detail');
}

// SAVE ALL / SAVE DRAFT
async function saveTT(classId) {
  if (!classId) classId = S.sectionId || S.classId;
  if (!classId) { dbtoast('No class selected', 'error'); return; }
  if (S.mode === 'development') {
    const ok = await API.saveDraft(classId, S.tt);
    dbtoast(ok ? 'Dev Mode Draft saved to MongoDB ✓' : 'Save failed – check connection', ok ? 'success' : 'error');
  } else {
    const ok = await API.saveTimetable(classId, S.tt);
    dbtoast(ok ? 'Timetable saved to DB ✓' : 'Save failed – check connection', ok ? 'success' : 'error');
  }
}

// LIVE INLINE CONFLICT CHECKING (Cell Edit Modal)
let conflictCheckTimer = null;
function liveCheckConflict() {
  clearTimeout(conflictCheckTimer);
  conflictCheckTimer = setTimeout(async () => {
    const key = S.activeCellKey;
    if (!key) return;
    const parts = key.split('-');
    const day = parts[0];
    const pNum = parts[1];
    const staff = (document.getElementById('edit-staff').value || '').trim();
    const hall = (document.getElementById('edit-hall').value || '').trim();
    const alertEl = document.getElementById('edit-conflict-alert');
    if (!alertEl) return;

    if (!staff && !hall) {
      alertEl.style.display = 'none';
      return;
    }

    const res = await API.checkInlineConflict(day, pNum, staff, '', hall, S.draftDoc?._id);
    if (res?.hasConflict && res.conflicts.length > 0) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = res.conflicts.map(c => `<div>⚠️ ${e(c.message)}</div>`).join('');
    } else {
      alertEl.style.display = 'none';
    }
  }, 280);
}
window.liveCheckConflict = liveCheckConflict;

// COMPREHENSIVE DRAFT CONFLICT VALIDATION
async function runDraftValidation() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;
  dbtoast('Checking cross-department conflicts across college…', 'info');
  const res = await API.validateDraft(classId);
  S.conflicts = res.conflicts || [];
  buildTTTable(classId);

  const drawer = document.getElementById('conflict-drawer');
  const listEl = document.getElementById('conflict-drawer-list');

  if (S.conflicts.length > 0) {
    if (drawer) drawer.style.display = 'block';
    if (listEl) {
      listEl.innerHTML = S.conflicts.map(c => `
        <div class="conflict-item">
          <strong>⚠️ ${e(c.slotKey || 'Slot')}:</strong> ${e(c.message)}
        </div>
      `).join('');
    }
    dbtoast(`Found ${S.conflicts.length} conflict(s). Review conflict drawer!`, 'warn', 4500);
  } else {
    if (drawer) drawer.style.display = 'none';
    dbtoast('Zero conflicts found! Timetable is clean ✓', 'success');
  }
}
window.runDraftValidation = runDraftValidation;

function toggleConflictDrawer() {
  const drawer = document.getElementById('conflict-drawer');
  if (drawer) {
    drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
  }
}
window.toggleConflictDrawer = toggleConflictDrawer;

// DIFF VIEW TOGGLE (Compare with Live)
function toggleDiffView() {
  S.diffMode = !S.diffMode;
  const btn = document.getElementById('btn-toggle-diff');
  if (btn) {
    btn.textContent = S.diffMode ? 'Exit Diff View' : '🔍 Compare with Live (Diff)';
    btn.className = S.diffMode ? 'btn btn-sm btn-amber' : 'btn btn-sm btn-ghost';
  }
  const classId = S.sectionId || S.classId;
  if (classId) buildTTTable(classId);
  dbtoast(S.diffMode ? 'Showing diff vs live schedule (Green: Added, Yellow: Modified)' : 'Exited diff view', 'info');
}
window.toggleDiffView = toggleDiffView;

// HOD APPROVAL & CONFIRMATION ACTIONS
async function confirmHodApprove() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;
  openPublishPreviewModal();
}
window.confirmHodApprove = confirmHodApprove;

function openHodRejectModal() {
  document.getElementById('hod-reject-remarks').value = '';
  openModal('modal-hod-reject');
}
window.openHodRejectModal = openHodRejectModal;

async function executeHodReject() {
  const remarks = document.getElementById('hod-reject-remarks').value.trim();
  if (!remarks) {
    dbtoast('Please provide feedback or changes needed', 'warn');
    return;
  }
  const classId = S.sectionId || S.classId;
  const res = await API.hodReject(classId, remarks);
  closeModal('modal-hod-reject');
  if (res.success) {
    dbtoast('Feedback sent to Timetable Coordinator.', 'info');
    loadTT();
  } else {
    dbtoast(`Error: ${res.error || 'Failed to submit feedback'}`, 'error');
  }
}
window.executeHodReject = executeHodReject;

// COORDINATOR SUBMISSION TO HOD
function openSubmitToHodModal() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;
  const totalSlots = Object.values(S.tt).filter(c => c?.subject).length;
  document.getElementById('submit-hod-summary').innerHTML = `
    <strong>Target Class:</strong> ${e(S.deptCode)} – ${e(S.className)}<br>
    <strong>Slots filled:</strong> ${totalSlots} periods<br>
    <strong>Conflicts:</strong> ${S.conflicts.length ? `<span style="color:#dc2626;">⚠️ ${S.conflicts.length} unresolved</span>` : '<span style="color:#166534;">✓ Zero conflicts detected</span>'}
  `;
  document.getElementById('submit-hod-note').value = '';
  openModal('modal-submit-hod');
}
window.openSubmitToHodModal = openSubmitToHodModal;

async function executeSubmitToHod() {
  const note = document.getElementById('submit-hod-note').value.trim();
  const classId = S.sectionId || S.classId;
  const res = await API.submitForHodApproval(classId, note);
  closeModal('modal-submit-hod');
  if (res.success) {
    dbtoast('📤 Submitted to Department HOD for confirmation!', 'success');
    loadTT();
  } else {
    dbtoast(`Submission failed: ${res.error || 'Server error'}`, 'error');
  }
}
window.executeSubmitToHod = executeSubmitToHod;

// VERSION CHANGELOG & BACKUP RESTORE MODAL
async function openVersionsModal() {
  const classId = S.sectionId || S.classId;
  openModal('modal-versions');
  const bodyEl = document.getElementById('versions-modal-body');
  bodyEl.innerHTML = '<div class="state-sc"><div class="state-s">Loading version history…</div></div>';

  const [versions, backups] = await Promise.all([
    API.getVersions(),
    classId ? API.getBackups(classId) : Promise.resolve([])
  ]);

  let html = '';
  if (backups.length > 0) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:8px;">📦 Backed-Up Snapshots for ${e(S.className)}</div>`;
    html += backups.map(b => `
      <div style="background:var(--gP);border:1px solid var(--br);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--td);">${e(b.versionLabel || 'Archived Snapshot')}</div>
          <div style="font-size:10.5px;color:var(--tmu);">${new Date(b.archivedAt).toLocaleString('en-IN')} · Confirmed by: ${e(b.approvedBy || 'HOD')}</div>
        </div>
        <button class="btn btn-sm btn-amber" onclick="executeRestoreBackup('${b._id}')">↺ Restore to Dev Mode</button>
      </div>
    `).join('');
    html += '<hr style="border:none;border-top:1px solid var(--brl);margin:14px 0;">';
  }

  html += `<div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:8px;">🕒 Published Versions Changelog</div>`;
  if (!versions.length) {
    html += `<div class="state-sc"><div class="state-s">No published version history yet.</div></div>`;
  } else {
    html += versions.map(v => `
      <div style="background:#fff;border:1px solid var(--br);border-radius:10px;padding:10px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <strong style="font-size:12px;color:var(--gD);">${e(v.summary || 'Timetable Published')}</strong>
          <span style="font-size:10px;color:var(--tmu);">${new Date(v.publishedAt).toLocaleString('en-IN')}</span>
        </div>
        <div style="font-size:11px;color:var(--tdi);">Coordinator: ${e(v.submittedBy || '—')} · Approved by HOD: ${e(v.approvedBy || '—')}</div>
      </div>
    `).join('');
  }

  bodyEl.innerHTML = html;
}
window.openVersionsModal = openVersionsModal;

async function executeRestoreBackup(backupId) {
  if (!confirm('Restore this backup into Development Mode? (It will be loaded as a draft for review and editing without modifying live production).')) return;
  const res = await API.restoreBackup(backupId);
  closeModal('modal-versions');
  if (res.success) {
    dbtoast('Restored into Dev Mode draft ✓', 'success');
    if (S.mode !== 'development') switchTTMode('development');
    else loadTT();
  } else {
    dbtoast('Failed to restore backup', 'error');
  }
}
window.executeRestoreBackup = executeRestoreBackup;

// AUTO GEN
// ── PLAN 3: AUTO GEN, TEMPLATES & DRAG/DROP EDITOR (FEATURES 5, 9, 10) ──

// AUTO GEN (UPGRADED FOR YEAR-WIDE BATCH & TEMPLATES)
async function openAutoGen() {
  document.getElementById('ag-sub').textContent = `Dept: ${S.deptName || 'Department'} — Multi-section continuous 3-period lab generation`;
  document.getElementById('ag-list').innerHTML = '';
  document.getElementById('conflict-log').style.display = 'none';
  document.getElementById('ag-hall').value = 'LH-101';
  document.getElementById('ag-lab-hall').value = 'CS-LAB-1';

  // Prepopulate Year dropdown based on selected class
  const yr = String(S.currentClassYear || '1').trim();
  const yrSel = document.getElementById('ag-year');
  if (yrSel) {
    if (yr.includes('2') || yr.includes('II')) yrSel.value = '2';
    else if (yr.includes('3') || yr.includes('III')) yrSel.value = '3';
    else if (yr.includes('4') || yr.includes('IV')) yrSel.value = '4';
    else yrSel.value = '1';
  }

  // Load Reusable Templates into selector
  await populateAgTemplateDropdown();

  // Populate Subject List from Department Curriculum
  const seeds = S.subjects.length ? S.subjects : [];
  if (seeds.length) {
    seeds.forEach(s => {
      const isLab = String(s.type).toLowerCase() === 'lab' || String(s.name).toLowerCase().includes('lab');
      addAgRow(s.name, isLab ? 3 : (s.credits ? s.credits + 1 : 4), s.credits || 3, '', isLab ? 'lab' : 'theory');
    });
  } else {
    addAgRow('Data Structures & Algorithms', 4, 3, '', 'theory');
    addAgRow('Database Management Systems', 4, 3, '', 'theory');
    addAgRow('Computer Networks', 4, 3, '', 'theory');
    addAgRow('Operating Systems', 3, 3, '', 'theory');
    addAgRow('Data Structures Laboratory', 3, 2, '', 'lab');
    addAgRow('DBMS Practical Laboratory', 3, 2, '', 'lab');
  }

  openModal('modal-ag');
}
window.openAutoGen = openAutoGen;

async function populateAgTemplateDropdown() {
  const sel = document.getElementById('ag-template-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Choose a Reusable Template (Optional) —</option>';
  try {
    S.templates = await API.getTemplates(S.deptId);
    S.templates.forEach(t => {
      sel.innerHTML += `<option value="${t._id}">${t.name} (${t.workingDays?.length || 5} Days · ${t.timingSetCode || 'SET_1'})</option>`;
    });
  } catch { }
}

function onAgTemplateSelectChange() {
  const tplId = document.getElementById('ag-template-select').value;
  if (!tplId) return;
  const tpl = S.templates.find(t => t._id === tplId);
  if (!tpl) return;

  if (tpl.defaultLabDuration) {
    document.getElementById('ag-lab-duration').value = String(tpl.defaultLabDuration);
  }
  if (tpl.workingDays) {
    document.getElementById('ag-days-mode').value = tpl.workingDays.length >= 6 ? '6' : '5';
  }
  if (tpl.rules?.maxTeacherPeriodsPerDay) {
    document.getElementById('ag-max-teacher-load').value = tpl.rules.maxTeacherPeriodsPerDay;
  }
  if (tpl.rules?.avoidFirstPeriodLab !== undefined) {
    document.getElementById('ag-avoid-first-lab').checked = tpl.rules.avoidFirstPeriodLab;
  }
  dbtoast(`Applied constraints from "${tpl.name}" ✓`, 'info');
}
window.onAgTemplateSelectChange = onAgTemplateSelectChange;

function toggleAgScope() {
  const scopeYear = document.getElementById('ag-scope-year').checked;
  const sub = document.getElementById('ag-sub');
  if (sub) {
    sub.textContent = scopeYear
      ? `Batch generating timetables for ALL sections of Year ${document.getElementById('ag-year').value}`
      : `Generating timetable for current section: ${S.className || 'Selected Section'}`;
  }
}
window.toggleAgScope = toggleAgScope;

function onAgDaysModeChange() {
  // Can trigger day re-layout preview if needed
}
window.onAgDaysModeChange = onAgDaysModeChange;

function addAgRow(name = '', hrs = '', cr = '', staff = '', type = 'theory') {
  const row = document.createElement('div');
  row.className = 'ag-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '1fr 70px 55px 120px 100px 32px';
  row.style.gap = '6px';
  row.style.alignItems = 'center';
  row.style.marginBottom = '6px';

  row.innerHTML = `
    <input class="ag-in ag-n fc2" type="text" placeholder="Subject name" value="${e(name)}" style="height:34px;font-size:12px;">
    <input class="ag-in ag-h fc2" type="number" placeholder="Hrs" min="1" max="12" value="${hrs}" style="height:34px;font-size:12px;" title="Weekly Hours / Periods">
    <input class="ag-in ag-c fc2" type="number" placeholder="Cr" min="1" max="6" value="${cr}" style="height:34px;font-size:12px;" title="Credits">
    <input class="ag-in ag-s fc2" type="text" placeholder="Staff (optional)" value="${e(staff)}" style="height:34px;font-size:12px;">
    <select class="ag-in ag-t fs" style="height:34px;font-size:11.5px;padding:0 8px;">
      <option value="theory" ${type === 'theory' ? 'selected' : ''}>Theory</option>
      <option value="lab" ${type === 'lab' ? 'selected' : ''}>Lab</option>
    </select>
    <button class="ag-rm btn btn-ghost btn-sm" style="color:#dc2626;padding:0;height:34px;line-height:34px;" onclick="this.closest('.ag-row').remove()" title="Remove">✕</button>`;
  document.getElementById('ag-list').appendChild(row);
}
window.addAgRow = addAgRow;

function getAgSubjects() {
  return Array.from(document.querySelectorAll('.ag-row')).map(r => ({
    name: r.querySelector('.ag-n').value.trim(),
    hours: parseInt(r.querySelector('.ag-h').value) || 0,
    credit: parseInt(r.querySelector('.ag-c').value) || 0,
    staff: r.querySelector('.ag-s').value.trim(),
    type: r.querySelector('.ag-t').value.toLowerCase() === 'lab' ? 'Lab' : 'Theory',
    hall: r.querySelector('.ag-t').value.toLowerCase() === 'lab' ? document.getElementById('ag-lab-hall').value.trim() : document.getElementById('ag-hall').value.trim()
  })).filter(s => s.name && s.hours > 0);
}

async function checkAgConflicts() {
  const subjects = getAgSubjects();
  if (!subjects.length) { dbtoast('Add at least one subject', 'error'); return; }
  const log = document.getElementById('conflict-log');
  log.style.display = 'block';
  log.innerHTML = '<span class="ok">↳ Checking institutional conflict database…</span><br>';

  const year = document.getElementById('ag-year').value;
  const res = await API.checkConflicts(S.deptId, year, subjects);
  log.innerHTML = res.map(r => `<span class="${r.ok ? 'ok' : 'err'}">${r.ok ? '✓' : '✗'} ${r.message}</span>`).join('<br>');
}
window.checkAgConflicts = checkAgConflicts;

async function executeAutoGen() {
  const subjects = getAgSubjects();
  const year = document.getElementById('ag-year').value;
  const targetScope = document.getElementById('ag-scope-year').checked ? 'year' : 'section';
  const hall = document.getElementById('ag-hall').value.trim() || 'LH-101';
  const labHall = document.getElementById('ag-lab-hall').value.trim() || 'CS-LAB-1';
  const labDuration = parseInt(document.getElementById('ag-lab-duration').value, 10) || 3;
  const maxTeacherHoursPerDay = parseInt(document.getElementById('ag-max-teacher-load').value, 10) || 4;
  const daysCount = parseInt(document.getElementById('ag-days-mode').value, 10) || 5;
  const workingDays = daysCount === 6
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const avoidFirstPeriodLab = document.getElementById('ag-avoid-first-lab').checked;

  if (!subjects.length) { dbtoast('Add at least one subject to generate timetable', 'error'); return; }

  const classId = S.sectionId || S.classId;
  if (!classId && targetScope === 'section') {
    dbtoast('Please load a class/section first', 'error');
    return;
  }

  const btn = document.getElementById('btn-gen');
  const orgText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></span> Generating…';
  btn.disabled = true;

  const log = document.getElementById('conflict-log');
  log.style.display = 'block';
  log.innerHTML = `<span class="ok">⚡ Running Auto-Gen Engine (${targetScope === 'year' ? 'All Year Sections' : 'Current Section'})…</span>`;

  try {
    const payload = {
      deptId: S.deptId,
      year,
      targetScope,
      classId,
      hall,
      labHall,
      workingDays,
      maxTeacherHoursPerDay,
      labDuration,
      avoidFirstPeriodLab,
      subjects
    };

    const res = await API.autoGenTT(payload);

    if (res.success) {
      if (res.slots && Object.keys(res.slots).length) {
        S.tt = res.slots;
        buildTTTable(classId);
        buildSummary();
      }
      log.innerHTML += `<br><span class="ok">✓ ${res.message || 'Auto-generated successfully!'}</span>`;
      dbtoast(`⚡ ${res.message || 'Auto-generated timetables stored as drafts'}`, 'success');
      setTimeout(() => closeModal('modal-ag'), 1500);
    } else {
      log.innerHTML += `<br><span class="err">✗ ${res.error || 'Auto-generation failed'}</span>`;
      dbtoast(res.error || 'Auto-generation failed', 'error');
    }
  } catch (err) {
    log.innerHTML += `<br><span class="err">✗ Error: ${err.message}</span>`;
    dbtoast('Network error during auto-generation', 'error');
  } finally {
    btn.innerHTML = orgText;
    btn.disabled = false;
  }
}
window.executeAutoGen = executeAutoGen;

// ── PLAN 3: REUSABLE TIMETABLE TEMPLATES (FEATURE 9) ──

async function openTemplatesModal() {
  openModal('modal-templates');
  await loadTemplates();
}
window.openTemplatesModal = openTemplatesModal;

async function loadTemplates() {
  const grid = document.getElementById('template-grid');
  grid.innerHTML = '<div class="state-sc" style="grid-column:1/-1;"><div class="state-s">Loading institutional templates…</div></div>';
  try {
    S.templates = await API.getTemplates(S.deptId);
    renderTemplatesGrid();
  } catch (e) {
    grid.innerHTML = `<div class="state-sc" style="grid-column:1/-1;"><div class="state-s">Failed to load templates: ${e.message}</div></div>`;
  }
}

function filterTemplates(type) {
  S.activeTemplateFilter = type;
  document.getElementById('tpl-tab-all').classList.toggle('active', type === 'all');
  document.getElementById('tpl-tab-sys').classList.toggle('active', type === 'system');
  document.getElementById('tpl-tab-cust').classList.toggle('active', type === 'custom');
  renderTemplatesGrid();
}
window.filterTemplates = filterTemplates;

function renderTemplatesGrid() {
  const grid = document.getElementById('template-grid');
  let list = S.templates || [];
  if (S.activeTemplateFilter === 'system') list = list.filter(t => t.isSystem);
  if (S.activeTemplateFilter === 'custom') list = list.filter(t => !t.isSystem);

  if (!list.length) {
    grid.innerHTML = `
      <div class="state-sc" style="grid-column:1/-1;">
        <div class="state-icon">📑</div>
        <div class="state-t">No Templates Found</div>
        <div class="state-s">No ${S.activeTemplateFilter} templates available. You can save your current draft as a new template.</div>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(t => `
    <div class="template-card">
      <div>
        <div class="tpl-hd">
          <div class="tpl-name">${e(t.name)}</div>
          <span class="tpl-badge" style="${t.isSystem ? 'background:#e0f2fe;color:#0369a1;' : 'background:#fef3c7;color:#92400e;'}">
            ${t.isSystem ? '🏛 Institutional' : '🏢 Dept Custom'}
          </span>
        </div>
        <div class="tpl-desc">${e(t.description || 'Pre-configured institutional timetable blueprint.')}</div>
        <div class="tpl-badges">
          <span class="tpl-badge">⏱ ${t.timingSetCode === 'SET_2' ? 'Set 2 (Break after P3)' : 'Set 1 (Break after P2)'}</span>
          <span class="tpl-badge">📅 ${t.workingDays?.length || 5} Working Days</span>
          <span class="tpl-badge">⚡ Lab: ${t.defaultLabDuration || 3} Cont. Periods</span>
          <span class="tpl-badge">👤 Max Load: ${t.rules?.maxTeacherPeriodsPerDay || 4} P/Day</span>
        </div>
      </div>
      <div class="tpl-acts">
        <button class="btn btn-primary btn-sm" style="font-size:11px;" onclick="applyTemplateToAutoGen('${t._id}')">⚡ Use in Auto-Gen</button>
        <button class="btn btn-ghost btn-sm" style="font-size:11px;" onclick="applyTemplateToDraft('${t._id}')">📋 Apply to Draft</button>
        ${!t.isSystem ? `<button class="btn btn-danger btn-sm" style="font-size:11px;padding:4px 8px;" onclick="deleteCustomTemplate('${t._id}')" title="Delete Template">🗑</button>` : ''}
      </div>
    </div>
  `).join('');
}

function applyTemplateToAutoGen(templateId) {
  closeModal('modal-templates');
  openAutoGen().then(() => {
    const sel = document.getElementById('ag-template-select');
    if (sel) {
      sel.value = templateId;
      onAgTemplateSelectChange();
    }
  });
}
window.applyTemplateToAutoGen = applyTemplateToAutoGen;

async function applyTemplateToDraft(templateId) {
  const tpl = S.templates.find(t => t._id === templateId);
  if (!tpl) return;
  const classId = S.sectionId || S.classId;
  if (!classId) { dbtoast('Please select a class first', 'warn'); return; }

  // Set active timing set
  if (tpl.timingSetCode) {
    S.activeTimingSet = {
      code: tpl.timingSetCode,
      name: tpl.timingSetCode === 'SET_2' ? 'Timing Set 2 (Years II & III)' : 'Timing Set 1 (Years I & IV)'
    };
    const badge = document.getElementById('tt-timing-badge');
    if (badge) badge.textContent = `⏱ ${S.activeTimingSet.name}`;
  }

  closeModal('modal-templates');
  buildTTTable(classId);
  dbtoast(`Applied structure from "${tpl.name}" to workspace ✓`, 'success');
}
window.applyTemplateToDraft = applyTemplateToDraft;

function openSaveTemplateModal() {
  document.getElementById('new-tpl-name').value = `${S.className || 'Department'} Template`;
  document.getElementById('new-tpl-desc').value = `Custom timetable structure for ${S.deptName}.`;
  openModal('modal-save-template');
}
window.openSaveTemplateModal = openSaveTemplateModal;

async function executeSaveTemplate() {
  const name = document.getElementById('new-tpl-name').value.trim();
  const description = document.getElementById('new-tpl-desc').value.trim();
  const timingSetCode = document.getElementById('new-tpl-timingset').value;
  const defaultLabDuration = parseInt(document.getElementById('new-tpl-lab-span').value, 10) || 3;

  if (!name) { dbtoast('Please enter a template name', 'error'); return; }

  try {
    const res = await API.saveTemplate({
      name,
      description,
      timingSetCode,
      defaultLabDuration,
      applicableYears: [S.currentClassYear || '1'],
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      periodsPerDay: 9,
      deptId: S.deptId,
      deptName: S.deptName,
      rules: {
        maxTheoryPerDay: 2,
        maxLabPerDay: 1,
        maxTeacherPeriodsPerDay: 4,
        avoidFirstPeriodLab: true
      }
    });

    if (res._id) {
      dbtoast('Saved custom template to MongoDB ✓', 'success');
      closeModal('modal-save-template');
      await loadTemplates();
    } else {
      dbtoast(res.error || 'Failed to save template', 'error');
    }
  } catch (e) {
    dbtoast('Network error saving template', 'error');
  }
}
window.executeSaveTemplate = executeSaveTemplate;

async function deleteCustomTemplate(templateId) {
  if (!confirm('Are you sure you want to delete this custom template?')) return;
  const res = await API.deleteTemplate(templateId);
  if (res.success) {
    dbtoast('Template deleted ✓', 'success');
    await loadTemplates();
  } else {
    dbtoast(res.error || 'Failed to delete template', 'error');
  }
}
window.deleteCustomTemplate = deleteCustomTemplate;

// ── PLAN 3: DRAG & DROP EDITOR ENGINE (FEATURE 10) ──

function handleDragStart(event, key, day, pNum, span) {
  if (!CAN_EDIT || S.mode !== 'development') return;
  const slot = S.tt[key];
  if (!slot) return;

  S.dragSource = {
    key,
    day,
    period: Number(pNum),
    span: Number(span) || 1,
    slot: JSON.parse(JSON.stringify(slot))
  };

  event.dataTransfer.setData('text/plain', key);
  event.dataTransfer.effectAllowed = 'move';

  // Visual feedback
  const el = event.currentTarget;
  if (el) el.classList.add('dragging');
}
window.handleDragStart = handleDragStart;

function handleDragOver(event, key) {
  if (!CAN_EDIT || S.mode !== 'development' || !S.dragSource) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const td = event.currentTarget;
  if (td && !td.classList.contains('drag-over')) {
    td.classList.add('drag-over');
  }
}
window.handleDragOver = handleDragOver;

function handleDragLeave(event, key) {
  const td = event.currentTarget;
  if (td) td.classList.remove('drag-over');
}
window.handleDragLeave = handleDragLeave;

function handleDragEnd(event) {
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
}
window.handleDragEnd = handleDragEnd;

async function handleDrop(event, targetKey, targetDay, targetPNum) {
  event.preventDefault();
  handleDragEnd(event);

  if (!CAN_EDIT || S.mode !== 'development' || !S.dragSource) return;
  if (S.dragSource.key === targetKey) return; // Dropped on self

  const sourceKey = S.dragSource.key;
  const sourceSlot = S.dragSource.slot;
  const targetSlot = S.tt[targetKey] || null;
  const span = Number(sourceSlot.span) || 1;

  // Real-time conflict checking before completing drag
  const checkRes = await API.checkConflict({
    day: targetDay,
    periodNumber: targetPNum,
    teacherName: sourceSlot.staff,
    hallNo: sourceSlot.hall,
    span: span,
    classId: S.classId,
    excludeDraftId: S.draftDoc?._id
  });

  const conflicts = checkRes.conflicts || [];
  const criticalConflicts = conflicts.filter(c => c.severity === 'critical');

  if (criticalConflicts.length > 0) {
    // Collision detected! Open Collision Resolution Modal
    S.pendingDragConflict = {
      sourceKey,
      targetKey,
      targetDay,
      targetPNum,
      sourceSlot,
      targetSlot,
      conflicts: criticalConflicts
    };

    const detailsEl = document.getElementById('drag-conflict-details');
    detailsEl.innerHTML = `
      <strong>⚠️ Collision detected while moving "${e(sourceSlot.subject)}":</strong><br>
      ${criticalConflicts.map(c => `• ${e(c.message)}`).join('<br>')}
    `;
    openModal('modal-drag-conflict');
    return;
  }

  // No collisions: execute Move or Swap directly
  executeDropCommit(sourceKey, targetKey, sourceSlot, targetSlot, targetDay, targetPNum);
}
window.handleDrop = handleDrop;

function executeDropCommit(sourceKey, targetKey, sourceSlot, targetSlot, targetDay, targetPNum) {
  if (targetSlot) {
    // Swap two slots
    S.tt[targetKey] = sourceSlot;
    S.tt[sourceKey] = targetSlot;
    dbtoast(`🔀 Swapped ${sourceSlot.subject} ↔ ${targetSlot.subject} ✓`, 'success');
  } else {
    // Move into empty slot
    S.tt[targetKey] = sourceSlot;
    delete S.tt[sourceKey];
    dbtoast(`Moved ${sourceSlot.subject} to ${targetDay} P${targetPNum} ✓`, 'success');
  }

  S.dragSource = null;
  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  buildSummary();
  if (S.mode === 'development') {
    API.saveDraft(classId, S.tt);
  }
  setTimeout(() => {
    const targetTd = document.querySelector(`[ondrop*="${targetKey}"] .tt-cell`);
    if (targetTd) {
      targetTd.classList.add('just-moved');
      setTimeout(() => targetTd.classList.remove('just-moved'), 420);
    }
  }, 40);
}

function cancelDragOperation() {
  S.pendingDragConflict = null;
  S.dragSource = null;
  closeModal('modal-drag-conflict');
  dbtoast('Drag operation cancelled', 'info');
}
window.cancelDragOperation = cancelDragOperation;

function confirmDragMoveAnyway() {
  if (!S.pendingDragConflict) return;
  const { sourceKey, targetKey, sourceSlot, targetSlot, targetDay, targetPNum } = S.pendingDragConflict;
  closeModal('modal-drag-conflict');

  executeDropCommit(sourceKey, targetKey, sourceSlot, targetSlot, targetDay, targetPNum);
  S.conflicts.push({
    slotKey: targetKey,
    message: 'Forced placement with collision'
  });
  S.pendingDragConflict = null;
  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  dbtoast('Moved with conflict flagged ⚠️', 'warn');
}
window.confirmDragMoveAnyway = confirmDragMoveAnyway;

async function autoFixDragConflict() {
  if (!S.pendingDragConflict) return;
  const { sourceKey, sourceSlot } = S.pendingDragConflict;
  closeModal('modal-drag-conflict');

  const workPeriods = PERIODS.filter(p => !p.isBreak);
  let fixedKey = null;
  let fixedDay = null;
  let fixedP = null;

  for (const day of DAYS) {
    for (const p of workPeriods) {
      const k = `${day}-${p.id}`;
      if (!S.tt[k]) {
        const res = await API.checkConflict({
          day,
          periodNumber: p.id,
          teacherName: sourceSlot.staff,
          hallNo: sourceSlot.hall,
          span: Number(sourceSlot.span) || 1,
          classId: S.classId,
          excludeDraftId: S.draftDoc?._id
        });
        if (!res.conflicts || res.conflicts.length === 0) {
          fixedKey = k;
          fixedDay = day;
          fixedP = p.id;
          break;
        }
      }
    }
    if (fixedKey) break;
  }

  if (fixedKey) {
    S.tt[fixedKey] = sourceSlot;
    delete S.tt[sourceKey];
    S.pendingDragConflict = null;
    const classId = S.sectionId || S.classId;
    buildTTTable(classId);
    buildSummary();
    if (S.mode === 'development') {
      API.saveDraft(classId, S.tt);
    }
    dbtoast(`⚡ Auto-fixed! Placed ${sourceSlot.subject} in ${fixedDay} P${fixedP} ✓`, 'success');
  } else {
    dbtoast('No conflict-free slots found for auto-fix', 'error');
  }
}
window.autoFixDragConflict = autoFixDragConflict;

// ── PLAN 3: CONTINUOUS PERIOD RESIZE & CLIPBOARD ──

function adjustSlotSpan(key, delta, event) {
  if (event) event.stopPropagation();
  const slot = S.tt[key];
  if (!slot) return;
  const currentSpan = Number(slot.span) || 1;
  const newSpan = Math.max(1, Math.min(4, currentSpan + delta));
  if (newSpan === currentSpan) return;

  slot.span = newSpan;
  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  buildSummary();
  if (S.mode === 'development') {
    API.saveDraft(classId, S.tt);
  }
  dbtoast(`Adjusted period span to ${newSpan} continuous periods ✓`, 'info');
}
window.adjustSlotSpan = adjustSlotSpan;

function copySlotToClipboard(key, event) {
  if (event) event.stopPropagation();
  const slot = S.tt[key];
  if (!slot) return;
  S.clipboardSlot = JSON.parse(JSON.stringify(slot));
  dbtoast(`Copied "${slot.subject}" to clipboard (Click empty cell or Ctrl+V to paste) 📋`, 'info');
}
window.copySlotToClipboard = copySlotToClipboard;

function pasteSlotFromClipboard(targetKey) {
  if (!S.clipboardSlot) { dbtoast('Clipboard is empty', 'warn'); return; }
  S.tt[targetKey] = JSON.parse(JSON.stringify(S.clipboardSlot));
  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  buildSummary();
  if (S.mode === 'development') {
    API.saveDraft(classId, S.tt);
  }
  dbtoast(`Pasted "${S.clipboardSlot.subject}" ✓`, 'success');
}
window.pasteSlotFromClipboard = pasteSlotFromClipboard;

// Global Keyboard Shortcuts (Ctrl+C / Ctrl+V)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (S.activeCellKey && S.tt[S.activeCellKey]) {
      copySlotToClipboard(S.activeCellKey);
      e.preventDefault();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    if (S.activeCellKey && S.clipboardSlot && CAN_EDIT && S.mode === 'development') {
      pasteSlotFromClipboard(S.activeCellKey);
      e.preventDefault();
    }
  }
});

// ── PLAN 3: DAY DUPLICATION ──

function openDuplicateDayModal(sourceDay) {
  document.getElementById('dup-source-day').value = sourceDay;
  const targetDaySel = document.getElementById('dup-target-day');
  const otherDay = DAYS.find(d => d !== sourceDay) || 'Tuesday';
  targetDaySel.value = otherDay;
  openModal('modal-duplicate-day');
}
window.openDuplicateDayModal = openDuplicateDayModal;

function executeDuplicateDay() {
  const sourceDay = document.getElementById('dup-source-day').value;
  const targetDay = document.getElementById('dup-target-day').value;
  const isOverwrite = document.querySelector('input[name="dup-mode"]:checked')?.value === 'overwrite';

  if (sourceDay === targetDay) {
    dbtoast('Source and target day cannot be identical', 'warn');
    return;
  }

  let copyCount = 0;
  PERIODS.filter(p => !p.isBreak).forEach(p => {
    const sKey = `${sourceDay}-${p.id}`;
    const tKey = `${targetDay}-${p.id}`;
    const srcSlot = S.tt[sKey];

    if (srcSlot) {
      if (isOverwrite || !S.tt[tKey]) {
        S.tt[tKey] = JSON.parse(JSON.stringify(srcSlot));
        copyCount++;
      }
    } else if (isOverwrite) {
      delete S.tt[tKey];
    }
  });

  closeModal('modal-duplicate-day');
  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  buildSummary();
  if (S.mode === 'development') {
    API.saveDraft(classId, S.tt);
  }
  dbtoast(`Duplicated ${copyCount} periods from ${sourceDay} to ${targetDay} ✓`, 'success');
}
window.executeDuplicateDay = executeDuplicateDay;

// EXPORT
function exportCSV() {
  let csv = 'Day,' + PERIODS.filter(p => !p.isBreak).map(p => `${p.label} (${p.time})`).join(',') + '\n';
  DAYS.forEach(day => {
    csv += day;
    PERIODS.forEach(p => {
      if (p.isBreak) return;
      const c = S.tt[`${day}-${p.id}`];
      csv += ',' + (c?.subject ? `"${c.subject}|${c.staff || ''}"` : '');
    });
    csv += '\n';
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `TT_${S.deptCode}_${S.className}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  dbtoast('Exported as CSV', 'info');
}

function goBack() {
  S.deptId = null; S.deptName = null; S.deptCode = null;
  S.classId = null; S.sectionId = null; S.tt = {};
  updateCanEdit();
  populateDeptDropdown();
  renderDeptGrid(S.depts);
  showView('view-dept');
}
window.goBack = goBack;

function showView(id) {
  ['view-dept', 'view-tt'].forEach(v => {
    const el = document.getElementById(v);
    if (!el) return;
    el.classList.toggle('hidden', v !== id);
    if (v === id) { el.classList.remove('hidden'); el.classList.add('fade-in'); }
  });
}

// UNIFIED TOAST (wraps global js/core/toast.js dbToast and showToast)
function dbtoast(msg, type = 'info', ms = 3500) {
  if (typeof dbToast === 'function') {
    dbToast(msg, type);
  } else if (typeof showToast === 'function') {
    showToast(msg, type);
  } else {
    console.log(`[Toast ${type}]`, msg);
  }
}
function toast(msg, type = 'info') {
  if (typeof showToast === 'function') showToast(msg, type);
  else dbtoast(msg, type);
}

// API LAYER
const API = {
  async getMyAssignments() {
    try {
      const r = await fetch(`${API_BASE}/assignments`, { headers: ah() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  async getAllClasses() {
    try {
      const r = await fetch(`${API_BASE}/classes`, { headers: ah() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  async getDepts() {
    try {
      const r = await fetch(`${API_BASE}/departments`, { headers: ah() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  async getClasses(deptId) {
    try {
      const url = deptId ? `${API_BASE}/classes?deptId=${deptId}` : `${API_BASE}/classes`;
      const r = await fetch(url, { headers: ah() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  async getSubjects(deptId) {
    try {
      const url = deptId ? `${API_BASE}/subjects?deptId=${deptId}` : `${API_BASE}/subjects`;
      const r = await fetch(url, { headers: ah() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  async getTimetable(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/section/${classId}`, {
        headers: ah(), cache: 'no-store'
      });
      if (!r.ok) throw 0;
      const d = await r.json();
      const slots = d.slots || (typeof d === 'object' && !Array.isArray(d) ? d : {});
      if (Object.keys(slots).length > 0) return slots;
      throw 0;
    } catch {
      try {
        const r = await fetch(`${API_BASE}/timetable?classId=${classId}`, {
          headers: ah(), cache: 'no-store'
        });
        if (!r.ok) throw 0;
        const payload = await r.json();
        const slots = Array.isArray(payload) ? payload : (payload.slots || []);
        if (!Array.isArray(slots)) return slots;
        const map = {};
        const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
        slots.forEach(sl => {
          const day = dayMap[sl.day] || sl.day;
          const per = PERIODS.find(p => p.time && p.time.replace('–', '-') === `${sl.start}-${sl.end}`);
          const pid = per ? per.id : sl.start;
          map[`${day}-${pid}`] = {
            subject: sl.subjectName || sl.subject,
            staff: sl.teacherName || sl.staff || '',
            hall: sl.hall || sl.room || '',
            code: sl.subjectCode || sl.code || '',
            credit: sl.credit || sl.credits || null,
            type: sl.type || 'theory',
            subjectId: sl.subjectId || null,
          };
        });
        return map;
      } catch { return {}; }
    }
  },
  async updateCell(classId, slotKey, payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/section/${classId}/slot`, {
        method: 'PUT', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotKey, payload,
          _meta: { coordDeptId: S.coordDeptId, coordIsService: S.coordIsService, ttDeptName: TT_DEPT }
        }),
      });
      return r.ok;
    } catch { return false; }
  },
  async saveTimetable(classId, slots) {
    try {
      const r = await fetch(`${API_BASE}/timetable/section/${classId}`, {
        method: 'PUT', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots,
          _meta: { coordDeptId: S.coordDeptId, coordIsService: S.coordIsService, ttDeptName: TT_DEPT }
        }),
      });
      return r.ok;
    } catch { return false; }
  },
  async getDraft(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}`, { headers: ah() });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  },
  async updateDraftSlot(classId, slotKey, payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}/slot`, {
        method: 'PUT',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotKey, payload })
      });
      return await r.json();
    } catch { return { hasConflict: false }; }
  },
  async saveDraft(classId, slots, classMeta = null) {
    try {
      const payload = { slots };
      const meta = classMeta || S.draftDoc?.classMeta;
      if (meta) payload.classMeta = meta;
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}`, {
        method: 'PUT',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return r.ok;
    } catch { return false; }
  },
  async discardDraft(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}`, {
        method: 'DELETE',
        headers: ah()
      });
      return r.ok;
    } catch { return false; }
  },
  async validateDraft(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/validate`, {
        method: 'POST',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId })
      });
      return await r.json();
    } catch { return { valid: false, conflicts: [] }; }
  },
  async submitForHodApproval(classId, note) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}/submit-approval`, {
        method: 'POST',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      return await r.json();
    } catch { return { success: false, error: 'Network error' }; }
  },
  async getPendingHodDrafts() {
    try {
      const r = await fetch(`${API_BASE}/timetable/drafts/pending-hod`, { headers: ah() });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  },
  async hodApprove(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}/hod-approve`, {
        method: 'POST',
        headers: ah()
      });
      return await r.json();
    } catch { return { success: false, error: 'Network error' }; }
  },
  async hodReject(classId, remarks) {
    try {
      const r = await fetch(`${API_BASE}/timetable/draft/${classId}/hod-reject`, {
        method: 'POST',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks })
      });
      return await r.json();
    } catch { return { success: false, error: 'Network error' }; }
  },
  async getVersions() {
    try {
      const r = await fetch(`${API_BASE}/timetable/versions`, { headers: ah() });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  },
  async getBackups(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/backups/${classId}`, { headers: ah() });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  },
  async restoreBackup(backupId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/restore/${backupId}`, {
        method: 'POST',
        headers: ah()
      });
      return await r.json();
    } catch { return { success: false }; }
  },
  async checkInlineConflict(day, periodNumber, teacherName, trackId, hallNo, draftId) {
    try {
      const params = new URLSearchParams({
        day: day || '',
        periodNumber: periodNumber || '',
        teacherName: teacherName || '',
        trackId: trackId || '',
        hallNo: hallNo || '',
        draftId: draftId || ''
      });
      const r = await fetch(`${API_BASE}/timetable/conflicts/check?${params.toString()}`, { headers: ah() });
      return await r.json();
    } catch { return { conflicts: [], hasConflict: false }; }
  },
  async getStudentProfile() {
    try {
      const r = await fetch(`${API_BASE}/profile/me`, { headers: ah() });
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  },
  async checkConflicts(deptId, year, subjects) {
    try {
      const r = await fetch(`${API_BASE}/timetable/check-conflicts`, {
        method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ deptId, year, subjects }),
      });
      return await r.json();
    } catch {
      return subjects.map(s => ({ ok: true, message: `${s.name} — ${s.staff || 'TBA'} is available (${s.hours} hrs/wk)` }));
    }
  },
  async autoGenTT(payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/auto-gen`, {
        method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    } catch { return { success: true }; }
  },
  async getTimingSets() {
    try {
      const r = await fetch(`${API_BASE}/timetable/timing-sets`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async getClassTimingSet(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/timing-sets/class/${classId}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async getRooms(filter = {}) {
    try {
      const qs = new URLSearchParams(filter).toString();
      const r = await fetch(`${API_BASE}/timetable/rooms?${qs}`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async getRoomAvailability(params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const r = await fetch(`${API_BASE}/timetable/rooms/availability?${qs}`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async checkConflict(payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/check-conflict`, {
        method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    } catch { return { success: false, conflicts: [] }; }
  },
  async getTemplates(deptId = null) {
    try {
      const qs = deptId ? `?deptId=${encodeURIComponent(deptId)}` : '';
      const r = await fetch(`${API_BASE}/timetable/templates${qs}`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async getTemplate(id) {
    try {
      const r = await fetch(`${API_BASE}/timetable/templates/${id}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async saveTemplate(payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/templates`, {
        method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async deleteTemplate(id) {
    try {
      const r = await fetch(`${API_BASE}/timetable/templates/${id}`, {
        method: 'DELETE', headers: ah()
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async generateWeeks(payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/weeks/generate`, {
        method: 'POST',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async getWeeks(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/weeks/${classId}`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async getWeek(weekId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/week/${weekId}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async saveWeek(weekId, slots) {
    try {
      const r = await fetch(`${API_BASE}/timetable/week/${weekId}`, {
        method: 'PUT',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots })
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async publishWeek(weekId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/week/${weekId}/publish`, {
        method: 'POST',
        headers: ah()
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async getDayOverride(classId, date) {
    try {
      const r = await fetch(`${API_BASE}/timetable/override/${classId}/${date}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async saveDayOverride(classId, date, payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/override/${classId}/${date}`, {
        method: 'PUT',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async deleteDayOverride(classId, date) {
    try {
      const r = await fetch(`${API_BASE}/timetable/override/${classId}/${date}`, {
        method: 'DELETE',
        headers: ah()
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },
  async resolveDailySchedule(classId, date) {
    try {
      const r = await fetch(`${API_BASE}/timetable/resolve/${classId}/${date}`, { headers: ah() });
      return r.ok ? await r.json() : { slots: {}, isHoliday: false, source: 'error' };
    } catch (e) { return { slots: {}, isHoliday: false, source: 'error' }; }
  },
  async getTeacherWorkloadReport(deptId) {
    try {
      const qs = deptId && deptId !== 'all' ? `?deptId=${encodeURIComponent(deptId)}` : '';
      const r = await fetch(`${API_BASE}/timetable/reports/teacher-workload${qs}`, { headers: ah() });
      return r.ok ? await r.json() : { teachers: [], averagePeriodsPerTeacher: 0 };
    } catch { return { teachers: [], averagePeriodsPerTeacher: 0 }; }
  },
  async getRoomUtilizationReport() {
    try {
      const r = await fetch(`${API_BASE}/timetable/reports/room-utilization`, { headers: ah() });
      return r.ok ? await r.json() : { rooms: [] };
    } catch { return { rooms: [] }; }
  },
  async getSubjectDistributionReport(deptId) {
    try {
      const qs = deptId && deptId !== 'all' ? `?deptId=${encodeURIComponent(deptId)}` : '';
      const r = await fetch(`${API_BASE}/timetable/reports/subject-distribution${qs}`, { headers: ah() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  async getAcademicCalendarStats(classId) {
    try {
      const qs = classId ? `?classId=${encodeURIComponent(classId)}` : '';
      const r = await fetch(`${API_BASE}/timetable/academic-calendar-stats${qs}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async getPublishPreview(classId) {
    try {
      const r = await fetch(`${API_BASE}/timetable/publish-preview/${encodeURIComponent(classId)}`, { headers: ah() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async publishWithNotifications(classId, payload) {
    try {
      const r = await fetch(`${API_BASE}/timetable/publish-with-notify/${encodeURIComponent(classId)}`, {
        method: 'POST',
        headers: { ...ah(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await r.json();
    } catch (e) { return { error: e.message }; }
  }
};

function ah() { return { 'Authorization': `Bearer ${SESSION.token || ''}` }; }

// UTIL
function e(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Navigate back to the portal that opened this page
function goHome() {
  const isTeacherWithAdmin = IS_TEACHER && SESSION.isAdmin;
  const href = isTeacherWithAdmin ? 'selector.html'
    : IS_ADMIN ? 'admin.html'
      : IS_STUDENT ? 'student.html'
        : 'teacher.html';
  location.href = href;
}

// ── THREE-TIER STORAGE & TIMETABLE HIERARCHY (FEATURE 13) ──

async function switchTTTier(tier) {
  S.tier = tier;
  const masterBtn = document.getElementById('btn-tier-master');
  const weekBtn = document.getElementById('btn-tier-week');
  const dayBtn = document.getElementById('btn-tier-day');
  if (masterBtn) masterBtn.classList.toggle('active', tier === 'master');
  if (weekBtn) weekBtn.classList.toggle('active', tier === 'week');
  if (dayBtn) dayBtn.classList.toggle('active', tier === 'day');

  const btnGenWeeks = document.getElementById('btn-open-gen-weeks');
  const btnDayOverride = document.getElementById('btn-open-day-override');
  const weekStrip = document.getElementById('tt-week-strip');

  if (tier === 'master') {
    if (btnGenWeeks) btnGenWeeks.style.display = CAN_EDIT ? 'inline-flex' : 'none';
    if (btnDayOverride) btnDayOverride.style.display = 'none';
    if (weekStrip) weekStrip.classList.add('hidden');
    loadTT();
  } else if (tier === 'week') {
    if (btnGenWeeks) btnGenWeeks.style.display = CAN_EDIT ? 'inline-flex' : 'none';
    if (btnDayOverride) btnDayOverride.style.display = 'none';
    if (weekStrip) weekStrip.classList.remove('hidden');
    await loadAcademicWeeks();
  } else if (tier === 'day') {
    if (btnGenWeeks) btnGenWeeks.style.display = 'none';
    if (btnDayOverride) btnDayOverride.style.display = CAN_EDIT ? 'inline-flex' : 'none';
    if (weekStrip) weekStrip.classList.add('hidden');
    await loadDayOverrideView();
  }
}
window.switchTTTier = switchTTTier;

// TIER 2: Academic Weeks
async function loadAcademicWeeks() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;

  const weekStrip = document.getElementById('tt-week-strip');
  weekStrip.innerHTML = `<div style="font-size:11.5px;color:var(--tmu);padding:6px 12px;">Loading academic weeks…</div>`;

  const weeks = await API.getWeeks(classId);
  S.weeks = weeks || [];

  if (!S.weeks.length) {
    weekStrip.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:12px;color:var(--tmu);">
        <span>No academic weeks generated yet for ${e(S.className || 'this class')}.</span>
        ${CAN_EDIT ? `<button class="btn btn-xs btn-primary" onclick="openGenerateWeeksModal()">📅 Generate 16 Academic Weeks</button>` : ''}
      </div>
    `;
    return;
  }

  // Render week pills
  weekStrip.innerHTML = S.weeks.map(w => `
    <div class="week-pill ${S.selectedWeekId === w._id ? 'active' : ''}" onclick="selectAcademicWeek('${w._id}')">
      <div>Week ${w.weekNumber}</div>
      <div class="week-pill-status">${w.status}</div>
    </div>
  `).join('');

  if (!S.selectedWeekId && S.weeks.length) {
    await selectAcademicWeek(S.weeks[0]._id);
  } else if (S.selectedWeekId) {
    await selectAcademicWeek(S.selectedWeekId);
  }
}
window.loadAcademicWeeks = loadAcademicWeeks;

async function selectAcademicWeek(weekId) {
  S.selectedWeekId = weekId;
  const week = S.weeks.find(w => w._id === weekId);
  if (!week) return;

  // Update pills active class
  document.querySelectorAll('.week-pill').forEach(el => el.classList.remove('active'));
  const activePill = Array.from(document.querySelectorAll('.week-pill')).find(el => el.textContent.includes(`Week ${week.weekNumber}`));
  if (activePill) activePill.classList.add('active');

  S.tt = week.slots || {};
  document.getElementById('tt-card-title').textContent = `${S.className} — Week ${week.weekNumber} Instance`;
  document.getElementById('tt-card-sub').textContent = `Academic Week: ${week.startDate} to ${week.endDate} · Status: ${week.status}`;

  const classId = S.sectionId || S.classId;
  buildTTTable(classId);
  buildSummary();

  // Custom week actions
  const el = document.getElementById('tt-card-acts');
  if (el && CAN_EDIT) {
    el.innerHTML = `
      <button class="btn btn-white btn-sm" onclick="saveCurrentWeek()">💾 Save Week ${week.weekNumber}</button>
      <button class="btn btn-primary btn-sm" onclick="publishCurrentWeek()">🚀 Publish Week</button>
    `;
  }
}
window.selectAcademicWeek = selectAcademicWeek;

async function saveCurrentWeek() {
  if (!S.selectedWeekId) return;
  const res = await API.saveWeek(S.selectedWeekId, S.tt);
  if (res?.success) {
    dbtoast('Academic Week slots saved ✓', 'success');
    await loadAcademicWeeks();
  } else {
    dbtoast('Failed to save academic week', 'error');
  }
}
window.saveCurrentWeek = saveCurrentWeek;

async function publishCurrentWeek() {
  if (!S.selectedWeekId) return;
  const res = await API.publishWeek(S.selectedWeekId);
  if (res?.success) {
    dbtoast('Academic Week published to live schedule ✓', 'success');
    await loadAcademicWeeks();
  } else {
    dbtoast(res?.error || 'Failed to publish academic week', 'error');
  }
}
window.publishCurrentWeek = publishCurrentWeek;

function openGenerateWeeksModal() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('gen-weeks-start-date').value = today;
  openModal('modal-generate-weeks');
}
window.openGenerateWeeksModal = openGenerateWeeksModal;

async function executeGenerateWeeks() {
  const startDate = document.getElementById('gen-weeks-start-date').value;
  const count = parseInt(document.getElementById('gen-weeks-count').value, 10) || 16;
  const classId = S.sectionId || S.classId;

  if (!startDate) { dbtoast('Select start date', 'error'); return; }
  if (!classId) { dbtoast('Select class', 'error'); return; }

  const res = await API.generateWeeks({
    classId,
    startDate,
    numberOfWeeks: count
  });

  if (res?.success) {
    dbtoast(`Generated ${count} Academic Weeks from Master Template ✓`, 'success');
    closeModal('modal-generate-weeks');
    await switchTTTier('week');
  } else {
    dbtoast(res?.error || 'Failed to generate academic weeks', 'error');
  }
}
window.executeGenerateWeeks = executeGenerateWeeks;

// TIER 3: Day Overrides & Authoritative Daily Schedule
async function loadDayOverrideView() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;

  const targetDate = S.selectedDate || new Date().toISOString().slice(0, 10);
  S.selectedDate = targetDate;

  const resolved = await API.resolveDailySchedule(classId, targetDate);

  if (resolved.isHoliday) {
    S.tt = {};
    document.getElementById('tt-card-title').textContent = `${S.className} — ${resolved.dayFull}, ${targetDate}`;
    document.getElementById('tt-card-sub').textContent = `🎉 Institutional Holiday: ${resolved.holidayReason || 'Holiday'}`;
    const table = document.getElementById('tt-table');
    table.innerHTML = `
      <div style="text-align:center;padding:40px;background:#fef2f2;border-radius:12px;margin:12px;">
        <div style="font-size:32px;margin-bottom:8px;">🏖️</div>
        <div style="font-size:18px;font-weight:700;color:#991b1b;">Institutional Holiday</div>
        <div style="font-size:13px;color:#b91c1c;margin-top:4px;">${e(resolved.holidayReason || 'College Closed')}</div>
      </div>
    `;
    return;
  }

  S.tt = resolved.slots || {};
  document.getElementById('tt-card-title').textContent = `${S.className} — ${resolved.dayFull}, ${targetDate}`;
  document.getElementById('tt-card-sub').textContent =
    `Authoritative Schedule [Source: ${resolved.source.toUpperCase()}] · ${resolved.overrideDetails ? resolved.overrideDetails.overridesCount + ' Override(s) Active' : 'Inherited Schedule'}`;

  buildTTTable(classId);
  buildSummary();

  const el = document.getElementById('tt-card-acts');
  if (el && CAN_EDIT) {
    el.innerHTML = `
      <button class="btn btn-outline-white btn-sm" onclick="openDayOverrideModal()">⚡ New Day Override</button>
      <button class="btn btn-white btn-sm" onclick="promptChangeDate()">📅 Change Date (${targetDate})</button>
    `;
  }
}
window.loadDayOverrideView = loadDayOverrideView;

function promptChangeDate() {
  openDayOverrideModal();
}
window.promptChangeDate = promptChangeDate;

// DAY OVERRIDE MODAL ACTIONS
function openDayOverrideModal() {
  const dateInput = document.getElementById('override-date');
  if (!dateInput.value) {
    dateInput.value = S.selectedDate || new Date().toISOString().slice(0, 10);
  }
  onOverrideDateChange();
  onOverrideActionChange();
  openModal('modal-day-override');
}
window.openDayOverrideModal = openDayOverrideModal;

function onOverrideActionChange() {
  const act = document.getElementById('override-action').value;
  document.getElementById('override-fields-swap').style.display = act === 'swap' ? 'flex' : 'none';
  document.getElementById('override-fields-sub').style.display = act === 'substitute' ? 'block' : 'none';
  document.getElementById('override-fields-cancel').style.display = act === 'cancel' ? 'block' : 'none';
  document.getElementById('override-fields-holiday').style.display = act === 'holiday' ? 'block' : 'none';
}
window.onOverrideActionChange = onOverrideActionChange;

async function onOverrideDateChange() {
  const dateStr = document.getElementById('override-date').value;
  const classId = S.sectionId || S.classId;
  if (!dateStr || !classId) return;

  const targetDate = new Date(dateStr + 'T00:00:00Z');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayAbbr = dayNames[targetDate.getUTCDay()];
  const fullDayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday' };
  const dayFull = fullDayMap[dayAbbr] || 'Monday';

  document.getElementById('day-override-modal-sub').textContent = `Overrides for ${dayFull}, ${dateStr} (${S.className || 'Class'})`;

  // Populate periods for selection
  const activePeriods = getActivePeriods().filter(p => !p.isBreak);
  const pOptions = activePeriods.map(p => `<option value="${p.id}">${p.label} (${p.time})</option>`).join('');

  document.getElementById('override-swap-p1').innerHTML = pOptions;
  document.getElementById('override-swap-p2').innerHTML = pOptions;
  if (activePeriods.length > 1) document.getElementById('override-swap-p2').selectedIndex = 1;
  document.getElementById('override-sub-period').innerHTML = pOptions;
  document.getElementById('override-cancel-period').innerHTML = pOptions;

  // Fetch existing overrides
  const existing = await API.getDayOverride(classId, dateStr);
  const summaryEl = document.getElementById('existing-overrides-summary');
  const delBtn = document.getElementById('btn-delete-override');

  if (existing && (existing.isHoliday || (existing.overrides && existing.overrides.length > 0))) {
    delBtn.style.display = 'inline-block';
    let h = `<div style="background:var(--gP);padding:8px 12px;border-radius:8px;font-size:11px;"><strong>Existing Delta Overrides:</strong><ul style="margin:4px 0 0 16px;padding:0;">`;
    if (existing.isHoliday) {
      h += `<li>Holiday: ${e(existing.holidayReason || 'Institutional Holiday')}</li>`;
    }
    (existing.overrides || []).forEach(o => {
      h += `<li>Action: <strong>${o.action.toUpperCase()}</strong> (P${o.periodNumber}${o.swapWithPeriod ? ' ↔ P' + o.swapWithPeriod : ''}${o.substituteTeacherName ? ' → ' + o.substituteTeacherName : ''})</li>`;
    });
    h += `</ul></div>`;
    summaryEl.innerHTML = h;
  } else {
    delBtn.style.display = 'none';
    summaryEl.innerHTML = '';
  }
}
window.onOverrideDateChange = onOverrideDateChange;

async function executeSaveOverride() {
  const classId = S.sectionId || S.classId;
  const dateStr = document.getElementById('override-date').value;
  const act = document.getElementById('override-action').value;
  const note = document.getElementById('override-note').value.trim();

  if (!dateStr || !classId) {
    dbtoast('Target date and class are required', 'error');
    return;
  }

  const targetDate = new Date(dateStr + 'T00:00:00Z');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayAbbr = dayNames[targetDate.getUTCDay()];

  const existing = await API.getDayOverride(classId, dateStr);
  const currentOverrides = existing?.overrides || [];

  let isHoliday = false;
  let holidayReason = '';

  if (act === 'holiday') {
    isHoliday = true;
    holidayReason = document.getElementById('override-holiday-reason').value.trim() || 'Institutional Holiday';
  } else if (act === 'swap') {
    const p1 = Number(document.getElementById('override-swap-p1').value);
    const p2 = Number(document.getElementById('override-swap-p2').value);
    if (p1 === p2) {
      dbtoast('Cannot swap a period with itself', 'error');
      return;
    }
    currentOverrides.push({
      periodNumber: p1,
      action: 'swap',
      swapWithPeriod: p2,
      reason: note
    });
  } else if (act === 'substitute') {
    const p = Number(document.getElementById('override-sub-period').value);
    const subTeacher = document.getElementById('override-sub-teacher').value.trim();
    if (!subTeacher) {
      dbtoast('Substitute teacher name is required', 'error');
      return;
    }
    currentOverrides.push({
      periodNumber: p,
      action: 'substitute',
      substituteTeacherName: subTeacher,
      substituteTeacherId: subTeacher,
      reason: note
    });
  } else if (act === 'cancel') {
    const p = Number(document.getElementById('override-cancel-period').value);
    currentOverrides.push({
      periodNumber: p,
      action: 'cancel',
      reason: note || 'Period Cancelled'
    });
  }

  const res = await API.saveDayOverride(classId, dateStr, {
    day: dayAbbr,
    isHoliday,
    holidayReason,
    overrides: currentOverrides
  });

  if (res?.success) {
    dbtoast('Day override applied successfully ✓', 'success');
    closeModal('modal-day-override');
    S.selectedDate = dateStr;
    if (S.tier === 'day') {
      await loadDayOverrideView();
    }
  } else {
    dbtoast(res?.error || 'Failed to save day override', 'error');
  }
}
window.executeSaveOverride = executeSaveOverride;

async function executeDeleteOverride() {
  const classId = S.sectionId || S.classId;
  const dateStr = document.getElementById('override-date').value;
  if (!classId || !dateStr) return;

  const res = await API.deleteDayOverride(classId, dateStr);
  if (res?.success) {
    dbtoast('Day overrides removed. Schedule reverted to parent.', 'info');
    closeModal('modal-day-override');
    if (S.tier === 'day') {
      await loadDayOverrideView();
    }
  }
}
window.executeDeleteOverride = executeDeleteOverride;

// ── ROOM AVAILABILITY GRID (FEATURE 4) ──
let isPickingRoomForEdit = false;
async function openRoomAvailabilityModal(forEdit = false) {
  isPickingRoomForEdit = forEdit;
  openModal('modal-room-availability');

  const pSel = document.getElementById('room-avail-period');
  if (pSel && pSel.options.length === 0) {
    const activePeriods = getActivePeriods().filter(p => !p.isBreak);
    pSel.innerHTML = activePeriods.map(p => `<option value="${p.id}">${p.label} (${p.time})</option>`).join('');
  }

  if (S.activeCellKey && forEdit) {
    const parts = S.activeCellKey.split('-');
    const day = parts[0];
    const pNum = parts[1];
    const dayAbbrMap = { 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat' };
    const dSel = document.getElementById('room-avail-day');
    if (dSel) dSel.value = dayAbbrMap[day] || 'Mon';
    if (pSel) pSel.value = pNum;
  }

  await loadRoomAvailabilityGrid();
}
window.openRoomAvailabilityModal = openRoomAvailabilityModal;

async function loadRoomAvailabilityGrid() {
  const container = document.getElementById('room-grid-list');
  container.innerHTML = `<div class="state-sc" style="grid-column:1/-1;"><div class="state-s">Checking room availability…</div></div>`;

  const day = document.getElementById('room-avail-day').value;
  const pNum = document.getElementById('room-avail-period').value;
  const type = document.getElementById('room-avail-type').value;

  const activePeriods = getActivePeriods();
  const per = activePeriods.find(p => String(p.id) === String(pNum));
  const start = per?.start || '';
  const end = per?.end || '';

  const rooms = await API.getRoomAvailability({ day, periodNumber: pNum, start, end });
  const filtered = type ? rooms.filter(r => r.type === type) : rooms;

  if (!filtered.length) {
    container.innerHTML = `<div class="state-sc" style="grid-column:1/-1;"><div class="state-s">No rooms found</div></div>`;
    return;
  }

  const cls = S.classes.find(c => c._id === (S.sectionId || S.classId));
  const studentCount = cls?.studentCount || 60;

  container.innerHTML = filtered.map(r => {
    const isAvail = r.isAvailable;
    const occ = r.occupiedBy;
    const isLowCap = r.capacity < studentCount;

    return `
      <div class="room-card ${isAvail ? 'available' : 'occupied'}">
        <div class="room-card-hd">
          <div class="room-hall-no">${e(r.hallNo)}</div>
          <span class="room-status-badge ${isAvail ? 'room-status-avail' : 'room-status-occ'}">
            ${isAvail ? '● Available' : '● Occupied'}
          </span>
        </div>
        <div class="room-details">
          <div><strong>${e(r.name || r.type)}</strong> (${r.type})</div>
          <div>Capacity: <strong>${r.capacity} seats</strong></div>
          ${!isAvail && occ ? `
            <div style="margin-top:4px;color:#991b1b;">
              Occupied by: <strong>${e(occ.className || 'Class')}</strong><br>
              ${e(occ.subjectName || '')} (${e(occ.teacherName || '')})
            </div>
          ` : ''}
          ${isLowCap ? `<div class="room-cap-warn">⚠️ Capacity (${r.capacity}) &lt; Class Size (~${studentCount})</div>` : ''}
        </div>
        ${isPickingRoomForEdit && isAvail ? `
          <button class="btn btn-xs btn-primary" style="margin-top:8px;width:100%;" onclick="pickRoomForSlot('${e(r.hallNo)}')">Select Room</button>
        ` : ''}
      </div>
    `;
  }).join('');
}
window.loadRoomAvailabilityGrid = loadRoomAvailabilityGrid;

function pickRoomForSlot(hallNo) {
  const hallInput = document.getElementById('edit-hall');
  if (hallInput) {
    hallInput.value = hallNo;
    liveCheckConflict();
  }
  closeModal('modal-room-availability');
  dbtoast(`Assigned ${hallNo} to period`, 'success');
}
window.pickRoomForSlot = pickRoomForSlot;

// ── CONTINUOUS PERIODS SPLIT (FEATURE 4) ──
async function splitContinuousSlot(key) {
  if (!CAN_EDIT) return;
  const cell = S.tt[key];
  if (!cell) return;
  const orgSpan = Number(cell.span) || 1;
  if (orgSpan <= 1) return;

  const parts = key.split('-');
  const day = parts[0];
  const startP = parseInt(parts[1], 10);
  const classId = S.sectionId || S.classId;

  cell.span = 1;
  cell.type = 'Theory';
  const activePeriods = getActivePeriods();
  const timing = activePeriods.find(p => p.id === startP);
  if (timing) {
    cell.start = timing.start;
    cell.end = timing.end;
  }

  for (let i = 1; i < orgSpan; i++) {
    const nextP = startP + i;
    const nextKey = `${day}-${nextP}`;
    const nextTiming = activePeriods.find(p => p.id === nextP);
    S.tt[nextKey] = {
      ...JSON.parse(JSON.stringify(cell)),
      span: 1,
      start: nextTiming?.start || '',
      end: nextTiming?.end || ''
    };
    if (S.mode === 'development') {
      await API.updateDraftSlot(classId, nextKey, S.tt[nextKey]);
    }
  }

  if (S.mode === 'development') {
    await API.updateDraftSlot(classId, key, cell);
  } else {
    await API.saveTimetable(classId, S.tt);
  }

  buildTTTable(classId);
  buildSummary();
  dbtoast(`Split continuous slot into ${orgSpan} separate single periods ✓`, 'success');
}
window.splitContinuousSlot = splitContinuousSlot;

// ── TIMING SET SWITCHER (FEATURE 4) ──
function cycleTimingSet() {
  openModal('modal-timing-set');
  renderTimingSetModal();
}
window.cycleTimingSet = cycleTimingSet;

function renderTimingSetModal() {
  const sel = document.getElementById('sel-class-timing-set');
  sel.innerHTML = `
    <option value="SET_1">Timing Set 1 (Years I &amp; IV) — Break 10:00–10:15</option>
    <option value="SET_2">Timing Set 2 (Years II &amp; III) — Break 10:45–11:00</option>
  `;
  const activeCode = S.activeTimingSet?.code || (['2', '3', 'II', 'III', '2nd Year', '3rd Year'].includes(String(S.currentClassYear || '').trim()) ? 'SET_2' : 'SET_1');
  sel.value = activeCode;
  updateTimingSetPreview(activeCode);
  sel.onchange = () => updateTimingSetPreview(sel.value);
}

function updateTimingSetPreview(code) {
  const preview = document.getElementById('timing-set-schedule-preview');
  if (code === 'SET_1') {
    preview.innerHTML = `
      <strong>Set 1 Schedule (Years I &amp; IV):</strong><br>
      • Period 1: 08:30 – 09:15<br>
      • Period 2: 09:15 – 10:00<br>
      • <span style="color:#d97706;font-weight:700;">Morning Break: 10:00 – 10:15 (After P2)</span><br>
      • Period 3: 10:15 – 11:00<br>
      • Period 4: 11:00 – 11:45<br>
      • Period 5: 11:45 – 12:30<br>
      • Period 6: 12:30 – 13:15<br>
      • <span style="color:#16a34a;font-weight:700;">Lunch Break: 13:15 – 14:00</span><br>
      • Period 7: 14:00 – 14:45<br>
      • Period 8: 14:45 – 15:30<br>
      • Afternoon Break: 15:30 – 15:45<br>
      • Period 9: 15:45 – 16:30
    `;
  } else {
    preview.innerHTML = `
      <strong>Set 2 Schedule (Years II &amp; III):</strong><br>
      • Period 1: 08:30 – 09:15<br>
      • Period 2: 09:15 – 10:00<br>
      • Period 3: 10:00 – 10:45<br>
      • <span style="color:#d97706;font-weight:700;">Morning Break: 10:45 – 11:00 (After P3)</span><br>
      • Period 4: 11:00 – 11:45<br>
      • Period 5: 11:45 – 12:30<br>
      • Period 6: 12:30 – 13:15<br>
      • <span style="color:#16a34a;font-weight:700;">Lunch Break: 13:15 – 14:00</span><br>
      • Period 7: 14:00 – 14:45<br>
      • Period 8: 14:45 – 15:30<br>
      • Afternoon Break: 15:30 – 15:45<br>
      • Period 9: 15:45 – 16:30
    `;
  }
}

async function executeSaveTimingSet() {
  const code = document.getElementById('sel-class-timing-set').value;
  S.activeTimingSet = { code, name: code === 'SET_1' ? 'Timing Set 1 (Years I & IV)' : 'Timing Set 2 (Years II & III)' };

  const badge = document.getElementById('tt-timing-badge');
  if (badge) {
    badge.textContent = `⏱ ${S.activeTimingSet.name}`;
  }

  const classId = S.sectionId || S.classId;
  closeModal('modal-timing-set');
  buildTTTable(classId);
  dbtoast(`Switched class timing to ${S.activeTimingSet.name} ✓`, 'success');
}
window.executeSaveTimingSet = executeSaveTimingSet;

// ── PLAN 5: REPORTS & ANALYTICS (FEATURE 7) ──

async function openTTReportsModal() {
  openModal('modal-tt-reports');

  // Populate department filter
  const selDept = document.getElementById('rep-workload-dept');
  if (selDept && selDept.options.length <= 1) {
    const depts = S.depts && S.depts.length ? S.depts : await API.getDepts();
    selDept.innerHTML = '<option value="all">All Departments</option>' +
      depts.map(d => `<option value="${e(d._id || d.id || d.name)}">${e(d.name)} (${e(d.code || '')})</option>`).join('');
    if (S.deptId) selDept.value = S.deptId;
  }

  await switchTTReportTab('workload');
}
window.openTTReportsModal = openTTReportsModal;

async function switchTTReportTab(tab) {
  S.activeTTReportTab = tab;
  ['workload', 'rooms', 'subjects'].forEach(t => {
    const btn = document.getElementById(`tab-rep-${t}`);
    const pane = document.getElementById(`pane-rep-${t}`);
    if (btn) btn.classList.toggle('act', t === tab);
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
  });

  if (tab === 'workload') {
    await loadTeacherWorkloadReport();
  } else if (tab === 'rooms') {
    await loadRoomUtilizationReport();
  } else if (tab === 'subjects') {
    await loadSubjectDistributionReport();
  }
}
window.switchTTReportTab = switchTTReportTab;

async function loadTeacherWorkloadReport() {
  const deptId = document.getElementById('rep-workload-dept')?.value || 'all';
  const tbody = document.getElementById('tbody-rep-workload');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">Loading workload metrics…</td></tr>';

  try {
    const data = await API.getTeacherWorkloadReport(deptId);
    const teachers = data.teachers || [];
    const avgEl = document.getElementById('rep-wl-avg');
    const overEl = document.getElementById('rep-wl-over');
    const underEl = document.getElementById('rep-wl-under');
    if (avgEl) avgEl.textContent = `${data.averagePeriodsPerTeacher || 0} P/Wk`;
    if (overEl) overEl.textContent = data.overloadedCount || 0;
    if (underEl) underEl.textContent = data.underloadedCount || 0;

    S.currentReportData = { type: 'workload', teachers };

    if (!teachers.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">No faculty records found</td></tr>';
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      let statusPill = `<span class="status-pill" style="background:#ecfdf5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">● Balanced</span>`;
      if (t.loadStatus === 'Overloaded') {
        statusPill = `<span class="status-pill" style="background:#fef2f2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">⚠️ Overloaded</span>`;
      } else if (t.loadStatus === 'Underloaded') {
        statusPill = `<span class="status-pill" style="background:#fffbeb;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">📉 Underloaded</span>`;
      }

      return `
        <tr>
          <td><strong>${e(t.fullName)}</strong><br><small style="color:var(--tmu);">${e(t.designation || 'Faculty')} · ${e(t.trackId || '')}</small></td>
          <td>${e(t.department || '—')}</td>
          <td style="font-weight:700;">${t.theoryPeriods || 0} hrs</td>
          <td style="font-weight:700;color:#2563eb;">${t.labHours || 0} hrs</td>
          <td style="font-weight:800;font-size:13px;">${t.totalPeriods || 0} periods</td>
          <td>${statusPill}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#dc2626;">Error loading report: ${e(err.message)}</td></tr>`;
  }
}
window.loadTeacherWorkloadReport = loadTeacherWorkloadReport;

async function loadRoomUtilizationReport() {
  const tbody = document.getElementById('tbody-rep-rooms');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">Loading room utilization…</td></tr>';

  try {
    const data = await API.getRoomUtilizationReport();
    const rooms = data.rooms || [];
    const optEl = document.getElementById('rep-room-opt');
    const underEl = document.getElementById('rep-room-under');
    if (optEl) optEl.textContent = data.optimalCount || 0;
    if (underEl) underEl.textContent = data.underutilizedCount || 0;

    S.currentReportData = { type: 'rooms', rooms };

    if (!rooms.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">No rooms registered in system</td></tr>';
      return;
    }

    tbody.innerHTML = rooms.map(r => {
      let statusPill = `<span class="status-pill" style="background:#eff6ff;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">● Normal</span>`;
      if (r.status === 'Optimal') {
        statusPill = `<span class="status-pill" style="background:#ecfdf5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">● Optimal</span>`;
      } else if (r.status === 'Underutilized') {
        statusPill = `<span class="status-pill" style="background:#fffbeb;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">📉 Underutilized</span>`;
      }

      return `
        <tr>
          <td><strong style="font-size:13px;color:var(--gD);">${e(r.hallNo)}</strong></td>
          <td>${e(r.name || r.hallNo)}</td>
          <td><span class="tpl-badge">${e(r.type || 'Theory')}</span></td>
          <td>${r.capacity || 60} seats</td>
          <td style="font-weight:700;">${r.hoursUsed || 0} / 45 hrs</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;min-width:60px;">
                <div style="width:${Math.min(100, r.utilizationPercent)}%;background:${r.utilizationPercent > 75 ? '#10b981' : r.utilizationPercent < 40 ? '#f59e0b' : '#3b82f6'};height:100%;"></div>
              </div>
              <span style="font-size:11.5px;font-weight:800;">${r.utilizationPercent}%</span>
            </div>
          </td>
          <td>${statusPill}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Error loading rooms: ${e(err.message)}</td></tr>`;
  }
}
window.loadRoomUtilizationReport = loadRoomUtilizationReport;

async function loadSubjectDistributionReport() {
  const tbody = document.getElementById('tbody-rep-subjects');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">Loading subject distribution…</td></tr>';

  try {
    const deptId = document.getElementById('rep-workload-dept')?.value || 'all';
    const classes = await API.getSubjectDistributionReport(deptId);

    S.currentReportData = { type: 'subjects', classes };

    if (!classes.length || !classes.some(c => c.subjects?.length)) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">No subjects scheduled in live timetable</td></tr>';
      return;
    }

    const rows = [];
    classes.forEach(c => {
      (c.subjects || []).forEach(s => {
        const targetWeekly = (s.credits || 3);
        const isCompliant = s.weeklyHours >= targetWeekly;
        const statusBadge = isCompliant
          ? `<span class="status-pill" style="background:#ecfdf5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">✓ Compliant</span>`
          : `<span class="status-pill" style="background:#fef2f2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">⚠️ Under Target</span>`;

        rows.push(`
          <tr>
            <td><strong>${e(c.className)}</strong></td>
            <td>${e(s.subjectName)}</td>
            <td><code style="background:var(--gP);padding:2px 6px;border-radius:4px;font-size:11px;">${e(s.shortName || s.subjectCode || '—')}</code></td>
            <td><span class="tpl-badge">${e(s.type || 'Theory')}</span></td>
            <td style="font-weight:700;">${s.credits || 3}</td>
            <td style="font-weight:800;font-size:13px;color:#2563eb;">${s.weeklyHours || 0} hrs/wk</td>
            <td>${statusBadge}</td>
          </tr>
        `);
      });
    });

    tbody.innerHTML = rows.join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Error loading subject distribution: ${e(err.message)}</td></tr>`;
  }
}
window.loadSubjectDistributionReport = loadSubjectDistributionReport;

function exportCurrentReportCSV() {
  const rep = S.currentReportData;
  if (!rep) { dbtoast('Please load a report first', 'warn'); return; }

  let csv = '';
  let filename = `Report_${rep.type}_${new Date().toISOString().slice(0, 10)}.csv`;

  if (rep.type === 'workload') {
    csv = 'Faculty Name,Track ID,Department,Designation,Theory Periods,Lab Hours,Total Weekly Periods,Status\n';
    (rep.teachers || []).forEach(t => {
      csv += `"${t.fullName}","${t.trackId || ''}","${t.department || ''}","${t.designation || ''}",${t.theoryPeriods || 0},${t.labHours || 0},${t.totalPeriods || 0},"${t.loadStatus}"\n`;
    });
  } else if (rep.type === 'rooms') {
    csv = 'Hall No,Room Name,Type,Capacity,Weekly Hours Used,Max Weekly Hours,Utilization %,Status\n';
    (rep.rooms || []).forEach(r => {
      csv += `"${r.hallNo}","${r.name || ''}","${r.type}",${r.capacity || 60},${r.hoursUsed || 0},${r.maxWeeklyPeriods || 45},${r.utilizationPercent || 0}%,"${r.status}"\n`;
    });
  } else if (rep.type === 'subjects') {
    csv = 'Class,Subject Name,Short Name,Code,Type,Credits,Weekly Hours Scheduled\n';
    (rep.classes || []).forEach(c => {
      (c.subjects || []).forEach(s => {
        csv += `"${c.className}","${s.subjectName}","${s.shortName || ''}","${s.subjectCode || ''}","${s.type}",${s.credits || 3},${s.weeklyHours || 0}\n`;
      });
    });
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  dbtoast(`Exported ${rep.type} report as CSV ✓`, 'success');
}
window.exportCurrentReportCSV = exportCurrentReportCSV;

function printCurrentReport() {
  window.print();
}
window.printCurrentReport = printCurrentReport;

// ── PLAN 5: ACADEMIC CALENDAR STATS (FEATURE 12) ──

async function openCalendarStatsModal() {
  const classId = S.sectionId || S.classId;
  if (!classId) {
    dbtoast('Please select a class first to view teaching hours breakdown', 'warn');
    return;
  }

  openModal('modal-calendar-stats');

  document.getElementById('cal-tot-days').textContent = '…';
  document.getElementById('cal-rem-days').textContent = '…';
  document.getElementById('cal-holidays').textContent = '…';
  document.getElementById('cal-work-sat').textContent = '…';
  const tbody = document.getElementById('cal-subjects-tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">Calculating academic calendar teaching hours…</td></tr>';
  }

  try {
    const data = await API.getAcademicCalendarStats(classId);
    if (!data) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#dc2626;">Failed to load calendar metrics</td></tr>';
      return;
    }

    const c = data.calendarSummary || {};
    document.getElementById('cal-tot-days').textContent = c.totalWorkingDays ?? 90;
    document.getElementById('cal-rem-days').textContent = c.remainingWorkingDays ?? '—';
    document.getElementById('cal-holidays').textContent = c.holidaysCount ?? 0;
    document.getElementById('cal-work-sat').textContent = c.workingSaturdaysCount ?? 0;

    const subjects = data.subjects || [];
    if (!subjects.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">No subjects scheduled in live timetable</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = subjects.map(s => {
        const pct = s.completionPercent ?? 0;
        return `
          <tr>
            <td><strong>${e(s.subjectName)}</strong><br><small style="color:var(--tmu);">${e(s.subjectCode || '')} · ${e(s.type || 'Theory')}</small></td>
            <td style="font-weight:700;">${s.weeklyTotal || 0} P/Wk</td>
            <td style="font-weight:700;">${s.totalSemesterPeriods || 0} periods</td>
            <td style="font-weight:800;color:#16a34a;">${s.completedPeriods || 0}</td>
            <td style="font-weight:800;color:#d97706;">${s.remainingTeachingPeriods || 0}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;min-width:60px;">
                  <div style="width:${Math.min(100, pct)}%;background:${pct >= 75 ? '#10b981' : pct >= 40 ? '#3b82f6' : '#f59e0b'};height:100%;"></div>
                </div>
                <span style="font-size:11.5px;font-weight:800;">${pct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#dc2626;">Error: ${e(err.message)}</td></tr>`;
  }
}
window.openCalendarStatsModal = openCalendarStatsModal;

// ── PLAN 5: TIMETABLE BACKUPS & VERSION SNAPSHOTS (FEATURE 8) ──

async function openBackupsModal() {
  const classId = S.sectionId || S.classId;
  if (!classId) {
    dbtoast('Please select a class first', 'warn');
    return;
  }

  openModal('modal-tt-backups');
  const listEl = document.getElementById('tt-backups-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tdi);">Loading backups…</div>';

  try {
    const backups = await API.getBackups(classId);
    if (!backups || !backups.length) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:32px;color:var(--tdi);">
          <div style="font-size:28px;margin-bottom:6px;">📦</div>
          <div style="font-weight:700;font-size:13px;">No Historical Backups Found</div>
          <div style="font-size:11.5px;color:var(--tmu);margin-top:4px;">Backups are automatically created whenever a new timetable is published to production.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = backups.map(b => {
      const dateStr = b.archivedAt ? new Date(b.archivedAt).toLocaleString('en-IN', {
        dateStyle: 'medium', timeStyle: 'short'
      }) : '—';
      const slotCount = Object.keys(b.slots || {}).length;

      return `
        <div style="background:var(--gP);border:1px solid var(--brl);border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="tpl-badge" style="background:#e0e7ff;color:#3730a3;font-weight:800;">${e(b.versionLabel || 'Archived Snapshot')}</span>
              <strong style="font-size:12.5px;">${dateStr}</strong>
            </div>
            <div style="font-size:11px;color:var(--tmu);margin-top:4px;">
              Confirmed by: <strong>${e(b.approvedBy || 'HOD')}</strong> · <strong>${slotCount} periods</strong> preserved
            </div>
            ${b.notes ? `<div style="font-size:11px;color:var(--td);margin-top:2px;font-style:italic;">"${e(b.notes)}"</div>` : ''}
          </div>
          <button class="btn btn-outline btn-sm" onclick="restoreBackupToDraft('${b._id}')" style="font-size:11px;white-space:nowrap;">
            ↺ Restore to Draft
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;">Error: ${e(err.message)}</div>`;
  }
}
window.openBackupsModal = openBackupsModal;

async function restoreBackupToDraft(backupId) {
  if (!confirm('Restore this backup version into your Development Draft Workspace?\n\nYour current draft will be replaced with this historical snapshot so you can inspect, edit, and publish it when ready.')) {
    return;
  }

  const res = await API.restoreBackup(backupId);
  if (res?.success) {
    closeModal('modal-tt-backups');
    dbtoast('Historical backup restored into Development Draft ✓', 'success', 4500);
    S.mode = 'development';
    await loadTT();
  } else {
    dbtoast(`Failed to restore backup: ${res?.error || 'Unknown error'}`, 'error');
  }
}
window.restoreBackupToDraft = restoreBackupToDraft;

// ── PLAN 5: PUBLISH PRE-FLIGHT DIFF & BROADCAST NOTIFICATIONS (FEATURE 8) ──

async function openPublishPreviewModal() {
  const classId = S.sectionId || S.classId;
  if (!classId) {
    dbtoast('Please select a class first', 'warn');
    return;
  }

  openModal('modal-publish-preview');

  // Set default effective date to tomorrow (or today if desired)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const effDateInput = document.getElementById('pub-effective-date');
  if (effDateInput && !effDateInput.value) {
    effDateInput.value = tomorrow.toISOString().slice(0, 10);
  }

  const stuCountEl = document.getElementById('pub-stu-count');
  const teachCountEl = document.getElementById('pub-teach-count');
  const diffSummaryEl = document.getElementById('pub-diff-summary');
  const detailsEl = document.getElementById('pub-diff-details');

  if (stuCountEl) stuCountEl.textContent = '…';
  if (teachCountEl) teachCountEl.textContent = '…';
  if (diffSummaryEl) diffSummaryEl.textContent = '…';
  if (detailsEl) detailsEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--tdi);">Generating pre-flight diff…</div>';

  try {
    const preview = await API.getPublishPreview(classId);
    if (!preview || preview.error) {
      if (detailsEl) detailsEl.innerHTML = `<div style="text-align:center;padding:16px;color:#dc2626;">Error: ${e(preview?.error || 'Failed to load preview')}</div>`;
      return;
    }

    const s = preview.summary || {};
    if (stuCountEl) stuCountEl.textContent = s.impactedStudentsCount ?? '—';
    if (teachCountEl) teachCountEl.textContent = s.impactedTeachersCount ?? '—';
    if (diffSummaryEl) diffSummaryEl.textContent = `${s.addedCount || 0} Add, ${s.removedCount || 0} Del, ${s.modifiedCount || 0} Mod`;

    const diff = preview.diff || {};
    const items = [];

    (diff.added || []).forEach(item => {
      const parts = (item.slotKey || '').split('-');
      const day = parts[0] || '';
      const p = parts[1] || '';
      items.push(`
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#065f46;display:flex;align-items:center;gap:8px;">
          <span style="background:#10b981;color:#fff;font-weight:800;padding:1px 6px;border-radius:4px;font-size:10px;">+ ADDED</span>
          <strong>${e(day)} P${e(p)}:</strong>
          <span>${e(item.slot?.subject || item.slot?.subjectName || 'Subject')}</span>
          <span style="color:#047857;">(${e(item.slot?.staff || item.slot?.teacherName || 'TBA')}${item.slot?.hall ? ' · ' + e(item.slot.hall) : ''})</span>
        </div>
      `);
    });

    (diff.removed || []).forEach(item => {
      const parts = (item.slotKey || '').split('-');
      const day = parts[0] || '';
      const p = parts[1] || '';
      items.push(`
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#991b1b;display:flex;align-items:center;gap:8px;">
          <span style="background:#ef4444;color:#fff;font-weight:800;padding:1px 6px;border-radius:4px;font-size:10px;">− REMOVED</span>
          <strong>${e(day)} P${e(p)}:</strong>
          <span>${e(item.slot?.subject || item.slot?.subjectName || 'Subject')}</span>
          <span style="color:#b91c1c;">(${e(item.slot?.staff || item.slot?.teacherName || 'TBA')})</span>
        </div>
      `);
    });

    (diff.modified || []).forEach(item => {
      const parts = (item.slotKey || '').split('-');
      const day = parts[0] || '';
      const p = parts[1] || '';
      const bStaff = item.before?.staff || item.before?.teacherName || '—';
      const aStaff = item.after?.staff || item.after?.teacherName || '—';
      const bRoom = item.before?.hall || item.before?.hallNo || '—';
      const aRoom = item.after?.hall || item.after?.hallNo || '—';

      items.push(`
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#92400e;display:flex;align-items:center;gap:8px;">
          <span style="background:#f59e0b;color:#fff;font-weight:800;padding:1px 6px;border-radius:4px;font-size:10px;">~ MODIFIED</span>
          <strong>${e(day)} P${e(p)}:</strong>
          <span>${e(item.after?.subject || item.after?.subjectName || 'Subject')}</span>
          <span style="color:#78350f;">[Faculty: ${e(bStaff)} → ${e(aStaff)} | Room: ${e(bRoom)} → ${e(aRoom)}]</span>
        </div>
      `);
    });

    if (items.length === 0) {
      if (detailsEl) detailsEl.innerHTML = `
        <div style="text-align:center;padding:20px;color:#059669;font-size:12px;font-weight:600;">
          ✓ Draft matches active production timetable with 0 slot changes.
        </div>
      `;
    } else {
      if (detailsEl) detailsEl.innerHTML = items.join('');
    }
  } catch (err) {
    if (detailsEl) detailsEl.innerHTML = `<div style="text-align:center;padding:16px;color:#dc2626;">Failed to generate diff: ${e(err.message)}</div>`;
  }
}
window.openPublishPreviewModal = openPublishPreviewModal;

async function executePublishWithNotifications() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;

  const effectiveDate = document.getElementById('pub-effective-date').value;
  const notes = document.getElementById('pub-notes').value.trim();

  const res = await API.publishWithNotifications(classId, { effectiveDate, notes });
  if (res?.success) {
    closeModal('modal-publish-preview');
    showPublishSuccessFlourish(res.notificationsSent || 0);
    S.mode = 'production';
    await loadTT();
  } else {
    dbtoast(`Publish failed: ${res?.error || 'Unknown error'}`, 'error');
  }
}
window.executePublishWithNotifications = executePublishWithNotifications;

function showPublishSuccessFlourish(count) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop open';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:360px;width:90%;text-align:center;padding:28px 24px;box-shadow:0 16px 40px rgba(0,0,0,.18);">
      <div class="publish-success-check">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
      </div>
      <div style="font-size:16.5px;font-weight:700;color:var(--gD);margin-bottom:6px;">Published to Live!</div>
      <div style="font-size:12px;color:var(--tmu);line-height:1.5;">The new schedule is now active in Production.<br><strong>${count}</strong> notifications sent to faculty &amp; students.</div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => {
    modal.style.transition = 'opacity .3s ease';
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 300);
  }, 1800);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — SIDEBAR STUDIO NEW FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

// SIDEBAR TOOLBAR ACCORDION TOGGLE
function toggleSidebarToolbar(forceState) {
  const section = document.getElementById('sb-toolbars');
  if (!section) return;
  const isOpen = typeof forceState === 'boolean'
    ? forceState
    : !section.classList.contains('sb-toolbar-open');

  section.classList.toggle('sb-toolbar-open', isOpen);
}
window.toggleSidebarToolbar = toggleSidebarToolbar;

// LIVE CLOCK (topbar)
let _liveClockInterval = null;
function startLiveClock() {
  const clockText = document.getElementById('tb-clock-text');
  if (!clockText) return;

  function tick() {
    const now = new Date();
    clockText.textContent = now.toLocaleTimeString('en-IN', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  tick();
  _liveClockInterval = setInterval(tick, 1000);
}

// CTRL+K SEARCH SHORTCUT
function setupCtrlKShortcut() {
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'k') {
      ev.preventDefault();
      const searchInput = document.getElementById('tt-class-search');
      if (searchInput) {
        searchInput.focus();
        openClassSearch();
      }
    }
  });
}

// CROSSHAIR HIGHLIGHT ON TABLE HOVER
function setupCrosshairHighlight() {
  const table = document.getElementById('tt-table');
  if (!table) return;

  table.addEventListener('mouseover', (ev) => {
    const td = ev.target.closest('td, th');
    if (!td) return;
    const tr = td.closest('tr');
    if (!tr) return;

    const cellIndex = td.cellIndex;
    const rows = table.querySelectorAll('tr');

    // Highlight row header (first cell of this row)
    const rowHeader = tr.querySelector('th');
    if (rowHeader) rowHeader.classList.add('row-highlight');

    // Highlight column
    rows.forEach(row => {
      const cell = row.children[cellIndex];
      if (cell) cell.classList.add('col-highlight');
    });
  });

  table.addEventListener('mouseout', (ev) => {
    const td = ev.target.closest('td, th');
    if (!td) return;

    // Clear all highlights
    table.querySelectorAll('.col-highlight').forEach(el => el.classList.remove('col-highlight'));
    table.querySelectorAll('.row-highlight').forEach(el => el.classList.remove('row-highlight'));
  });
}

// TEMPLATES HOVER PREVIEW
let _templatesPreviewEl = null;
function showTemplatesPreview(btn) {
  if (!_templatesPreviewEl) {
    _templatesPreviewEl = document.createElement('div');
    _templatesPreviewEl.className = 'templates-hover-preview';
    document.body.appendChild(_templatesPreviewEl);
  }

  const templates = S.templates || [];
  if (!templates.length) {
    _templatesPreviewEl.innerHTML = `
      <div class="thp-title">Templates</div>
      <div style="font-size:11px;color:var(--tmu);padding:8px 0;">No templates saved yet. Click to create one.</div>
    `;
  } else {
    _templatesPreviewEl.innerHTML = `
      <div class="thp-title">Available Templates</div>
      <div class="thp-list">
        ${templates.slice(0, 5).map(t => `
          <div class="thp-item">
            <span class="thp-item-name">${e(t.name || 'Untitled')}</span>
            <span class="thp-item-meta">${t.workingDays || 5} days · ${t.periodsPerDay || 8} periods</span>
          </div>
        `).join('')}
        ${templates.length > 5 ? `<div style="font-size:10px;color:var(--tmu);text-align:center;padding:4px;">+${templates.length - 5} more…</div>` : ''}
      </div>
    `;
  }

  // Position near the button
  const rect = btn.getBoundingClientRect();
  _templatesPreviewEl.style.top = rect.top + 'px';
  _templatesPreviewEl.style.left = (rect.right + 8) + 'px';
  _templatesPreviewEl.classList.add('visible');
}
window.showTemplatesPreview = showTemplatesPreview;

function hideTemplatesPreview() {
  if (_templatesPreviewEl) {
    _templatesPreviewEl.classList.remove('visible');
  }
}
window.hideTemplatesPreview = hideTemplatesPreview;

// EXPORT SCOPED TO TIMETABLE
function openExportScoped() {
  window.open('export.html?type=timetable', '_blank');
}
window.openExportScoped = openExportScoped;

// AUTOGEN MODAL ALIAS (HTML uses openAutoGenModal, existing function is openAutoGen)
function openAutoGenModal() {
  if (typeof openAutoGen === 'function') {
    openAutoGen();
  } else {
    dbtoast('Auto-generate feature loading...', 'info');
  }
}
window.openAutoGenModal = openAutoGenModal;

// SAVE DRAFT — standalone floating button handler
async function saveDraft() {
  const classId = S.sectionId || S.classId;
  if (!classId) { dbtoast('No class selected', 'error'); return; }
  const floatSave = document.getElementById('btn-float-save');
  if (floatSave) {
    floatSave.disabled = true;
    floatSave.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;margin-right:5px;vertical-align:middle;"></span> Saving…';
  }
  try {
    const ok = await API.saveDraft(classId, S.tt);
    dbtoast(ok ? '💾 Draft saved successfully' : 'Save failed – check connection', ok ? 'success' : 'error');
  } catch (err) {
    dbtoast('Save failed: ' + err.message, 'error');
  } finally {
    if (floatSave) {
      floatSave.disabled = false;
      floatSave.innerHTML = '💾 Save Draft';
    }
  }
}
window.saveDraft = saveDraft;

// SUBMIT TO HOD ALIAS (floating pill calls openSubmitHodModal, existing is openSubmitToHodModal)
function openSubmitHodModal() {
  if (typeof openSubmitToHodModal === 'function') {
    openSubmitToHodModal();
  }
}
window.openSubmitHodModal = openSubmitHodModal;

// LOGOUT
function doLogout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}
window.doLogout = doLogout;

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — STAGED CLASS METADATA (Hall No & Advisor)
// ══════════════════════════════════════════════════════════════════════════════

function renderClassMetaChips(classId) {
  const cls = S.classes.find(c => String(c._id) === String(classId));
  const metaHall = document.getElementById('meta-hall');
  const metaAdvisor = document.getElementById('meta-advisor');
  const isDev = S.mode === 'development' && CAN_EDIT;

  const stagedHall = S.draftDoc?.classMeta?.hallNo;
  const stagedAdv = S.draftDoc?.classMeta?.advisorName;

  const hallVal = (isDev && stagedHall !== undefined && stagedHall !== '') ? stagedHall : (cls?.hallNo || '');
  const isHallStaged = isDev && stagedHall && stagedHall !== cls?.hallNo;

  const advVal = (isDev && stagedAdv !== undefined && stagedAdv !== '') ? stagedAdv : (cls?.advisorTeacherName || '');
  const isAdvStaged = isDev && stagedAdv && stagedAdv !== cls?.advisorTeacherName;

  if (metaHall) {
    metaHall.innerHTML = `🏛 Hall: ${e(hallVal || '—')}${isHallStaged ? ' <span style="color:var(--amber);font-size:10px;font-weight:700;">(Staged)</span>' : ''}`;
    metaHall.style.cursor = isDev ? 'pointer' : 'default';
    metaHall.title = isDev ? 'Click to edit staged Hall Number' : 'Hall Number';
    metaHall.onclick = isDev ? () => openEditClassMetaModal() : null;
  }
  if (metaAdvisor) {
    metaAdvisor.innerHTML = `👤 Advisor: ${e(advVal || '—')}${isAdvStaged ? ' <span style="color:var(--amber);font-size:10px;font-weight:700;">(Staged)</span>' : ''}`;
    metaAdvisor.style.cursor = isDev ? 'pointer' : 'default';
    metaAdvisor.title = isDev ? 'Click to edit staged Class Advisor' : 'Class Advisor';
    metaAdvisor.onclick = isDev ? () => openEditClassMetaModal() : null;
  }
}
window.renderClassMetaChips = renderClassMetaChips;

async function openEditClassMetaModal() {
  const classId = S.sectionId || S.classId;
  if (!classId) {
    dbtoast('Please select a class first', 'warn');
    return;
  }
  const cls = S.classes.find(c => String(c._id) === String(classId));
  const isDev = S.mode === 'development' && CAN_EDIT;
  if (!isDev) {
    dbtoast('Class metadata can only be edited in Development Draft mode', 'info');
    return;
  }

  const hallInput = document.getElementById('meta-input-hall');
  const advSelect = document.getElementById('meta-input-advisor');
  if (hallInput) {
    hallInput.value = S.draftDoc?.classMeta?.hallNo || cls?.hallNo || '';
  }

  if (advSelect) {
    advSelect.innerHTML = '<option value="">— Select Advisor —</option>';
    try {
      const teachers = await API.getTeachers(cls?.deptId || S.deptId);
      (teachers || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t._id;
        opt.textContent = `${t.name} (${t.designation || 'Faculty'})`;
        opt.dataset.name = t.name;
        advSelect.appendChild(opt);
      });
      const curAdvId = S.draftDoc?.classMeta?.advisorId || cls?.advisorTeacherId;
      if (curAdvId) advSelect.value = String(curAdvId);
    } catch (e) {
      console.error('Failed to load teachers for advisor select', e);
    }
  }

  openModal('modal-class-meta');
}
window.openEditClassMetaModal = openEditClassMetaModal;

async function saveClassMeta() {
  const classId = S.sectionId || S.classId;
  if (!classId) return;
  const hallInput = document.getElementById('meta-input-hall');
  const advSelect = document.getElementById('meta-input-advisor');

  const selectedOpt = advSelect?.selectedOptions?.[0];
  const advisorId = advSelect?.value || null;
  const advisorName = selectedOpt?.dataset?.name || (advisorId ? selectedOpt?.textContent : '');
  const hallNo = (hallInput?.value || '').trim();

  const classMeta = {
    hallNo,
    advisorId,
    advisorName
  };

  if (!S.draftDoc) S.draftDoc = { slots: S.tt || {} };
  S.draftDoc.classMeta = classMeta;

  try {
    const ok = await API.saveDraft(classId, S.tt || {}, classMeta);
    if (ok) {
      dbtoast('🏛️ Class metadata staged to draft', 'success');
      closeModal('modal-class-meta');
      syncActiveTabState();
      renderClassMetaChips(classId);
    } else {
      dbtoast('Failed to save metadata', 'error');
    }
  } catch (err) {
    dbtoast('Network error saving metadata', 'error');
  }
}
window.saveClassMeta = saveClassMeta;


