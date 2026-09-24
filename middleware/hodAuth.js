const M = require('../models');

async function controllerAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  try {
    // Check for principal or superadmin authorization
    if (req.user.role === 'admin') {
      const adminDoc = await M.Admin.findOne({ trackId: req.user.trackId }).lean();
      const adminFlag = adminDoc?.adminFlag || 'superadmin';

      if (adminFlag === 'principal' || adminFlag === 'superadmin') {
        req.controllerContext = {
          role: 'principal',
          scope: 'college',
          name: req.user.fullName || req.user.firstName || req.user.username || 'Principal',
          trackId: req.user.trackId,
          email: req.user.email || '',
          adminFlag: adminFlag
        };
        return next();
      }
    }

    // Check for HOD role via teacher profile and specials
    if (req.user.role === 'teacher' && req.user.isHod) {
      const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
      const hodDeptSpec = specials.find(s => s.option === 'HodDeptTrackId');
      
      let deptDoc = null;
      if (hodDeptSpec && hodDeptSpec.value) {
        deptDoc = await M.Department.findOne({
          $or: [
            { trackId: hodDeptSpec.value },
            { code: String(hodDeptSpec.value).toUpperCase() },
            { name: hodDeptSpec.value }
          ]
        }).lean();
      }
      if (!deptDoc && req.user.deptId) {
        deptDoc = await M.Department.findById(req.user.deptId).lean();
      }
      if (!deptDoc && req.user.deptCode) {
        deptDoc = await M.Department.findOne({ code: req.user.deptCode.toUpperCase() }).lean();
      }
      if (!deptDoc && req.user.department) {
        deptDoc = await M.Department.findOne({ name: req.user.department }).lean();
      }

      req.controllerContext = {
        role: 'hod',
        scope: 'department',
        deptId: deptDoc ? deptDoc._id : req.user.deptId,
        deptCode: deptDoc ? deptDoc.code : (req.user.deptCode || ''),
        deptName: deptDoc ? deptDoc.name : (req.user.department || ''),
        deptTrackId: deptDoc ? deptDoc.trackId : (hodDeptSpec?.value || ''),
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
