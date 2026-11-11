/**
 * services/registryExportService.js
 *
 * AttReg Part 2 (§4.6, §4.7): Server-Side Excel (.xlsx) and PDF (.pdf) Exporters.
 * Consumes buildRegistry() output to guarantee 100% data and calculation parity.
 */

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

function getOrdinalDay(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateBand(dStr) {
  const dt = new Date(dStr + 'T00:00:00.000Z');
  const day = dt.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const month = months[dt.getUTCMonth()];
  const yr = String(dt.getUTCFullYear()).slice(-2);
  return `${getOrdinalDay(day)} ${month} ${yr}`;
}

function colToLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    let mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Generates Excel Workbook with live COUNTIF formulas, merged bands, and freeze panes.
 *
 * @param {object} reg - buildRegistry output
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateExcel(reg) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EAMS Attendance System';
  wb.created = new Date();

  const ws = wb.addWorksheet('Attendance Register', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }]
  });

  const { days, students, periodsPerDay, thresholds } = reg;
  const numDays = days.length;
  const totalPeriodCols = numDays * periodsPerDay;

  // Title Block (Rows 1-3)
  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = 'EAMS ATTENDANCE REGISTER';
  ws.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };

  ws.mergeCells('A2:C2');
  ws.getCell('A2').value = `Class: ${reg.class.name} (${reg.class.dept}) | Batch: ${reg.class.batch || '—'} | Sem: ${reg.class.sem || '—'}`;
  ws.getCell('A2').font = { size: 10, italic: true };

  ws.mergeCells('A3:C3');
  ws.getCell('A3').value = `Range: ${reg.range.from} to ${reg.range.to} | Advisor: ${reg.class.advisor || 'Not assigned'}`;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF64748B' } };

  // Set widths for Identity columns
  ws.getColumn(1).width = 6;  // S.No
  ws.getColumn(2).width = 16; // Reg No
  ws.getColumn(3).width = 24; // Name

  // Headers (Row 4: Date Bands, Row 5: Period Numbers)
  ws.getCell('A4').value = '#';
  ws.getCell('B4').value = 'Reg No';
  ws.getCell('C4').value = 'Student Name';
  ws.mergeCells('A4:A5');
  ws.mergeCells('B4:B5');
  ws.mergeCells('C4:C5');

  ['A4', 'B4', 'C4', 'A5', 'B5', 'C5'].forEach(ref => {
    const c = ws.getCell(ref);
    c.font = { bold: true, size: 10 };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  let curCol = 4;
  days.forEach(day => {
    const startCol = curCol;
    const endCol = curCol + periodsPerDay - 1;
    const startLetter = colToLetter(startCol);
    const endLetter = colToLetter(endCol);

    ws.mergeCells(`${startLetter}4:${endLetter}4`);
    const dateCell = ws.getCell(`${startLetter}4`);
    const ddmm = (day.date && day.date.length >= 10)
      ? (day.date.slice(8, 10) + '-' + day.date.slice(5, 7))
      : day.date;
    dateCell.value = `${ddmm} · ${day.dow}`;
    dateCell.alignment = { vertical: 'middle', horizontal: 'center' };
    dateCell.font = { bold: true, size: 9.5 };
    dateCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: day.isHoliday ? 'FFF3F4F6' : 'FFF8FAFC' }
    };

    for (let p = 1; p <= periodsPerDay; p++) {
      const pCol = curCol + (p - 1);
      const pCell = ws.getCell(5, pCol);
      pCell.value = p;
      pCell.alignment = { vertical: 'middle', horizontal: 'center' };
      pCell.font = { size: 8.5, bold: true, color: { argb: 'FF475569' } };
      pCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: day.isHoliday ? 'FFF3F4F6' : 'FFFFFFFF' }
      };
      ws.getColumn(pCol).width = 4.2;
    }

    curCol += periodsPerDay;
  });

  // Totals Columns Headers
  const pColIdx = curCol;
  const aColIdx = curCol + 1;
  const lColIdx = curCol + 2;
  const pctColIdx = curCol + 3;

  const tStartLetter = colToLetter(pColIdx);
  const tEndLetter = colToLetter(pctColIdx);
  ws.mergeCells(`${tStartLetter}4:${tEndLetter}4`);
  const totHeader = ws.getCell(`${tStartLetter}4`);
  totHeader.value = 'Totals';
  totHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  totHeader.font = { bold: true, size: 10 };
  totHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  const subHeaders = [
    { col: pColIdx, label: 'P', width: 6 },
    { col: aColIdx, label: 'A', width: 6 },
    { col: lColIdx, label: 'L', width: 6 },
    { col: pctColIdx, label: '%', width: 9 }
  ];

  subHeaders.forEach(sh => {
    const c = ws.getCell(5, sh.col);
    c.value = sh.label;
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.font = { bold: true, size: 9.5 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getColumn(sh.col).width = sh.width;
  });

  // Data Rows
  let curRow = 6;
  students.forEach((st, sIdx) => {
    ws.getCell(curRow, 1).value = sIdx + 1;
    ws.getCell(curRow, 1).alignment = { horizontal: 'center' };

    ws.getCell(curRow, 2).value = st.regNo;
    ws.getCell(curRow, 2).alignment = { horizontal: 'center' };
    ws.getCell(curRow, 2).font = { bold: true, size: 9.5 };

    ws.getCell(curRow, 3).value = st.name;
    ws.getCell(curRow, 3).font = { size: 9.5 };

    let gridCol = 4;
    days.forEach((day, dIdx) => {
      const dayCells = st.cells[dIdx] || '';
      for (let p = 0; p < periodsPerDay; p++) {
        const glyph = dayCells[p] || '–';
        const cell = ws.getCell(curRow, gridCol);
        cell.value = glyph === 'O' ? 'OD' : glyph;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { size: 8.5, bold: glyph === 'A' || glyph === 'P' };

        // Highlight styles
        if (glyph === 'A') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; // Yellow
          cell.font = { bold: true, color: { argb: 'FF854D0E' } };
        } else if (glyph === 'L' || glyph === 'O') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; // Light blue
          cell.font = { color: { argb: 'FF0369A1' } };
        } else if (glyph === 'H') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
          cell.font = { color: { argb: 'FF94A3B8' } };
        } else if (glyph === '–') {
          cell.font = { color: { argb: 'FFCBD5E1' } };
        } else if (glyph === 'P') {
          cell.font = { color: { argb: 'FF16A34A' } };
        }

        gridCol++;
      }
    });

    // Live COUNTIF Formulas
    const firstColLetter = colToLetter(4);
    const lastColLetter = colToLetter(gridCol - 1);
    const pLetter = colToLetter(pColIdx);
    const aLetter = colToLetter(aColIdx);
    const lLetter = colToLetter(lColIdx);
    const pctLetter = colToLetter(pctColIdx);

    // Present formula
    ws.getCell(curRow, pColIdx).value = {
      formula: `COUNTIF(${firstColLetter}${curRow}:${lastColLetter}${curRow},"P")`,
      result: st.totals.P
    };
    ws.getCell(curRow, pColIdx).font = { bold: true, color: { argb: 'FF16A34A' } };
    ws.getCell(curRow, pColIdx).alignment = { horizontal: 'center' };

    // Absent formula
    ws.getCell(curRow, aColIdx).value = {
      formula: `COUNTIF(${firstColLetter}${curRow}:${lastColLetter}${curRow},"A")`,
      result: st.totals.A
    };
    ws.getCell(curRow, aColIdx).font = { bold: true, color: { argb: 'FFDC2626' } };
    ws.getCell(curRow, aColIdx).alignment = { horizontal: 'center' };

    // Leave formula: L + OD
    ws.getCell(curRow, lColIdx).value = {
      formula: `COUNTIF(${firstColLetter}${curRow}:${lastColLetter}${curRow},"L") + COUNTIF(${firstColLetter}${curRow}:${lastColLetter}${curRow},"OD")`,
      result: st.totals.L
    };
    ws.getCell(curRow, lColIdx).font = { bold: true, color: { argb: 'FF0284C7' } };
    ws.getCell(curRow, lColIdx).alignment = { horizontal: 'center' };

    // Percentage formula: P / (P + A + L)
    ws.getCell(curRow, pctColIdx).value = {
      formula: `IF((${pLetter}${curRow}+${aLetter}${curRow}+${lLetter}${curRow})>0, ROUND((${pLetter}${curRow}/(${pLetter}${curRow}+${aLetter}${curRow}+${lLetter}${curRow}))*100, 1), 100.0)`,
      result: st.totals.pct
    };
    ws.getCell(curRow, pctColIdx).font = { bold: true };
    ws.getCell(curRow, pctColIdx).alignment = { horizontal: 'center' };

    if (st.totals.pct < thresholds.low) {
      ws.getCell(curRow, pctColIdx).font = { bold: true, color: { argb: 'FFDC2626' } };
      ws.getCell(curRow, pctColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else if (st.totals.pct < thresholds.min) {
      ws.getCell(curRow, pctColIdx).font = { bold: true, color: { argb: 'FFD97706' } };
      ws.getCell(curRow, pctColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    }

    curRow++;
  });

  // Footer Row: Class Total Present
  const footerRow = curRow;
  ws.mergeCells(`A${footerRow}:C${footerRow}`);
  const footCell = ws.getCell(`A${footerRow}`);
  footCell.value = 'Class Present';
  footCell.font = { bold: true, size: 10 };
  footCell.alignment = { vertical: 'middle', horizontal: 'right' };
  footCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  for (let c = 4; c < curCol; c++) {
    const cLetter = colToLetter(c);
    const startDataRow = 6;
    const endDataRow = curRow - 1;
    const fCell = ws.getCell(footerRow, c);
    fCell.value = {
      formula: `COUNTIF(${cLetter}${startDataRow}:${cLetter}${endDataRow},"P")`
    };
    fCell.font = { bold: true, size: 8.5 };
    fCell.alignment = { vertical: 'middle', horizontal: 'center' };
    fCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  }

  // Thin borders on all grid cells
  const borderStyle = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
  };

  for (let r = 4; r <= footerRow; r++) {
    for (let c = 1; c <= pctColIdx; c++) {
      ws.getCell(r, c).border = borderStyle;
    }
  }

  // Sheet 2: Legend & Summary
  const wsLegend = wb.addWorksheet('Legend & Summary');
  wsLegend.getColumn(1).width = 12;
  wsLegend.getColumn(2).width = 40;

  wsLegend.addRow(['Glyph', 'Description']);
  wsLegend.getRow(1).font = { bold: true };
  wsLegend.addRow(['P', 'Present']);
  wsLegend.addRow(['A', 'Absent (Highlighted in Yellow)']);
  wsLegend.addRow(['L', 'Approved Leave']);
  wsLegend.addRow(['OD', 'On Duty Approved Leave']);
  wsLegend.addRow(['H', 'Holiday / Declared Non-Working Day']);
  wsLegend.addRow(['–', 'Not Marked / Unrecorded Period']);
  wsLegend.addRow([]);
  wsLegend.addRow(['Shortage Thresholds', '']);
  wsLegend.addRow(['Amber Alert', `< ${thresholds.min}% Attendance`]);
  wsLegend.addRow(['Red Alert', `< ${thresholds.low}% Low Attendance`]);

  return wb.xlsx.writeBuffer();
}

