/**
 * utils/timetableExcelParser.js
 *
 * Core Excel Parser for EAMS Timetable Import (Feature #1).
 * Parses departmental workbooks (.xlsx) with heterogeneous sheets,
 * extracting multi-section timetable grids, metadata headers, period alignments,
 * merged lab spans, and course legend tables using ExcelJS.
 */

const ExcelJS = require('exceljs');

// ── Roman numeral to Arabic converter ──
function romanToArabic(roman) {
  if (!roman) return '';
  const map = { I: 1, V: 5, X: 10, L: 50 };
  const str = String(roman).trim().toUpperCase();
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const curr = map[str[i]] || 0;
    const next = map[str[i + 1]] || 0;
    if (curr < next) {
      result += (next - curr);
      i++;
    } else {
      result += curr;
    }
  }
  return result > 0 ? String(result) : str;
}

// ── Extract clean text from an ExcelJS cell ──
function getCellString(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const val = cell.value;
  if (typeof val === 'object') {
    if (Array.isArray(val.richText)) {
      return val.richText.map(t => t.text).join('').trim();
    }
    if (val.text) return String(val.text).trim();
    if (val.result !== undefined) return String(val.result).trim();
  }
  return String(val).trim();
}

// ── Normalize Day Names to EAMS 3-char format ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat') ──
const DAY_MAP = {
  monday: 'Mon', mon: 'Mon',
  tuesday: 'Tue', tue: 'Tue', tues: 'Tue',
  wednesday: 'Wed', wed: 'Wed',
  thursday: 'Thu', thu: 'Thu', thur: 'Thu', thurs: 'Thu',
  friday: 'Fri', fri: 'Fri',
  saturday: 'Sat', sat: 'Sat'
};

function normalizeDay(str) {
  if (!str) return null;
  const clean = String(str).trim().toLowerCase().replace(/[^a-z]/g, '');
  return DAY_MAP[clean] || null;
}

// ── Calculate column span for a cell in ExcelJS ──
function getCellColSpan(worksheet, cell) {
  if (!cell.isMerged) return 1;
  const masterAddr = cell.master ? cell.master.address : cell.address;
  if (worksheet._merges && worksheet._merges[masterAddr]) {
    const range = worksheet._merges[masterAddr].model;
    if (range && range.left !== undefined && range.right !== undefined) {
      return (range.right - range.left + 1);
    }
  }
  return 1;
}

/**
 * Scan a worksheet row-by-row and identify all "Section:" block start rows.
 */
function findSectionAnchors(worksheet) {
  const anchors = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = getCellString(cell);
      // Check for Section: or Section -
      if (/^\s*Section\s*[:\-]/i.test(text) || /^\s*Sec\s*[:\-]/i.test(text)) {
        anchors.push({ rowNumber, colNumber, cellText: text });
      } else if (/^\s*Section\s*$/i.test(text)) {
        // If cell is just "Section", check if adjacent cell has ":" or section name
        const nextCell = row.getCell(colNumber + 1);
        const nextText = getCellString(nextCell);
        if (nextText) {
          anchors.push({ rowNumber, colNumber, cellText: `Section: ${nextText}` });
        }
      }
    });
  });
  return anchors;
}

/**
 * Extract metadata from rows surrounding the section anchor.
 */
