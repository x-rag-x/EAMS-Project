/**
 * jobs/timetableGoLive.js
 *
 * Scheduled Go-Live Worker for EAMS Timetable (§10.4 & D16):
 * - Checks for approved TimetableCommits with goLiveAt in the past/present
 * - Executes the 8-stage deployment pipeline automatically
 * - Idempotent, robust against concurrent executions
 */

'use strict';

const mongoose = require('mongoose');
const M = require('../models');
const { executeDeployPipeline } = require('../services/timetableDeploy');

let goLiveInterval = null;
let _initialGoLiveTimeout = null;
let isRunning = false;

/**
 * Checks for due scheduled commits and deploys them
 */
async function checkAndDeployScheduledCommits() {
  if (isRunning) return;
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
  isRunning = true;

  try {
    const now = new Date();
    // Query approved commits where goLiveAt is due (<= now)
    const dueCommits = await M.TimetableCommit.find({
      status: 'approved',
      goLiveAt: { $ne: null, $lte: now }
    }).sort({ goLiveAt: 1 });

    for (const commit of dueCommits) {
      try {
        console.log(`[Timetable Go-Live] Deploying scheduled commit ${commit.trackId} (scheduled for ${commit.goLiveAt.toISOString()})...`);
        const result = await executeDeployPipeline(commit, {
          actor: {
            name: 'Scheduled Go-Live Worker',
            trackId: 'SYS-GOLIVE',
            role: 'system'
          }
        });

        if (result.ok) {
          console.log(`[Timetable Go-Live] Successfully deployed scheduled commit ${commit.trackId}`);
        } else {
          console.warn(`[Timetable Go-Live] Stage ${result.stage} warning/failure for ${commit.trackId}: ${result.error}`);
        }
      } catch (commitErr) {
        console.error(`[Timetable Go-Live] Error executing deploy for ${commit.trackId}:`, commitErr.message || commitErr);
      }
    }
  } catch (err) {
    if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError' || (err.message && (err.message.includes('buffering timed out') || err.message.includes('closed')))) {
      return;
    }
    console.error('[Timetable Go-Live Job] Sweep error:', err.message || err);
  } finally {
    isRunning = false;
  }
}

/**
 * Starts the periodic scheduled go-live worker
 * @param {number} intervalMs - Poll interval in milliseconds (defaults to 60s)
 */
function startTimetableGoLiveJob(intervalMs = 60 * 1000) {
  if (goLiveInterval) return;

  const scheduleInitialSweep = () => {
    if (_initialGoLiveTimeout) clearTimeout(_initialGoLiveTimeout);
    _initialGoLiveTimeout = setTimeout(() => {
      checkAndDeployScheduledCommits().catch(() => {});
    }, 2000);
  };

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    scheduleInitialSweep();
  } else if (mongoose.connection) {
    mongoose.connection.once('connected', scheduleInitialSweep);
  }

  goLiveInterval = setInterval(() => {
    checkAndDeployScheduledCommits().catch(() => {});
  }, intervalMs);

  if (goLiveInterval && typeof goLiveInterval.unref === 'function') {
    goLiveInterval.unref();
  }
}

/**
 * Stops the periodic scheduled go-live worker
 */
function stopTimetableGoLiveJob() {
  if (goLiveInterval) {
    clearInterval(goLiveInterval);
    goLiveInterval = null;
  }
  if (_initialGoLiveTimeout) {
    clearTimeout(_initialGoLiveTimeout);
    _initialGoLiveTimeout = null;
  }
  isRunning = false;
}

module.exports = {
  checkAndDeployScheduledCommits,
  startTimetableGoLiveJob,
  stopTimetableGoLiveJob
};
