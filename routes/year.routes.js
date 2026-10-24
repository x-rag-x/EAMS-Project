const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { invalidateSettingsCache } = require('../utils/settingsCache');
const { normalizeYearRange, isValidYearRange, toBatchTrackId } = require('../utils/yearFormat');

// GET /api/year - Get all academic years
router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await M.Year.find().sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/current - Get current academic year
router.get('/current', authMiddleware, async (req, res) => {
  try {
    let currentYear = await M.Year.findOne({ isCurrent: true });
    if (!currentYear) {
      currentYear = await M.Year.findOne().sort({ createdAt: -1 });
    }
    if (currentYear && currentYear.academicYear) {
      return res.json(normalizeYearRange(currentYear.academicYear));
    }
    const acadSetting = await M.Settings.findOne({ key: 'academic' }).lean();
    if (acadSetting && acadSetting.value && acadSetting.value.academicYear) {
      return res.json(normalizeYearRange(acadSetting.value.academicYear));
    }
    const curYear = new Date().getFullYear();
    res.json(`${curYear}-${curYear + 1}`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/batches - Get list of available batches
router.get('/batches', authMiddleware, async (req, res) => {
  try {
    const batchSet = new Set();
    const currentYear = await M.Year.findOne({ isCurrent: true });
    if (currentYear && Array.isArray(currentYear.batches)) {
      currentYear.batches.forEach(b => {
        const nb = normalizeYearRange(b && b.batch);
        if (nb) batchSet.add(nb);
      });
    }
    const allYears = await M.Year.find().lean();
    allYears.forEach(y => {
      if (Array.isArray(y.batches)) {
        y.batches.forEach(b => {
          const nb = normalizeYearRange(b && b.batch);
          if (nb) batchSet.add(nb);
        });
      }
    });
    const classBatches = await M.Class.distinct('batch');
    classBatches.forEach(b => {
      const nb = normalizeYearRange(b);
      if (nb) batchSet.add(nb);
    });
    const studentBatches = await M.Student.distinct('batch');
    studentBatches.forEach(b => {
      const nb = normalizeYearRange(b);
      if (nb) batchSet.add(nb);
    });

    if (batchSet.size === 0) {
      let acadYear = currentYear ? currentYear.academicYear : null;
      if (!acadYear) {
        const acadSetting = await M.Settings.findOne({ key: 'academic' }).lean();
        if (acadSetting && acadSetting.value && acadSetting.value.academicYear) {
          acadYear = acadSetting.value.academicYear;
        }
      }
      const baseYear = acadYear ? parseInt(acadYear.split('-')[0], 10) : new Date().getFullYear();
      if (!isNaN(baseYear)) {
        for (let i = 0; i <= 4; i++) {
          const start = baseYear - i;
          batchSet.add(`${start}-${start + 4}`);
        }
      }
    }

    const sortedBatches = Array.from(batchSet).filter(b => isValidYearRange(b)).sort().reverse();
    res.json(sortedBatches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/batch/:batchTrackId - Get currentYear and currentSem for a batchTrackId
router.get('/batch/:batchTrackId', authMiddleware, async (req, res) => {
  try {
    const rawParam = req.params.batchTrackId;
    const normParam = normalizeYearRange(rawParam);
    const derivedTrackId = toBatchTrackId(normParam);
    const lookupValues = [rawParam, normParam, derivedTrackId].filter(Boolean);

    let year = await M.Year.findOne({
      $or: [
        { 'batches.batchTrackId': { $in: lookupValues } },
        { 'batches.batch': { $in: lookupValues } }
      ],
      isCurrent: true
    });
    if (!year) {
      year = await M.Year.findOne({
        $or: [
          { 'batches.batchTrackId': { $in: lookupValues } },
          { 'batches.batch': { $in: lookupValues } }
        ]
      }).sort({ createdAt: -1 });
    }
    if (!year) return res.status(404).json({ error: 'Batch not found' });
    
    const batch = year.batches.find(b =>
      lookupValues.includes(b.batchTrackId) || lookupValues.includes(b.batch) || lookupValues.includes(normalizeYearRange(b.batch))
    );
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    
    res.json({
      batchTrackId: batch.batchTrackId,
      batch: normalizeYearRange(batch.batch),
      currentYear: batch.currentYear,
      currentSem: batch.currentSem,
      academicYear: normalizeYearRange(year.academicYear)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/regulations - Get list of curriculum regulations
router.get('/regulations', authMiddleware, async (req, res) => {
  try {
    const acadSetting = await M.Settings.findOne({ key: 'academic' }).lean();
    const globalMinAtt = Number(acadSetting?.value?.minAttendance) || 75;
    const regMinMap = acadSetting?.value?.regulationMinAttendance || {};

    const defaultRegs = [
      { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false, minAttendance: regMinMap['2021'] !== undefined ? Number(regMinMap['2021']) : 75 },
      { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true, minAttendance: regMinMap['2025'] !== undefined ? Number(regMinMap['2025']) : 75 }
    ];

    let regs = [];
    const currentYear = await M.Year.findOne({ isCurrent: true }).lean();
    if (currentYear && Array.isArray(currentYear.regulations) && currentYear.regulations.length > 0) {
      regs = currentYear.regulations;
    } else {
      const anyYear = await M.Year.findOne({ 'regulations.0': { $exists: true } }).lean();
      if (anyYear && Array.isArray(anyYear.regulations) && anyYear.regulations.length > 0) {
        regs = anyYear.regulations;
      } else {
        regs = defaultRegs;
      }
    }

    const mergedRegs = regs.map(r => {
      const rObj = { ...r };
      if (regMinMap[r.code] !== undefined) {
        rObj.minAttendance = Number(regMinMap[r.code]);
      } else if (rObj.minAttendance === undefined || rObj.minAttendance === null) {
        rObj.minAttendance = globalMinAtt;
      }
      return rObj;
    });

    res.json(mergedRegs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/year/regulations - Add or update a curriculum regulation
router.post('/regulations', authMiddleware, requirePage('manage', 'create', { tab: 'years' }), async (req, res) => {
  try {
    const { code, name, year, isDefault, minAttendance } = req.body;
    if (!code) return res.status(400).json({ error: 'Regulation code is required (e.g. 2021, 2025)' });
    const regDoc = {
      code: String(code).trim(),
      name: String(name || `Regulation ${code}`).trim(),
      year: String(year || code).trim(),
      isDefault: Boolean(isDefault),
      minAttendance: minAttendance !== undefined ? (Number(minAttendance) || 75) : 75
    };

    let targetYear = await M.Year.findOne({ isCurrent: true });
    if (!targetYear) targetYear = await M.Year.findOne().sort({ createdAt: -1 });
    if (!targetYear) {
      targetYear = await M.Year.create({
        academicYear: '2025-2026',
        batches: [],
        regulations: [regDoc],
        isCurrent: true
      });
    } else {
      if (!Array.isArray(targetYear.regulations)) targetYear.regulations = [];
      const idx = targetYear.regulations.findIndex(r => r.code === regDoc.code);
      if (idx >= 0) {
        targetYear.regulations[idx] = regDoc;
      } else {
        targetYear.regulations.push(regDoc);
      }
      if (regDoc.isDefault) {
        targetYear.regulations.forEach(r => { if (r.code !== regDoc.code) r.isDefault = false; });
      }
      await targetYear.save();
    }

    // Sync minAttendance into Settings.academic
    await M.Settings.findOneAndUpdate(
      { key: 'academic' },
      { $set: { [`value.regulationMinAttendance.${regDoc.code}`]: regDoc.minAttendance } },
      { upsert: true }
    );
    invalidateSettingsCache('academic');

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Regulation Saved', regDoc.name, 'year', 'info', req.ip, req.user.sessionId
    );
    res.json({ ok: true, data: targetYear.regulations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/year/regulations/:code - Remove a curriculum regulation
router.delete('/regulations/:code', authMiddleware, requirePage('manage', 'delete', { tab: 'years' }), async (req, res) => {
  try {
    const code = req.params.code;
    let targetYear = await M.Year.findOne({ isCurrent: true });
    if (!targetYear) targetYear = await M.Year.findOne().sort({ createdAt: -1 });
    if (targetYear && Array.isArray(targetYear.regulations)) {
      const removedReg = targetYear.regulations.find(r => r.code === code);
      if (removedReg) {
        await M.UndoLog.create({
          collectionName: 'years',
          label: `Regulation: ${removedReg.code} (${targetYear.academicYear || ''})`,
          snapshot: { yearId: targetYear._id, regulation: removedReg },
          deletedBy: req.user.name || req.user.username || 'admin',
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        }).catch(err => console.warn('[UndoLog Error]:', err.message));
      }
      targetYear.regulations = targetYear.regulations.filter(r => r.code !== code);
      await targetYear.save();
    }

    // Clean up setting
    await M.Settings.findOneAndUpdate(
      { key: 'academic' },
      { $unset: { [`value.regulationMinAttendance.${code}`]: '' } }
    );
    invalidateSettingsCache('academic');

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Regulation Deleted', code, 'year', 'warning', req.ip, req.user.sessionId
    );
    res.json({ ok: true, deleted: code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/:id - Get specific year by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const year = await M.Year.findById(req.params.id);
    if (!year) return res.status(404).json({ error: 'Academic year not found' });
    res.json(year);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/year - Create new academic year
router.post('/', authMiddleware, requirePage('manage', 'create', { tab: 'years' }), async (req, res) => {
  try {
    const { academicYear, batches, semesterDates, regulations, isCurrent } = req.body;

    if (!academicYear || !batches || !Array.isArray(batches) || batches.length === 0) {
      return res.status(400).json({ error: 'academicYear and batches array are required' });
    }

    const normAcademicYear = normalizeYearRange(academicYear);
    if (!isValidYearRange(normAcademicYear)) {
      return res.status(400).json({ error: 'academicYear must follow YYYY-YYYY format (e.g. 2026-2027)' });
    }

    const normalizedBatches = batches.map(b => {
      const normB = normalizeYearRange(b.batch);
      return {
        ...b,
        batch: normB,
        batchTrackId: b.batchTrackId || toBatchTrackId(normB)
      };
    });

    for (const batch of normalizedBatches) {
      if (!batch.batchTrackId || !batch.batch || !batch.currentYear || !batch.currentSem) {
        return res.status(400).json({ error: 'Each batch must have batchTrackId, batch, currentYear, and currentSem' });
      }
    }
    if (isCurrent) {
      await M.Year.updateMany({}, { $set: { isCurrent: false } });
      await M.Settings.findOneAndUpdate(
        { key: 'academic' },
        { $set: { 'value.academicYear': normAcademicYear } }
      );
      invalidateSettingsCache('academic');
    }
    const year = await M.Year.create({
      academicYear: normAcademicYear,
      batches: normalizedBatches,
      regulations: regulations || [],
      semesterDates: semesterDates || [],
      createdBy: req.user.trackId || req.user.name,
      isCurrent: isCurrent || false
    });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Academic Year Created',
      normAcademicYear,
      'year',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: year.toObject ? year.toObject() : year }
      }
    );
    res.status(201).json(year);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Academic year already exists' });
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/year/:id - Update academic year (including batch progress)
router.put('/:id', authMiddleware, requirePage('manage', 'edit', { tab: 'years' }), async (req, res) => {
  try {
    const { academicYear, batches, semesterDates, regulations, isCurrent } = req.body;
    const existingYear = await M.Year.findById(req.params.id);
    if (!existingYear) return res.status(404).json({ error: 'Academic year not found' });

    const before = existingYear.toObject();
    const updates = {};
    const historyEntries = [];
    const updatedBy = req.user.trackId || req.user.name;
    const updatedAt = new Date();

    if (academicYear) {
      const normAcademicYear = normalizeYearRange(academicYear);
      if (normAcademicYear !== existingYear.academicYear) {
        historyEntries.push({ field: 'academicYear', oldValue: existingYear.academicYear, newValue: normAcademicYear, updatedBy, updatedAt });
        updates.academicYear = normAcademicYear;
      }
    }

    if (regulations && Array.isArray(regulations)) {
      updates.regulations = regulations;
    }

    if (batches && Array.isArray(batches)) {
      const normalizedBatches = batches.map(b => {
        const normB = normalizeYearRange(b.batch);
        return {
          ...b,
          batch: normB,
          batchTrackId: b.batchTrackId || toBatchTrackId(normB)
        };
      });

      for (const newBatch of normalizedBatches) {
        const oldBatch = existingYear.batches.find(b => b.batchTrackId === newBatch.batchTrackId || b.batch === newBatch.batch);
        if (oldBatch) {
          if (newBatch.currentYear !== oldBatch.currentYear) {
            historyEntries.push({ field: `batches.${newBatch.batchTrackId}.currentYear`,
              oldValue: oldBatch.currentYear, newValue: newBatch.currentYear, updatedBy, updatedAt });
          }
          if (newBatch.currentSem !== oldBatch.currentSem) {
            historyEntries.push({ field: `batches.${newBatch.batchTrackId}.currentSem`,
              oldValue: oldBatch.currentSem, newValue: newBatch.currentSem, updatedBy, updatedAt });
          }
        }
      }
      updates.batches = normalizedBatches;
    }

    if (semesterDates && Array.isArray(semesterDates)) {
      updates.semesterDates = semesterDates;
      historyEntries.push({ field: 'semesterDates', oldValue: 'Updated', newValue: `${semesterDates.length} entries`, updatedBy, updatedAt });
    }

    if (typeof isCurrent === 'boolean' && isCurrent !== existingYear.isCurrent) {
      historyEntries.push({ field: 'isCurrent', oldValue: String(existingYear.isCurrent),
        newValue: String(isCurrent), updatedBy, updatedAt });
      if (isCurrent) {
        await M.Year.updateMany({ _id: { $ne: req.params.id } }, { $set: { isCurrent: false } });
        await M.Settings.findOneAndUpdate(
          { key: 'academic' },
          { $set: { 'value.academicYear': academicYear || existingYear.academicYear } }
        );
        invalidateSettingsCache('academic');
      }
      updates.isCurrent = isCurrent;
    }

    if (historyEntries.length > 0) updates.$push = { history: { $each: historyEntries } };

    const updatedYear = await M.Year.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after', runValidators: true });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Academic Year Updated',
      updatedYear.academicYear,
      'year',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: updatedYear.toObject ? updatedYear.toObject() : updatedYear }
      }
    );
    res.json(updatedYear);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/year/:id - Delete academic year
router.delete('/:id', authMiddleware, requirePage('manage', 'delete', { tab: 'years' }), async (req, res) => {
  try {
    const year = await M.Year.findById(req.params.id).lean();
    if (!year) return res.status(404).json({ error: 'Academic year not found' });
    if (year.isCurrent) return res.status(400).json({ error: 'Cannot delete the current academic year. Set another year as current first.' });
    
    await M.UndoLog.create({
      collectionName: 'years', label: `Academic Year: ${year.academicYear}`,
      snapshot: year, deletedBy: req.user.name,
      expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    });
    
    await M.Year.findByIdAndDelete(req.params.id);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Academic Year Deleted',
      year.academicYear,
      'year',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: year, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;