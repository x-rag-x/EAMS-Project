/**
 * services/bulk/stage.js
 * Stage Engine for bulk pipeline operations.
 * Enforces stage timing (>= 2s per stage in 'after' mode), heartbeats,
 * and structured progress.stage metadata.
 */

'use strict';

const STAGES = {
  stage: [
    { key: 'receive',  text: 'Uploading the file' },
    { key: 'drive',    text: 'Saving to Drive' },
    { key: 'read',     text: 'Reading spreadsheet' },
    { key: 'validate', text: 'Validating data' },
    { key: 'cleanup',  text: 'Cleaning up' },
    { key: 'done',     text: 'Done' }
  ],
  commit: [
    { key: 'db',       text: 'Saving to database' },
    { key: 'drive',    text: 'Saving to Google Drive' },
    { key: 'audit',    text: 'Logging action' },
    { key: 'close',    text: 'Closing chat' },
    { key: 'notify',   text: 'Notifying uploader' },
    { key: 'done',     text: 'Done' }
  ]
};

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

async function holdWithHeartbeat(tracker, holdMs, sleep = defaultSleep) {
  let remaining = holdMs;
  while (remaining > 0) {
    const chunk = Math.min(1000, remaining);
    await sleep(chunk);
    remaining -= chunk;
    if (tracker && typeof tracker.heartbeat === 'function') {
      await tracker.heartbeat();
    }
  }
}

async function runStage(tracker, kind, idx, work, opts = {}) {
  const list = STAGES[kind] || STAGES.stage;
  const stage = opts.text ? { key: (list[idx] && list[idx].key) || 'stage' + idx, text: opts.text } : (list[idx] || { key: 'stage' + idx, text: 'Processing' });

  let defaultHold = (kind === 'commit' ? 1500 : 2000);
  if (process.env.BULK_STAGE_HOLD_MS !== undefined) {
    const parsed = parseInt(process.env.BULK_STAGE_HOLD_MS, 10);
    if (!isNaN(parsed)) defaultHold = parsed;
  }
  const holdMs = opts.holdMs !== undefined ? opts.holdMs : defaultHold;
  const mode = opts.mode || 'after'; // 'after' = real time + holdMs
  const sleep = opts.sleep || defaultSleep;

  if (tracker && typeof tracker.setStage === 'function') {
    await tracker.setStage(idx, list.length, stage.key, stage.text);
  }

  const t0 = Date.now();
  const out = await work();
  const elapsed = Date.now() - t0;
  const hold = mode === 'after' ? holdMs : Math.max(0, holdMs - elapsed);

  if (hold > 0) {
    await holdWithHeartbeat(tracker, hold, sleep);
  }

  return out;
}

module.exports = {
  STAGES,
  runStage,
  holdWithHeartbeat
};
