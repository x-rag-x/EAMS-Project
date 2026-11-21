/**
 * public/js/shared/ttBlocks.shared.js
 * Multi-period block engine (doubles, 3-period labs, combined sessions).
 * UMD module: runs identically in the browser (<script>, window.TTBlocks) and on the server (require).
 *
 * Why this exists
 * ---------------
 * A multi-period session used to be stored in two incompatible ways at once:
 *   - "block" form: one root cell { period: 7, span: 3 }
 *   - "cell" form:  the root plus one continuation cell per extra period
 *     { period: 8, spanRootPeriod: 7, spanIndex: 1, isSpanContinuation: true }
 * Different writers produced different mixes (Autogen wrote continuation cells WITHOUT the
 * continuation flag, combined-class sync copied continuations WITHOUT their flags, clear/move
 * touched only the root). Readers then re-expanded continuations, so a 3-period lab read back as
 * P7-P9 + P8-P10 + P9-P11, doubles split into singles, and clears left ghost periods behind.
 *
 * The rule from now on
 * --------------------
 *   - Grids that people edit (workspace drafts, semester templates) store BLOCKS: one entry per
 *     session, with `span`.
 *   - Production `SectionTimetable.slots` stores CELLS: the root plus flagged continuations,
 *     keyed `${day}_${period}`, because attendance and teacher pages look periods up by key.
 *   - Every read and every write passes through toBlocks() first. toBlocks() accepts either form,
 *     any legacy mix, an array or a keyed object, and always returns clean, non-overlapping blocks.
 *     toCells() / toSlotsObj() are built on toBlocks(), so expanding twice can never overflow.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TTBlocks = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_MAX_PERIOD = 9;

  // ── Small helpers ──

  function toPeriod(value, fallbackKey) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (value !== undefined && value !== null && value !== '') {
      const n = parseInt(String(value).replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) return n;
    }
    if (fallbackKey) {
      const part = String(fallbackKey).split('_')[1];
      const n = parseInt(String(part || '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function dayFromKey(key) {
    return key ? String(key).split('_')[0] : '';
  }

  /** Case-insensitive day identity: 'Monday', 'monday' and 'Mon' all match. */
  function dayKey(day) {
    return String(day || '').trim().slice(0, 3).toLowerCase();
  }

  function toSpan(value) {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  function norm(v) {
    return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  }

  function idOrName(id, name) {
    return id ? `id:${String(id)}` : `n:${norm(name)}`;
  }

  /** Two cells belong to the same session when subject, teacher and activity match. */
  function sameSession(a, b) {
    if (!a || !b) return false;
    return idOrName(a.subjectId, a.subject) === idOrName(b.subjectId, b.subject)
      && idOrName(a.teacherId, a.teacher || a.teacherName) === idOrName(b.teacherId, b.teacher || b.teacherName)
      && idOrName(a.activityId, a.activityLabel) === idOrName(b.activityId, b.activityLabel);
  }

  /** spanRootPeriod as a usable number, or null (0, null and '' mean "not set"). */
  function rootPeriodOf(cell) {
    const r = toPeriod(cell && cell.spanRootPeriod);
    return r !== null && r >= 1 ? r : null;
  }

  /** A continuation cell is any cell that says it belongs to a block rooted at an earlier period. */
  function isContinuation(cell) {
    if (!cell) return false;
    if (cell.isSpanContinuation === true) return true;
    if (Number(cell.spanIndex) > 0) return true;
    const p = toPeriod(cell.period);
    const r = rootPeriodOf(cell);
    return p !== null && r !== null && r < p;
  }

  /**
   * Lab flag. Explicit isLab / type 'Lab' wins. A block of 3 or more periods with no flag at all is
   * a lab (only labs run 3 periods: rulebook PER-3, PER-15). A 2-period block is NEVER a lab by
   * inference: the old `span > 1` guess turned every double into a lab.
   */
  function inferIsLab(cell, span) {
    if (cell.isLab === true) return true;
    if (cell.isLab === false) return false;
    if (String(cell.type || '').toLowerCase() === 'lab') return true;
    return span >= 3;
  }

  function combinedList(cell) {
    if (Array.isArray(cell.combinedWith)) return cell.combinedWith.filter(Boolean).map(String);
    return cell.combinedWith ? [String(cell.combinedWith)] : [];
  }

  /** Collect cells from an array, a keyed slots object, or a Mongoose array. */
  function collectCells(input) {
    const out = [];
    if (!input) return out;
    if (Array.isArray(input)) {
      input.forEach(c => {
        if (!c) return;
        const plain = typeof c.toObject === 'function' ? c.toObject() : c;
        out.push({ key: null, cell: plain });
      });
      return out;
    }
    if (typeof input === 'object') {
      Object.keys(input).forEach(key => {
        const c = input[key];
        if (!c || typeof c !== 'object') return;
        const plain = typeof c.toObject === 'function' ? c.toObject() : c;
        out.push({ key, cell: plain });
      });
    }
    return out;
  }

  const UI_ONLY_FIELDS = ['_id', 'id', 'duration', 'status', 'source', 'section', 'classId', 'className'];

  /** Build a clean block (root form) from any cell. All unknown fields are kept. */
  function makeBlock(cell, day, period, span) {
    const b = Object.assign({}, cell);
    b.day = day;
    b.period = period;
    b.span = span;
    b.spanRootPeriod = period;
    b.spanIndex = 0;
    b.isSpanContinuation = false;
    b.isLab = inferIsLab(cell, span);
    b.combinedWith = combinedList(cell);
    if (!b.type) b.type = b.isLab ? 'Lab' : (b.combinedWith.length ? 'Combined' : 'Theory');
    // Editor-only fields never belong in a stored slot.
    UI_ONLY_FIELDS.forEach(f => { delete b[f]; });
    return b;
  }

  // 'repaired': legacy data was fixed silently and safely. 'conflict': data was dropped or is
  // still wrong, and a person should look at it.
  const ISSUE_SEVERITY = {
    absorbed_continuation: 'repaired',
    extended_block: 'repaired',
    orphan_continuation: 'repaired',
    duplicate_cell: 'conflict',
    overlap: 'conflict',
    runs_off_day: 'conflict'
  };

  function issue(kind, day, period, message, extra) {
    return Object.assign({ kind, severity: ISSUE_SEVERITY[kind] || 'conflict', day, period, message }, extra || {});
  }

  /** Only the issues a person needs to see. */
  function conflictsOnly(issues) {
    return (issues || []).filter(i => i.severity === 'conflict');
  }

  // ── Core: any input → clean blocks ──

  /**
   * toBlocks(input, opts) → { blocks, issues }
   *   input: array of cells/blocks, or a slots object keyed `${day}_${period}`
   *   opts.maxPeriod: last period of the day (default 9); blocks running past it are reported
   *
   * Repairs applied (each reported in `issues`):
   *   absorbed_continuation  an unflagged cell inside a block of the same session (old Autogen and
   *                          combined-sync output) is folded into that block
   *   extended_block         a root whose span was shorter than its own flagged continuations
   *   orphan_continuation    a continuation whose root is gone (old clear/move left it) is dropped
   *   duplicate_cell         two roots on the same day and period: the first is kept
   *   overlap                a different session starts inside an earlier block: the earlier
   *                          block is kept, the later cell is dropped and reported
   *   runs_off_day           a block runs past opts.maxPeriod (kept, reported)
   */
  function toBlocks(input, opts) {
    const options = opts || {};
    const maxPeriod = Number(options.maxPeriod) || DEFAULT_MAX_PERIOD;
    const issues = [];
    const roots = [];
    const conts = [];

    collectCells(input).forEach(({ key, cell }) => {
      const day = cell.day || dayFromKey(key);
      const period = toPeriod(cell.period, key);
      if (!day || period === null || period < 1) return;
      const entry = { cell, day, period, span: toSpan(cell.span !== undefined ? cell.span : cell.duration) };
      if (isContinuation(cell)) {
        entry.rootPeriod = rootPeriodOf(cell);
        if (entry.rootPeriod === null) entry.rootPeriod = period - (Number(cell.spanIndex) || 0);
        conts.push(entry);
      } else {
        roots.push(entry);
      }
    });

    // Extend roots from their own flagged continuations (a root saved with span 1 but 2 flagged
    // continuations is really a 3-period block).
    roots.forEach(r => {
      conts.forEach(c => {
        if (dayKey(c.day) === dayKey(r.day) && c.rootPeriod === r.period && sameSession(c.cell, r.cell)) {
          const needed = c.period - r.period + 1;
          if (needed > r.span) {
            issues.push(issue('extended_block', r.day, r.period,
              `${r.cell.subject || 'Session'} on ${r.day} P${r.period} extended from ${r.span} to ${needed} periods to match its saved continuation cells`));
            r.span = needed;
          }
        }
      });
    });

    // Order: day, then period, then longer span first so a block wins over its own stray cells.
    roots.sort((a, b) => {
      const d = dayKey(a.day).localeCompare(dayKey(b.day));
      if (d) return d;
      if (a.period !== b.period) return a.period - b.period;
      return b.span - a.span;
    });

    const blocks = [];
    const byDay = new Map(); // dayKey -> blocks on that day (in period order)

    roots.forEach(r => {
      const dk = dayKey(r.day);
      if (!byDay.has(dk)) byDay.set(dk, []);
      const dayBlocks = byDay.get(dk);
      const host = dayBlocks.find(b => b.period <= r.period && r.period < b.period + b.span);

      if (host) {
        if (host.period === r.period && !sameSession(host, r.cell)) {
          issues.push(issue('duplicate_cell', r.day, r.period,
            `Two sessions saved on ${r.day} P${r.period}: kept ${host.subject || 'the first'}, dropped ${r.cell.subject || 'the second'}`,
            { dropped: r.cell }));
          return;
        }
        if (sameSession(host, r.cell)) {
          // Same session inside the block: an unflagged continuation (old Autogen output, or a
          // continuation copied with the block's span by the old combined sync). Fold it in; its
          // own span is ignored so it can never stretch the block.
          if (host.period !== r.period) {
            issues.push(issue('absorbed_continuation', r.day, r.period,
              `${r.cell.subject || 'Session'} on ${r.day} P${r.period} is part of the block starting P${host.period}`));
          }
          return;
        }
        issues.push(issue('overlap', r.day, r.period,
          `${r.cell.subject || 'A session'} on ${r.day} P${r.period} starts inside ${host.subject || 'another block'} (P${host.period}-P${host.period + host.span - 1}); kept the earlier block`,
          { dropped: r.cell, keptPeriod: host.period }));
        return;
      }

      const block = makeBlock(r.cell, r.day, r.period, r.span);
      dayBlocks.push(block);
      dayBlocks.sort((a, b) => a.period - b.period);
      blocks.push(block);
    });

    // Continuations: fine when their block covers them, dropped otherwise.
    conts.forEach(c => {
      const dayBlocks = byDay.get(dayKey(c.day)) || [];
      const cover = dayBlocks.find(b => b.period <= c.period && c.period < b.period + b.span);
      if (cover && sameSession(cover, c.cell)) return;
      if (cover) {
        issues.push(issue('overlap', c.day, c.period,
          `A leftover period of ${c.cell.subject || 'a removed block'} on ${c.day} P${c.period} sits under ${cover.subject || 'another session'}; dropped`,
          { dropped: c.cell }));
        return;
      }
      issues.push(issue('orphan_continuation', c.day, c.period,
        `${c.cell.subject || 'A period'} on ${c.day} P${c.period} belonged to a block at P${c.rootPeriod} that no longer exists; dropped`,
        { dropped: c.cell }));
    });

    blocks.forEach(b => {
      if (b.period + b.span - 1 > maxPeriod) {
        issues.push(issue('runs_off_day', b.day, b.period,
          `${b.subject || 'Block'} on ${b.day} P${b.period} runs ${b.span} periods, past P${maxPeriod}`));
      }
    });

    blocks.sort((a, b) => {
      const d = dayKey(a.day).localeCompare(dayKey(b.day));
      return d || (a.period - b.period);
    });

    return { blocks, issues };
  }

  /** Shorthand: blocks only. */
  function blocksOf(input, opts) {
    return toBlocks(input, opts).blocks;
  }

  // ── Blocks → cells ──

  /** Expand to root + flagged continuation cells. Safe on any input (it collapses first). */
  function toCells(input, opts) {
    const cells = [];
    blocksOf(input, opts).forEach(b => {
      for (let i = 0; i < b.span; i++) {
        const c = Object.assign({}, b);
        c.period = b.period + i;
        c.spanRootPeriod = b.period;
        c.spanIndex = i;
        c.isSpanContinuation = i > 0;
        cells.push(c);
      }
    });
    return cells;
  }

  /** Expand to the production map keyed `${day}_${period}`. */
  function toSlotsObj(input, opts) {
    const out = {};
    toCells(input, opts).forEach(c => { out[`${c.day}_${c.period}`] = c; });
    return out;
  }

  // ── Editing operations on blocks (all return new arrays) ──

  function covers(block, day, period) {
    return dayKey(block.day) === dayKey(day) && block.period <= period && period < block.period + block.span;
  }

  function rangesOverlap(a, b) {
    return dayKey(a.day) === dayKey(b.day)
      && a.period <= b.period + b.span - 1
      && b.period <= a.period + a.span - 1;
  }

  /** The block covering a cell, or null. */
  function blockAt(blocks, day, period) {
    const p = toPeriod(period);
    return (blocks || []).find(b => covers(b, day, p)) || null;
  }

  /** Remove the whole block covering (day, period), whichever of its cells was named. */
  function removeAt(blocks, day, period) {
    const target = blockAt(blocks, day, period);
    if (!target) return { blocks: (blocks || []).slice(), removed: null };
    return { blocks: blocks.filter(b => b !== target), removed: target };
  }

  /**
   * Place a block. Every existing block it overlaps is removed and returned in `replaced`
   * (setting a lab over P1-P3 replaces the singles that were there, and never leaves half of an
   * old block behind).
   */
  function place(blocks, cell, opts) {
    const b = blocksOf([cell], opts)[0];
    if (!b) return { blocks: (blocks || []).slice(), placed: null, replaced: [] };
    const replaced = [];
    const kept = [];
    (blocks || []).forEach(x => (rangesOverlap(x, b) ? replaced : kept).push(x));
    kept.push(b);
    return { blocks: blocksOf(kept, opts), placed: b, replaced };
  }

  /**
   * Move the block covering `from` so that the cell that was grabbed lands on `to`.
   * Refuses (ok: false) when the target range is occupied by another block or runs off the day.
   */
  function move(blocks, from, to, opts) {
    const maxPeriod = Number((opts || {}).maxPeriod) || DEFAULT_MAX_PERIOD;
    const src = blockAt(blocks, from.day, from.period);
    if (!src) return { ok: false, code: 'NO_BLOCK', message: `Nothing to move on ${from.day} P${from.period}`, blocks: (blocks || []).slice() };
    const offset = toPeriod(from.period) - src.period;
    const newRoot = toPeriod(to.period) - offset;
    if (newRoot < 1 || newRoot + src.span - 1 > maxPeriod) {
      return { ok: false, code: 'OFF_DAY', message: `${src.subject || 'Block'} needs ${src.span} periods and does not fit from P${newRoot} on ${to.day}`, blocks: blocks.slice() };
    }
    const moved = Object.assign({}, src, { day: to.day, period: newRoot, spanRootPeriod: newRoot });
    const others = blocks.filter(b => b !== src);
    const clash = others.filter(b => rangesOverlap(b, moved));
    if (clash.length) {
      return {
        ok: false,
        code: 'TARGET_OCCUPIED',
        message: `${to.day} P${newRoot}-P${newRoot + src.span - 1} is taken by ${clash.map(c => `${c.subject || 'a session'} (P${c.period})`).join(', ')}`,
        blocks: blocks.slice(),
        clash
      };
    }
    return { ok: true, blocks: blocksOf(others.concat([moved]), opts), moved, from: src };
  }

  // ── Combined classes ──

  /** Blocks of `sourceName` that are shared with `targetName`, rewritten for the target class. */
  function ownedBy(block, sourceName, sourceId) {
    if (!block.primaryClassId && !block.primaryClassName) return true;
    if (sourceId && block.primaryClassId && String(block.primaryClassId) === String(sourceId)) return true;
    return Boolean(block.primaryClassName) && norm(block.primaryClassName) === norm(sourceName);
  }

  /**
   * Only blocks the source class owns are sent on. A copy it received from another class
   * (primaryClassName set to that class) is never re-broadcast, so two member classes saving in
   * turn cannot steal ownership from each other (rulebook PER-14: the owner places and edits it).
   */
  function combinedBlocksFor(sourceBlocks, sourceName, sourceId, targetName) {
    const t = norm(targetName);
    return (sourceBlocks || [])
      .filter(b => ownedBy(b, sourceName, sourceId))
      .filter(b => combinedList(b).some(n => norm(n) === t))
      .map(b => {
        const all = [sourceName].concat(combinedList(b));
        return Object.assign({}, b, {
          type: 'Combined',
          combinedWith: all.filter(n => norm(n) !== t),
          primaryClassId: sourceId || b.primaryClassId || null,
          primaryClassName: sourceName
        });
      });
  }

  /**
   * Write a source class's combined blocks into a member class's blocks:
   *   1. drop every block that came from this source before (so moved or deleted combined
   *      sessions do not linger in the member class),
   *   2. place each incoming combined block, replacing whatever it overlaps.
   */
  function applyCombined(targetBlocks, incoming, sourceName, sourceId, opts) {
    const src = norm(sourceName);
    let blocks = blocksOf(targetBlocks, opts).filter(b => {
      const fromSource = (sourceId && b.primaryClassId && String(b.primaryClassId) === String(sourceId))
        || Boolean(b.primaryClassName && norm(b.primaryClassName) === src);
      return !fromSource;
    });
    const replaced = [];
    (incoming || []).forEach(b => {
      const r = place(blocks, b, opts);
      blocks = r.blocks;
      replaced.push(...r.replaced);
    });
    return { blocks, replaced };
  }

  /** Count teaching periods: each block counts its span once (never once per cell). */
  function periodCount(input, filterFn) {
    return blocksOf(input).filter(b => (filterFn ? filterFn(b) : true)).reduce((n, b) => n + b.span, 0);
  }

  return {
    DEFAULT_MAX_PERIOD,
    toPeriod,
    dayKey,
    isContinuation,
    sameSession,
    inferIsLab,
    toBlocks,
    blocksOf,
    toCells,
    toSlotsObj,
    blockAt,
    overlaps: rangesOverlap,
    removeAt,
    place,
    move,
    ownedBy,
    combinedBlocksFor,
    applyCombined,
    /** Names of every class a block list shares a combined session with (owned blocks only). */
    combinedPartners(blocks, sourceName, sourceId) {
      const names = new Set();
      (blocks || []).filter(b => ownedBy(b, sourceName, sourceId)).forEach(b => combinedList(b).forEach(n => names.add(n)));
      return Array.from(names);
    },
    periodCount,
    conflictsOnly
  };
}));
