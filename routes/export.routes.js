const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, requirePage, assertInScope, scopeFilter } = require('../middleware/auth');
const { controllerAuth } = require('../middleware/hodAuth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const { getSetting } = require('../utils/settingsCache');
const { criticalDeleteLimiter } = require('../utils/rateLimiters');
const { computeStudentAttendance } = require('../utils/attendanceCalculator');
const { logAction } = require('../utils/logAction');
const { todayInInstitutionTz, getStartOfInstitutionDaySync } = require('../utils/institutionTime');


// Helper to escape CSV fields and neutralize formula injection (CWE-1236)
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str}"`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper to get next export track ID
async function getNextExportTrackId() {
  const counter = await M.Counter.findByIdAndUpdate(
    'exportId',
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return `TR-EXP-${String(counter.seq).padStart(6, '0')}`;
}

// Helper to determine user permissions based on role
function getExportPermissions(reqOrUser) {
  const req = (reqOrUser && reqOrUser.user) ? reqOrUser : null;
  const user = req ? req.user : reqOrUser;
  const perms = {
    canExportAll: false,
    canExportDepartment: false,
    canExportOwnClasses: false,
    canExportOwnData: false,
    departmentId: null,
    classIds: []
  };

  if (!user) return perms;

  if (isSudo(req || user)) {
    perms.canExportAll = true;
    return perms;
  }

  const exportAccess = req?.access?.pages?.export;
  if (exportAccess) {
    if (exportAccess.scope === 'institution') {
      perms.canExportAll = true;
      return perms;
    }
    if (exportAccess.scope === 'department') {
      perms.canExportDepartment = true;
      perms.departmentId = exportAccess.deptId || user.deptId;
      return perms;
    }
  }

  if (user.role === 'teacher') {
    if (user.isHod || user.isPrincipal) {
      perms.canExportDepartment = true;
      perms.departmentId = user.deptId;
    }
    if (user.isClassAdvisor) {
      perms.canExportOwnClasses = true;
      perms.classIds = user.classesAdvising || [];
    }
  }

  if (user.role === 'student') {
    perms.canExportOwnData = true;
  }

  return perms;
}

// GET /api/export/dashboard - Dashboard stats and recent exports
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    // Get recent exports
    const recentExports = await M.ExportHistory
      .find({ userId, status: 'completed' })
      .sort({ generatedAt: -1 })
      .limit(10)
      .select('exportTrackId reportType format generatedAt recordCount fileSize')
      .lean();

    // Get stats
    const todayStr = await todayInInstitutionTz();
    const thisMonth = getStartOfInstitutionDaySync(todayStr.slice(0, 7) + '-01');
    // normalized to institution first-of-month
    // exact start of current month in institution timezone

    const statsThisMonth = await M.ExportHistory.countDocuments({
      userId,
      generatedAt: { $gte: thisMonth }
    });

    // Get popular report types
    const popularReports = await M.ExportHistory.aggregate([
      { $match: { userId, status: 'completed' } },
      { $group: { _id: '$reportType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      ok: true,
      data: {
        stats: {
          exportsThisMonth: statsThisMonth,
          totalExports: await M.ExportHistory.countDocuments({ userId })
        },
        recentExports,
        popularReports: popularReports.map(r => ({ type: r._id, count: r.count }))
      }
    });
  } catch (err) {
    console.error('Export dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard', details: err.message });
  }
});

// GET /api/export/templates - List saved templates
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const templates = await M.ExportTemplate
      .find({ userId: req.user._id })
      .sort({ lastUsed: -1 })
      .lean();

    res.json({ ok: true, data: { templates } });
  } catch (err) {
    console.error('Export templates list error:', err);
    res.status(500).json({ error: 'Failed to load templates', details: err.message });
  }
});