function extractSectionMetadata(worksheet, anchorRow, anchorCol, initialCellText) {
  const meta = {
    academicYear: '',
    year: '',
    rawYear: '',
    semester: '',
    rawSemester: '',
    section: '',
    hallNo: '',
    advisorRaw: ''
  };

  // 1. Initial attempt from anchor cell text
  const secDirectMatch = initialCellText.match(/Section\s*[:\-]?\s*([A-Za-z0-9\+\-]+)/i);
  if (secDirectMatch) meta.section = secDirectMatch[1].trim().toUpperCase();

  // 2. Scan window from 4 rows above anchor to 2 rows below
  const minRow = Math.max(1, anchorRow - 4);
  const maxRow = Math.min(worksheet.rowCount, anchorRow + 2);

  for (let r = minRow; r <= maxRow; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= 25; c++) {
      const cellText = getCellString(row.getCell(c));
      if (!cellText) continue;

      // Academic Year
      if (!meta.academicYear) {
        const ayMatch = cellText.match(/(?:Academic\s*Year|A\.?Y\.?)\s*[:\-]?\s*([0-9]{4}\s*[-–/]\s*[0-9]{2,4}(?:\s*\([A-Za-z]+\))?)/i);
        if (ayMatch) {
          meta.academicYear = ayMatch[1].trim();
        } else {
          // If cell is just label, check next cell
          if (/^(?:Academic\s*Year|A\.?Y\.?)\s*[:\-]?$/i.test(cellText)) {
            const nextVal = getCellString(row.getCell(c + 1));
            if (nextVal && /[0-9]{4}/.test(nextVal)) meta.academicYear = nextVal;
          }
        }
      }

      // Year & Semester
      if (!meta.year || !meta.semester) {
        // Example: "Year & Semester : III Year & V Sem" or "III / V" or "Year: 2, Sem: 3"
        const ysMatch = cellText.match(/(?:Year\s*(?:&|and|\/)\s*Sem(?:ester)?|Year\/Sem)\s*[:\-]?\s*([IVX0-9]+)\s*(?:Year)?\s*(?:&|\/|-|and|,)?\s*([IVX0-9]+)?/i);
        if (ysMatch) {
          if (ysMatch[1]) {
            meta.rawYear = ysMatch[1].trim();
            meta.year = isNaN(ysMatch[1]) ? romanToArabic(ysMatch[1]) : ysMatch[1].trim();
          }
          if (ysMatch[2]) {
            meta.rawSemester = ysMatch[2].trim();
            meta.semester = isNaN(ysMatch[2]) ? romanToArabic(ysMatch[2]) : ysMatch[2].trim();
          }
        } else {
          // Check standalone Year
          if (!meta.year) {
            const yrMatch = cellText.match(/^(?:Year)\s*[:\-]?\s*([IVX0-9]+)/i);
            if (yrMatch) {
              meta.rawYear = yrMatch[1].trim();
              meta.year = isNaN(yrMatch[1]) ? romanToArabic(yrMatch[1]) : yrMatch[1].trim();
            }
          }
          // Check standalone Sem
          if (!meta.semester) {
            const semMatch = cellText.match(/^(?:Sem(?:ester)?)\s*[:\-]?\s*([IVX0-9]+)/i);
            if (semMatch) {
              meta.rawSemester = semMatch[1].trim();
              meta.semester = isNaN(semMatch[1]) ? romanToArabic(semMatch[1]) : semMatch[1].trim();
            }
          }
        }
      }

      // Section (if not captured yet)
      if (!meta.section) {
        const sMatch = cellText.match(/Section\s*[:\-]?\s*([A-Za-z0-9\+\-]+)/i);
        if (sMatch) {
          meta.section = sMatch[1].trim().toUpperCase();
        } else if (/^Section\s*[:\-]?$/i.test(cellText)) {
          const nextVal = getCellString(row.getCell(c + 1));
          if (nextVal) meta.section = nextVal.trim().toUpperCase();
        }
      }

      // Hall No / Room No
      if (!meta.hallNo) {
        const hallMatch = cellText.match(/(?:Class\s*Room\s*(?:No\.?)?|Hall\s*(?:No\.?)?|Room\s*(?:No\.?)?)\s*[:\-]?\s*([A-Za-z0-9\-\/ ]+)/i);
        if (hallMatch && hallMatch[1].trim()) {
          meta.hallNo = hallMatch[1].trim();
        } else if (/^(?:Class\s*Room\s*(?:No\.?)?|Hall\s*(?:No\.?)?|Room\s*(?:No\.?)?)\s*[:\-]?$/i.test(cellText)) {
          const nextVal = getCellString(row.getCell(c + 1));
          if (nextVal) meta.hallNo = nextVal.trim();
        }
      }

      // Class Advisor
      if (!meta.advisorRaw) {
        const advMatch = cellText.match(/(?:Class\s*Advisor(?:\s*Name)?|Advisor)\s*[:\-]?\s*([^\n\r]+)/i);
        if (advMatch && advMatch[1].trim()) {
          meta.advisorRaw = advMatch[1].trim();
        } else if (/^(?:Class\s*Advisor(?:\s*Name)?|Advisor)\s*[:\-]?$/i.test(cellText)) {
          const nextVal = getCellString(row.getCell(c + 1));
          if (nextVal) meta.advisorRaw = nextVal.trim();
        }
      }
    }
  }

  // Derive normalized class name (e.g., 'II-CSE-A' or '3-A')
  const yrLabel = meta.year ? (['I', 'II', 'III', 'IV'][parseInt(meta.year, 10) - 1] || meta.year) : '';
  meta.className = [yrLabel, meta.section].filter(Boolean).join('-');

  return meta;
}

