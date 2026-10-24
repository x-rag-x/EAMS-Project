const M = require('../models');
const { isSudoAdmin } = require('../utils/access');

async function controllerAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  try {
    const flags = req.access?.flags || {};

    // Check for Principal authorization via flags or user specials
    const isPrincipal = flags.isPrincipal || req.user.isPrincipal === true ||
      (Array.isArray(req.user.specials) && req.user.specials.some(s => s && s.option === 'isPrincipal'));

    if (isPrincipal) {
      req.controllerContext = {
        role: 'principal',
        scope: 'college',
        name: req.user.fullName || req.user.firstName || req.user.username || 'Principal',
        trackId: req.user.trackId,
        email: req.user.email || '',
        adminFlag: 'principal'
      };
      return next();
    }

    // Check for Sudo Admin authorization (institution-wide, treated as principal scope)
    const isSudoUser = flags.isSudo || isSudoAdmin(req.user);
    if (isSudoUser) {
      req.controllerContext = {
        role: 'principal',
        scope: 'college',
        name: req.user.fullName || req.user.firstName || req.user.username || 'Administrator',
        trackId: req.user.trackId,
        email: req.user.email || '',
        adminFlag: req.user.isPrincipal ? 'principal' : 'superadmin'
      };
      return next();
    }

    // Check for HOD role via flags, role, or teacher specials
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isHodUserRole = flags.isHod === true ||
      req.user.role === 'hod' ||
      req.user.isHod === true ||
      (req.user.role === 'teacher' && req.user.isHod) ||
      specials.some(s => s && s.option === 'isHod');

    if (isHodUserRole) {
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
        deptDoc = await M.Department.findOne({ code: req.user.deptCode.toUpperCase() }).lean();
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

      const resolvedDeptCode = deptDoc ? deptDoc.code : (req.user.deptCode || req.user.dept || '');
      const resolvedDeptName = deptDoc ? deptDoc.name : (req.user.department || req.user.dept || 'Department');

      req.controllerContext = {
        role: 'hod',
        scope: 'department',
        deptId: deptDoc ? deptDoc._id : req.user.deptId,
        deptCode: resolvedDeptCode ? String(resolvedDeptCode).toUpperCase() : '',
        deptName: resolvedDeptName,
        deptTrackId: deptDoc ? deptDoc.trackId : '',
        name: req.user.fullName || req.user.firstName || req.user.username || 'HOD',
        trackId: req.user.trackId,
        email: req.user.email || ''
      };
      return next();
    }

    return res.status(403).json({
      error: 'Access denied: Controller Portal requires active HOD or Principal privileges.'
    });
  } catch (err) {
    console.error('[ControllerAuth Error]:', err);
    return res.status(500).json({ error: 'Controller authorization evaluation failed' });
  }
}

module.exports = { controllerAuth };
