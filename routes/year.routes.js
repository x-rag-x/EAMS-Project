const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

// GET /api/year - Get all academic years
router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await M.Year.find().sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/current - Get current academic year
router.get('/current', authMiddleware, async (req, res) => {
  try {
    const currentYear = await M.Year.findOne({ isCurrent: true });
    if (!currentYear) return res.status(404).json({ error: 'No current academic year set' });
    res.json(currentYear.academicYear);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/batches - Get list of available batches from current year
router.get('/batches', authMiddleware, async (req, res) => {
  try {
    const currentYear = await M.Year.findOne({ isCurrent: true });
    res.json(currentYear ? currentYear.batches.map(b => b.batch) : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/batch/:batchTrackId - Get currentYear and currentSem for a batchTrackId
router.get('/batch/:batchTrackId', authMiddleware, async (req, res) => {
  try {
    const year = await M.Year.findOne({ 'batches.batchTrackId': req.params.batchTrackId, isCurrent: true });
    if (!year) return res.status(404).json({ error: 'Batch not found in current academic year' });
    
    const batch = year.batches.find(b => b.batchTrackId === req.params.batchTrackId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    
    res.json({
      batchTrackId: batch.batchTrackId, batch: batch.batch,
      currentYear: batch.currentYear, currentSem: batch.currentSem,
      academicYear: year.academicYear
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/year/regulations - Get list of curriculum regulations
router.get('/regulations', authMiddleware, async (req, res) => {
  try {
    const defaultRegs = [
      { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false },
      { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true }
    ];
    const currentYear = await M.Year.findOne({ isCurrent: true }).lean();
    if (currentYear && Array.isArray(currentYear.regulations) && currentYear.regulations.length > 0) {
      return res.json(currentYear.regulations);
    }
    const anyYear = await M.Year.findOne({ 'regulations.0': { $exists: true } }).lean();
    if (anyYear && Array.isArray(anyYear.regulations) && anyYear.regulations.length > 0) {
      return res.json(anyYear.regulations);
    }
    res.json(defaultRegs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/year/regulations - Add or update a curriculum regulation
router.post('/regulations', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { code, name, year, isDefault } = req.body;
    if (!code) return res.status(400).json({ error: 'Regulation code is required (e.g. 2021, 2025)' });
    const regDoc = {
      code: String(code).trim(),
      name: String(name || `Regulation ${code}`).trim(),
      year: String(year || code).trim(),
      isDefault: Boolean(isDefault)
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

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Regulation Saved', regDoc.name, 'year', 'info', req.ip, req.user.sessionId
    );
    res.json({ ok: true, data: targetYear.regulations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/year/regulations/:code - Remove a curriculum regulation
router.delete('/regulations/:code', authMiddleware, adminOnly, async (req, res) => {
  try {
    const code = req.params.code;
    let targetYear = await M.Year.findOne({ isCurrent: true });
    if (!targetYear) targetYear = await M.Year.findOne().sort({ createdAt: -1 });
    if (targetYear && Array.isArray(targetYear.regulations)) {
      targetYear.regulations = targetYear.regulations.filter(r => r.code !== code);
      await targetYear.save();
    }
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
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { academicYear, batches, semesterDates, regulations, isCurrent } = req.body;

    if (!academicYear || !batches || !Array.isArray(batches) || batches.length === 0) {
      return res.status(400).json({ error: 'academicYear and batches array are required' });
    }

    for (const batch of batches) {
      if (!batch.batchTrackId || !batch.batch || !batch.currentYear || !batch.currentSem) {
        return res.status(400).json({ error: 'Each batch must have batchTrackId, batch, currentYear, and currentSem' });
      }
    }
    if (isCurrent) await M.Year.updateMany({}, { $set: { isCurrent: false } });
    const year = await M.Year.create({
      academicYear,
      batches,
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
      academicYear,
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
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { academicYear, batches, semesterDates, regulations, isCurrent } = req.body;
    const existingYear = await M.Year.findById(req.params.id);
    if (!existingYear) return res.status(404).json({ error: 'Academic year not found' });

    const before = existingYear.toObject();
    const updates = {};
    const historyEntries = [];
    const updatedBy = req.user.trackId || req.user.name;
    const updatedAt = new Date();

    if (academicYear && academicYear !== existingYear.academicYear) {
      historyEntries.push({ field: 'academicYear', oldValue: existingYear.academicYear, newValue: academicYear, updatedBy, updatedAt });
      updates.academicYear = academicYear;
    }

    if (regulations && Array.isArray(regulations)) {
      updates.regulations = regulations;
    }

    if (batches && Array.isArray(batches)) {
      for (const newBatch of batches) {
        const oldBatch = existingYear.batches.find(b => b.batchTrackId === newBatch.batchTrackId);
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
      updates.batches = batches;
    }

    if (semesterDates && Array.isArray(semesterDates)) {
      updates.semesterDates = semesterDates;
      historyEntries.push({ field: 'semesterDates', oldValue: 'Updated', newValue: `${semesterDates.length} entries`, updatedBy, updatedAt });
    }

    if (typeof isCurrent === 'boolean' && isCurrent !== existingYear.isCurrent) {
      historyEntries.push({ field: 'isCurrent', oldValue: String(existingYear.isCurrent),
        newValue: String(isCurrent), updatedBy, updatedAt });
      if (isCurrent) await M.Year.updateMany({ _id: { $ne: req.params.id } }, { $set: { isCurrent: false } });
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
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
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