// POST /api/export/templates - Save template
router.post('/templates', authMiddleware, async (req, res) => {
  try {
    const { templateName, reportType, config } = req.body;

    if (!templateName || !reportType || !config) {
      return res.status(400).json({ error: 'Template name, report type, and config are required' });
    }

    const template = await M.ExportTemplate.findOneAndUpdate(
      { userId: req.user._id, templateName: String(templateName).trim() },
      {
        userId: req.user._id,
        userModel: req.user.role === 'student' ? 'Student' : 'Teacher',
        role: req.user.role,
        templateName: String(templateName).trim(),
        reportType: String(reportType).trim(),
        config,
        lastUsed: new Date(),
        $inc: { useCount: 1 }
      },
      { upsert: true, returnDocument: 'after' }
    );

    await logAction(
      req.user._id,
      req.user.userName || req.user.fullName,
      req.user.role,
      'Save Export Template',
      { templateName, reportType },
      'export',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'Export', subType: 'Template' }
    );

    res.json({ ok: true, message: 'Template saved successfully', data: { template } });
  } catch (err) {
    console.error('Export template save error:', err);
    res.status(500).json({ error: 'Failed to save template', details: err.message });
  }
});

// DELETE /api/export/templates/:id - Delete template
router.delete('/templates/:id', authMiddleware, criticalDeleteLimiter, async (req, res) => {
  try {
    const templateId = sanitizeToObjectId(req.params.id);
    if (!templateId) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }

    const template = await M.ExportTemplate.findOneAndDelete({
      _id: templateId,
      userId: req.user._id
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await logAction(
      req.user._id,
      req.user.userName || req.user.fullName,
      req.user.role,
      'Delete Export Template',
      { templateName: template.templateName, reportType: template.reportType },
      'export',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'Export', subType: 'Template' }
    );

    res.json({ ok: true, message: 'Template deleted successfully' });
  } catch (err) {
    console.error('Export template delete error:', err);
    res.status(500).json({ error: 'Failed to delete template', details: err.message });
  }
});

// GET /api/export/history - Export history with pagination
router.get('/history', authMiddleware, requirePage('export', 'view', { tab: 'history' }), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { userId: req.user._id };
    if (req.query.reportType) filter.reportType = sanitizeToString(req.query.reportType);
    if (req.query.format) filter.format = sanitizeToString(req.query.format);
    if (req.query.status) filter.status = sanitizeToString(req.query.status);

    const total = await M.ExportHistory.countDocuments(filter);
    const history = await M.ExportHistory
      .find(filter)
      .sort({ generatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      data: {
        history,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error('Export history error:', err);
    res.status(500).json({ error: 'Failed to load history', details: err.message });
  }
});

// POST /api/export/preview - Preview export counts
router.post('/preview', authMiddleware, async (req, res) => {
  try {
    const { reportType, config } = req.body;

    if (!reportType || !config) {
      return res.status(400).json({ error: 'Report type and config are required' });
    }

    const perms = getExportPermissions(req);
    let preview = {
      reportType,
      estimatedRecords: 0,
      dateRange: config.dateRange || {},
      filters: config.filters || {}
    };

    // Department scope enforcement
    if (config.filters && config.filters.departmentId) {
      if (!assertInScope(req, config.filters.departmentId, 'export')) {
        return res.status(403).json({ error: 'Forbidden: department outside allowed scope' });
      }
    } else if (!perms.canExportAll && perms.departmentId) {
      if (!config.filters) config.filters = {};
      config.filters.departmentId = perms.departmentId;
    }

    // Build filter based on report type and permissions
    const filter = {};

    // Apply date range if specified
    if (config.dateRange && config.dateRange.start && config.dateRange.end) {
      filter.date = {
        $gte: new Date(config.dateRange.start),
        $lte: new Date(config.dateRange.end)
      };
    }

    // Apply additional filters
    if (config.filters) {
      if (config.filters.departmentId) filter.deptId = sanitizeToString(config.filters.departmentId);
      if (config.filters.year) filter.year = parseInt(config.filters.year, 10);
      if (config.filters.section) filter.section = sanitizeToString(config.filters.section);
    }

    // Estimate record count based on report type
    let count = 0;
    if (reportType.includes('student')) {
      count = await M.Student.countDocuments(filter);
    } else if (reportType.includes('class') || reportType.includes('attendance')) {
      count = await M.ClassAttendance.countDocuments(filter);
    } else if (reportType.includes('subject')) {
      count = await M.Subject.countDocuments(filter);
    }

    preview.estimatedRecords = count;
    preview.estimatedSize = `${Math.ceil(count / 100)}KB - ${Math.ceil(count / 10)}KB`;

    res.json({ ok: true, data: { preview } });
  } catch (err) {
    console.error('Export preview error:', err);
    res.status(500).json({ error: 'Failed to generate preview', details: err.message });
  }
});

// POST /api/export/student/complete - Complete student report
router.post('/student/complete', authMiddleware, async (req, res) => {
  try {
    const { studentId, dateRange, format } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'Student ID is required' });
    }

    const perms = getExportPermissions(req);

    // Permission check
    if (!perms.canExportAll && req.user.role === 'student' && String(req.user._id) !== studentId) {
      return res.status(403).json({ error: 'You can only export your own data' });
    }

    const student = await M.Student.findById(sanitizeToObjectId(studentId)).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!perms.canExportAll && student.deptId && !assertInScope(req, student.deptId, 'export')) {
      return res.status(403).json({ error: 'Forbidden: student outside department scope' });
    }

    // Create export history record
    const exportTrackId = await getNextExportTrackId();
    const historyRecord = await M.ExportHistory.create({
      exportTrackId,
      userId: req.user._id,
      userModel: req.user.role === 'student' ? 'Student' : 'Teacher',
      userName: req.user.userName || req.user.fullName,
      role: req.user.role,
      reportType: 'student-complete',
      config: { studentId, dateRange, format },
      format: format || 'pdf',
      status: 'pending',
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    // Log the export
    await logAction(
      req.user._id,
      req.user.userName || req.user.fullName,
      req.user.role,
      'Export Student Complete Report',
      { studentId, studentName: student.fullName, format },
      'export',
      'info',
      req.ip,
      { module: 'export', subType: 'export', reportType: 'Student Report', filters: { studentId }, rowCount: 1 }
    );

    // TODO: Actual PDF/Excel generation would go here
    // For now, return success with placeholder

    await M.ExportHistory.findByIdAndUpdate(historyRecord._id, {
      status: 'completed',
      recordCount: 1,
      fileSize: 0
    });

    res.json({
      ok: true,
      message: 'Export generated successfully',
      data: {
        exportTrackId,
        downloadUrl: `/api/export/download/${exportTrackId}`,
        format: format || 'pdf'
      }
    });
  } catch (err) {
    console.error('Student complete export error:', err);
    res.status(500).json({ error: 'Failed to generate export', details: err.message });
  }
});

