const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const M = require('../models');
const { authMiddleware, adminOnly, requireRight, getRoleModel } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const cfg = require('../config');
const { deleteAuthLimiter } = require('../utils/rateLimiters');

const { DEFAULT_SETTINGS_MAP } = require('../config/defaultSettings');
const { getSettings, invalidateSettingsCache } = require('../utils/settingsCache');

// GET /api/settings/public — Public endpoint for pre-auth status & portal availability
router.get('/public', async (req, res) => {
  try {
    const settingsMap = await getSettings(['pages', 'maintenance', 'institution', 'broadcast', 'academic', 'models', 'attendance']);

    res.json({
      pages: settingsMap.pages || DEFAULT_SETTINGS_MAP.pages.value,
      maintenance: settingsMap.maintenance || DEFAULT_SETTINGS_MAP.maintenance.value,
      institution: settingsMap.institution || DEFAULT_SETTINGS_MAP.institution.value,
      academic: settingsMap.academic || DEFAULT_SETTINGS_MAP.academic.value,
      models: settingsMap.models || DEFAULT_SETTINGS_MAP.models.value,
      attendance: settingsMap.attendance || DEFAULT_SETTINGS_MAP.attendance.value,
      broadcast: settingsMap.broadcast || DEFAULT_SETTINGS_MAP.broadcast.value,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/history — Change history audit log
router.get('/history', authMiddleware, requireRight('settingsPage', 'settingsModule', 'controlPage'), async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const card = req.query.card || '';
    const search = req.query.search || '';

    const query = {};
    if (card && card !== 'all') query.card = card;
    if (search) {
      query.$or = [
        { field: { $regex: search, $options: 'i' } },
        { 'updatedBy.name': { $regex: search, $options: 'i' } },
        { 'updatedBy.username': { $regex: search, $options: 'i' } },
      ];
    }

    const [logs, total] = await Promise.all([
      M.SettingHistory.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      M.SettingHistory.countDocuments(query),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings — Load all domain settings
router.get('/', authMiddleware, requireRight('settingsPage', 'settingsModule', 'controlPage'), async (req, res) => {
  try {
    const rows = await M.Settings.find({ key: { $ne: 'special_delete_password' } }).lean();
    const grouped = {};
    const CARD_KEYS = [
      'institution', 'pages', 'attendance', 'models', 'academic', 
      'security', 'broadcast', 'advanced', 'maintenance', 'settings'
    ];
    
    // Seed standard defaults first
    for (const key of CARD_KEYS) {
      if (DEFAULT_SETTINGS_MAP[key]) {
        grouped[key] = { ...DEFAULT_SETTINGS_MAP[key].value };
      }
    }

    rows.forEach(s => {
      if (CARD_KEYS.includes(s.key)) {
        grouped[s.key] = { ...(grouped[s.key] || {}), ...(s.value || {}) };
      }
    });
    
    // Ensure fallbacks for any uninitialized legacy card groups
    if (grouped.settings && !rows.some(r => r.key === 'pages')) {
      const leg = grouped.settings;
      const toTri = (val) => (typeof val === 'string' ? val : (val === false ? 'disabled' : 'enabled'));
      grouped.pages = {
        pageStudents:  toTri(leg.pageStudents),
        pageTeachers:  toTri(leg.pageTeachers),
        pageManage:    toTri(leg.pageManage),
        pageBulk:      toTri(leg.pageBulk),
        pageTimeTable: toTri(leg.pageTimeTable || 'enabled'),
        pageSelector:  toTri(leg.pageSelector || 'enabled'),
      };
    }
    
    res.json(grouped);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// POST /api/settings/verify-delete-password
router.post('/verify-delete-password', deleteAuthLimiter, authMiddleware, adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    if (password === cfg.DELETE_DATA_PASSWORD) {
      return res.json({ valid: true });
    }

    const useAdminPass = (await M.Settings.findOne({ key: 'models' }))?.value?.moduleDelUseAdminPass 
                      ?? (await M.Settings.findOne({ key: 'settings' }))?.value?.moduleDelUseAdminPass;
    if (useAdminPass) {
      const model = getRoleModel(req.user.role) || M.Admin;
      let adminUser = await model.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }, { _id: req.user.roleDocId || req.user._id }] }).select('+password');
      if (!adminUser && req.user.role !== 'admin') {
        adminUser = await M.Admin.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }] }).select('+password');
      }
      if (adminUser && adminUser.password) {
        const adminMatch = await bcrypt.compare(password, adminUser.password);
        if (adminMatch) return res.json({ valid: true });
      }
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Delete Auth Failed',
      'Wrong delete password attempt',
      'security',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'settings', subType: 'security', trackId: req.user.trackId }
    );
    res.status(403).json({ valid: false, error: 'Incorrect password' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/reset — Factory Reset All Settings
router.post('/reset', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Admin password required to reset settings' });

    const model = getRoleModel(req.user.role) || M.Admin;
    let adminUser = await model.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }, { _id: req.user.roleDocId || req.user._id }] }).select('+password');
    if (!adminUser && req.user.role !== 'admin') {
      adminUser = await M.Admin.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }] }).select('+password');
    }
    if (!adminUser || !adminUser.password) return res.status(404).json({ error: 'Admin user not found' });
    const match = await bcrypt.compare(password, adminUser.password);
    if (!match) return res.status(403).json({ error: 'Incorrect admin password' });

    for (const [key, d] of Object.entries(DEFAULT_SETTINGS_MAP)) {
      await M.Settings.findOneAndUpdate(
        { key },
        { $set: { card: d.card, value: d.value, updatedBy: req.user.name || 'Admin' } },
        { upsert: true }
      );
    }

    await M.SettingHistory.create({
      card: 'System Utilities',
      key: 'all',
      field: 'Factory Reset',
      previousValue: 'custom',
      newValue: 'default',
      updatedBy: {
        role: req.user.role,
        username: req.user.username,
        name: req.user.name || 'Admin',
        trackId: req.user.trackId || '',
        ip: req.ip || '',
      },
      timestamp: new Date()
    });

    await logAction(
      req.user._id,
      req.user.name,
      req.user.role,
      'Settings Reset',
      'All settings restored to factory defaults',
      'settings',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'settings', subType: 'danger', trackId: req.user.trackId }
    );
    invalidateSettingsCache();
    res.json({ success: true, message: 'All settings restored to factory defaults.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/:key
router.get('/:key', authMiddleware, async (req, res) => {
  const s = await M.Settings.findOne({ key: req.params.key });
  if (!s) return res.status(404).json({ error: 'Setting not found' });
  if (req.params.key === 'special_delete_password') return res.status(403).json({ error: 'Forbidden' });
  res.json(s.value);
});

// PUT /api/settings/:key — Save & Audit Setting Domain
router.put('/:key', authMiddleware, requireRight('settingsPage', 'settingsModule', 'controlPage'), async (req, res) => {
  try {
    if (req.params.key === 'special_delete_password') return res.status(403).json({ error: 'Forbidden' });

    const key = req.params.key;
    const newValue = req.body.value || {};
    const existing = await M.Settings.findOne({ key }).lean();
    const prevValue = existing?.value || {};

    // Audit field diffs
    const historyEntries = [];
    const allFields = Array.from(new Set([...Object.keys(prevValue), ...Object.keys(newValue)]));
    for (const field of allFields) {
      const pVal = prevValue[field];
      const nVal = newValue[field];
      if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
        historyEntries.push({
          card: existing?.card || key,
          key,
          field,
          previousValue: pVal !== undefined ? pVal : null,
          newValue: nVal !== undefined ? nVal : null,
          updatedBy: {
            role: req.user.role,
            username: req.user.username,
            name: req.user.name || 'Admin',
            trackId: req.user.trackId || '',
            ip: req.ip || '',
          },
          timestamp: new Date()
        });
      }
    }

    if (historyEntries.length > 0) {
      await M.SettingHistory.insertMany(historyEntries).catch(err => {
        console.error('[SettingHistory Save Error]:', err.message);
      });
    }

    const cardName = existing?.card || DEFAULT_SETTINGS_MAP[key]?.card || key;
    const s = await M.Settings.findOneAndUpdate(
      { key },
      { $set: { value: newValue, card: cardName, updatedBy: req.user.name || 'Admin' } },
      { returnDocument: 'after', upsert: true }
    );

    invalidateSettingsCache(key);

    // Special detailed logging for maintenance changes
    if (key === 'maintenance') {
      const v = newValue;
      const action = v.active ? 'Maintenance Mode Enabled' : 'Maintenance Mode Disabled';
      const affected = (v.affectedRoles || []).join(', ') || 'none';
      const endInfo = v.endTime ? ` | End: ${new Date(v.endTime).toLocaleString('en-IN')}` : '';
      const details = `Roles blocked: ${affected}${endInfo} | Msg: "${(v.message || '').slice(0, 60)}"`;
      await logAction(
        req.user._id,
        req.user.name,
        req.user.role,
        action,
        details,
        'settings',
        v.active ? 'warning' : 'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'settings',
          subType: 'action',
          trackId: req.user.trackId,
          changes: { before: prevValue, after: newValue }
        }
      );
    } else {
      await logAction(
        req.user._id,
        req.user.name,
        req.user.role,
        'Settings Updated',
        `Setting domain: ${key}`,
        'settings',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'settings',
          subType: 'field-edit',
          trackId: req.user.trackId,
          changes: { before: prevValue, after: newValue }
        }
      );
    }

    res.json(s && s.value ? s.value : newValue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;