/**
 * Identify the period timing header row below the anchor.
 * Returns array of period column descriptors: [{ colIndex, periodNumber, rawTime, isBreak }]
 */
function findPeriodHeaderRow(worksheet, anchorRow) {
  let headerRowNumber = -1;
  const periods = [];

  // Look up to 4 rows below anchor for the period header
  for (let r = anchorRow + 1; r <= anchorRow + 5; r++) {
    const row = worksheet.getRow(r);
    let timePatternMatches = 0;
    const candidatePeriods = [];

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = getCellString(cell);
      // Matches "8.30 - 9.15" or "08:30-09:15" or "8:30 to 9:15" or "Period 1" or Roman "I", "II"
      const isTime = /\b\d{1,2}[:.]\d{2}\s*[-–to]+\s*\d{1,2}[:.]\d{2}\b/i.test(text);
      const isPeriodLabel = /^Period\s*[0-9]+/i.test(text) || /^[0-9]+(?:st|nd|rd|th)?\s*Period$/i.test(text);
      const isBreak = /break|lunch|tea|interval/i.test(text);

      if (isTime || isPeriodLabel || isBreak) {
        timePatternMatches++;
        candidatePeriods.push({
          colIndex: colNumber,
          rawText: text,
          isBreak: isBreak,
          isTime: isTime
        });
      }
    });

    // If at least 3 cells match time or period patterns, this is the header row
    if (timePatternMatches >= 3) {
      headerRowNumber = r;
      // Sequence academic periods (skip breaks)
      let academicPeriodCount = 1;
      candidatePeriods.forEach(p => {
        if (!p.isBreak) {
          p.periodNumber = academicPeriodCount++;
        } else {
          p.periodNumber = 0;
        }
        periods.push(p);
      });
      break;
    }
  }

  // Fallback: If no explicit time header row detected, default to columns 2..10 as periods 1..9
  if (headerRowNumber === -1) {
    headerRowNumber = anchorRow + 1;
    for (let p = 1; p <= 9; p++) {
      periods.push({
        colIndex: p + 1,
        rawText: `Period ${p}`,
        periodNumber: p,
        isBreak: false,
        isTime: false
      });
    }
  }

  return { headerRowNumber, periods };
}

/**
 * Parse the 6 day grid rows (Monday through Saturday).
 */
