const M = require('../models');

/**
 * Returns current IST year as integer
 */
function getCurrentISTYear() {
  const d = new Date();
  const yearStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric'
  }).format(d);
  return parseInt(yearStr, 10) || d.getUTCFullYear();
}

/**
 * Returns current IST month as YYYY-MM
 */
function getCurrentISTMonth() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  return `${year}-${month}`;
}

/**
 * Normalize leave type strings
 */
function normalizeLeaveType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('casual') || t === 'cl') return 'Casual Leave';
  if (t.includes('med') || t === 'ml') return 'Medical Leave';
  if (t.includes('earned') || t === 'el') return 'Earned Leave';
  if (t.includes('duty') || t === 'od') return 'Duty Leave';
  if (t.includes('loss') || t === 'lop') return 'Loss of Pay (LOP)';
  return 'Casual Leave';
}

/**
 * Calculate units for a given leave request
 * LD7: Specific period leaves consume 0 units from leave balance
 * Full day = 1, FN / AN = 0.5
 */
function getRequestUnits(req) {
  const coverage = String(req.coverage || '').toLowerCase();
  const slot = String(req.slot || '').toLowerCase();

  if (coverage === 'periods' || slot.includes('hour') || slot.includes('period')) {
    return 0; // LD7: 0 units
  }
  if (coverage === 'fn' || coverage === 'an' || slot === 'fn' || slot === 'an') {
    const datesCount = Array.isArray(req.dates) && req.dates.length ? req.dates.length : 1;
    return 0.5 * datesCount;
  }
  return Number(req.daysCount) || (Array.isArray(req.dates) ? req.dates.length : 1);
}

/**
 * Calculate Faculty Leave Balance
 * Available = allowance + carried forward − used − pending
 * 
 * @param {Object} params
 * @param {string} params.teacherTrackId
 * @param {string} [params.deptCode]
 * @param {number} [params.year]
 * @returns {Promise<Object>}
 */
async function calculateFacultyLeaveBalance({ teacherTrackId, deptCode = '', year = null }) {
  const currentYear = year || getCurrentISTYear();
  const currentMonth = getCurrentISTMonth();
  const yearPrefix = String(currentYear);

  // 1. Fetch policy for department or use default
  let cleanDeptCode = String(deptCode || '').toUpperCase().trim();
  if (!cleanDeptCode && teacherTrackId) {
    const teacher = await M.Teacher.findOne({ trackId: teacherTrackId }).lean();
    if (teacher) {
      cleanDeptCode = String(teacher.deptCode || teacher.department || '').toUpperCase().trim();
    }
  }

  let policy = null;
  if (cleanDeptCode) {
    policy = await M.FacultyLeavePolicy.findOne({ deptCode: cleanDeptCode }).lean();
  }

  let teacherSettings = {};
  try {
    const { getSettings } = require('./settingsCache');
    const sMap = await getSettings(['teachers']);
    teacherSettings = sMap?.teachers || {};
  } catch (e) {}

  const defaultCL = teacherSettings.casualLeaveAllowance ?? 12;
  const defaultML = teacherSettings.medicalLeaveAllowance ?? 10;
  const defaultEL = teacherSettings.earnedLeaveAllowance ?? 15;
  const annualQuota = policy?.annualLeaveQuota ?? teacherSettings.annualLeaveQuota ?? 15;

  const allowances = {
    casualLeave: policy?.allowances?.casualLeave ?? defaultCL,
    medicalLeave: policy?.allowances?.medicalLeave ?? defaultML,
    earnedLeave: policy?.allowances?.earnedLeave ?? defaultEL
  };
  const carryForwardEarned = policy?.carryForwardEarned ?? true;
  const medicalDocThresholdDays = policy?.medicalDocThresholdDays ?? 3;

  // 2. Fetch all leave requests for this teacher in the current calendar year
  const allRequests = await M.TeacherLeaveRequest.find({
    teacherTrackId,
    $or: [
      { fromDate: new RegExp('^' + yearPrefix) },
      { dates: new RegExp('^' + yearPrefix) }
    ]
  }).lean();

  const used = { 'Casual Leave': 0, 'Medical Leave': 0, 'Earned Leave': 0, 'Loss of Pay (LOP)': 0 };
  const pending = { 'Casual Leave': 0, 'Medical Leave': 0, 'Earned Leave': 0, 'Loss of Pay (LOP)': 0 };
  let periodLeavesThisMonth = 0;

  for (const r of allRequests) {
    const normType = normalizeLeaveType(r.leaveType);
    const units = getRequestUnits(r);
    const isPeriodLeave = String(r.coverage).toLowerCase() === 'periods' || String(r.slot).toLowerCase().includes('hour');

    // Count period leaves in current month
    if (isPeriodLeave) {
      const dates = Array.isArray(r.dates) && r.dates.length ? r.dates : [r.fromDate];
      if (dates.some(d => String(d).startsWith(currentMonth))) {
        if (!['Rejected', 'rejected', 'Cancelled', 'cancelled', 'withdrawn'].includes(r.status)) {
          periodLeavesThisMonth++;
        }
      }
    }

    if (units === 0) continue; // Period leaves don't consume balance units

    const st = String(r.status || '').toLowerCase();
    if (['approved'].includes(st)) {
      if (r.balanceBreakdown && r.balanceBreakdown.lopDays > 0) {
        used[normType] = (used[normType] || 0) + (r.balanceBreakdown.coveredByLeave || 0);
        used['Loss of Pay (LOP)'] = (used['Loss of Pay (LOP)'] || 0) + (r.balanceBreakdown.lopDays || 0);
      } else {
        used[normType] = (used[normType] || 0) + units;
      }
    } else if (['pending', 'pending_hod', 'pending_principal', 'draft'].includes(st)) {
      if (r.balanceBreakdown && r.balanceBreakdown.lopDays > 0) {
        pending[normType] = (pending[normType] || 0) + (r.balanceBreakdown.coveredByLeave || 0);
        pending['Loss of Pay (LOP)'] = (pending['Loss of Pay (LOP)'] || 0) + (r.balanceBreakdown.lopDays || 0);
      } else {
        pending[normType] = (pending[normType] || 0) + units;
      }
    }
  }

  // 3. Compute balances
  const clAvailable = Math.max(0, allowances.casualLeave - used['Casual Leave'] - pending['Casual Leave']);
  const mlAvailable = Math.max(0, allowances.medicalLeave - used['Medical Leave'] - pending['Medical Leave']);
  const elAvailable = Math.max(0, allowances.earnedLeave - used['Earned Leave'] - pending['Earned Leave']);
  const totalApprovedDays = used['Casual Leave'] + used['Medical Leave'] + used['Earned Leave'];
  const remainingLeaves = Math.max(0, annualQuota - totalApprovedDays);

  return {
    year: currentYear,
    deptCode: cleanDeptCode,
    annualLeaveQuota: annualQuota,
    remainingLeaves: remainingLeaves,
    policy: {
      revision: policy?.revision || 1,
      carryForwardEarned,
      medicalDocThresholdDays,
      maxConsecutiveLeaveDays: policy?.maxConsecutiveLeaveDays ?? teacherSettings.maxConsecutiveLeaveDays ?? 3,
      requireSubstitution: policy?.requireSubstitution ?? teacherSettings.requireSubstitution ?? true,
      allowPeriodLeave: policy?.allowPeriodLeave ?? teacherSettings.allowPeriodLeave ?? true,
      autoEscalatePrincipal: policy?.autoEscalatePrincipal ?? teacherSettings.autoEscalatePrincipal ?? false
    },
    balances: {
      casualLeave: {
        allowance: allowances.casualLeave,
        used: used['Casual Leave'],
        pending: pending['Casual Leave'],
        available: clAvailable
      },
      medicalLeave: {
        allowance: allowances.medicalLeave,
        used: used['Medical Leave'],
        pending: pending['Medical Leave'],
        available: mlAvailable
      },
      earnedLeave: {
        allowance: allowances.earnedLeave,
        used: used['Earned Leave'],
        pending: pending['Earned Leave'],
        available: elAvailable
      },
      lossOfPay: {
        used: used['Loss of Pay (LOP)'],
        pending: pending['Loss of Pay (LOP)']
      }
    },
    periodLeavesThisMonth,
    medicalDocThresholdDays
  };
}

