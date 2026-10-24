const express = require('express');
const router = express.Router();
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const { authMiddleware, getRoleModel, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const cfg = require('../config');
const { deleteAuthLimiter } = require('../utils/rateLimiters');

const { DEFAULT_SETTINGS_MAP } = require('../config/defaultSettings');
const { getSetting, getSettings, invalidateSettingsCache } = require('../utils/settingsCache');
const { getStartOfInstitutionDaySync, getEndOfInstitutionDaySync } = require('../utils/institutionTime');

// GET /api/settings/public — Public endpoint for pre-auth status & portal availability
router.get('/public', async (req, res) => {
  try {
    const settingsMap = await getSettings(['pages', 'maintenance', 'institution', 'broadcast', 'academic', 'models', 'attendance', 'security', 'teachers']);
    const sec = settingsMap.security || DEFAULT_SETTINGS_MAP.security?.value || {};
    const isDev = cfg.NODE_ENV === 'development' || process.env.NODE_ENV === 'development';

    res.json({
      pages: settingsMap.pages || DEFAULT_SETTINGS_MAP.pages.value,
      maintenance: settingsMap.maintenance || DEFAULT_SETTINGS_MAP.maintenance.value,
      institution: settingsMap.institution || DEFAULT_SETTINGS_MAP.institution.value,
      academic: settingsMap.academic || DEFAULT_SETTINGS_MAP.academic.value,
      models: settingsMap.models || DEFAULT_SETTINGS_MAP.models.value,
      attendance: settingsMap.attendance || DEFAULT_SETTINGS_MAP.attendance.value,
      broadcast: settingsMap.broadcast || DEFAULT_SETTINGS_MAP.broadcast.value,
      teachers: settingsMap.teachers || DEFAULT_SETTINGS_MAP.teachers.value,
      isDev: isDev,
      security: {
        sessionTimeout: sec.sessionTimeout !== false,
        sessionTimeoutMins: sec.sessionTimeoutMins !== undefined ? Number(sec.sessionTimeoutMins) : 7,
        loginLocationRequired: isDev ? false : (sec.loginLocationRequired !== false),
        loginLocationAccuracyCheck: isDev ? false : (sec.loginLocationAccuracyCheck !== false),
        loginLocationMaxAccuracyM: sec.loginLocationMaxAccuracyM !== undefined ? Number(sec.loginLocationMaxAccuracyM) : 2000,
        loginLocationMaxAgeSec: sec.loginLocationMaxAgeSec !== undefined ? Number(sec.loginLocationMaxAgeSec) : 300,
        isDev: isDev,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/history — Change history audit log
router.get('/history', authMiddleware, requirePage('settings', 'view'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const card = typeof req.query.card === 'string' ? req.query.card.trim() : '';
    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const search = rawSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const query = {};
    if (card && card !== 'all') query.card = card;
    if (dateParam) {
      const d = new Date(dateParam);
      if (!isNaN(d.getTime())) {
        const startOfDay = getStartOfInstitutionDaySync(dateParam);
        const endOfDay = getEndOfInstitutionDaySync(dateParam);
        // normalized to institution bounds
        // across full IST calendar day
        query.timestamp = { $gte: startOfDay, $lte: endOfDay };
      }
    }
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
router.get('/', authMiddleware, requirePage('settings', 'view'), async (req, res) => {
  try {
    const rows = await M.Settings.find({ key: { $ne: 'special_delete_password' } }).lean();
    const grouped = {};
    const CARD_KEYS = [
      'institution', 'pages', 'attendance', 'teachers', 'models', 'academic', 
      'security', 'device', 'trust', 'broadcast', 'advanced', 'maintenance', 'settings'
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

    // Auto-link Academic Settings with manage.html (Year collection)
    try {
      const currentYearDoc = await M.Year.findOne({ isCurrent: true }).lean();
      const anyYearWithRegs = await M.Year.findOne({ 'regulations.0': { $exists: true } }).lean();
      if (!grouped.academic) grouped.academic = {};

      if (currentYearDoc && currentYearDoc.academicYear) {
        grouped.academic.academicYear = currentYearDoc.academicYear;
      }

      const rawRegs = (currentYearDoc && Array.isArray(currentYearDoc.regulations) && currentYearDoc.regulations.length > 0)
        ? currentYearDoc.regulations
        : (anyYearWithRegs?.regulations || [
            { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false, minAttendance: 75 },
            { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true, minAttendance: 75 }
          ]);

      const globalMin = Number(grouped.academic.minAttendance) || 75;
      const regMinMap = grouped.academic.regulationMinAttendance || {};

      grouped.academic.regulationsList = rawRegs.map(r => ({
        code: r.code,
        name: r.name || `Regulation ${r.code}`,
        year: r.year || r.code,
        isDefault: !!r.isDefault,
        minAttendance: regMinMap[r.code] !== undefined ? Number(regMinMap[r.code]) : (r.minAttendance !== undefined ? Number(r.minAttendance) : globalMin)
      }));
    } catch (e) {
      console.warn('[Settings Auto-link Warning]:', e.message);
    }
    
    // Ensure fallbacks for any uninitialized legacy card groups
    if (grouped.settings && !rows.some(r => r.key === 'pages')) {
      const leg = grouped.settings;
      const toTri = (val) => (typeof val === 'string' ? val : (val === false ? 'disabled' : 'enabled'));
      grouped.pages = {
        pageStudents:   toTri(leg.pageStudents),
        pageTeachers:   toTri(leg.pageTeachers),
        pageController: toTri(leg.pageController || 'enabled'),
        pageRooms:      toTri(leg.pageRooms || 'enabled'),
        pageManage:     toTri(leg.pageManage),
        pageBulk:       toTri(leg.pageBulk),
        pageTimeTable:  toTri(leg.pageTimeTable || 'enabled'),
        pageSelector:   toTri(leg.pageSelector || 'enabled'),
      };
    }
    
    res.json(grouped);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// POST /api/settings/verify-delete-password
router.post('/verify-delete-password', authMiddleware, requirePage('settings', 'edit'), deleteAuthLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    if (password === cfg.DELETE_DATA_PASSWORD) {
      return res.json({ valid: true });
    }

    const useAdminPass = (await M.Settings.findOne({ key: 'models' }))?.value?.moduleDelUseAdminPass 
                      ?? (await M.Settings.findOne({ key: 'settings' }))?.value?.moduleDelUseAdminPass;
    if (useAdminPass) {
      const model = getRoleModel(req.user.role) || M.Teacher;
      const adminUser = await model.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }, { _id: req.user.roleDocId || req.user._id }] }).select('+password');
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
router.post('/reset', authMiddleware, requirePage('settings', 'edit'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Admin password required to reset settings' });

    const model = getRoleModel(req.user.role) || M.Teacher;
    const adminUser = await model.findOne({ $or: [{ trackId: req.user.trackId }, { username: req.user.username }, { _id: req.user.roleDocId || req.user._id }] }).select('+password');
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
  try {
    if (req.params.key === 'special_delete_password') return res.status(403).json({ error: 'Forbidden' });
    const key = req.params.key;
    if (DEFAULT_SETTINGS_MAP[key]) {
      const val = await getSetting(key);
      return res.json(val);
    }
    const s = await M.Settings.findOne({ key }).lean();
    if (!s) return res.status(404).json({ error: 'Setting not found' });
    res.json(s.value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updateSettingDomain(key, incomingValue, user, ip, sessionId) {
  if (!key || key === 'special_delete_password') {
    throw new Error('Invalid setting key');
  }

  let newValue = { ...(incomingValue || {}) };

  // Handle shorthand aliases from control.html or legacy callers
  if (key === 'institution') {
    if (newValue.name && !newValue.institutionName) newValue.institutionName = newValue.name;
    if (newValue.short && !newValue.institutionShort) newValue.institutionShort = newValue.short;
    if (newValue.tagline && !newValue.institutionTagline) newValue.institutionTagline = newValue.tagline;
    if (newValue.addr && !newValue.institutionAddress) newValue.institutionAddress = newValue.addr;
    if (newValue.email && !newValue.institutionEmail) newValue.institutionEmail = newValue.email;
    if (newValue.phone && !newValue.institutionPhone) newValue.institutionPhone = newValue.phone;
    if (newValue.web && !newValue.institutionWebsite) newValue.institutionWebsite = newValue.web;
  } else if (key === 'academic') {
    if (newValue.year && !newValue.academicYear) newValue.academicYear = newValue.year;
    if (newValue.sem && !newValue.currentSemesterType) newValue.currentSemesterType = newValue.sem;
    if (newValue.minAtt !== undefined && newValue.minAttendance === undefined) newValue.minAttendance = Number(newValue.minAtt);
    if (newValue.wdays !== undefined && newValue.workingDays === undefined) newValue.workingDays = Number(newValue.wdays);
  } else if (key === 'security') {
    if (newValue.forcePw !== undefined && newValue.forcePasswordChange === undefined) newValue.forcePasswordChange = newValue.forcePw;
    if (newValue.strongPw !== undefined && newValue.requireStrongPassword === undefined) newValue.requireStrongPassword = newValue.strongPw;
    if (newValue.timeout !== undefined && newValue.sessionTimeout === undefined) newValue.sessionTimeout = newValue.timeout;
    if (newValue.timeoutMin !== undefined && newValue.sessionTimeoutMins === undefined) newValue.sessionTimeoutMins = Number(newValue.timeoutMin);
    if (newValue.maxLogin !== undefined && newValue.maxLoginAttempts === undefined) newValue.maxLoginAttempts = Number(newValue.maxLogin);
  }

  const existing = await M.Settings.findOne({ key }).lean();
  const prevValue = existing?.value || {};
  const defaultVal = DEFAULT_SETTINGS_MAP[key]?.value || {};

  // Shallow merge: default -> previous -> new values
  const mergedValue = {
    ...defaultVal,
    ...prevValue,
    ...newValue
  };

  // Audit field diffs
  const historyEntries = [];
  const allFields = Array.from(new Set([...Object.keys(prevValue), ...Object.keys(mergedValue)]));
  for (const field of allFields) {
    const pVal = prevValue[field];
    const nVal = mergedValue[field];
    if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      historyEntries.push({
        card: existing?.card || DEFAULT_SETTINGS_MAP[key]?.card || key,
        key,
        field,
        previousValue: pVal !== undefined ? pVal : null,
        newValue: nVal !== undefined ? nVal : null,
        updatedBy: {
          role: user?.role || 'admin',
          username: user?.username || 'admin',
          name: user?.name || 'Admin',
          trackId: user?.trackId || '',
          ip: ip || '',
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
    { $set: { value: mergedValue, card: cardName, updatedBy: user?.name || 'Admin' } },
    { returnDocument: 'after', upsert: true }
  );

  invalidateSettingsCache(key);

  // Sync regulationMinAttendance into Year model when academic settings update
  if (key === 'academic' && mergedValue.regulationMinAttendance && typeof mergedValue.regulationMinAttendance === 'object') {
    try {
      const yearsWithRegs = await M.Year.find({ 'regulations.0': { $exists: true } });
      for (const y of yearsWithRegs) {
        let yChanged = false;
        if (Array.isArray(y.regulations)) {
          y.regulations.forEach(r => {
            if (mergedValue.regulationMinAttendance[r.code] !== undefined) {
              const num = Number(mergedValue.regulationMinAttendance[r.code]) || 75;
              if (r.minAttendance !== num) {
                r.minAttendance = num;
                yChanged = true;
              }
            }
          });
        }
        if (yChanged) await y.save();
      }
    } catch (err) {
      console.warn('[Sync Regulation MinAtt to Year Model Error]:', err.message);
    }
  }

  // Special detailed logging for maintenance changes
  if (key === 'maintenance') {
    const v = mergedValue;
    const action = v.active ? 'Maintenance Mode Enabled' : 'Maintenance Mode Disabled';
    const affected = (v.affectedRoles || []).join(', ') || 'none';
    const endInfo = v.endTime ? ` | End: ${new Date(v.endTime).toLocaleString('en-IN')}` : '';
    const details = `Roles blocked: ${affected}${endInfo} | Msg: "${(v.message || '').slice(0, 60)}"`;
    await logAction(
      user?._id,
      user?.name || 'Admin',
      user?.role || 'admin',
      action,
      details,
      'settings',
      v.active ? 'warning' : 'info',
      ip,
      sessionId,
      {
        module: 'settings',
        subType: 'action',
        trackId: user?.trackId,
        changes: { before: prevValue, after: mergedValue }
      }
    );
  } else {
    await logAction(
      user?._id,
      user?.name || 'Admin',
      user?.role || 'admin',
      'Settings Updated',
      `Setting domain: ${key}`,
      'settings',
      'info',
      ip,
      sessionId,
      {
        module: 'settings',
        subType: 'field-edit',
        trackId: user?.trackId,
        changes: { before: prevValue, after: mergedValue }
      }
    );
  }

  return s && s.value ? s.value : mergedValue;
}

// PUT /api/settings — Batch or Keyed Setting Update
router.put('/', authMiddleware, requirePage('settings', 'edit'), async (req, res) => {
  try {
    const targetKey = req.body.key || req.body.card;
    if (targetKey) {
      const val = req.body.value !== undefined ? req.body.value : req.body;
      const updated = await updateSettingDomain(targetKey, val, req.user, req.ip, req.user.sessionId);
      return res.json({ ok: true, message: `Setting ${targetKey} updated`, data: updated });
    }

    const CARD_KEYS = [
      'institution', 'pages', 'attendance', 'teachers', 'models', 'academic', 
      'security', 'device', 'trust', 'broadcast', 'advanced', 'maintenance', 'settings'
    ];
    const sourceObj = req.body.settings || req.body.value || req.body;
    const matchedKeys = Object.keys(sourceObj || {}).filter(k => CARD_KEYS.includes(k));

    if (matchedKeys.length > 0) {
      const results = {};
      for (const k of matchedKeys) {
        results[k] = await updateSettingDomain(k, sourceObj[k], req.user, req.ip, req.user.sessionId);
      }
      return res.json({ ok: true, message: `${matchedKeys.length} settings domain(s) updated`, data: results });
    }

    return res.status(400).json({ error: 'No valid setting key or card provided in request' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/:key — Save & Audit Specific Setting Domain
router.put('/:key', authMiddleware, requirePage('settings', 'edit'), async (req, res) => {
  try {
    if (req.params.key === 'special_delete_password') return res.status(403).json({ error: 'Forbidden' });

    const key = req.params.key;
    const incoming = req.body.value !== undefined ? req.body.value : req.body;
    const updated = await updateSettingDomain(key, incoming, req.user, req.ip, req.user.sessionId);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;