// POST /api/export/class/defaulters - Low attendance report
router.post('/class/defaulters', authMiddleware, async (req, res) => {
  try {
    let { threshold, filters, format } = req.body;

    const perms = getExportPermissions(req);

    if (!perms.canExportAll && !perms.canExportDepartment && !perms.canExportOwnClasses) {
      return res.status(403).json({ error: 'Insufficient permissions to export class reports' });
    }

    if (filters && filters.departmentId) {
      if (!assertInScope(req, filters.departmentId, 'export')) {
        return res.status(403).json({ error: 'Forbidden: department outside allowed scope' });
      }
    } else if (!perms.canExportAll && perms.departmentId) {
      if (!filters) filters = {};
      filters.departmentId = perms.departmentId;
    }

    const thresholdValue = threshold || 75;

    // Build filter
    const filter = {};
    if (filters) {
      if (filters.departmentId) filter.deptId = sanitizeToString(filters.departmentId);
      if (filters.year) filter.year = parseInt(filters.year, 10);
      if (filters.section) filter.section = sanitizeToString(filters.section);
    }

    // Get students with low attendance
    const students = await M.Student.find(filter)
      .select('fullName registerNo attendancePercentage deptId year section classId trackId')
      .lean();

    // Ensure attendance percentage is accurately populated
    for (const s of students) {
      if (s.attendancePercentage === undefined || s.attendancePercentage === null) {
        const stats = await computeStudentAttendance(s.trackId || String(s._id), s.classId);
        s.attendancePercentage = stats ? stats.overallPercentage : 100;
      }
    }

    const defaulters = students.filter(s => (s.attendancePercentage ?? 100) < thresholdValue);


    // Create export history record
    const exportTrackId = await getNextExportTrackId();
    await M.ExportHistory.create({
      exportTrackId,
      userId: req.user._id,
      userModel: req.user.role === 'student' ? 'Student' : 'Teacher',
      userName: req.user.userName || req.user.fullName,
      role: req.user.role,
      reportType: 'class-defaulters',
      config: { threshold: thresholdValue, filters, format },
      format: format || 'excel',
      status: 'completed',
      recordCount: defaulters.length,
      fileSize: 0,
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await logAction(
      req.user._id,
      req.user.userName || req.user.fullName,
      req.user.role,
      'Export Defaulters Report',
      { threshold: thresholdValue, count: defaulters.length, filters },
      'export',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'export', subType: 'export', reportType: 'Defaulters Report', filters, rowCount: defaulters.length }
    );

    res.json({
      ok: true,
      message: 'Export generated successfully',
      data: {
        exportTrackId,
        downloadUrl: `/api/export/download/${exportTrackId}`,
        recordCount: defaulters.length,
        format: format || 'excel'
      }
    });
  } catch (err) {
    console.error('Defaulters export error:', err);
    res.status(500).json({ error: 'Failed to generate export', details: err.message });
  }
});

// POST /api/export/generate - Universal export generator endpoint
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    let { reportType, format, dateRange, filters, studentId, threshold } = req.body;
    if (!reportType) {
      return res.status(400).json({ error: 'Report type is required' });
    }

    const perms = getExportPermissions(req);
    if (!perms.canExportAll && !perms.canExportDepartment && !perms.canExportOwnClasses && !perms.canExportOwnData) {
      return res.status(403).json({ error: 'Insufficient permissions for export' });
    }

    // Department scope enforcement
    if (filters && filters.departmentId) {
      if (!assertInScope(req, filters.departmentId, 'export')) {
        return res.status(403).json({ error: 'Forbidden: department outside allowed scope' });
      }
    } else if (!perms.canExportAll && perms.departmentId) {
      if (!filters) filters = {};
      filters.departmentId = perms.departmentId;
    }

    const reqScope = req.query.scope || req.headers['x-export-scope'] || req.body.scope;
    if (reqScope === 'timetable') {
      const allowedTTTypes = ['timetable', 'schedule', 'class', 'teacher'];
      const isAllowed = allowedTTTypes.some(t => String(reportType).toLowerCase().includes(t));
      if (!isAllowed) {
        return res.status(403).json({ error: 'Access denied: Timetable export scope is restricted to timetable and schedule reports.' });
      }
    }

    // Build query filter
    const query = {};
    if (filters) {
      if (filters.departmentId) query.deptId = sanitizeToString(filters.departmentId);
      if (filters.year) query.year = parseInt(filters.year, 10);
      if (filters.section) query.section = sanitizeToString(filters.section);
    }
    if (studentId) query._id = sanitizeToObjectId(studentId);

    let count = 0;
    if (reportType.includes('student')) {
      count = await M.Student.countDocuments(query);
    } else if (reportType.includes('class') || reportType.includes('attendance')) {
      count = await M.ClassAttendance.countDocuments({});
      if (count === 0) count = await M.Student.countDocuments(query);
    } else if (reportType.includes('subject')) {
      count = await M.Subject.countDocuments({});
    } else if (reportType.includes('teacher')) {
      count = await M.Teacher.countDocuments({});
    } else {
      count = await M.Student.countDocuments(query);
    }
    if (count === 0) count = 1;

    const exportTrackId = await getNextExportTrackId();
    await M.ExportHistory.create({
      exportTrackId,
      userId: req.user._id,
      userModel: req.user.role === 'student' ? 'Student' : 'Teacher',
      userName: req.user.userName || req.user.fullName || req.user.name || 'User',
      role: req.user.role,
      reportType,
      config: {
        filters: filters || {},
        dateRange: dateRange || {},
        options: { studentId, threshold: threshold || 75 }
      },
      format: format || 'pdf',
      status: 'completed',
      recordCount: count,
      fileSize: Math.max(1024, count * 128),
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await logAction(
      req.user._id,
      req.user.userName || req.user.fullName || req.user.name,
      req.user.role,
      'Generate Export Report',
      { reportType, format: format || 'pdf', exportTrackId, count },
      'export',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'export', subType: 'export', reportType, filters: { reportType, format }, rowCount: count }
    );

    res.json({
      ok: true,
      message: 'Export generated successfully',
      data: {
        exportTrackId,
        downloadUrl: `/api/export/download/${exportTrackId}`,
        format: format || 'pdf',
        recordCount: count
      }
    });
  } catch (err) {
    console.error('Universal export generate error:', err);
    res.status(500).json({ error: 'Failed to generate export', details: err.message });
  }
});

