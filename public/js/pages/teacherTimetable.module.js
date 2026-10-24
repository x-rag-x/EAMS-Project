/**
 * EAMS · Adaptive Teacher Timetable Module
 * ═══════════════════════════════════════════════════════════════════════
 * Handles SET_1 (Years I & IV) and SET_2 (Years II & III) together.
 * Header is built from the real time boundaries of the timing sets,
 * not from period numbers -> no duplicate P3 / P8 / P11.
 * Slots placed by time (start/end in minutes). TextContent-safe (no XSS).
 *
 * API:
 *   TeacherTimetable.mount(container, {
 *     timingSets : [...],   // DB.get('timing-sets')
 *     slots      : [...],   // getMyTimetable()
 *     days       : [['Mon','Monday'], ...],  // optional (default Mon-Sat)
 *     timeFormat : '24h' | '12h',            // default '24h'
 *     today      : 'Wed',                    // optional override
 *     onSlotClick: function(rawSlot, event)
 *   }) -> { update({timingSets, slots}), model() }
 * ═══════════════════════════════════════════════════════════════════════
 */
(function (global) {
  'use strict';

  var DEFAULT_DAYS = [['Mon','Monday'],['Tue','Tuesday'],['Wed','Wednesday'],['Thu','Thursday'],['Fri','Friday'],['Sat','Saturday']];
  var LANE_COLORS  = ['#2e7d32', '#00796b', '#6d4c9f', '#b45309'];   // lane 0 = green, lane 1 = teal ...
  var ROMAN = { '1':'I', '2':'II', '3':'III', '4':'IV', '5':'V' };
  var ROMAN_ORDER = ['I','II','III','IV','V'];
  var PX_PER_MIN = 2.5;       // min column width = minutes x 2.5  (45 min -> 112 px)
  var BREAK_PX   = 34;        // fixed width of a break / lunch / tea column

  /* ── CLASS COLOR PALETTE & HELPERS ────────────────────────────────── */
  var CLASS_PALETTE = [
    { name: 'blue',    bg: '#eff6ff', border: '#2563eb', borderLight: '#bfdbfe', text: '#1e40af', badgeBg: '#dbeafe', badgeText: '#1d4ed8' },
    { name: 'purple',  bg: '#f5f3ff', border: '#7c3aed', borderLight: '#ddd6fe', text: '#5b21b6', badgeBg: '#ede9fe', badgeText: '#6d28d9' },
    { name: 'emerald', bg: '#f0fdf4', border: '#16a34a', borderLight: '#bbf7d0', text: '#166534', badgeBg: '#dcfce7', badgeText: '#15803d' },
    { name: 'amber',   bg: '#fffbeb', border: '#d97706', borderLight: '#fde68a', text: '#92400e', badgeBg: '#fef3c7', badgeText: '#b45309' },
    { name: 'rose',    bg: '#fff1f2', border: '#e11d48', borderLight: '#fecdd3', text: '#9f1239', badgeBg: '#ffe4e6', badgeText: '#be123c' },
    { name: 'cyan',    bg: '#ecfeff', border: '#0891b2', borderLight: '#a5f3fc', text: '#155e75', badgeBg: '#cffafe', badgeText: '#0e7490' },
    { name: 'orange',  bg: '#fff7ed', border: '#ea580c', borderLight: '#fed7aa', text: '#9a3412', badgeBg: '#ffedd5', badgeText: '#c2410c' },
    { name: 'indigo',  bg: '#eef2ff', border: '#4f46e5', borderLight: '#c7d2fe', text: '#3730a3', badgeBg: '#e0e7ff', badgeText: '#4338ca' },
    { name: 'fuchsia', bg: '#fdf4ff', border: '#c026d3', borderLight: '#f5d0fe', text: '#86198f', badgeBg: '#fae8ff', badgeText: '#a21caf' },
    { name: 'teal',    bg: '#f0fdfa', border: '#0d9488', borderLight: '#99f6e4', text: '#115e59', badgeBg: '#ccfbf1', badgeText: '#0f766e' },
    { name: 'lime',    bg: '#f7fee7', border: '#65a30d', borderLight: '#d9f99d', text: '#3f6212', badgeBg: '#ecfccb', badgeText: '#4d7c0f' },
    { name: 'slate',   bg: '#f8fafc', border: '#475569', borderLight: '#cbd5e1', text: '#1e293b', badgeBg: '#e2e8f0', badgeText: '#334155' }
  ];

  function getClassKey(raw) {
    if (!raw) return '';
    return String(raw.className || raw.class || raw.section || raw.classId || '').trim();
  }

  function buildClassColorMap(slots) {
    var map = new Map();
    var seen = [];
    (slots || []).forEach(function (s) {
      var raw = s.raw || s;
      var name = getClassKey(raw);
      if (name && seen.indexOf(name) === -1) {
        seen.push(name);
      }
    });
    seen.sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    seen.forEach(function (name, i) {
      map.set(name, CLASS_PALETTE[i % CLASS_PALETTE.length]);
    });
    return map;
  }

  function getClassColor(className, classColorMap) {
    var key = String(className || '').trim();
    if (!key) return null;
    if (classColorMap && classColorMap.has && classColorMap.has(key)) {
      return classColorMap.get(key);
    }
    var hash = 0;
    for (var i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return CLASS_PALETTE[Math.abs(hash) % CLASS_PALETTE.length];
  }

  /* ── time helpers ─────────────────────────────────────────────────── */
  function toMin(t) {
    if (typeof t === 'number') return t;
    var m = String(t == null ? '' : t).trim().match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)?$/i);
    if (!m) return NaN;
    var h = +m[1], mi = +m[2], ap = m[3] && m[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mi;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(min, f) {
    var h = Math.floor(min / 60), m = min % 60;
    if (f === '12h') return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
    return pad(h) + ':' + pad(m);
  }
  function range(s, e, f) { return fmt(s, f) + '–' + fmt(e, f); }

  /* ── 1. normalise ONE timing set from the DB shape ────────────────────
     The DB stores breaks INSIDE periods[] with periodNumber:0, isBreak:true.
     We split them apart here.                                            */
  function isBreakEntry(p) {
    if (p.isBreak === true) return true;
    var t = String(p.type || '').toLowerCase();
    if (t === 'break' || t === 'lunch' || t === 'tea' || t === 'interval') return true;
    var bt = String(p.breakType || 'none').toLowerCase();
    return bt !== 'none' && bt !== '';
  }
  function breakKind(p) {
    var s = (String(p.breakType || '') + ' ' + String(p.type || '') + ' ' + String(p.label || '')).toLowerCase();
    if (/lunch/.test(s)) return 'Lunch';
    if (/tea|snack/.test(s)) return 'Tea';
    return 'Break';
  }
  function yearsLabel(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (y) {
      var s = String(y).trim().toUpperCase(); s = ROMAN[s] || s;
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    });
    out.sort(function (a, b) { return ROMAN_ORDER.indexOf(a) - ROMAN_ORDER.indexOf(b); });
    return out.join(' & ');
  }
  function normaliseSet(raw, idx) {
    var items = [], auto = 0;
    (raw.periods || []).forEach(function (p) {
      var s = toMin(p.start), e = toMin(p.end);
      if (isNaN(s) || isNaN(e) || e <= s) return;
      if (isBreakEntry(p)) {
        items.push({ kind: 'break', brk: breakKind(p), label: breakKind(p), s: s, e: e });
      } else {
        auto++;
        var n = Number(p.periodNumber || p.number) || auto;
        items.push({ kind: 'period', num: n, label: 'P' + n, s: s, e: e });
      }
    });
    items.sort(function (a, b) { return a.s - b.s; });
    // a gap between two items with no break stored -> synthesise one (never invent time, only fill it)
    var filled = [];
    items.forEach(function (it, i) {
      if (i > 0 && it.s > items[i - 1].e) {
        var big = (it.s - items[i - 1].e) >= 30;
        filled.push({ kind: 'break', brk: big ? 'Lunch' : 'Break', label: big ? 'Lunch' : 'Break', s: items[i - 1].e, e: it.s, synthetic: true });
      }
      filled.push(it);
    });
    var code = raw.code || raw.name || ('SET_' + (idx + 1));
    return {
      code: code,
      short: /^SET[_\s-]*\d+$/i.test(code) ? code.replace(/^SET[_\s-]*/i, 'Set ') : (raw.name || code),
      name: raw.name || code,
      years: yearsLabel(raw.applicableYears),
      isDefault: !!raw.isDefault,
      items: filled
    };
  }

  var CANONICAL_TIMING_SETS = [
    {
      code: 'SET_1',
      name: 'Timing Set 1 (Years I & IV)',
      applicableYears: ['1', '4', 'I', 'IV'],
      morningBreakAfter: 2,
      lunchAfter: 5,
      isDefault: true,
      periods: [
        { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
        { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '10:00', end: '10:15', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
        { periodNumber: 3, number: 3, start: '10:15', end: '11:00', label: 'Period 3', isBreak: false, breakType: 'None' },
        { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
        { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '12:30', end: '13:15', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
        { periodNumber: 6, number: 6, start: '13:15', end: '14:00', label: 'Period 6', isBreak: false, breakType: 'None' },
        { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '14:45', end: '15:00', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
        { periodNumber: 8, number: 8, start: '15:00', end: '15:45', label: 'Period 8', isBreak: false, breakType: 'None' },
        { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
      ]
    },
    {
      code: 'SET_2',
      name: 'Timing Set 2 (Years II & III)',
      applicableYears: ['2', '3', 'II', 'III'],
      morningBreakAfter: 3,
      lunchAfter: 6,
      isDefault: false,
      periods: [
        { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
        { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
        { periodNumber: 3, number: 3, start: '10:00', end: '10:45', label: 'Period 3', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '10:45', end: '11:00', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
        { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
        { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
        { periodNumber: 6, number: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
        { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
        { periodNumber: 8, number: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, breakType: 'None' },
        { periodNumber: 0, number: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
        { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
      ]
    }
  ];

  function sanitizeSets(rawSets) {
    var list = (Array.isArray(rawSets) && rawSets.length) ? rawSets.slice() : CANONICAL_TIMING_SETS.slice();
    var hasS1 = list.some(function(s) { return s && s.code === 'SET_1'; });
    var hasS2 = list.some(function(s) { return s && s.code === 'SET_2'; });
    if (!hasS1) list.unshift(CANONICAL_TIMING_SETS[0]);
    if (!hasS2) list.push(CANONICAL_TIMING_SETS[1]);

    // Check if SET_1 has stale lunchAfter: 6 (lacks 12:30 lunch break)
    return list.map(function(s) {
      if (s && s.code === 'SET_1') {
        var hasEarlyLunch = Array.isArray(s.periods) && s.periods.some(function(p) {
          return (p.isBreak || p.periodNumber === 0) && p.start === '12:30';
        });
        if (s.lunchAfter === 6 || !hasEarlyLunch) {
          return CANONICAL_TIMING_SETS[0];
        }
      }
      return s;
    });
  }

  /* ── 2. resolve a slot -> { set, start, end } in minutes ────────────────
     Preferred source = the slot's own timing set + periodNumber + span     */
  function dayKey(v) { return String(v || '').trim().slice(0, 3).toLowerCase(); }
  function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function resolveSlot(raw, byCode, defCode) {
    var code = (raw.timingSetCode && byCode[raw.timingSetCode]) ? raw.timingSetCode : null;
    if (!code) {
      var cName = String(raw.className || raw.class || raw.section || '').toUpperCase();
      if (/\b(II|III|2ND|3RD|Y2|Y3|YEAR\s*[23]|SEM\s*[3456]|25-29|24-28)\b/i.test(cName)) {
        if (byCode['SET_2']) code = 'SET_2';
      } else if (/\b(I|IV|1ST|4TH|Y1|Y4|YEAR\s*[14]|SEM\s*[1278]|26-30|23-27)\b/i.test(cName)) {
        if (byCode['SET_1']) code = 'SET_1';
      }
      if (!code && typeof _masterData !== 'undefined' && Array.isArray(_masterData.classes)) {
        var foundCls = _masterData.classes.find(function(c) {
          return (raw.classId && String(c._id) === String(raw.classId)) || (c.name && String(c.name).toUpperCase() === cName);
        });
        if (foundCls && foundCls.year) {
          var yr = String(foundCls.year);
          if (yr === '2' || yr === '3' || yr === 'II' || yr === 'III') {
            if (byCode['SET_2']) code = 'SET_2';
          } else if (yr === '1' || yr === '4' || yr === 'I' || yr === 'IV') {
            if (byCode['SET_1']) code = 'SET_1';
          }
        }
      }
      if (!code && (raw.end === '10:45' || raw.start === '10:00')) {
        if (byCode['SET_2']) code = 'SET_2';
      }
      if (!code) code = defCode;
    }
    var set = byCode[code];
    var pRaw = raw.periodNumber != null ? raw.periodNumber : raw.period;
    var num = parseInt(String(pRaw == null ? '' : pRaw).replace(/\D/g, ''), 10);
    var span = Math.max(1, Number(raw.span || raw.duration || 1) || 1);
    var s = NaN, e = NaN;
    if (set && num) {
      var periods = set.items.filter(function (i) { return i.kind === 'period'; });
      var first = periods.filter(function (p) { return p.num === num; })[0];
      var last  = periods.filter(function (p) { return p.num === num + span - 1; })[0] ||
                  periods.filter(function (p) { return p.num >= num && p.num <= num + span - 1; }).pop();
      if (first && last) { s = first.s; e = last.e; }
    }
    if (isNaN(s) || isNaN(e)) { s = toMin(raw.start); e = toMin(raw.end); }
    if (isNaN(s) || isNaN(e) || e <= s) return null;
    var sub  = raw.role === 'substitute' || raw.isSubstitute === true;
    var lab  = raw.type === 'Lab' || raw.isLab === true || span >= 2;
    var comb = Array.isArray(raw.combinedWith) && raw.combinedWith.length > 0;
    return { raw: raw, setCode: code, day: dayKey(raw.day || raw.dayFull), s: s, e: e, span: span,
             variant: sub ? 'sub' : lab ? 'lab' : comb ? 'comb' : 'theory', clash: false };
  }

  /* ── 3. build the shared time axis ────────────────────────────────────
     Every start/end of every visible set is a boundary; two boundaries
     enclose one grid column. A column is "common" when every visible set
     has the identical item there (same period/break, same start/end).
     Runs of non-common columns form a FORK ZONE with one header lane per
     set. With a single visible set nothing is ever a fork.                */
  function buildAxis(sets) {
    var b = {};
    sets.forEach(function (st) { st.items.forEach(function (i) { b[i.s] = 1; b[i.e] = 1; }); });
    var bounds = Object.keys(b).map(Number).sort(function (x, y) { return x - y; });
    var segs = [];
    for (var i = 0; i < bounds.length - 1; i++) {
      var s = bounds[i], e = bounds[i + 1];
      var covers = sets.map(function (st) {
        return st.items.filter(function (it) { return it.s <= s && it.e >= e; })[0] || null;
      });
      var keys = covers.map(function (c) { return c ? c.kind + '|' + c.label + '|' + c.s + '|' + c.e : '∅'; });
      var allSame = keys.every(function (k) { return k === keys[0]; });
      var empty = keys.every(function (k) { return k === '∅'; });
      var brks = covers.filter(function (c) { return c && c.kind === 'break'; }).length;
      segs.push({ i: i, s: s, e: e, covers: covers, empty: empty, common: allSame && !empty,
                  allBreak: brks === sets.length, someBreak: brks > 0 && brks < sets.length });
    }
    var groups = [];
    segs.forEach(function (sg) {
      var last = groups[groups.length - 1];
      if (sg.empty) { groups.push({ type: 'gap', segs: [sg] }); }
      else if (sg.common) { groups.push({ type: 'common', segs: [sg], item: sg.covers[0] }); }
      else if (last && last.type === 'fork') { last.segs.push(sg); }
      else { groups.push({ type: 'fork', segs: [sg] }); }
    });
    return { segs: segs, groups: groups, lanes: sets,
             hasFork: groups.some(function (g) { return g.type === 'fork'; }) };
  }

  /* ── 4. the pure model (no DOM) – also handy for unit tests ─────────── */
  function colAtStart(axis, t) {
    var sg = axis.segs, k;
    for (k = 0; k < sg.length; k++) if (sg[k].s === t) return { c: k, exact: true };
    for (k = 0; k < sg.length; k++) if (sg[k].s < t && t < sg[k].e) return { c: k, exact: false };
    for (k = 0; k < sg.length; k++) if (sg[k].s >= t) return { c: k, exact: false };
    return { c: sg.length - 1, exact: false };
  }
  function colAtEnd(axis, t) {            // returns EXCLUSIVE column index
    var sg = axis.segs, k;
    for (k = 0; k < sg.length; k++) if (sg[k].e === t) return { c: k + 1, exact: true };
    for (k = 0; k < sg.length; k++) if (sg[k].s < t && t < sg[k].e) return { c: k + 1, exact: false };
    for (k = sg.length - 1; k >= 0; k--) if (sg[k].e <= t) return { c: k + 1, exact: false };
    return { c: 1, exact: false };
  }
  function computeModel(rawSets, rawSlots, days) {
    var cleanSets = sanitizeSets(rawSets);
    var sets = (cleanSets || []).map(normaliseSet).filter(function (s) { return s.items.length; });
    sets.sort(function (a, b) {                 // Set 1 = first row, Set 2 = second row
      var x = parseInt((String(a.code).match(/\d+/) || [0])[0], 10), y = parseInt((String(b.code).match(/\d+/) || [0])[0], 10);
      return x - y;
    });
    if (!sets.length) return { empty: true };
    var byCode = {}; sets.forEach(function (s) { byCode[s.code] = s; });
    var defCode = (sets.filter(function (s) { return s.isDefault; })[0] || sets[0]).code;

    var resolved = [], unplaced = [];
    (rawSlots || []).forEach(function (raw) {
      var r = resolveSlot(raw, byCode, defCode);
      if (r) resolved.push(r); else unplaced.push(raw);
    });

    var visible = sets;            // always both (all) timing sets
    var shown = resolved;
    var axis = buildAxis(visible);

    shown.forEach(function (r) {
      var a = colAtStart(axis, r.s), z = colAtEnd(axis, r.e);
      r.c0 = a.c; r.c1 = Math.max(z.c, a.c + 1); r.snapped = !(a.exact && z.exact);
    });

    var rows = days.map(function (d) {
      var k = dayKey(d[0]);
      var list = shown.filter(function (r) { return r.day === k; }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
      // real clashes (time overlap), regardless of how they are drawn
      list.forEach(function (a, i) {
        for (var j = i + 1; j < list.length; j++) {
          if (list[j].s < a.e && a.s < list[j].e) { a.clash = true; list[j].clash = true; }
        }
      });
      // greedy lane packing on columns -> overlapping cards stack instead of hiding each other
      var laneEnds = [];
      list.forEach(function (r) {
        var l = 0; while (l < laneEnds.length && laneEnds[l] > r.c0) l++;
        laneEnds[l] = r.c1; r.lane = l;
      });
      return { day: d, slots: list, laneCount: Math.max(1, laneEnds.length) };
    });

    var classColorMap = buildClassColorMap(rawSlots);

    return { empty: false, sets: sets, visible: visible, axis: axis, rows: rows, unplaced: unplaced,
             clashes: shown.filter(function (r) { return r.clash; }).length,
             classColorMap: classColorMap };
  }

  /* ── 5. DOM helpers (textContent only – no innerHTML with data) ─────── */
  function h(tag, cls, text, style) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (style) el.style.cssText = style;
    return el;
  }
  function place(el, c0, c1, r0, r1) {      // columns/rows are 1-based grid lines
    el.style.gridColumn = c0 + ' / ' + c1;
    el.style.gridRow = r0 + ' / ' + r1;
    return el;
  }
  var BRK_ICON = { Break: '☕', Lunch: '🍱', Tea: '🍵' };

  /* ── 6. render ──────────────────────────────────────────────────────── */
  function mount(root, opts) {
    opts = opts || {};
    var state = { timingSets: opts.timingSets || [], slots: opts.slots || [] };
    var days = opts.days || DEFAULT_DAYS;
    var tf = opts.timeFormat || '24h';
    var todayKey = dayKey(opts.today || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][(typeof todayIST === 'function' ? new Date(todayIST() + 'T00:00:00') : new Date()).getDay()]);
    var model = null;

    function render() {
      model = computeModel(state.timingSets, state.slots, days);
      root.replaceChildren();
      var wrap = h('div', 'ttx');
      root.appendChild(wrap);
      if (model.empty) { wrap.appendChild(h('div', 'ttx-empty', 'No timing sets are configured yet, so the timetable cannot be drawn.')); return; }

      var tb = buildToolbar();
      if (tb) wrap.appendChild(tb);
      wrap.appendChild(buildLegend());
      wrap.appendChild(buildGrid());
    }

    function buildToolbar() {
      var bar = h('div', 'ttx-bar');
      if (model.clashes) bar.appendChild(h('span', 'ttx-pill bad', '⚠ ' + model.clashes + ' slots overlap in time (marked in red)'));
      if (model.unplaced.length) bar.appendChild(h('span', 'ttx-pill warn', model.unplaced.length + ' slot(s) have no valid time and are not drawn'));
      return bar.children.length ? bar : null;
    }

    function buildLegend() {
      var lg = h('div', 'ttx-legend');
      [['theory', 'Theory'], ['lab', 'Lab / multi-period'], ['comb', 'Combined'], ['sub', 'Substitute']].forEach(function (x) {
        var s = h('span'); s.appendChild(h('i', 'ttx-sw ' + x[0])); s.appendChild(document.createTextNode(x[1])); lg.appendChild(s);
      });
      if (model.visible.length > 1) {
        model.visible.forEach(function (st, i) {
          var s = h('span');
          s.appendChild(h('i', 'ttx-dot', null, '--lane:' + LANE_COLORS[i % LANE_COLORS.length]));
          s.appendChild(document.createTextNode(st.short + (st.years ? ' (Yr ' + st.years + ')' : '')));
          lg.appendChild(s);
        });
      }
      if (model.classColorMap && model.classColorMap.size > 0) {
        var sep = h('span', 'ttx-legend-sep');
        lg.appendChild(sep);
        var labelSpan = h('span', 'ttx-legend-cls-label', 'Classes:');
        lg.appendChild(labelSpan);
        model.classColorMap.forEach(function (col, clsName) {
          var s = h('span', 'ttx-legend-cls-chip');
          s.style.setProperty('--cls-bg', col.bg);
          s.style.setProperty('--cls-border', col.border);
          s.style.setProperty('--cls-text', col.text);
          var dot = h('i', 'ttx-dot');
          dot.style.setProperty('--lane', col.border);
          s.appendChild(dot);
          s.appendChild(document.createTextNode(clsName));
          lg.appendChild(s);
        });
      }
      return lg;
    }

    function buildGrid() {
      var axis = model.axis, L = axis.lanes.length, laneColor = function (i) { return LANE_COLORS[i % LANE_COLORS.length]; };
      var forkHdr = axis.hasFork;
      var headerRows = forkHdr ? 1 + L : 1;

      /* column tracks */
      var tracks = ['76px'], minW = 76;
      axis.segs.forEach(function (sg) {
        var m = sg.e - sg.s;
        if (sg.empty) { tracks.push('8px'); minW += 8; }
        else if (sg.allBreak) { tracks.push(BREAK_PX + 'px'); minW += BREAK_PX; }
        else { var mn = Math.round(m * PX_PER_MIN); tracks.push('minmax(' + mn + 'px,' + (m / 15) + 'fr)'); minW += mn; }
      });
      /* row tracks */
      var rowT = forkHdr ? ['24px'].concat(axis.lanes.map(function () { return '38px'; })) : ['52px'];
      model.rows.forEach(function (r) { for (var k = 0; k < r.laneCount; k++) rowT.push('minmax(76px,auto)'); });

      var scroller = h('div', 'ttx-wrap');
      var grid = h('div', 'ttx-grid');
      grid.style.gridTemplateColumns = tracks.join(' ');
      grid.style.gridTemplateRows = rowT.join(' ');
      grid.style.minWidth = minW + 'px';
      scroller.appendChild(grid);

      /* ── header ── */
      grid.appendChild(place(h('div', 'ttx-h ttx-h--corner', 'Day'), 1, 2, 1, headerRows + 1));
      axis.groups.forEach(function (g) {
        var c0 = g.segs[0].i + 2, c1 = g.segs[g.segs.length - 1].i + 3;
        if (g.type === 'gap') { grid.appendChild(place(h('div', 'ttx-h ttx-h--gap'), c0, c1, 1, headerRows + 1)); return; }
        if (g.type === 'common') {
          var it = g.item, sg = g.segs[0], cell;
          if (it.kind === 'break') {
            cell = h('div', 'ttx-h ttx-h--break'); cell.title = it.label + ' · ' + range(sg.s, sg.e, tf);
            cell.appendChild(h('span', 'ttx-vt', (BRK_ICON[it.brk] || '') + ' ' + it.label));
          } else {
            cell = h('div', 'ttx-h'); cell.appendChild(document.createTextNode(it.label));
            cell.appendChild(h('small', null, range(it.s, it.e, tf)));
          }
          grid.appendChild(place(cell, c0, c1, 1, headerRows + 1)); return;
        }
        /* fork zone: title row + one lane per set */
        var zs = g.segs[0].s, ze = g.segs[g.segs.length - 1].e;
        var zone = h('div', 'ttx-h ttx-h--zone', 'Differs by set'); zone.appendChild(h('small', null, range(zs, ze, tf)));
        grid.appendChild(place(zone, c0, c1, 1, 2));
        axis.lanes.forEach(function (st, li) {
          var k = 0;
          while (k < g.segs.length) {
            var item = g.segs[k].covers[li], span = 1;
            while (k + span < g.segs.length && g.segs[k + span].covers[li] === item) span++;
            var cc0 = g.segs[k].i + 2, cc1 = cc0 + span;
            var lc = h('div', 'ttx-h ttx-h--lane', null, '--lane:' + laneColor(li));
            if (!item) { lc.classList.add('is-break'); }
            else if (item.kind === 'break') {
              lc.classList.add('is-break');
              if ((g.segs[k + span - 1].e - g.segs[k].s) >= 30) {      // wide enough -> name + time, else icon only
                lc.appendChild(h('b', null, (BRK_ICON[item.brk] || '') + ' ' + item.label));
                lc.appendChild(h('small', null, range(item.s, item.e, tf)));
              } else {
                lc.textContent = BRK_ICON[item.brk] || '·';
              }
              lc.title = st.short + ' · ' + item.label + ' ' + range(item.s, item.e, tf);
            } else {
              lc.appendChild(h('b', null, st.short.replace('Set ', 'S') + ' · ' + item.label));
              lc.appendChild(h('small', null, range(item.s, item.e, tf)));
              lc.title = st.short + ' · ' + item.label + ' ' + range(item.s, item.e, tf);
            }
            grid.appendChild(place(lc, cc0, cc1, 2 + li, 3 + li));
            k += span;
          }
        });
      });

      /* ── body ── */
      var r0 = headerRows + 1;
      var groupOfSeg = {}; axis.groups.forEach(function (g) { g.segs.forEach(function (sg) { groupOfSeg[sg.i] = g; }); });
      model.rows.forEach(function (row) {
        var rEnd = r0 + row.laneCount;
        var isToday = dayKey(row.day[0]) === todayKey;
        var dl = h('div', 'ttx-day' + (isToday ? ' is-today' : ''), row.day[0]);
        if (isToday) dl.appendChild(h('em', null, 'Today'));
        grid.appendChild(place(dl, 1, 2, r0, rEnd));

        axis.segs.forEach(function (sg) {
          var cls = 'ttx-bg';
          if (sg.empty) cls += ' is-gap'; else if (sg.allBreak) cls += ' is-break'; else if (sg.someBreak) cls += ' is-partial';
          grid.appendChild(place(h('div', cls), sg.i + 2, sg.i + 3, r0, rEnd));
        });

        row.slots.forEach(function (r) {
          var raw = r.raw, multi = model.visible.length > 1;
          var card = h('button', 'ttx-card ' + r.variant + (r.clash ? ' clash' : '')); card.type = 'button';

          var cKey = getClassKey(raw);
          var col = getClassColor(cKey, model.classColorMap);
          if (col) {
            card.classList.add('has-class-color');
            card.style.setProperty('--cls-bg', col.bg);
            card.style.setProperty('--cls-border', col.border);
            card.style.setProperty('--cls-border-light', col.borderLight);
            card.style.setProperty('--cls-text', col.text);
            card.style.setProperty('--cls-badge-bg', col.badgeBg);
            card.style.setProperty('--cls-badge-text', col.badgeText);
          }

          var top = h('div', 'ttx-card-top');
          top.appendChild(h('div', 'ttx-title', raw.subjectName || raw.subject || 'Subject'));
          if (multi) {
            var li = model.visible.map(function (s) { return s.code; }).indexOf(r.setCode);
            top.appendChild(h('span', 'ttx-chip', r.setCode.replace(/^SET[_\s-]*/i, 'S'), '--lane:' + laneColor(Math.max(0, li))));
          }
          card.appendChild(top);

          var meta = h('div', 'ttx-meta');
          var room = raw.hallNo || raw.room;
          var clsWrap = h('span', 'ttx-cls-wrap');
          var clsSpan = h('span', 'ttx-cls-name', raw.className || '');
          if (col) {
            clsSpan.style.color = col.text;
            clsSpan.style.fontWeight = '700';
          }
          clsWrap.appendChild(clsSpan);
          if (room) {
            clsWrap.appendChild(h('span', 'ttx-room', ' • ' + room));
          }
          meta.appendChild(clsWrap);

          var badge = null;
          if (r.variant === 'sub') badge = h('span', 'ttx-badge sub', 'Sub');
          else if (r.variant === 'lab') {
            badge = h('span', 'ttx-badge lab-badge', 'Lab (' + r.span + 'P)');
            if (col) {
              badge.style.background = col.badgeBg;
              badge.style.color = col.badgeText;
              badge.style.border = '1px solid ' + col.borderLight;
            }
          }
          else if (r.variant === 'comb') badge = h('span', 'ttx-badge comb', (raw.combinedWith || []).join('+'));
          if (r.clash) badge = h('span', 'ttx-badge clash', '⚠ Clash');
          if (badge) meta.appendChild(badge);
          card.appendChild(meta);

          var timeEl = h('div', 'ttx-time', range(r.s, r.e, tf) + (r.snapped ? ' ⚠' : ''));
          if (col) {
            timeEl.style.color = col.text;
          }
          card.appendChild(timeEl);

          card.title = (raw.subjectName || raw.subject || '') + '\n' + (raw.className || '') + (room ? ' • ' + room : '') +
                       '\n' + range(r.s, r.e, tf) + ' · ' + r.setCode + (r.clash ? '\n⚠ overlaps another slot' : '') +
                       (r.snapped ? '\n⚠ times do not line up with the timing set grid' : '');
          card.addEventListener('click', function (ev) { if (opts.onSlotClick) opts.onSlotClick(raw, ev); });
          grid.appendChild(place(card, r.c0 + 2, r.c1 + 2, r0 + r.lane, r0 + r.lane + 1));
        });
        r0 = rEnd;
      });
      return scroller;
    }

    var api = {
      update: function (p) {
        p = p || {};
        if (p.timingSets) state.timingSets = p.timingSets;
        if (p.slots) state.slots = p.slots;
        render();
      },
      model: function () { return model; }
    };
    render();
    return api;
  }

  /* ── 7. renderHtml (Synchronous HTML String Generator) ─────────────── */
  function renderHtml(opts) {
    opts = opts || {};
    var rawSets = (opts.timingSets && opts.timingSets.length)
      ? opts.timingSets
      : (typeof TIMING_SETS !== 'undefined' && Array.isArray(TIMING_SETS) && TIMING_SETS.length
          ? TIMING_SETS
          : ((typeof DB !== 'undefined' && DB.get && DB.get('timing-sets')) || CANONICAL_TIMING_SETS));

    var slots = opts.slots || [];
    var days = opts.days || DEFAULT_DAYS;
    var tf = opts.timeFormat || '12h';
    var theme = opts.theme || 'light';
    var todayKey = dayKey(opts.today || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][(typeof todayIST === 'function' ? new Date(todayIST() + 'T00:00:00') : new Date()).getDay()]);
    var model = computeModel(rawSets, slots, days);

    if (model.empty) {
      return '<div class="ttx ttx-theme-' + escHtml(theme) + '"><div class="ttx-empty">No timing sets are configured yet, so the timetable matrix cannot be drawn.</div></div>';
    }

    var axis = model.axis;
    var L = axis.lanes.length;
    var laneColor = function (i) { return LANE_COLORS[i % LANE_COLORS.length]; };
    var forkHdr = axis.hasFork;
    var headerRows = forkHdr ? 1 + L : 1;

    /* Column tracks */
    var tracks = ['115px'], minW = 115;
    axis.segs.forEach(function (sg) {
      var m = sg.e - sg.s;
      if (sg.empty) { tracks.push('8px'); minW += 8; }
      else if (sg.allBreak) { tracks.push(BREAK_PX + 'px'); minW += BREAK_PX; }
      else { var mn = Math.round(m * PX_PER_MIN); tracks.push('minmax(' + mn + 'px,' + (m / 15) + 'fr)'); minW += mn; }
    });

    /* Row tracks */
    var rowT = forkHdr ? ['30px'].concat(axis.lanes.map(function () { return '34px'; })) : ['52px'];
    model.rows.forEach(function (r) { for (var k = 0; k < r.laneCount; k++) rowT.push('minmax(76px,auto)'); });

    var html = '<div class="ttx ttx-theme-' + escHtml(theme) + '">';

    /* Legend */
    if (opts.showLegend !== false) {
      html += '<div class="ttx-legend">';
      html += '<span><i class="ttx-sw theory"></i> Theory</span>';
      html += '<span><i class="ttx-sw lab"></i> Lab / multi-period</span>';
      html += '<span><i class="ttx-sw comb"></i> Combined</span>';
      html += '<span><i class="ttx-sw sub"></i> Substitute</span>';
      if (model.visible.length > 1) {
        model.visible.forEach(function (st, i) {
          html += '<span><i class="ttx-dot" style="--lane:' + laneColor(i) + '"></i> ' + escHtml(st.short + (st.years ? ' (Yr ' + st.years + ')' : '')) + '</span>';
        });
      }
      html += '</div>';
    }

    /* Grid Wrap */
    html += '<div class="ttx-wrap">';
    html += '<div class="ttx-grid" style="grid-template-columns:' + tracks.join(' ') + ';grid-template-rows:' + rowT.join(' ') + ';min-width:' + minW + 'px;">';

    /* Header Corner */
    html += '<div class="ttx-h ttx-h--corner" style="grid-column:1/2;grid-row:1/' + (headerRows + 1) + ';">';
    html += '<div class="day-time-head"><span>Day / Period</span></div>';
    html += '</div>';

    /* Header Columns */
    axis.groups.forEach(function (g) {
      var c0 = g.segs[0].i + 2, c1 = g.segs[g.segs.length - 1].i + 3;
      if (g.type === 'gap') {
        html += '<div class="ttx-h ttx-h--gap" style="grid-column:' + c0 + '/' + c1 + ';grid-row:1/' + (headerRows + 1) + ';"></div>';
        return;
      }
      if (g.type === 'common') {
        var it = g.item, sg = g.segs[0];
        if (it.kind === 'break') {
          html += '<div class="ttx-h ttx-h--break" style="grid-column:' + c0 + '/' + c1 + ';grid-row:1/' + (headerRows + 1) + ';" title="' + escHtml(it.label + ' · ' + range(sg.s, sg.e, tf)) + '">';
          html += '<span class="ttx-vt">' + (BRK_ICON[it.brk] || '') + ' ' + escHtml(it.label) + '</span>';
          html += '</div>';
        } else {
          html += '<div class="ttx-h" style="grid-column:' + c0 + '/' + c1 + ';grid-row:1/' + (headerRows + 1) + ';">';
          html += '<div class="period-head"><span class="p-name">' + escHtml(it.label) + '</span>';
          html += '<span class="p-time">' + escHtml(range(it.s, it.e, tf)) + '</span></div>';
          html += '</div>';
        }
        return;
      }

      /* Fork Zone (Differs by set) */
      var zs = g.segs[0].s, ze = g.segs[g.segs.length - 1].e;
      html += '<div class="ttx-h ttx-h--zone" style="grid-column:' + c0 + '/' + c1 + ';grid-row:1/2;">';
      html += '<span>Differs by set</span><small>' + escHtml(range(zs, ze, tf)) + '</small>';
      html += '</div>';

      axis.lanes.forEach(function (st, li) {
        var k = 0;
        while (k < g.segs.length) {
          var item = g.segs[k].covers[li], span = 1;
          while (k + span < g.segs.length && g.segs[k + span].covers[li] === item) span++;
          var cc0 = g.segs[k].i + 2, cc1 = cc0 + span;
          var rStart = 2 + li, rEnd = 3 + li;
          var isBreak = !item || item.kind === 'break';
          var colVar = '--lane:' + laneColor(li);

          if (isBreak) {
            var bLabel = item ? (item.label || item.brk) : 'Break';
            var bIcon = item ? (BRK_ICON[item.brk] || '') : '☕';
            var isWide = (g.segs[k + span - 1].e - g.segs[k].s) >= 30;
            html += '<div class="ttx-h ttx-h--lane is-break" style="' + colVar + ';grid-column:' + cc0 + '/' + cc1 + ';grid-row:' + rStart + '/' + rEnd + ';" title="' + escHtml(st.short + ' · ' + bLabel + ' ' + (item ? range(item.s, item.e, tf) : '')) + '">';
            if (isWide) {
              html += '<b>' + bIcon + ' ' + escHtml(bLabel) + '</b><small>' + escHtml(range(g.segs[k].s, g.segs[k + span - 1].e, tf)) + '</small>';
            } else {
              html += bIcon || '·';
            }
            html += '</div>';
          } else {
            html += '<div class="ttx-h ttx-h--lane" style="' + colVar + ';grid-column:' + cc0 + '/' + cc1 + ';grid-row:' + rStart + '/' + rEnd + ';" title="' + escHtml(st.short + ' · ' + item.label + ' ' + range(item.s, item.e, tf)) + '">';
            html += '<b>' + escHtml(st.short.replace('Set ', 'S') + ' · ' + item.label) + '</b>';
            html += '<small>' + escHtml(range(item.s, item.e, tf)) + '</small>';
            html += '</div>';
          }
          k += span;
        }
      });
    });

    /* Body Rows */
    var r0 = headerRows + 1;
    model.rows.forEach(function (row) {
      var rEnd = r0 + row.laneCount;
      var isToday = dayKey(row.day[0]) === todayKey;

      /* Day Cell */
      html += '<div class="ttx-day' + (isToday ? ' is-today' : '') + '" style="grid-column:1/2;grid-row:' + r0 + '/' + rEnd + ';">';
      html += '<div class="day-label">' + escHtml(row.day[1] || row.day[0]) + '</div>';
      html += '<div class="day-date">' + (isToday ? '<span class="today-badge">TODAY</span>' : 'Weekly Matrix') + '</div>';
      html += '</div>';

      /* Background Pattern Cells */
      axis.segs.forEach(function (sg) {
        var cls = 'ttx-bg';
        if (sg.empty) cls += ' is-gap';
        else if (sg.allBreak) cls += ' is-break';
        else if (sg.someBreak) cls += ' is-partial';
        html += '<div class="' + cls + '" style="grid-column:' + (sg.i + 2) + '/' + (sg.i + 3) + ';grid-row:' + r0 + '/' + rEnd + ';"></div>';
      });

      /* Slot Cards */
      row.slots.forEach(function (r) {
        var raw = r.raw;
        var room = raw.hallNo || raw.room || '';
        var subName = raw.subjectName || raw.subject || 'Subject';
        var clsName = raw.className || raw.class || raw.section || '';
        var isLab = r.variant === 'lab' || (subName || '').toLowerCase().includes('lab') || (raw.type === 'Lab');
        var cardCls = 'ttx-card-wrap faculty-slot-card ' + r.variant + (isLab ? ' lab' : '') + (r.clash ? ' clash' : '');

        var li = model.visible.map(function (s) { return s.code; }).indexOf(r.setCode);
        var setChipColor = laneColor(Math.max(0, li));
        var setLabel = (r.setCode || '').replace(/^SET[_\s-]*/i, 'S');

        var titleAttr = escHtml(subName + '\n' + clsName + (room ? ' • Room ' + room : '') + '\n' + range(r.s, r.e, tf) + ' · ' + (r.setCode || ''));

        html += '<div class="' + cardCls + '" style="grid-column:' + (r.c0 + 2) + '/' + (r.c1 + 2) + ';grid-row:' + (r0 + r.lane) + '/' + (r0 + r.lane + 1) + ';" title="' + titleAttr + '">';
        html += '<div class="faculty-slot-top">';
        html += '<b class="faculty-slot-sub" title="' + escHtml(subName) + '">' + escHtml(subName) + '</b>';
        if (setLabel) {
          html += '<span class="ttx-chip" style="--lane:' + setChipColor + '">' + escHtml(setLabel) + '</span>';
        }
        html += '</div>';

        html += '<div class="faculty-slot-meta">';
        if (clsName) {
          html += '<span class="pill pri" style="font-size:10px;padding:1px 6px;"><re-icon icon="chalkboard"></re-icon> ' + escHtml(clsName) + '</span>';
        }
        if (room) {
          html += '<span style="font-size:11px;color:var(--tmu);"><re-icon icon="pin"></re-icon> ' + escHtml(room) + '</span>';
        }
        if (r.span > 1) {
          html += '<span class="pill warn" style="font-size:9.5px;padding:1px 4px;">' + r.span + 'p</span>';
        }
        if (r.variant === 'sub') {
          html += '<span class="pill warn" style="font-size:9.5px;padding:1px 4px;">Sub</span>';
        }
        if (r.variant === 'comb') {
          html += '<span class="pill" style="font-size:9.5px;padding:1px 4px;background:#ede9fe;color:#5b21b6;">Comb</span>';
        }
        if (r.clash) {
          html += '<span class="pill red" style="font-size:9.5px;padding:1px 4px;">⚠ Clash</span>';
        }
        html += '</div>';

        html += '<div class="faculty-slot-time">' + escHtml(range(r.s, r.e, tf)) + '</div>';
        html += '</div>';
      });

      r0 = rEnd;
    });

    html += '</div>'; // ttx-grid
    html += '</div>'; // ttx-wrap
    html += '</div>'; // ttx

    return html;
  }

  global.TeacherTimetable = {
    mount: mount,
    renderHtml: renderHtml,
    computeModel: computeModel,
    normaliseSet: normaliseSet,
    CANONICAL_TIMING_SETS: CANONICAL_TIMING_SETS,
    CLASS_PALETTE: CLASS_PALETTE,
    getClassKey: getClassKey,
    getClassColor: getClassColor,
    buildClassColorMap: buildClassColorMap
  };
})(typeof window !== 'undefined' ? window : globalThis);
