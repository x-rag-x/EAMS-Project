require('dotenv').config();

const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');
const cfg = require('./index');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const { startSessionMonitor } = require('../utils/sessionMonitor');
const { logAction } = require('../utils/logAction');
const { normalizeYearRange, toBatchTrackId } = require('../utils/yearFormat');

const { DEFAULT_SETTINGS_LIST } = require('./defaultSettings');
const { syncActiveLoginSessions } = require('../utils/sessionMigration');
const { mergeDuplicateClassAttendance } = require('../utils/attendanceMigration');

mongoose.connection.on('error', err => {
  console.warn('   [MongoDB Connection Warning]:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('   [MongoDB Disconnected]: Connection lost. Waiting for automatic reconnection...');
});
mongoose.connection.on('reconnected', () => {
  console.log('   ✓ MongoDB reconnected successfully');
});

mongoose.connect(cfg.MONGO_URI, {
  dbName: cfg.DB_NAME,
  maxPoolSize: 20,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  serverSelectionTimeoutMS: 8000,
  autoIndex: true
})
  .then(async() => {
    console.log(`   3/5: MongoDB connected → ${cfg.DB_NAME}`);
    console.log(`> Checking Admin User...`);
    await seedAdmin();
    await seedSettings();
    await seedAcademicYear();
    await seedStudent();
    await seedTeacher();
    await syncActiveLoginSessions();
    await mergeDuplicateClassAttendance();
  })
  .catch(err => { console.error('   3/5: MongoDB error:', err.message); process.exit(1); });

async function seedSettings() {  
  console.log(`> Checking settings...`);
  let seeded = 0;
  for (const d of DEFAULT_SETTINGS_LIST) {
    const exists = await M.Settings.findOne({ key: d.key });
    if (!exists) {
      await M.Settings.create({ card: d.card, key: d.key, value: d.value, updatedBy: 'system' });
      seeded++;
    } else {
      // Ensure card matches latest enum and backfill missing keys
      const updatedVal = { ...d.value, ...(exists.value || {}) };
      await M.Settings.findOneAndUpdate({ key: d.key }, { $set: { card: d.card, value: updatedVal } });
    }
  }

    // Migrate legacy boolean settings into grouped card format
    const legacySettings = await M.Settings.findOne({ key: 'settings' });
    if (legacySettings && legacySettings.value) {
      const leg = legacySettings.value;
      
      // Migrate page visibility settings
      const pagesDoc = await M.Settings.findOne({ key: 'pages' });
      if (pagesDoc) {
        const toTri = (val) => (typeof val === 'string' ? val : (val === false ? 'disabled' : 'enabled'));
        const pVal = {
          pageStudents:   toTri(leg.pageStudents || pagesDoc.value?.pageStudents),
          pageTeachers:   toTri(leg.pageTeachers || pagesDoc.value?.pageTeachers),
          pageController: toTri(leg.pageController || pagesDoc.value?.pageController || 'enabled'),
          pageRooms:      toTri(leg.pageRooms || pagesDoc.value?.pageRooms || 'enabled'),
          pageManage:     toTri(leg.pageManage || pagesDoc.value?.pageManage),
          pageBulk:       toTri(leg.pageBulk || pagesDoc.value?.pageBulk),
          pageTimeTable:  toTri(leg.pageTimeTable || pagesDoc.value?.pageTimeTable || 'enabled'),
          pageSelector:   toTri(leg.pageSelector || pagesDoc.value?.pageSelector || 'enabled'),
        };
        await M.Settings.findOneAndUpdate({ key: 'pages' }, { $set: { value: pVal } });
      }

      // Migrate attendance policy settings
      const attDoc = await M.Settings.findOne({ key: 'attendance' });
      if (attDoc) {
        const aVal = {
          ...attDoc.value,
          markAttendance: leg.markAttendance !== undefined ? leg.markAttendance : attDoc.value.markAttendance,
          liveSessions: leg.liveSessions !== undefined ? leg.liveSessions : attDoc.value.liveSessions,
          forwardToRep: leg.forwardToRep !== undefined ? leg.forwardToRep : attDoc.value.forwardToRep,
        };
        await M.Settings.findOneAndUpdate({ key: 'attendance' }, { $set: { value: aVal } });
      }

      // Migrate model feature flags
      const modDoc = await M.Settings.findOne({ key: 'models' });
      if (modDoc) {
        const mVal = {
          ...modDoc.value,
          modelBackup: leg.modelBackup !== undefined ? leg.modelBackup : modDoc.value.modelBackup,
          modelUndo: leg.modelUndo !== undefined ? leg.modelUndo : modDoc.value.modelUndo,
          modelAddStudent: leg.modelAddStudent !== undefined ? leg.modelAddStudent : modDoc.value.modelAddStudent,
          modelExportSheet: leg.modelExportSheet !== undefined ? leg.modelExportSheet : modDoc.value.modelExportSheet,
          moduleDelUseAdminPass: leg.moduleDelUseAdminPass !== undefined ? leg.moduleDelUseAdminPass : modDoc.value.moduleDelUseAdminPass,
        };
        await M.Settings.findOneAndUpdate({ key: 'models' }, { $set: { value: mVal } });
      }
    }

    if (seeded > 0) console.log(`   5/5: Default settings not found, ${seeded} setting(s) added successfully`);
    else console.log(`   5/5: Default Settings Found`);
  
    // Set default maintenance fields if missing in legacy records
    await M.Settings.findOneAndUpdate(
      { key: 'maintenance', 'value.affectedRoles': { $exists: false } },
      { $set: { 'value.affectedRoles': ['teacher', 'student'], 'value.endTime': null, 'value.startedAt': null } }
    );
  
    // Log server initialization event
    await logAction(
      null, 'SYSTEM', 'system',
      'Server Started',
      'EAMS server started successfully.',
      'system', 'info', '127.0.0.1', '',
      { module: 'system', subType: 'action', trackId: 'TR-SYS-001' }
    );

    console.log(`EAMS ready for Access...`)
    startSessionMonitor();
  }

  async function seedAdmin() {
    // Seed default admin account in Teacher and User collections
    const adminExists = await M.Teacher.findOne({ username: 'admin' });
    if (adminExists) {
      console.log(`   4/5: Admin User found...`);
      // Ensure shadow User record is normalized to role: 'teacher' and matches trackId (§4.8, R1.7, R3)
      const shadowUser = await M.User.findOne({ username: 'admin' });
      if (!shadowUser) {
        await M.User.create({ username: 'admin', role: 'teacher', trackId: adminExists.trackId || 'TR-ADMIN001', status: 'active', bootstrapPending: Boolean(adminExists.bootstrapPending) });
      } else if (shadowUser.role !== 'teacher' || !shadowUser.trackId || shadowUser.bootstrapPending !== Boolean(adminExists.bootstrapPending)) {
        await M.User.updateOne({ username: 'admin' }, { $set: { role: 'teacher', trackId: adminExists.trackId || 'TR-ADMIN001', bootstrapPending: Boolean(adminExists.bootstrapPending) } });
      }
    }
    else {
      const isDefault = !cfg.ADMIN_PASSWORD && !process.env.adminPassword;
      const adminPass = cfg.ADMIN_PASSWORD || process.env.adminPassword || 'EAMS-admin@123';
      const hash = await bcrypt.hash(adminPass, cfg.BCRYPT_ROUNDS);
      const now = new Date();
      await M.Teacher.create({
        fullName: 'Administrator',
        firstName: 'Admin',
        lastName: null,
        username: 'admin',
        password: hash,
        trackId: 'TR-ADMIN001',
        designation: 'System Administrator',
        specials: [{ option: 'isAdmin', value: true, key: '' }],
        pageRights: [{
          page: '*',
          module: '*',
          accessRole: 'sudoAdmin',
          scope: 'institution',
          deptId: null,
          actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'assign', 'publish'],
          enabled: true
        }],
        mustChangePassword: true,
        bootstrapPending: true,
        isDefaultPassword: isDefault,
        firstBootAt: now
      });
      // Create shadow User record for unified session tracking with role: 'teacher'
      const userExists = await M.User.findOne({ username: 'admin' });
      if (!userExists) {
        await M.User.create({ username: 'admin', role: 'teacher', trackId: 'TR-ADMIN001', status: 'active', bootstrapPending: true });
      } else {
        await M.User.updateOne({ username: 'admin' }, { $set: { role: 'teacher', bootstrapPending: true } });
      }
      console.log(`   4/5: Admin User not found, Created new user successfully (bootstrapPending: true)`);
    }
  }

  async function seedStudent(){
    const autoSeedData = await M.Settings.findOne({ key: 'autoSeedData'});
    
    if(autoSeedData && autoSeedData.value && autoSeedData.value.autoSeedData) {
      const stdExists = await M.User.findOne({ role: 'student' });
      if (!stdExists) {
        const studentPass = cfg.STUDENT_PASSWORD || process.env.studentPassword;
        if (!studentPass) {
          console.warn('   [WARNING] STUDENT_PASSWORD not set. Skipping test student seed.');
          return;
        }
        const hash = await bcrypt.hash(studentPass, cfg.BCRYPT_ROUNDS);
        let dept = await M.Department.findOne();
        if (!dept) {
          dept = await M.Department.create({ name: 'Computer Science and Engineering', code: 'CSE', trackId: 'DP-CSE001' });
        }
        await M.Student.create({
          fullName: 'Test Student',
          password: hash,
          username: 'student',
          trackId: 'TR-STD001',
          registerNo: '2022A7PS0203P',
          deptId: dept._id
        });
        await M.User.create({ username: 'student', role: 'student', trackId: 'TR-STD001', status: 'active' });
        await logAction(
          null, 'SYSTEM', 'system',
          'Student Created',
          'Test Student created successfully.',
          'system', 'info', '127.0.0.1', '',
          { module: 'system', subType: 'entry-create', trackId: 'TR-STD001' }
        );
        console.log(`Test Student Created successfully`);
      }
    }
  }

  async function seedTeacher(){
    const autoSeedData = await M.Settings.findOne({ key: 'autoSeedData'});
    
    if(autoSeedData && autoSeedData.value && autoSeedData.value.autoSeedData) {
      const tecExists = await M.User.findOne({ role: 'teacher' });
      if (!tecExists) {
        const teacherPass = cfg.TEACHER_PASSWORD || process.env.teacherPassword;
        if (!teacherPass) {
          console.warn('   [WARNING] TEACHER_PASSWORD not set. Skipping test teacher seed.');
          return;
        }
        const hash = await bcrypt.hash(teacherPass, cfg.BCRYPT_ROUNDS);
        const dept = await M.Department.findOne();
        await M.Teacher.create({fullName: 'Test Teacher', password: hash, username: 'teacher', trackId: 'TR-TEC001', empId: 'EMP001', deptId: dept ? dept._id : undefined});
        await M.User.create({ username: 'teacher', role: 'teacher', trackId: 'TR-TEC001', status: 'active' });
        await logAction(
          null, 'SYSTEM', 'system',
          'Teacher Created',
          'Test Teacher created successfully.',
          'system', 'info', '127.0.0.1', '',
          { module: 'system', subType: 'entry-create', trackId: 'TR-TEC001' }
        );
        console.log(`Test Teacher Created successfully`);
      }
    }
  }

  async function seedAcademicYear() {
    try {
      const yearCount = await M.Year.countDocuments();
      if (yearCount === 0) {
        console.log(`> Checking Academic Year...`);
        const acadSetting = await M.Settings.findOne({ key: 'academic' }).lean();
        const rawAcadYear = (acadSetting && acadSetting.value && acadSetting.value.academicYear) || '2026-2027';
        const acadYear = normalizeYearRange(rawAcadYear);
        const m = acadYear.match(/^(\d{4})-(\d{4})$/);
        const startY = m ? parseInt(m[1], 10) : 2026;

        const batches = [
          {
            batchTrackId: `TR-BATCH-${String(startY).slice(-2)}${String(startY + 4).slice(-2)}`,
            batch: `${startY}-${startY + 4}`,
            currentYear: 'I',
            currentSem: 'I',
            regulation: '2025'
          },
          {
            batchTrackId: `TR-BATCH-${String(startY - 1).slice(-2)}${String(startY + 3).slice(-2)}`,
            batch: `${startY - 1}-${startY + 3}`,
            currentYear: 'II',
            currentSem: 'III',
            regulation: '2025'
          },
          {
            batchTrackId: `TR-BATCH-${String(startY - 2).slice(-2)}${String(startY + 2).slice(-2)}`,
            batch: `${startY - 2}-${startY + 2}`,
            currentYear: 'III',
            currentSem: 'V',
            regulation: '2021'
          },
          {
            batchTrackId: `TR-BATCH-${String(startY - 3).slice(-2)}${String(startY + 1).slice(-2)}`,
            batch: `${startY - 3}-${startY + 1}`,
            currentYear: 'IV',
            currentSem: 'VII',
            regulation: '2021'
          }
        ];

        // Also merge any existing batches from Class or Student collections
        const existingBatches = await Promise.all([
          M.Class.distinct('batch'),
          M.Student.distinct('batch')
        ]);
        const extraBatches = [...new Set([...(existingBatches[0] || []), ...(existingBatches[1] || [])].filter(Boolean))];
        extraBatches.forEach(eb => {
          const ebNorm = normalizeYearRange(eb);
          if (ebNorm && !batches.some(b => b.batch === ebNorm)) {
            const trackId = toBatchTrackId(ebNorm);
            batches.push({
              batchTrackId: trackId || `TR-BATCH-2529`,
              batch: ebNorm,
              currentYear: 'II',
              currentSem: 'III',
              regulation: '2025'
            });
          }
        });

        await M.Year.create({
          academicYear: acadYear,
          batches: batches,
          regulations: [
            { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false },
            { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true }
          ],
          semesterDates: [],
          createdBy: 'system',
          isCurrent: true
        });
        console.log(`   Academic Year seeded → ${acadYear} (${batches.length} batches)`);
      } else {
        // Ensure at least one academic year is flagged as isCurrent
        const currentYear = await M.Year.findOne({ isCurrent: true });
        if (!currentYear) {
          const latest = await M.Year.findOne().sort({ createdAt: -1 });
          if (latest) {
            latest.isCurrent = true;
            await latest.save();
          }
        }
      }
    } catch (e) {
      console.warn('   [WARNING] seedAcademicYear:', e.message);
    }
  }