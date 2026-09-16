const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { dateToDow, satOrdinal } = require('../utils/dateUtils');

// Helper to normalize input date string to YYYY-MM-DD
function parseDateStr(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    return dateInput.split('T')[0];
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.toISOString().split('T')[0];
  }
  return String(dateInput).split('T')[0];
}

// GET /api/calendar  — all days in a month
router.get('/', authMiddleware, async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year);
    const docs = await M.CalendarDay.find({ month: mm, year: yyyy }).sort({ date: 1 }).lean();
    
    // Ensure clean dateKey on every day object
    const days = docs.map(d => {
      let dateKey = '';
      if (d.date instanceof Date) {
        dateKey = d.date.toISOString().split('T')[0];
      } else if (typeof d.date === 'string') {
        dateKey = d.date.split('T')[0];
      }
      return {
        ...d,
        dateKey: dateKey || (d.date ? String(d.date) : '')
      };
    });
    res.json(days);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/calendar/check/:date  — single day status + exam info
router.get('/check/:date', authMiddleware, async (req, res) => {
  try {
    const dateStr = parseDateStr(req.params.date);
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const localDateObj = new Date(dateStr + 'T00:00:00');
    const [day, exams] = await Promise.all([
      M.CalendarDay.findOne({
        $or: [{ date: dateObj }, { date: localDateObj }]
      }),
      M.Exam.find({ Dates: dateStr, status: { $in: ['upcoming', 'ongoing'] } })
    ]);
    const defaults = { details: [{ year: 'I', dayType: dateObj.getUTCDay() === 0 ? 'leave' : 'working', comments: '', timing: { start: '08:30', end: '16:30' }
      }]
    };
    const dayObj = day ? (day.toObject ? day.toObject() : day) : defaults;
    res.json({ ...dayObj, dateKey: dateStr, hasExam: exams.length > 0, exams });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/calendar  — upsert a single day (admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { date, details, isFinalized } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    if (!details || !Array.isArray(details)) return res.status(400).json({ error: 'details array required' });
    
    const dateStr = parseDateStr(date);
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const localDateObj = new Date(dateStr + 'T00:00:00');
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getUTCFullYear());
    const day = dateToDow(dateStr);
    
    // Generate unique CalendarTrackId if new
    let trackId;
    const existing = await M.CalendarDay.findOne({
      $or: [{ date: dateObj }, { date: localDateObj }]
    });
    if (existing) { trackId = existing.CalendarTrackId; }
    else { trackId = `TR-CAL${year}${month}${String(dateObj.getUTCDate()).padStart(2, '0')}-${Date.now()}`; }
    
    const updateData = { CalendarTrackId: trackId, date: dateObj, month, year, day, details, createdBy: req.user.name};
    if (isFinalized) { updateData.isFinalized = true; updateData.finalizedBy = req.user.name; updateData.finalizedAt = new Date();}
    else { updateData.isFinalized = false; updateData.finalizedBy = null; updateData.finalizedAt = null; }
    
    const doc = await M.CalendarDay.findOneAndUpdate(
      { $or: [{ date: dateObj }, { date: localDateObj }] },
      { 
        $set: updateData,
        $push: {
          history: { updatedBy: req.user.name, updatedAt: new Date(), field: 'details', 
            oldValue: existing ? JSON.stringify(existing.details) : '', newValue: JSON.stringify(details)
          }
        }
      },
      { returnDocument: 'after', upsert: true }
    );
    await logAction(req.user._id, req.user.name, req.user.role, 'Calendar Day Updated', `${dateStr}`, 'manage', 'info', req.ip);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/calendar/:date  — same as POST
router.put('/:date', authMiddleware, adminOnly, async (req, res) => {
  try {
    const dateStr = parseDateStr(req.params.date);
    const { details, isFinalized } = req.body;
    if (!details || !Array.isArray(details)) return res.status(400).json({ error: 'details array required' });
    
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const localDateObj = new Date(dateStr + 'T00:00:00');
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getUTCFullYear());
    const existing = await M.CalendarDay.findOne({
      $or: [{ date: dateObj }, { date: localDateObj }]
    });
    
    const updateData = { details, day: dateToDow(dateStr), month, year, date: dateObj };
    
    if (isFinalized) { updateData.isFinalized = true; updateData.finalizedBy = req.user.name; updateData.finalizedAt = new Date(); }
    else { updateData.isFinalized = false; updateData.finalizedBy = null; updateData.finalizedAt = null; }
    
    const doc = await M.CalendarDay.findOneAndUpdate(
      { $or: [{ date: dateObj }, { date: localDateObj }] },
      { $set: updateData, $push: { history: {updatedBy: req.user.name, updatedAt: new Date(), field: 'details', oldValue: existing ? JSON.stringify(existing.details) : '', newValue: JSON.stringify(details) } } },
      { returnDocument: 'after', upsert: true }
    );
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/calendar/month/save  — save all days for a month in bulk (admin only)
router.post('/month/save', authMiddleware, adminOnly, async (req, res) => {
  try {
    const month = parseInt(req.body.month);
    const year = parseInt(req.body.year);
    const isFinalized = req.body.isFinalized === true;
    const days = req.body.days;
    if (!month || !year || !Array.isArray(days)) {
      return res.status(400).json({ error: 'month, year, and days array required' });
    }
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year);
    const ops = [];
    const now = new Date();

    for (const d of days) {
      if (!d.date) continue;
      const dateStr = parseDateStr(d.date);
      if (!dateStr) continue;
      const dateObj = new Date(dateStr + 'T00:00:00.000Z');
      const localDateObj = new Date(dateStr + 'T00:00:00');
      const day = dateToDow(dateStr);
      const details = d.details || [{ year: 'I', dayType: 'working', comments: '', timing: { start: '08:30', end: '16:30' } }];
      const dayNum = dateStr.split('-')[2] || String(dateObj.getUTCDate()).padStart(2, '0');
      const trackId = `TR-CAL${yyyy}${mm}${dayNum}-${Date.now()}-${parseInt(dayNum, 10)}`;
      
      const updateData = {
        date: dateObj,
        month: mm,
        year: yyyy,
        day,
        details,
        createdBy: req.user.name,
        isFinalized: isFinalized,
        finalizedBy: isFinalized ? req.user.name : null,
        finalizedAt: isFinalized ? now : null
      };

      ops.push({
        updateOne: {
          filter: {
            $or: [
              { date: dateObj },
              { date: localDateObj }
            ]
          },
          update: {
            $set: updateData,
            $setOnInsert: { CalendarTrackId: trackId }
          },
          upsert: true
        }
      });
    }

    if (ops.length > 0) {
      await M.CalendarDay.bulkWrite(ops);
    }
    const savedDates = days.map(d => parseDateStr(d.date)).filter(Boolean);
    const datesText = savedDates.length > 0 ? ` [${savedDates.join(', ')}]` : '';
    const logDetails = `${yyyy}-${mm} (${savedDates.length} days)${datesText}`;
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      isFinalized ? 'Calendar Month Finalized' : 'Calendar Days Updated',
      logDetails,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: isFinalized ? 'action' : 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights
      }
    );
    res.json({ ok: true, count: ops.length, isFinalized, dates: savedDates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/month/clear  — delete all saved days for a specific month and year (admin only)
router.delete('/month/clear', authMiddleware, adminOnly, async (req, res) => {
  try {
    const month = parseInt(req.query.month) || (req.body && parseInt(req.body.month));
    const year = parseInt(req.query.year) || (req.body && parseInt(req.body.year));
    if (!month || !year) return res.status(400).json({ error: 'month and year required' });
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year);
    const result = await M.CalendarDay.deleteMany({ month: mm, year: yyyy });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Calendar Month Cleared',
      `${yyyy}-${mm} (${result.deletedCount || 0} days removed)`,
      'manage',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'manage', subType: 'action', trackId: req.user.trackId }
    );
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/calendar/:date  — remove override, revert to auto-default
router.delete('/:date', authMiddleware, adminOnly, async (req, res) => {
  try {
    const dateStr = parseDateStr(req.params.date);
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const localDateObj = new Date(dateStr + 'T00:00:00');
    await M.CalendarDay.deleteMany({
      $or: [{ date: dateObj }, { date: localDateObj }]
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/calendar/day-details/:date  — single day with exam info for specific student
router.get('/day-details/:date', authMiddleware, async (req, res) => {
  try {
    const dateStr = parseDateStr(req.params.date);
    const { trackId } = req.query;
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const localDateObj = new Date(dateStr + 'T00:00:00');
    const [day, exams] = await Promise.all([
      M.CalendarDay.findOne({
        $or: [{ date: dateObj }, { date: localDateObj }]
      }),
      M.Exam.find({ Dates: dateStr })
    ]);
    if (!day) return res.status(404).json({ error: 'Day not found' });
    let filteredDetails = day.details;
    if (trackId) {
      const student = await M.Student.findOne({ studentTrackId: trackId }).select('year');
      if (student && student.year) filteredDetails = day.details.filter(d => d.year === student.year);
    }
    const dayObj = day.toObject ? day.toObject() : day;
    res.json({ ...dayObj, dateKey: dateStr, details: filteredDetails, exams: exams || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/calendar/bulk-generate  — auto-fill month with default rules
router.post('/bulk-generate', authMiddleware, adminOnly, async (req, res) => {
  try {
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const overwriteExisting = req.body.overwriteExisting === true;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year);
    let generated = 0, skipped = 0;
    const ops = [];
    
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${year}-${mm}-${String(day).padStart(2, '0')}`;
      const d = new Date(dateStr + 'T00:00:00.000Z');
      const localD = new Date(dateStr + 'T00:00:00');
      const dow = d.getUTCDay();
      let dayType;
      
      if (dow === 0) { 
        dayType = 'leave'; 
      } else if (dow === 6) {
        const sn = satOrdinal(dateStr);
        dayType = (sn % 2 === 0 || sn === 5) ? 'working' : 'leave';
      } else { 
        dayType = 'working'; 
      }
      
      if (!overwriteExisting) {
        const existing = await M.CalendarDay.findOne({
          $or: [{ date: d }, { date: localD }],
          isFinalized: true
        });
        if (existing) { skipped++; continue; }
      }
      
      const trackId = `TR-CAL${yyyy}${mm}${String(day).padStart(2, '0')}-${Date.now()}-${day}`;
      
      // Create details for all years
      const details = ['I', 'II', 'III', 'IV'].map(yr => ({year: yr, dayType, comments: '', timing: { start: '08:30', end: '16:30' } }));
      
      ops.push({ 
        updateOne: { filter: { $or: [{ date: d }, { date: localD }] }, 
          update: { $set: { CalendarTrackId: trackId, date: d, month: mm, year: yyyy, day: dateToDow(dateStr), details, createdBy: 'system',isFinalized: false } }, 
          upsert: true 
        } 
      });
      generated++;
    }
    if (ops.length) await M.CalendarDay.bulkWrite(ops);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Calendar Days Auto-Generated',
      `${yyyy}-${mm} (${generated} days generated, ${skipped} skipped)`,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'manage', subType: 'action', trackId: req.user.trackId }
    );
    res.json({ generated, skipped, month, year });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;