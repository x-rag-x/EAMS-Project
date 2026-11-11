'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { recountLimiter } = require('../utils/rateLimiters');
const { logAction } = require('../utils/logAction');
const countService = require('../services/countService');

/**
 * POST /api/admin/recount
 * Recounts all tracked collections and reconciles the aggregated count singleton.
 * Protected by:
 * - authMiddleware (valid JWT Bearer token, active session, rejects query token)
 * - adminOnly (requires institution reach)
 * - recountLimiter (rate limit)
 * - Concurrency mutex via countService.recountAll (returns 409 if in progress)
 */
router.post('/recount', authMiddleware, adminOnly, recountLimiter, async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true' || req.query?.dryRun === true;
    const triggeredBy = req.user?.trackId || req.user?.name || req.user?.username || 'system';

    const result = await countService.recountAll(triggeredBy, { dryRun });

    // Encrypted audit log entry per R3 / security specs
    await logAction(
      req.user?.trackId || req.user?._id,
      req.user?.name || req.user?.username || 'Admin',
      req.user?.role || 'admin',
      'Counts Recounted',
      dryRun ? 'Recount preview completed (dry-run)' : 'Counts successfully recounted and reconciled',
      'admin',
      'info',
      req.ip,
      req.user?.sessionId,
      {
        module: 'admin',
        subType: 'recount',
        trackId: req.user?.trackId,
        actingWithAdminRights: req.user?.actingWithAdminRights,
        dryRun,
        discrepancies: result.discrepancies,
        counts: result.counts,
      }
    ).catch(err => console.warn('[LogAction Recount Error]:', err.message));

    return res.status(200).json({
      ok: true,
      message: 'Counts successfully recounted and reconciled',
      data: {
        counts: result.counts,
        discrepancies: result.discrepancies,
        dryRun: result.dryRun,
        durationMs: result.durationMs,
        recountedAt: result.recountedAt,
      },
    });
  } catch (err) {
    if (err.statusCode === 409 || err.code === 'RECOUNT_IN_PROGRESS') {
      return res.status(409).json({ error: err.message || 'Recount already in progress. Please wait.' });
    }
    return res.status(500).json({ error: err.message || 'Failed to recount counts' });
  }
});

module.exports = router;