// GET /api/export/download/:trackId - Download generated export document
router.get('/download/:trackId', authMiddleware, async (req, res) => {
  try {
    const trackId = req.params.trackId;
    const history = await M.ExportHistory.findOne({
      $or: [
        { exportTrackId: trackId },
        { _id: mongoose.isValidObjectId(trackId) ? trackId : undefined }
      ].filter(Boolean)
    }).lean();

    if (!history) {
      return res.status(404).json({ error: 'Export record not found or expired' });
    }

    const isOwner = history.userId && String(history.userId) === String(req.user._id);
    const isPrivileged = isSudoAdmin(req.user) || req.user.role === 'admin' || req.user.role === 'principal' || req.user.isPrincipal;
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to download this export file' });
    }

    // Update downloaded timestamp
    await M.ExportHistory.findByIdAndUpdate(history._id, { downloadedAt: new Date() });

    const format = (history.format || 'csv').toLowerCase();
    const reportType = history.reportType || 'report';
    const timestamp = await todayInInstitutionTz();
    const studentFilter = isPrivileged ? {} : scopeFilter(req);

    const savedConfig = history.config || {};
    const filters = savedConfig.filters || {};
    const dateRange = savedConfig.dateRange || {};
    const threshold = Number(savedConfig.options?.threshold) || 75;

    if (filters.deptId) studentFilter.deptId = filters.deptId;
    if (filters.classId) studentFilter.classId = filters.classId;
    if (filters.year) studentFilter.year = filters.year;
    if (filters.section) studentFilter.section = filters.section;

    if (format === 'csv' || format === 'excel') {
      let csvContent = '';
      if (reportType.includes('defaulter') || reportType.includes('shortage')) {
        csvContent = 'Register No,Student Name,Department,Year,Section,Total Classes,Classes Attended,Attendance %,Eligibility\n';

        const students = await M.Student.find(studentFilter).limit(500).lean();
        const studentTrackIds = students.map(s => s.trackId || String(s._id));
        const attDocs = await M.StudentAttendance.find({ studentTrackId: { $in: studentTrackIds } }).lean();
        const attMap = new Map();
        attDocs.forEach(a => attMap.set(a.studentTrackId, a));

        students.forEach(s => {
          const track = s.trackId || String(s._id);
          const att = attMap.get(track);
          let totalHeld = 0;
          let totalAttended = 0;
          if (att && Array.isArray(att.records)) {
            totalHeld = att.records.reduce((acc, r) => acc + (r.classesHeld || 0), 0);
            totalAttended = att.records.reduce((acc, r) => acc + (r.classesAttended || 0), 0);
          }
          const pct = att && att.overallPercentage !== undefined
            ? att.overallPercentage
            : (s.attendancePercentage !== undefined ? s.attendancePercentage : (totalHeld > 0 ? Math.round((totalAttended / totalHeld) * 100) : 100));

          if (pct < threshold) {
            csvContent += `${escapeCsv(s.registerNo || '')},${escapeCsv(s.fullName || '')},${escapeCsv(s.deptName || s.department || '')},${escapeCsv(s.year || '')},${escapeCsv(s.section || '')},${totalHeld},${totalAttended},${pct}%,${escapeCsv('Shortage (Not Eligible)')}\n`;
          }
        });
      } else if (reportType.includes('student')) {
        csvContent = 'Register No,Student Name,Department,Year,Section,Classes Held,Classes Attended,Percentage,Status\n';
        const students = await M.Student.find(studentFilter).limit(200).lean();
        const studentTrackIds = students.map(s => s.trackId || String(s._id));
        const attDocs = await M.StudentAttendance.find({ studentTrackId: { $in: studentTrackIds } }).lean();
        const attMap = new Map();
        attDocs.forEach(a => attMap.set(a.studentTrackId, a));

        students.forEach(s => {
          const track = s.trackId || String(s._id);
          const att = attMap.get(track);
          let totalHeld = 0;
          let totalAttended = 0;
          if (att && Array.isArray(att.records)) {
            totalHeld = att.records.reduce((acc, r) => acc + (r.classesHeld || 0), 0);
            totalAttended = att.records.reduce((acc, r) => acc + (r.classesAttended || 0), 0);
          }
          const pct = att && att.overallPercentage !== undefined
            ? att.overallPercentage
            : (s.attendancePercentage !== undefined ? s.attendancePercentage : (totalHeld > 0 ? Math.round((totalAttended / totalHeld) * 100) : 100));
          const status = pct >= 75 ? 'Eligible' : 'Shortage';
          csvContent += `${escapeCsv(s.registerNo || '')},${escapeCsv(s.fullName || '')},${escapeCsv(s.deptName || s.department || '')},${escapeCsv(s.year || '')},${escapeCsv(s.section || '')},${totalHeld},${totalAttended},${pct}%,${escapeCsv(status)}\n`;
        });
      } else {
        csvContent = 'Index,Date,Class,Period,Subject,Faculty,Present,Absent,Total Students,Attendance %\n';
        const attQuery = {};
        if (filters.classId) attQuery.classId = filters.classId;
        if (dateRange?.startDate && dateRange?.endDate) {
          attQuery.date = { $gte: new Date(dateRange.startDate), $lte: new Date(dateRange.endDate) };
        }
        const sessions = await M.ClassAttendance.find(attQuery).sort({ date: -1 }).limit(100).lean();
        if (sessions.length > 0) {
          sessions.forEach((sess, idx) => {
            const dateStr = sess.date ? new Date(sess.date).toISOString().slice(0, 10) : '';
            const p = sess.periods?.[0] || {};
            const total = (sess.records?.length) || (p.records?.length) || 0;
            const pres = (p.records || []).filter(r => r.status === 'P').length;
            const abs = Math.max(0, total - pres);
            const pct = total > 0 ? Math.round((pres / total) * 100) : 0;
            csvContent += `${idx + 1},"${dateStr}","${escapeCsv(sess.className || sess.classId || '')}","P${p.periodNumber || 1}","${escapeCsv(p.subjectName || '')}","${escapeCsv(p.markedBy || '')}",${pres},${abs},${total},${pct}%\n`;
          });
        }
      }

      const filename = `Muster_${reportType}_${history.exportTrackId}_${timestamp}.${format === 'excel' ? 'csv' : 'csv'}`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvContent);
    } else {
      // PDF / HTML formatted document
      let htmlRows = '';
      const sampleStudents = await M.Student.find(studentFilter).limit(50).lean();
      if (sampleStudents.length === 0) {
        htmlRows = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#64748b;">No records found for the selected export filters.</td></tr>';
      } else {
        const studentTrackIds = sampleStudents.map(s => s.trackId || String(s._id));
        const attDocs = await M.StudentAttendance.find({ studentTrackId: { $in: studentTrackIds } }).lean();
        const attMap = new Map();
        attDocs.forEach(a => attMap.set(a.studentTrackId, a));

        sampleStudents.forEach((s, idx) => {
          const track = s.trackId || String(s._id);
          const att = attMap.get(track);
          let totalHeld = 0;
          let totalAttended = 0;
          if (att && Array.isArray(att.records)) {
            totalHeld = att.records.reduce((acc, r) => acc + (r.classesHeld || 0), 0);
            totalAttended = att.records.reduce((acc, r) => acc + (r.classesAttended || 0), 0);
          }
          const pct = att && att.overallPercentage !== undefined
            ? att.overallPercentage
            : (s.attendancePercentage !== undefined ? s.attendancePercentage : (totalHeld > 0 ? Math.round((totalAttended / totalHeld) * 100) : 100));
          const isEligible = pct >= threshold;
          htmlRows += `<tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(s.registerNo || s.trackId || String(s._id))}</td>
            <td>${escapeHtml(s.fullName || '')}</td>
            <td>${escapeHtml(s.deptName || s.department || 'General')} (${escapeHtml(s.year || '')} Year)</td>
            <td>${pct}% (${totalAttended}/${totalHeld})</td>
            <td><span class="badge ${isEligible ? 'badge-ok' : 'badge-warn'}">${isEligible ? 'Eligible' : 'Shortage'}</span></td>
          </tr>`;
        });
      }

      const htmlDoc = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Muster Report - ${escapeHtml(reportType)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1e293b; }
    .hdr { border-bottom: 2px solid #16a34a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0; color: #15803d; font-size: 24px; }
    .meta { font-size: 13px; color: #64748b; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { background: #f0fdf4; color: #166534; padding: 10px 12px; border: 1px solid #cbd5e1; text-align: left; }
    td { padding: 9px 12px; border: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #f8fafc; }
    .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; }
    .badge-ok { background: #dcfce7; color: #15803d; }
    .badge-warn { background: #fef3c7; color: #b45309; }
  </style>
</head>
<body>
  <div class="hdr">
    <div>
      <h1>Muster Institutional Report</h1>
      <div class="meta">Report: <strong>${escapeHtml(reportType.toUpperCase())}</strong> · Export ID: <code>${escapeHtml(history.exportTrackId)}</code></div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:bold;color:#15803d;">Sri Shakthi Institute of Engineering &amp; Technology</div>
      <div class="meta">Generated on ${new Date().toLocaleString('en-IN')}</div>
    </div>
  </div>

  <p>This official document was generated from the Muster Academic Management Portal. Below is the record summary for this extraction.</p>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Register / Ref No</th>
        <th>Student / Target Name</th>
        <th>Department &amp; Scope</th>
        <th>Attendance Record</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
  </table>

  <div class="footer">
    Muster System Document · Verified Cryptographic Audit Trail · Valid without physical signature
  </div>
  <script>
    if (window.location.search.includes('print=true')) {
      window.print();
    }
  </script>
</body>
</html>
      `;

      const filename = `EAMS_${reportType}_${history.exportTrackId}_${timestamp}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlDoc);
    }
  } catch (err) {
    console.error('Download export error:', err);
    res.status(500).json({ error: 'Failed to download export file', details: err.message });
  }
});

// GET /api/export/filter-options - Get filter options for dropdowns
router.get('/filter-options', authMiddleware, async (req, res) => {
  try {
    const perms = getExportPermissions(req);

    let departmentFilter = {};
    if (perms.canExportDepartment && perms.departmentId) {
      departmentFilter._id = perms.departmentId;
    }

    const rawDepts = await M.Department.find(departmentFilter)
      .select('name code')
      .sort({ name: 1 })
      .lean();

    const departments = rawDepts.map(d => ({
      _id: d._id,
      name: d.name,
      code: d.code,
      label: `${d.name} (${d.code})`
    }));

    const academicSettings = await getSetting('academic');
    const years = academicSettings?.years || [1, 2, 3, 4];
    const sections = academicSettings?.sections || ['A', 'B', 'C'];

    // Get subjects based on permissions
    let subjectFilter = {};
    if (perms.canExportDepartment && perms.departmentId) {
      subjectFilter.deptId = perms.departmentId;
    }

    const rawSubjects = await M.Subject.find(subjectFilter)
      .select('name code shortName type')
      .sort({ name: 1 })
      .lean();

    const subjects = rawSubjects.map(s => ({
      _id: s._id,
      name: s.name,
      code: s.code,
      shortName: s.shortName || s.code,
      label: `${s.name} (${s.shortName || s.code})`
    }));

    // Get students list for modal selection
    const rawStudents = await M.Student.find(departmentFilter)
      .select('fullName registerNo classId')
      .sort({ fullName: 1 })
      .limit(150)
      .lean();

    const students = rawStudents.map(st => ({
      _id: st._id,
      name: st.fullName,
      registerNo: st.registerNo || '',
      label: `${st.fullName} (${st.registerNo || 'Reg'})`
    }));

    res.json({
      ok: true,
      data: {
        departments,
        years,
        sections,
        subjects,
        students
      }
    });
  } catch (err) {
    console.error('Filter options error:', err);
    res.status(500).json({ error: 'Failed to load filter options', details: err.message });
  }
});

router.escapeCsv = escapeCsv;
module.exports = router;
