require('dotenv').config();

const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');
const cfg = require('./index');
const bcrypt = require('bcryptjs');
const M = require('../models');
const { startSessionMonitor } = require('../utils/sessionMonitor');
const { logAction } = require('../utils/logAction');

const { DEFAULT_SETTINGS_LIST } = require('./defaultSettings');

mongoose.connect(cfg.MONGO_URI, {
  dbName: cfg.DB_NAME,
  maxPoolSize: 20,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  serverSelectionTimeoutMS: 30000,
  autoIndex: true
})
  .then(async() => {
    console.log(`   3/5: MongoDB connected → ${cfg.DB_NAME}`);
    console.log(`> Checking Admin User...`);
    await seedAdmin();
    await seedSettings();
    await seedStudent();
    await seedTeacher();
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
          pageStudents:  toTri(leg.pageStudents || pagesDoc.value?.pageStudents),
          pageTeachers:  toTri(leg.pageTeachers || pagesDoc.value?.pageTeachers),
          pageManage:    toTri(leg.pageManage || pagesDoc.value?.pageManage),
          pageBulk:      toTri(leg.pageBulk || pagesDoc.value?.pageBulk),
          pageTimeTable: toTri(leg.pageTimeTable || pagesDoc.value?.pageTimeTable || 'enabled'),
          pageSelector:  toTri(leg.pageSelector || pagesDoc.value?.pageSelector || 'enabled'),
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
    // Seed default admin account in Admin and User collections
    const adminExists = await M.User.findOne({ username: 'admin', role: 'admin' });
    if (adminExists) {
      console.log(`   4/5: Admin User found...`);
    }
    else {
      const adminPass = cfg.ADMIN_PASSWORD || process.env.adminPassword;
      if (!adminPass) {
        console.warn('   [WARNING] ADMIN_PASSWORD/adminPassword not set in environment. Skipping default admin seed to prevent insecure account.');
        return;
      }
      const hash = await bcrypt.hash(adminPass, cfg.BCRYPT_ROUNDS);
      await M.Admin.create({ fullName: 'Administrator', firstName: 'Admin', lastName: '', username: 'admin', password: hash, trackId: 'TR-ADMIN001', isAdmin: true, adminRights: 'all', adminFlag: 'superadmin', mustChangePassword: true });
      // Create shadow User record for unified session tracking
      const userExists = await M.User.findOne({ username: 'admin' });
      if (!userExists) await M.User.create({ username: 'admin', role: 'admin', trackId: 'TR-ADMIN001', status: 'active' });
      console.log(`   4/5: Admin User not found, Created new user successfully`);
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
        const dept = await M.Department.findOne();
        await M.Student.create({fullName: 'Test Student', password: hash, username: 'student', trackId: 'TRSTD001', regNo: '2022A7PS0203P', deptId: dept ? dept._id : undefined});
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
        await M.Teacher.create({fullName: 'Test Teacher', password: hash, username: 'teacher', trackId: 'TRTEC001', empId: 'EMP001', deptId: dept ? dept._id : undefined});
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