function parseDayGrid(worksheet, periodHeaderRow, periods) {
  const slots = [];
  const dayRows = [];
  let currentRow = periodHeaderRow + 1;
  const academicPeriods = periods.filter(p => p.periodNumber > 0);

  // Look for day rows
  while (currentRow <= worksheet.rowCount && dayRows.length < 7) {
    const row = worksheet.getRow(currentRow);
    // Usually col 1 or col 2 has day name
    let detectedDay = null;
    let dayCol = 1;

    for (let c = 1; c <= 3; c++) {
      const d = normalizeDay(getCellString(row.getCell(c)));
      if (d) {
        detectedDay = d;
        dayCol = c;
        break;
      }
    }

    if (detectedDay) {
      dayRows.push({ rowNumber: currentRow, day: detectedDay, dayCol });

      // Track visited columns to avoid re-parsing followers in merged cells
      const processedCols = new Set();

      academicPeriods.forEach(pDesc => {
        if (processedCols.has(pDesc.colIndex)) return;

        const cell = row.getCell(pDesc.colIndex);
        if (cell.isMerged && cell.address !== cell.master.address) {
          // This cell is part of an ongoing merge initiated by a previous cell
          return;
        }

        const rawLabel = getCellString(cell);
        const colSpan = getCellColSpan(worksheet, cell);

        // Mark all covered columns as processed
        for (let c = pDesc.colIndex; c < pDesc.colIndex + colSpan; c++) {
          processedCols.add(c);
        }

        // Calculate how many academic periods this merge covers
        const coveredPeriods = academicPeriods.filter(
          ap => ap.colIndex >= pDesc.colIndex && ap.colIndex < pDesc.colIndex + colSpan
        );
        const span = Math.max(1, coveredPeriods.length);

        if (rawLabel && !/^[-\s\.\/]+$/.test(rawLabel)) {
          const isLab = span >= 2 || /lab|laboratory|practic/i.test(rawLabel);
          slots.push({
            day: detectedDay,
            period: pDesc.periodNumber,
            span: span,
            rawLabel: rawLabel,
            isLab: isLab,
            colIndex: pDesc.colIndex
          });
        }
      });
      currentRow++;
    } else {
      // If we already parsed at least 3 days and hit a row without a day name,
      // we have reached the end of the day grid
      if (dayRows.length >= 3) break;
      currentRow++;
    }
  }

  const lastGridRow = dayRows.length > 0 ? dayRows[dayRows.length - 1].rowNumber : currentRow;
  return { slots, lastGridRow, dayCount: dayRows.length };
}

/**
 * Parse the Course Legend table located below the day grid.
 */
function parseCourseLegend(worksheet, startRow, nextAnchorRow) {
  const legend = [];
  const maxSearchRow = nextAnchorRow > 0 ? Math.min(nextAnchorRow - 1, startRow + 25) : Math.min(worksheet.rowCount, startRow + 25);
  let legendHeaderRow = -1;
  const colMap = {};

  // Find legend header row
  for (let r = startRow; r <= maxSearchRow; r++) {
    const row = worksheet.getRow(r);
    let matchedHeaders = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = getCellString(cell).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (text.includes('coursecode') || text.includes('subcode') || text.includes('subjectcode') || text === 'code') {
        colMap.code = colNumber;
        matchedHeaders++;
      } else if (text.includes('coursetitle') || text.includes('subjectname') || text.includes('subjecttitle') || text.includes('title')) {
        colMap.title = colNumber;
        matchedHeaders++;
      } else if (text.includes('faculty') || text.includes('staff') || text.includes('teacher') || text.includes('handledby')) {
        colMap.faculty = colNumber;
        matchedHeaders++;
      } else if (text.includes('credit')) {
        colMap.credit = colNumber;
      } else if (text.includes('hour') || text.includes('period')) {
        colMap.hours = colNumber;
      } else if (text.includes('remark')) {
        colMap.remarks = colNumber;
      } else if (text.includes('sno') || text.includes('slno')) {
        colMap.sno = colNumber;
      }
    });

    if (matchedHeaders >= 2) {
      legendHeaderRow = r;
      break;
    }
  }

  if (legendHeaderRow === -1) {
    return legend; // No legend table found in this section block
  }

  // Parse subsequent legend rows
  for (let r = legendHeaderRow + 1; r <= maxSearchRow; r++) {
    const row = worksheet.getRow(r);
    const code = colMap.code ? getCellString(row.getCell(colMap.code)) : '';
    const title = colMap.title ? getCellString(row.getCell(colMap.title)) : '';
    const faculty = colMap.faculty ? getCellString(row.getCell(colMap.faculty)) : '';
    const creditStr = colMap.credit ? getCellString(row.getCell(colMap.credit)) : '';
    const hoursStr = colMap.hours ? getCellString(row.getCell(colMap.hours)) : '';
    const remarks = colMap.remarks ? getCellString(row.getCell(colMap.remarks)) : '';

    // Stop if empty row or hits sign-off footer
    if (!code && !title && !faculty) continue;
    if (/principal|hod|head of the department|coordinator/i.test(code + title + faculty)) break;

    const credits = parseFloat(creditStr) || 3;
    const hours = parseFloat(hoursStr) || 4;

    legend.push({
      sno: legend.length + 1,
      courseCode: code,
      courseTitle: title,
      facultyRaw: faculty,
      credits: credits,
      hours: hours,
      remarks: remarks
    });
  }

  return legend;
}

