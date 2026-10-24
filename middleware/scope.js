const M = require('../models');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { isSudoAdmin } = require('../utils/access');

/**
 * Returns current date in IST format (YYYY-MM-DD)
 */
function getTodayIST() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Scope middleware for Controller and cross-domain access control.
 * Builds req.scope according to EAMS controller specifications.
 */
async function scopeMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  try {
    const today = getTodayIST();
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];

    // 1. Check Principal privilege
    const isPrincipalUser = isSudoAdmin(req.user) ||
      req.user.isPrincipal === true ||
      specials.some(s => s.option === 'isPrincipal');

    // 2. Check HOD privilege
    const isHodUser = req.user.role === 'hod' || req.user.isHod === true || specials.some(s => s && s.option === 'isHod');
    let userHodDeptCode = null;

    if (isHodUser) {
      let deptDoc = await M.Department.findOne({ hodId: req.user._id }).lean();
      if (!deptDoc) {
        const hodSpec = specials.find(s => s && s.option === 'isHod');
        if (hodSpec && hodSpec.key) {
          deptDoc = await M.Department.findOne({
            $or: [
              { name: hodSpec.key },
              { code: String(hodSpec.key).toUpperCase() }
            ]
          }).lean();
        }
      }
      if (!deptDoc && req.user.deptId) {
        deptDoc = await M.Department.findById(req.user.deptId).lean();
      }
      if (!deptDoc && req.user.deptCode) {
        deptDoc = await M.Department.findOne({ code: String(req.user.deptCode).toUpperCase() }).lean();
      }
      if (!deptDoc && (req.user.department || req.user.dept)) {
        const dStr = req.user.department || req.user.dept;
        deptDoc = await M.Department.findOne({
          $or: [
            { name: dStr },
            { code: String(dStr).toUpperCase() }
          ]
        }).lean();
      }
      if (deptDoc) userHodDeptCode = deptDoc.code;
      if (!userHodDeptCode && (req.user.deptCode || req.user.dept)) {
        userHodDeptCode = String(req.user.deptCode || req.user.dept).toUpperCase();
      }
    }

    // 3. Check Acting HOD privilege for today
    let actingRoleDoc = null;
    if (!isPrincipalUser && !userHodDeptCode) {
      actingRoleDoc = await M.ActingRole.findOne({
        holderTrackId: req.user.trackId,
        role: 'hod',
        status: { $in: ['active', 'pending'] },
        from: { $lte: today },
        to: { $gte: today }
      }).lean();

      if (actingRoleDoc) {
        userHodDeptCode = String(actingRoleDoc.key).toUpperCase();
      }
    }

    // If user holds none of the controller roles, deny access
    if (!isPrincipalUser && !isHodUser && !actingRoleDoc) {
      return res.status(403).json({
        error: 'Access denied: Controller Portal requires active HOD or Principal privileges.',
        redirect: 'teacher.html'
      });
    }

    // Fetch all department codes for college scope
    const allDepts = await M.Department.find({}).select('code name trackId').lean();
    const allDeptCodes = allDepts.map(d => d.code.toUpperCase());

    // Resolve requested view context
    const requestedAs = sanitizeToString(req.query.as || req.headers['x-viewing-as'] || '').toLowerCase();
    const requestedDept = sanitizeToString(req.query.dept || req.headers['x-viewing-dept'] || '').toUpperCase();

    let asRole = 'hod';
    let deptCodes = [];
    let actingInfo = false;

    if (isPrincipalUser) {
      if (requestedAs === 'hod' && requestedDept) {
        if (!allDeptCodes.includes(requestedDept)) {
          return res.status(404).json({ error: `Department '${requestedDept}' not found` });
        }
        asRole = 'hod';
        deptCodes = [requestedDept];
      } else {
        asRole = 'principal';
        deptCodes = allDeptCodes;
      }
    } else {
      // HOD or Acting HOD
      if (requestedAs === 'principal') {
        return res.status(403).json({ error: 'Access denied: Cannot switch to Principal view without Principal privileges' });
      }

      if (requestedDept && requestedDept !== userHodDeptCode) {
        return res.status(403).json({
          error: `Access denied: Department scope mismatch. You only have access to ${userHodDeptCode}.`
        });
      }

      asRole = 'hod';
      deptCodes = [userHodDeptCode];

      if (actingRoleDoc) {
        actingInfo = {
          until: actingRoleDoc.to,
          appointedBy: actingRoleDoc.appointedBy,
          sourceLeaveId: actingRoleDoc.sourceLeaveId,
          deptCode: userHodDeptCode
        };
      }
    }

    const isPrincipalView = asRole === 'principal';

    req.scope = {
      asRole,
      acting: actingInfo,
      deptCodes,
      allDeptCodes,
      primaryDeptCode: deptCodes[0] || null,
      isPrincipalUser,
      isHodUser: !!isHodUser,
      isActingHod: !!actingRoleDoc,
      today,
      can: {
        liveBoard: true,
        classLiveView: true,
        studentRecords: true,
        export: true,
        nudgeTeacher: true,
        assignSubstitute: true,
        cancelPeriod: true,
        moveRoom: true,
        addExtraClass: true,
        approveUnlockRequest: true,
        permitFacultyLeave: true,
        finalApproveFacultyLeave: isPrincipalView,
        setDeptLeavePolicy: !isPrincipalView && !actingInfo,
        studentODHODStage: true,
        studentODPrincipalStage: isPrincipalView,
        rejectApprovedOD: true,
        academicParticipation: true,
        declareHoliday: isPrincipalView ? 'college' : 'dept',
        facultyPunctuality: true,
        broadcast: isPrincipalView ? 'college' : 'dept',
        auditLog: isPrincipalView ? 'all' : 'dept',
        hostelSnapshot: isPrincipalView
      }
    };

    next();
  } catch (err) {
    console.error('[Scope Middleware Error]:', err);
    return res.status(500).json({ error: 'Failed to evaluate access scope' });
  }
}

module.exports = {
  scopeMiddleware,
  getTodayIST
};
