const M = require('../models');
const { isSudoAdmin } = require('../utils/access');

/**
 * Hostel Scope Middleware
 * Resolves hostel role, assigned blocks, and enforces HD15 privacy rules.
 */
async function hostelScopeMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  try {
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isAdmin = isSudoAdmin(req.user);
    const isPrincipal = isAdmin ||
      req.user.isPrincipal === true ||
      specials.some(s => s && s.option === 'isPrincipal');

    const wardenSpecials = specials.filter(s => s && s.option === 'isWarden');
    const isWarden = wardenSpecials.length > 0;

    let assignedBlockIds = [];
    let isWomenWarden = false;

    if (isWarden) {
      const blockKeys = wardenSpecials.map(s => s.key || s.value).filter(Boolean);
      const queryOr = [{ wardenTrackId: req.user.trackId }];
      if (blockKeys.length) {
        queryOr.push({ code: { $in: blockKeys } });
        const validIds = blockKeys.filter(k => typeof k === 'string' && /^[0-9a-fA-F]{24}$/.test(k));
        if (validIds.length) {
          queryOr.push({ _id: { $in: validIds } });
        }
      }

      const blocks = await M.Block.find({ $or: queryOr }).populate('hostelId').lean();
      assignedBlockIds = blocks.map(b => String(b._id));
      isWomenWarden = blocks.some(b => b.hostelId && b.hostelId.gender === 'girls');
    }

    const isHod = req.user.isHod === true || specials.some(s => s && s.option === 'isHod');
    const isAdvisor = specials.some(s => s && s.option === 'isClassAdvisor');
    const isStudent = req.user.role === 'student';

    req.hostelScope = {
      isAdmin,
      isPrincipal,
      isWarden,
      isWomenWarden,
      isHod,
      isAdvisor,
      isStudent,
      assignedBlockIds,
      // HD15: Girls' hostel individual details visible ONLY to women wardens & system admin
      canSeeGirlsDetail: isAdmin || isWomenWarden,
    };

    next();
  } catch (err) {
    console.error('[HostelScopeMiddleware] Error:', err);
    return res.status(500).json({ error: 'Failed to resolve hostel security scope' });
  }
}

module.exports = {
  hostelScopeMiddleware,
};