/**
 * Calculate LOP Split
 * Extra days automatically become Loss of Pay (LOP) per LD6
 *
 * @param {Object} params
 * @param {string} params.leaveType
 * @param {number} params.requestedDays
 * @param {number} params.availableBalance
 * @returns {Object}
 */
function calculateLOPSplit({ leaveType, requestedDays, availableBalance }) {
  const normType = normalizeLeaveType(leaveType);
  const reqUnits = Number(requestedDays) || 0;
  const avail = Math.max(0, Number(availableBalance) || 0);

  if (reqUnits <= 0) {
    return {
      leaveType: normType,
      requestedDays: 0,
      available: avail,
      coveredByLeave: 0,
      lopDays: 0,
      splitDescription: '0 days'
    };
  }

  if (normType === 'Loss of Pay (LOP)') {
    return {
      leaveType: normType,
      requestedDays: reqUnits,
      available: 0,
      coveredByLeave: 0,
      lopDays: reqUnits,
      splitDescription: `${reqUnits} LOP`
    };
  }

  if (reqUnits <= avail) {
    return {
      leaveType: normType,
      requestedDays: reqUnits,
      available: avail,
      coveredByLeave: reqUnits,
      lopDays: 0,
      splitDescription: `${reqUnits} ${normType}`
    };
  }

  if (avail === 0) {
    return {
      leaveType: normType,
      requestedDays: reqUnits,
      available: 0,
      coveredByLeave: 0,
      lopDays: reqUnits,
      splitDescription: `${reqUnits} LOP (No balance)`
    };
  }

  const covered = avail;
  const lop = Math.round((reqUnits - avail) * 100) / 100;
  return {
    leaveType: normType,
    requestedDays: reqUnits,
    available: avail,
    coveredByLeave: covered,
    lopDays: lop,
    splitDescription: `${covered} ${normType} + ${lop} LOP`
  };
}

module.exports = {
  getCurrentISTYear,
  getCurrentISTMonth,
  normalizeLeaveType,
  getRequestUnits,
  calculateFacultyLeaveBalance,
  calculateLOPSplit
};
