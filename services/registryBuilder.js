/**
 * services/registryBuilder.js
 *
 * AttReg Part 2 (§4.4, §4.5): Unified Attendance Registry Matrix Builder.
 * Shared by:
 * - JSON endpoint (GET /api/attendance-records/registry)
 * - Excel exporter (generateExcel)
 * - PDF exporter (generatePdf)
 */

const mongoose = require('mongoose');
const M = require('../models');
const { getCachedSettings } = require('../utils/settingsCache');
const { satOrdinal } = require('../utils/dateUtils');
const { todayIST } = require('../utils/institutionTime');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseYearNum(yr, sem) {
  if (!yr) {
    if (sem) {
      const sm = String(sem).trim().toUpperCase();
      if (sm === '1' || sm === '2' || sm === 'I' || sm === 'II' || sm.startsWith('1') || sm.startsWith('2')) return 'I';
      if (sm === '3' || sm === '4' || sm === 'III' || sm === 'IV' || sm.startsWith('3') || sm.startsWith('4')) return 'II';
      if (sm === '5' || sm === '6' || sm === 'V' || sm === 'VI' || sm.startsWith('5') || sm.startsWith('6')) return 'III';
      if (sm === '7' || sm === '8' || sm === 'VII' || sm === 'VIII' || sm.startsWith('7') || sm.startsWith('8')) return 'IV';
    }
    return 'I';
  }
  const s = String(yr).trim().toUpperCase();
  if (s === '1' || s === 'I' || s.startsWith('1ST') || s.startsWith('I ') || s.startsWith('I-')) return 'I';
  if (s === '2' || s === 'II' || s.startsWith('2ND') || s.startsWith('II ') || s.startsWith('II-')) return 'II';
  if (s === '3' || s === 'III' || s.startsWith('3RD') || s.startsWith('III ') || s.startsWith('III-')) return 'III';
  if (s === '4' || s === 'IV' || s.startsWith('4TH') || s.startsWith('IV ') || s.startsWith('IV-')) return 'IV';
  if (sem) {
    const sm = String(sem).trim().toUpperCase();
    if (sm === '1' || sm === '2' || sm === 'I' || sm === 'II' || sm.startsWith('1') || sm.startsWith('2')) return 'I';
    if (sm === '3' || sm === '4' || sm === 'III' || sm === 'IV' || sm.startsWith('3') || sm.startsWith('4')) return 'II';
    if (sm === '5' || sm === '6' || sm === 'V' || sm === 'VI' || sm.startsWith('5') || sm.startsWith('6')) return 'III';
    if (sm === '7' || sm === '8' || sm === 'VII' || sm === 'VIII' || sm.startsWith('7') || sm.startsWith('8')) return 'IV';
  }
  return s;
}