/**
 * Main Entry Point: Parse complete workbook buffer into structured section timetables.
 *
 * @param {Buffer} fileBuffer - The binary Excel file buffer
 * @param {Object} options - Optional config (e.g. deptId, fileName)
 * @returns {Promise<Object>} Structured parsed timetable payload
 */
async function parseTimetableWorkbook(fileBuffer, options = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const parsedSections = [];
  const warnings = [];
  let totalSlotsFound = 0;
  let totalLegendRows = 0;

  const totalSheets = workbook.worksheets.length;
  let sheetsScanned = 0;

  for (let sIdx = 0; sIdx < totalSheets; sIdx++) {
    const worksheet = workbook.worksheets[sIdx];
    const sheetName = worksheet.name;
    sheetsScanned++;

    // Locate all section blocks on this worksheet
    const anchors = findSectionAnchors(worksheet);
    if (anchors.length === 0) continue;

    for (let aIdx = 0; aIdx < anchors.length; aIdx++) {
      const anchor = anchors[aIdx];
      const nextAnchorRow = aIdx + 1 < anchors.length ? anchors[aIdx + 1].rowNumber : -1;

      // 1. Extract metadata
      const meta = extractSectionMetadata(worksheet, anchor.rowNumber, anchor.colNumber, anchor.cellText);

      // 2. Identify period header
      const { headerRowNumber, periods } = findPeriodHeaderRow(worksheet, anchor.rowNumber);

      // 3. Parse Monday-Saturday grid
      const { slots, lastGridRow, dayCount } = parseDayGrid(worksheet, headerRowNumber, periods);

      // 4. Parse Course Legend table
      const legend = parseCourseLegend(worksheet, lastGridRow + 1, nextAnchorRow);

      if (slots.length === 0 && legend.length === 0) {
        warnings.push(`Sheet '${sheetName}' (row ${anchor.rowNumber}): Found Section anchor '${meta.section || '?'}' but no timetable slots or legend rows could be parsed.`);
        continue;
      }

      totalSlotsFound += slots.length;
      totalLegendRows += legend.length;

      parsedSections.push({
        tempSectionId: `sec_${parsedSections.length + 1}`,
        sheetName: sheetName,
        rowStart: anchor.rowNumber,
        rowEnd: lastGridRow,
        meta: meta,
        dayCount: dayCount,
        periodCount: periods.filter(p => p.periodNumber > 0).length,
        periodHeaders: periods,
        slots: slots,
        legend: legend,
        warnings: []
      });
    }
  }

  return {
    summary: {
      fileName: options.fileName || 'workbook.xlsx',
      totalSheets: totalSheets,
      sheetsScanned: sheetsScanned,
      sectionsFound: parsedSections.length,
      totalSlotsFound: totalSlotsFound,
      totalLegendRows: totalLegendRows
    },
    sections: parsedSections,
    warnings: warnings
  };
}

module.exports = {
  parseTimetableWorkbook,
  findSectionAnchors,
  extractSectionMetadata,
  findPeriodHeaderRow,
  parseDayGrid,
  parseCourseLegend,
  romanToArabic,
  normalizeDay,
  getCellString,
  getCellColSpan
};