/**
 * Generates PDF Document in Landscape A4 with week blocks.
 *
 * @param {object} reg - buildRegistry output
 * @returns {Promise<Buffer>} PDF file buffer
 */
function generatePdf(reg) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        layout: 'landscape',
        size: 'A4',
        margin: 28
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const { days, students, periodsPerDay } = reg;

      // Group days into 6-day week blocks
      const DAYS_PER_BLOCK = 6;
      const blocks = [];
      for (let i = 0; i < days.length; i += DAYS_PER_BLOCK) {
        blocks.push(days.slice(i, i + DAYS_PER_BLOCK));
      }

      blocks.forEach((blockDays, bIdx) => {
        if (bIdx > 0) doc.addPage();

        // Title Header
        doc.fontSize(14).font('Helvetica-Bold').text('EAMS ATTENDANCE REGISTER', { align: 'center' });
        doc.fontSize(9).font('Helvetica').text(
          `Class: ${reg.class.name} (${reg.class.dept}) | Batch: ${reg.class.batch || '—'} | Sem: ${reg.class.sem || '—'} | Range: ${blockDays[0].date} to ${blockDays[blockDays.length - 1].date}`,
          { align: 'center' }
        );
        doc.moveDown(0.6);

        // Dimensions
        const startX = 28;
        let startY = doc.y;
        const sNoWidth = 20;
        const regNoWidth = 65;
        const nameWidth = 100;
        const idWidth = sNoWidth + regNoWidth + nameWidth; // 185 pt

        const availWidth = 842 - 56 - idWidth - (bIdx === blocks.length - 1 ? 70 : 0);
        const totalPeriodsInBlock = blockDays.length * periodsPerDay;
        const colWidth = Math.max(10, Math.floor(availWidth / totalPeriodsInBlock));
        const rowHeight = 11;

        // Header Row 1: Merged Date Bands
        doc.rect(startX, startY, idWidth, rowHeight * 2).fillAndStroke('#F1F5F9', '#94A3B8');
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold').text('Student Details', startX + 6, startY + 7);

        let curX = startX + idWidth;
        blockDays.forEach(day => {
          const w = colWidth * periodsPerDay;
          doc.rect(curX, startY, w, rowHeight).fillAndStroke(day.isHoliday ? '#E2E8F0' : '#F8FAFC', '#94A3B8');
          const ddmm = (day.date && day.date.length >= 10)
            ? (day.date.slice(8, 10) + '-' + day.date.slice(5, 7))
            : day.date;
          doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold')
            .text(`${ddmm} ${day.dow}`, curX, startY + 2, { width: w, align: 'center' });
          curX += w;
        });

        if (bIdx === blocks.length - 1) {
          doc.rect(curX, startY, 70, rowHeight * 2).fillAndStroke('#E2E8F0', '#94A3B8');
          doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold').text('Totals', curX, startY + 7, { width: 70, align: 'center' });
        }

        // Header Row 2: Period Numbers
        startY += rowHeight;
        curX = startX + idWidth;
        blockDays.forEach(day => {
          for (let p = 1; p <= periodsPerDay; p++) {
            doc.rect(curX, startY, colWidth, rowHeight).fillAndStroke('#FFFFFF', '#CBD5E1');
            doc.fillColor('#475569').fontSize(6).font('Helvetica').text(String(p), curX, startY + 2, { width: colWidth, align: 'center' });
            curX += colWidth;
          }
        });

        // Data Rows
        startY += rowHeight;
        const dayOffset = bIdx * DAYS_PER_BLOCK;

        students.forEach((st, sIdx) => {
          // Page overflow check
          if (startY > 520) {
            doc.addPage();
            startY = 35;
          }

          // Student Identity
          doc.rect(startX, startY, sNoWidth, rowHeight).fillAndStroke('#FFFFFF', '#E2E8F0');
          doc.fillColor('#64748B').fontSize(6.5).font('Helvetica').text(String(sIdx + 1), startX, startY + 2, { width: sNoWidth, align: 'center' });

          doc.rect(startX + sNoWidth, startY, regNoWidth, rowHeight).fillAndStroke('#FFFFFF', '#E2E8F0');
          doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold').text(st.regNo, startX + sNoWidth + 2, startY + 2, { width: regNoWidth - 4 });

          doc.rect(startX + sNoWidth + regNoWidth, startY, nameWidth, rowHeight).fillAndStroke('#FFFFFF', '#E2E8F0');
          doc.fillColor('#0F172A').fontSize(6).font('Helvetica').text(st.name.slice(0, 22), startX + sNoWidth + regNoWidth + 3, startY + 2, { width: nameWidth - 6 });

          // Periods
          let cellX = startX + idWidth;
          blockDays.forEach((day, bdIdx) => {
            const actualDayIdx = dayOffset + bdIdx;
            const dayString = st.cells[actualDayIdx] || '';

            for (let p = 0; p < periodsPerDay; p++) {
              const glyph = dayString[p] || '–';
              let bg = '#FFFFFF';
              let textCol = '#64748B';

              if (glyph === 'A') {
                bg = '#FFFF00'; // Yellow
                textCol = '#854D0E';
              } else if (glyph === 'P') {
                textCol = '#16A34A';
              } else if (glyph === 'L' || glyph === 'O') {
                bg = '#E0F2FE';
                textCol = '#0369A1';
              } else if (glyph === 'H') {
                bg = '#F3F4F6';
                textCol = '#94A3B8';
              }

              doc.rect(cellX, startY, colWidth, rowHeight).fillAndStroke(bg, '#E2E8F0');
              doc.fillColor(textCol).fontSize(5.5).font(glyph === 'A' || glyph === 'P' ? 'Helvetica-Bold' : 'Helvetica')
                .text(glyph === 'O' ? 'OD' : glyph, cellX, startY + 2, { width: colWidth, align: 'center' });

              cellX += colWidth;
            }
          });

          // Totals on last block
          if (bIdx === blocks.length - 1) {
            doc.rect(cellX, startY, 70, rowHeight).fillAndStroke('#F8FAFC', '#E2E8F0');
            doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold')
              .text(`${st.totals.P}P ${st.totals.A}A ${st.totals.pct}%`, cellX, startY + 2, { width: 70, align: 'center' });
          }

          startY += rowHeight;
        });

        // Signatures strip on last page
        if (bIdx === blocks.length - 1 && startY <= 520) {
          doc.moveDown(2);
          const sigY = 540;
          doc.fontSize(8).font('Helvetica')
            .text('Class Advisor', 60, sigY)
            .text('Head of Department', 380, sigY)
            .text('Principal', 700, sigY);
        }
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateExcel,
  generatePdf
};