function formatISTDate(d) {
  if (!d) return '';
  if (typeof todayIST === 'function') {
    const ist = todayIST(d);
    if (ist) return ist;
  }
  const dt = new Date(d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Builds the complete Attendance Registry matrix.
 *
 * @param {object} params
 * @param {string} params.classId - Mongo ID or trackId
 * @param {string} params.from - 'YYYY-MM-DD'
 * @param {string} params.to - 'YYYY-MM-DD'
 * @param {string} [params.view] - 'periods' | 'days'
 * @returns {Promise<object>} Complete matrix payload
 */
async function buildRegistry(params) {
  const { classId, from, to, view = 'periods' } = params;

  if (!classId) throw new Error('classId is required');
  if (!from || !to) throw new Error('from and to dates are required');
  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    throw new Error('Dates must be in YYYY-MM-DD format');
  }

  const fromDate = new Date(from + 'T00:00:00.000Z');
  const toDate = new Date(to + 'T23:59:59.999Z');

  if (fromDate > toDate) {
    throw new Error('from date must be earlier than or equal to to date');
  }

  const daySpan = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24));
  if (daySpan > 62) {
    throw new Error('Date range cannot exceed 62 days');
  }

  // 1. Resolve Class
  const classQueries = [{ trackId: classId }, { name: classId }];
  if (mongoose.isValidObjectId(classId)) {
    classQueries.unshift({ _id: new mongoose.Types.ObjectId(classId) });
  }
  const cls = await M.Class.findOne({ $or: classQueries }).lean();
  if (!cls) throw new Error('Class not found');

  const classObjIdStr = String(cls._id);
  const classTrackId = cls.trackId || cls.classTrackId || '';
  const validClassIds = [classObjIdStr];
  if (classTrackId && classTrackId !== classObjIdStr) {
    validClassIds.push(classTrackId);
  }

  // 2. Fetch Settings
  const settings = await getCachedSettings();
  const periodsPerDay = Number(settings.academic?.periodsPerDay) || 7;
  const fnPeriods = Number(settings.academic?.fnPeriods) || Math.ceil(periodsPerDay / 2);
  const minAttendance = Number(settings.academic?.minAttendance) || 75;
  const lowAttendanceThreshold = Number(settings.academic?.lowAttendanceThreshold) || 65;

  // 3. Generate Candidate Day List (Excluding All Sundays)
  const candidateDays = [];
  const curr = new Date(from + 'T00:00:00.000Z');
  const end = new Date(to + 'T00:00:00.000Z');

  while (curr <= end) {
    const dStr = curr.toISOString().slice(0, 10);
    const dowIdx = curr.getUTCDay();
    const dow = DOW_NAMES[dowIdx];

    // Remove all Sunday
    if (dowIdx !== 0 && dow !== 'Sun') {
      candidateDays.push({
        date: dStr,
        dow,
        dowIdx,
        dayType: 'working',
        isHoliday: false,
        periods: []
      });
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  // 4. Load Working Dates from Manage Page Calendar (M.CalendarDay)
  const queryStart = new Date(new Date(from + 'T00:00:00.000Z').getTime() - 24 * 60 * 60 * 1000);
  const queryEnd = new Date(new Date(to + 'T23:59:59.999Z').getTime() + 24 * 60 * 60 * 1000);

  const rawCalendarDays = await M.CalendarDay.find({
    date: { $gte: queryStart, $lte: queryEnd }
  }).lean();

  const classYearNum = parseYearNum(cls.year, cls.semester || cls.sem);
  const nonWorkingTypes = ['leave', 'holiday', 'vacation', 'declared_holiday'];

  const calDayMap = new Map();
  rawCalendarDays.forEach(cd => {
    const cdStr = formatISTDate(cd.date);
    if (cdStr >= from && cdStr <= to) {
      calDayMap.set(cdStr, cd);
    }
  });

  let days = [];
  const hasCalendarData = calDayMap.size > 0;

  if (hasCalendarData) {
    // Check if the calendar has explicit working day entries for this range
    const hasExplicitWorking = candidateDays.some(c => {
      const cd = calDayMap.get(c.date);
      if (!cd) return false;
      let dayType = cd.dayType || 'working';
      if (Array.isArray(cd.details) && cd.details.length > 0) {
        const yearDetail = cd.details.find(dt => dt.year === classYearNum);
        if (yearDetail && yearDetail.dayType) {
          dayType = yearDetail.dayType;
        } else {
          const fallback = cd.details.find(dt => dt.dayType === 'exam') ||
            cd.details.find(dt => dt.dayType === 'leave') ||
            cd.details[0];
          if (fallback && fallback.dayType) dayType = fallback.dayType;
        }
      }
      return !nonWorkingTypes.includes(String(dayType).toLowerCase());
    });

    candidateDays.forEach(c => {
      const cd = calDayMap.get(c.date);
      let isWorking = false;
      let dayType = 'working';

      if (cd) {
        dayType = cd.dayType || 'working';
        if (Array.isArray(cd.details) && cd.details.length > 0) {
          const yearDetail = cd.details.find(dt => dt.year === classYearNum);
          if (yearDetail && yearDetail.dayType) {
            dayType = yearDetail.dayType;
          } else {
            const fallback = cd.details.find(dt => dt.dayType === 'exam') ||
              cd.details.find(dt => dt.dayType === 'leave') ||
              cd.details[0];
            if (fallback && fallback.dayType) dayType = fallback.dayType;
          }
        }
        isWorking = !nonWorkingTypes.includes(String(dayType).toLowerCase());
      } else {
        if (hasExplicitWorking) {
          isWorking = false;
        } else {
          if (c.dowIdx === 6) {
            const sn = satOrdinal(c.date);
            isWorking = (sn % 2 === 0 || sn === 5);
            dayType = isWorking ? 'working' : 'leave';
          } else {
            isWorking = true;
            dayType = 'working';
          }
        }
      }

      if (isWorking) {
        days.push({
          date: c.date,
          dow: c.dow,
          dayType,
          isHoliday: false,
          periods: []
        });
      }
    });
  } else {
    // If no data found in Manage Page calendar, mention all dates (no Sunday)
    days = candidateDays.map(c => ({
      date: c.date,
      dow: c.dow,
      dayType: 'working',
      isHoliday: false,
      periods: []
    }));
  }

  // 5. Load Class Attendance Docs in Range
  const attDocs = await M.ClassAttendance.find({
    classId: { $in: validClassIds },
    date: { $gte: fromDate, $lte: toDate }
  }).lean();

  const attDocMap = new Map();
  attDocs.forEach(doc => {
    const dStr = formatISTDate(doc.date);
    attDocMap.set(dStr, doc);
  });

  // Populate day periods info for headers
  days.forEach(day => {
    const doc = attDocMap.get(day.date);
    if (doc && Array.isArray(doc.periods)) {
      for (let pNum = 1; pNum <= periodsPerDay; pNum++) {
        const periodObj = doc.periods.find(p =>
          Number(p.periodNumber) === pNum ||
          (Array.isArray(p.periodNumbers) && p.periodNumbers.includes(pNum))
        );
        if (periodObj) {
          day.periods.push({
            n: pNum,
            subject: periodObj.subjectTrackId,
            teacher: periodObj.teacherTrackId,
            method: periodObj.source?.method || 'Manual',
            topic: periodObj.topic || ''
          });
        }
      }
    }
  });

  // 6. Load Students
  const studentQueries = [
    { classId: { $in: validClassIds } },
    { classId: cls._id }
  ];
  if (cls.name) studentQueries.push({ class: cls.name });

  const students = await M.Student.find({ $or: studentQueries })
    .select('trackId registerNo fullName name rollNo')
    .sort({ registerNo: 1, name: 1 })
    .lean();

  const studentTrackIds = students.map(s => s.trackId);

  // 7. Load Approved Leaves
  const leaves = await M.LeaveRequest.find({
    studentTrackId: { $in: studentTrackIds },
    status: 'Approved',
    dates: { $elemMatch: { $gte: fromDate, $lte: toDate } }
  }).lean();

  // 8. Build Matrix for each Student
  const studentRows = [];
  const presentByCol = new Array(days.length * periodsPerDay).fill(0);
  const dayPresentTotals = new Array(days.length).fill(0);
  const dayMarkedTotals = new Array(days.length).fill(0);

  students.forEach((st, sIdx) => {
    const cellsPerDay = [];
    const daySummaryCells = [];
    let totalP = 0;
    let totalA = 0;
    let totalL = 0;
    let totalMarked = 0;

    days.forEach((day, dIdx) => {
      const attDoc = attDocMap.get(day.date);
      let dayCellStr = '';
      let dayP = 0;
      let dayA = 0;
      let dayL = 0;

      for (let pNum = 1; pNum <= periodsPerDay; pNum++) {
        const colIdx = dIdx * periodsPerDay + (pNum - 1);

        // Rule 1: Holiday
        if (day.isHoliday) {
          dayCellStr += 'H';
          continue;
        }

        // Rule 2..5: Check attendance record
        let record = null;
        if (attDoc && Array.isArray(attDoc.periods)) {
          const p = attDoc.periods.find(pd =>
            Number(pd.periodNumber) === pNum ||
            (Array.isArray(pd.periodNumbers) && pd.periodNumbers.includes(pNum))
          );
          if (p && Array.isArray(p.records)) {
            record = p.records.find(r => r.studentTrackId === st.trackId);
          }
        }

        if (!record) {
          // Rule 5: Unmarked
          dayCellStr += '–';
          continue;
        }

        if (record.status === 'P') {
          // Rule 2: Present
          dayCellStr += 'P';
          totalP++;
          dayP++;
          totalMarked++;
          presentByCol[colIdx]++;
          dayPresentTotals[dIdx]++;
          dayMarkedTotals[dIdx]++;
        } else {
          // Absent - Check Leave Overlay (Rule 3)
          const targetDateObj = new Date(day.date + 'T00:00:00.000Z');
          const matchedLeave = leaves.find(lv => {
            if (lv.studentTrackId !== st.trackId) return false;
            const coversDate = (lv.dates || []).some(d => formatISTDate(d) === day.date);
            if (!coversDate) return false;

            const slot = lv.slot || 'Full Day';
            if (slot === 'Full Day') return true;
            if (slot === 'FN' && pNum <= fnPeriods) return true;
            if (slot === 'AN' && pNum > fnPeriods) return true;
            if (Array.isArray(lv.periods) && lv.periods.includes(pNum)) return true;
            return false;
          });

          if (matchedLeave) {
            const isOD = (matchedLeave.leaveType || '').toLowerCase().includes('duty') ||
                         (matchedLeave.leaveType || '').toLowerCase().includes('od') ||
                         (matchedLeave.category || '').toLowerCase() === 'permission';
            const glyph = isOD ? 'O' : 'L';
            dayCellStr += glyph;
            totalL++;
            dayL++;
            totalMarked++;
            dayMarkedTotals[dIdx]++;
          } else {
            // Rule 4: Plain Absent
            dayCellStr += 'A';
            totalA++;
            dayA++;
            totalMarked++;
            dayMarkedTotals[dIdx]++;
          }
        }
      }

      cellsPerDay.push(dayCellStr);

      // Day Summary glyph
      if (day.isHoliday) {
        daySummaryCells.push('H');
      } else if (dayCellStr.replace(/[–]/g, '').length === 0) {
        daySummaryCells.push('–');
      } else if (dayA > 0) {
        daySummaryCells.push('A');
      } else if (dayL > 0 && dayP === 0) {
        daySummaryCells.push('L');
      } else {
        daySummaryCells.push('P');
      }
    });

    const pct = totalMarked > 0 ? Math.round((totalP / totalMarked) * 1000) / 10 : 100.0;

    studentRows.push({
      trackId: st.trackId,
      regNo: st.registerNo || st.rollNo || '',
      name: st.fullName || st.name || '',
      cells: cellsPerDay,
      dayCells: daySummaryCells,
      totals: {
        P: totalP,
        A: totalA,
        L: totalL,
        marked: totalMarked,
        pct
      }
    });
  });

  // 9. Footer calculations
  const dayPct = dayMarkedTotals.map((m, idx) => {
    return m > 0 ? Math.round((dayPresentTotals[idx] / m) * 1000) / 10 : null;
  });

  return {
    class: {
      id: classObjIdStr,
      trackId: classTrackId,
      name: cls.name,
      dept: cls.deptName || cls.deptCode || '',
      batch: cls.batch || '',
      sem: cls.sem || '',
      advisor: cls.advisorTeacherName || ''
    },
    range: { from, to },
    periodsPerDay,
    fnPeriods,
    days,
    students: studentRows,
    footer: {
      presentByColumn: presentByCol,
      dayPct,
      dayPresentTotals,
      dayMarkedTotals
    },
    thresholds: {
      min: minAttendance,
      low: lowAttendanceThreshold
    }
  };
}

module.exports = {
  buildRegistry,
  parseYearNum,
  formatISTDate
};
