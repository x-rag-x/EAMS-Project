const { EventEmitter } = require('events');
const M = require('../../models');

const bus = new EventEmitter();
bus.setMaxListeners(0);

const LABELS = {
  receive:  'Receiving file',
  drive:    'Saving to Google Drive',
  read:     'Reading spreadsheet',
  validate: 'Validating rows',
  save:     'Saving to EAMS',
  rows:     'Saving records to database',
  zip:      'Building encrypted backup archive',
  backup:   'Archiving backup to Google Drive'
};

const PHASES = {
  stage: [
    { key: 'receive',  w: 10 },
    { key: 'drive',    w: 20 },
    { key: 'read',     w: 10 },
    { key: 'validate', w: 45 },
    { key: 'save',     w: 15 }
  ],
  rescan: [
    { key: 'read',     w: 20 },
    { key: 'validate', w: 60 },
    { key: 'save',     w: 20 }
  ],
  commit: [
    { key: 'rows',   w: 60 },
    { key: 'zip',    w: 15 },
    { key: 'backup', w: 25 }
  ]
};

function createTracker(batchId, kind = 'stage') {
  const defs = PHASES[kind] || PHASES.stage;
  let lastDb = 0;
  let lastEmit = 0;

  const st = {
    jobKind: kind,
    phase: defs[0].key,
    percent: 0,
    counters: { total: 0, processed: 0, eligible: 0, skipped: 0, committed: 0 },
    error: '',
    heartbeatAt: new Date(),
    phases: defs.map(d => ({
      key: d.key,
      label: LABELS[d.key] || d.key,
      status: 'pending',
      percent: 0,
      detail: '',
      startedAt: null,
      finishedAt: null
    }))
  };

  const calculateOverall = () => {
    const totalWeight = defs.reduce((sum, d) => sum + d.w, 0);
    if (!totalWeight) return 0;
    const weightedSum = defs.reduce((sum, d, idx) => {
      const p = st.phases[idx] ? (st.phases[idx].percent || 0) : 0;
      return sum + (d.w * p) / 100;
    }, 0);
    return Math.min(100, Math.round((weightedSum / totalWeight) * 100));
  };

  async function flush(force = false) {
    const now = Date.now();
    st.percent = calculateOverall();
    st.heartbeatAt = new Date();

    if (force || now - lastEmit > 120) {
      lastEmit = now;
      bus.emit(`batch:${batchId}`, { type: 'progress', data: st });
    }

    if (force || now - lastDb > 500) {
      lastDb = now;
      await M.BulkImportBatch.updateOne(
        { _id: batchId },
        { $set: { progress: st } }
      ).catch(err => console.warn('[Tracker Flush Error]:', err.message));
    }
  }

  const findPhase = (k) => st.phases.find(p => p.key === k);

  return {
    getState: () => st,
    start: (k, detail = '') => {
      const phase = findPhase(k);
      if (phase) {
        Object.assign(phase, { status: 'running', detail, startedAt: new Date() });
      }
      st.phase = k;
      return flush(true);
    },
    tick: (k, pct, detail, counters) => {
      const phase = findPhase(k);
      if (phase) {
        phase.percent = Math.max(0, Math.min(100, pct));
        if (detail !== undefined) phase.detail = detail;
      }
      if (counters) Object.assign(st.counters, counters);
      return flush(false);
    },
    done: (k, detail = '') => {
      const phase = findPhase(k);
      if (phase) {
        Object.assign(phase, { status: 'done', percent: 100, finishedAt: new Date() });
        if (detail) phase.detail = detail;
      }
      return flush(true);
    },
    warn: (k, detail = '') => {
      const phase = findPhase(k);
      if (phase) {
        Object.assign(phase, { status: 'warn', detail });
      }
      return flush(true);
    },
    fail: (k, err) => {
      const errorMsg = err?.message || String(err);
      const phase = findPhase(k);
      if (phase) {
        Object.assign(phase, { status: 'error', detail: errorMsg });
      }
      st.error = errorMsg;
      return flush(true);
    }
  };
}

module.exports = {
  bus,
  LABELS,
  PHASES,
  createTracker
};
