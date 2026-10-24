/**
 * services/bellScheduler.js
 * Periodic scheduler that pushes timetable context updates to boards at period boundaries.
 * Runs every 30 seconds, detects boards whose period just changed, and calls pushContextToRoomBoards.
 */

const mongoose = require('mongoose');
const M = require('../models');
const { resolveRoomCurrentContext } = require('../utils/timetableResolver');
const { pushContextToRoomBoards, activeBoardSockets } = require('./board.socket');

let schedulerInterval = null;
let lastKnownPeriods = new Map(); // roomId -> { periodNumber, scheduleStatus }

/**
 * Start the bell scheduler
 */
function startBellScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Run every 30 seconds
  schedulerInterval = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[BellScheduler] Error during tick:', err.message);
    }
  }, 30000);

  console.log('   ✓ Bell Scheduler: active (30s interval)');
}

/**
 * Stop the bell scheduler
 */
function stopBellScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    lastKnownPeriods.clear();
    console.log('   ✓ Bell Scheduler: stopped');
  }
}

/**
 * Main scheduler tick - check all connected boards for period changes
 */
async function tick() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
  const roomsToUpdate = new Set();

  // Check each connected board's room for period boundary changes
  for (const [deviceId, session] of activeBoardSockets.entries()) {
    const roomId = session.roomId;
    if (!roomId) continue;

    try {
      const context = await resolveRoomCurrentContext(roomId);

      const currentPeriodNum = context.period?.periodNumber || null;
      const currentStatus = context.state;

      const key = String(roomId);
      const last = lastKnownPeriods.get(key);

      // Detect period boundary crossing
      if (last) {
        const periodChanged = last.periodNumber !== currentPeriodNum;
        const statusChanged = last.scheduleStatus !== currentStatus;

        if (periodChanged || statusChanged) {
          console.log(`[BellScheduler] Room ${roomId}: period ${last.periodNumber}->${currentPeriodNum}, status ${last.scheduleStatus}->${currentStatus}`);
          roomsToUpdate.add(roomId);
        }
      }

      // Update last known state
      lastKnownPeriods.set(key, {
        periodNumber: currentPeriodNum,
        scheduleStatus: currentStatus
      });
    } catch (err) {
      console.error(`[BellScheduler] Error resolving context for room ${roomId}:`, err.message);
    }
  }

  // Push context updates to affected rooms
  for (const roomId of roomsToUpdate) {
    try {
      await pushContextToRoomBoards(roomId);
    } catch (err) {
      console.error(`[BellScheduler] Failed to push context to room ${roomId}:`, err.message);
    }
  }
}

/**
 * Force a context push for a specific room (e.g., after override creation)
 */
async function forcePushRoomContext(roomId) {
  try {
    await pushContextToRoomBoards(roomId);
    // Update our tracking
    const context = await resolveRoomCurrentContext(roomId);
    lastKnownPeriods.set(String(roomId), {
      periodNumber: context.period?.periodNumber || null,
      scheduleStatus: context.state
    });
    return true;
  } catch (err) {
    console.error(`[BellScheduler] Force push failed for room ${roomId}:`, err.message);
    return false;
  }
}

/**
 * Get scheduler status for monitoring
 */
function getSchedulerStatus() {
  return {
    running: !!schedulerInterval,
    trackedRooms: lastKnownPeriods.size,
    rooms: Array.from(lastKnownPeriods.entries()).map(([roomId, state]) => ({ roomId, ...state }))
  };
}

module.exports = {
  startBellScheduler,
  stopBellScheduler,
  tick,
  forcePushRoomContext,
  getSchedulerStatus
};