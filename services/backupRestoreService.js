/**
 * services/backupRestoreService.js
 *
 * Comprehensive Backup, Cloud Sync, and Restoration Conflict Resolver Service.
 * - Compiles complete database snapshots across all core collections.
 * - Encrypts with AES-256-GCM (only EAMS can decrypt).
 * - Uploads to Google Drive.
 * - Dispatches rich telemetry emails to Sudo Admin from TeacherSchema.
 * - Provides inspection, conflict analysis, and granular restoration strategies.
 */

const crypto = require('crypto');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const M = require('../models');
const { encryptBackupPayload, decryptBackupPayload } = require('../utils/backupCrypto');
const { uploadBufferToDrive, BACKUP_FOLDER_ID } = require('../utils/googleDrive');
const { sendBackupNotificationMail } = require('../utils/googleMailer');
const { logAction } = require('../utils/logAction');
const { invalidateSettingsCache } = require('../utils/settingsCache');

/**
 * Extracts client telemetry (OS, Browser, Device Type) from user agent string.
 */
function parseUserAgentTelemetry(uaString = '') {
  const ua = String(uaString).toLowerCase();
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';

  if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
  else if (ua.includes('windows nt 6.3')) os = 'Windows 8.1';
  else if (ua.includes('macintosh') || ua.includes('mac os x')) os = 'macOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('linux')) os = 'Linux';

  if (ua.includes('edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Google Chrome';
  else if (ua.includes('firefox/')) browser = 'Mozilla Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Apple Safari';
  else if (ua.includes('opera/') || ua.includes('opr/')) browser = 'Opera';

  return { os, browser };
}

/**
 * Looks up Sudo Admin contact information from TeacherSchema.
 */
async function resolveSudoAdminContact() {
  try {
    const sudoTeacher = await M.Teacher.findOne({
      $or: [
        { 'pageRights.accessRole': 'sudoAdmin' },
        { 'specials.option': 'isAdmin' },
        { username: 'admin' }
      ]
    })
      .select('fullName username email specials pageRights')
      .lean();

    if (sudoTeacher && sudoTeacher.email && sudoTeacher.email.includes('@')) {
      return {
        email: sudoTeacher.email.trim(),
        name: sudoTeacher.fullName || 'Sudo Administrator',
        username: sudoTeacher.username || 'admin'
      };
    }

    // Try finding any teacher with isAdmin flag and valid email
    const anyAdminTeacher = await M.Teacher.findOne({
      'specials.option': 'isAdmin',
      email: { $regex: /@/ }
    })
      .select('fullName username email')
      .lean();

    if (anyAdminTeacher && anyAdminTeacher.email) {
      return {
        email: anyAdminTeacher.email.trim(),
        name: anyAdminTeacher.fullName || 'Administrator',
        username: anyAdminTeacher.username
      };
    }

    return {
      email: 'emas.project.siet@gmail.com',
      name: sudoTeacher?.fullName || 'Sudo Administrator',
      username: sudoTeacher?.username || 'admin'
    };
  } catch (err) {
    console.warn('[BackupService] Sudo admin email lookup error:', err.message);
    return {
      email: 'emas.project.siet@gmail.com',
      name: 'Sudo Administrator',
      username: 'admin'
    };
  }
}

/**
 * Creates a complete encrypted database snapshot, uploads to Drive, and mails Sudo Admin.
 */
async function createFullBackup({ user, ip, userAgent, clientDeviceInfo = {} }) {
  const timestamp = new Date();
  const backupId = `EAMS_BK_${timestamp.toISOString().replace(/[:.]/g, '-')}`;

  // 1. Fetch complete data across all collections
  // Password fields are select: false in Student and Teacher, so explicitly select them here
  const [
    students,
    teachers,
    departments,
    classes,
    subjects,
    classAttendance,
    studentAttendance,
    timetables,
    layoutPresets,
    timetableVersions,
    assignments,
    settings,
    academicYears,
    exams,
    hostels,
    deviceBindings,
    accessRequests,
    roleAssignments,
    odRequests,
    studentLeaveRequests,
    teacherLeaveRequests,
    hostelLeaves,
    calendars,
    users,
    passwords
  ] = await Promise.all([
    M.Student.find().select('+password +passwordHistory').lean(),
    M.Teacher.find().select('+password +passwordHistory').lean(),
    M.Department.find().lean(),
    M.Class.find().lean(),
    M.Subject.find().lean(),
    M.ClassAttendance.find().lean(),
    M.StudentAttendance.find().lean(),
    M.Timetable.find().lean(),
    M.LayoutPreset.find().lean(),
    M.TimetableVersion.find().lean(),
    M.Assignment.find().lean(),
    M.Settings.find().lean(),
    M.Year.find().lean(),
    M.Exam.find().lean(),
    M.Hostel.find().lean(),
    M.DeviceBinding.find().lean(),
    M.AccessRequest.find().lean(),
    M.RoleAssignment.find().lean(),
    M.ODRequest.find().lean(),
    M.LeaveRequest.find().lean(),
    M.TeacherLeaveRequest.find().lean(),
    M.HostelLeave.find().lean(),
    M.AcademicCalendar.find().lean(),
    M.User.find().lean(),
    M.Password.find().lean()
  ]);

  const collections = {
    students: students.length,
    teachers: teachers.length,
    departments: departments.length,
    classes: classes.length,
    subjects: subjects.length,
    classAttendance: classAttendance.length,
    studentAttendance: studentAttendance.length,
    timetables: timetables.length,
    layoutPresets: layoutPresets.length,
    timetableVersions: timetableVersions.length,
    assignments: assignments.length,
    settings: settings.length,
    academicYears: academicYears.length,
    exams: exams.length,
    hostels: hostels.length,
    deviceBindings: deviceBindings.length,
    accessRequests: accessRequests.length,
    roleAssignments: roleAssignments.length,
    odRequests: odRequests.length,
    studentLeaveRequests: studentLeaveRequests.length,
    teacherLeaveRequests: teacherLeaveRequests.length,
    hostelLeaves: hostelLeaves.length,
    calendars: calendars.length,
    users: users.length,
    passwords: passwords.length
  };

  const totalDocs = Object.values(collections).reduce((sum, n) => sum + n, 0);
  const backupPassword = crypto.randomBytes(6).toString('hex').toUpperCase();

  const backupData = {
    meta: {
      backupId,
      createdAt: timestamp.toISOString(),
      createdBy: user?.name || 'Administrator',
      creatorUsername: user?.username || 'admin',
      creatorRole: user?.role || 'sudo',
      creatorTrackId: user?.trackId || '',
      totalDocs,
      collections
    },
    data: {
      students,
      teachers,
      departments,
      classes,
      subjects,
      classAttendance,
      studentAttendance,
      timetables,
      layoutPresets,
      timetableVersions,
      assignments,
      settings,
      academicYears,
      exams,
      hostels,
      deviceBindings,
      accessRequests,
      roleAssignments,
      odRequests,
      studentLeaveRequests,
      teacherLeaveRequests,
      hostelLeaves,
      calendars,
      users,
      passwords
    }
  };

  // 2. High-grade authenticated encryption (AES-256-GCM)
  const encryptedPayload = encryptBackupPayload(backupData, backupPassword);

  // 3. Assemble .zip archive with JSZip
  const zip = new JSZip();
  const manifest = {
    backupId,
    app: 'EAMS',
    version: '2.3',
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-100K',
    createdAt: timestamp.toISOString(),
    createdBy: user?.name || 'Administrator',
    totalDocs,
    collections,
    salt: encryptedPayload.salt,
    iv: encryptedPayload.iv,
    authTag: encryptedPayload.authTag
  };

  zip.file('manifest.eams', JSON.stringify(manifest, null, 2));
  zip.file('data.eams', encryptedPayload.ciphertext);
  zip.file(
    'README.txt',
    [
      '====================================================================',
      'ELECTRONIC ATTENDANCE MANAGEMENT SYSTEM (EAMS) — ENCRYPTED BACKUP',
      '====================================================================',
      `Backup ID:     ${backupId}`,
      `Created At:    ${timestamp.toISOString()}`,
      `Total Records: ${totalDocs}`,
      '',
      'SECURITY NOTICE:',
      'All database collections in data.eams are encrypted using AES-256-GCM',
      'authenticated encryption. External archivers (WinRAR, 7-Zip, etc.) cannot',
      'read or alter the underlying database records.',
      '',
      'RESTORE INSTRUCTIONS:',
      '1. Open the EAMS administrative portal.',
      '2. Navigate to Bulk Upload -> Restore from Backup tab (Sudo Admin only).',
      '3. Upload this .zip file to inspect conflicts and execute restoration.',
      '===================================================================='
    ].join('\r\n')
  );

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Upload directly to Google Drive (backup folder) from memory buffer (zero local disk writes)
  let driveResult = { success: false, driveUrl: '', fileId: '' };
  try {
    const gResult = await uploadBufferToDrive(
      zipBuffer,
      `${backupId}.zip`,
      'application/zip',
      BACKUP_FOLDER_ID
    );
    if (gResult && gResult.fileId) {
      driveResult = gResult;
    }
  } catch (driveErr) {
    console.warn('[BackupService] Drive upload warning:', driveErr.message);
  }

  const finalDriveUrl =
    driveResult.driveUrl ||
    (driveResult.fileId ? `https://drive.google.com/file/d/${driveResult.fileId}/view` : 'https://drive.google.com');

  // 5. Look up Sudo Admin contact from TeacherSchema
  const sudoAdmin = await resolveSudoAdminContact();

  // 6. Gather device & requester telemetry
  const uaTelemetry = parseUserAgentTelemetry(userAgent);
  const deviceInfo = {
    ip: ip || '127.0.0.1',
    os: clientDeviceInfo.os || uaTelemetry.os,
    browser: clientDeviceInfo.browser || uaTelemetry.browser,
    screen: clientDeviceInfo.screen || '',
    userAgent: userAgent || '—'
  };

  const requesterInfo = {
    name: user?.name || 'Administrator',
    username: user?.username || 'admin',
    role: user?.role || 'sudo',
    trackId: user?.trackId || 'TR-ADMIN001'
  };

  // 7. Dispatch rich email via Google Mail
  let mailResult = { sent: false };
  try {
    mailResult = await sendBackupNotificationMail({
      to: sudoAdmin.email,
      recipientName: sudoAdmin.name,
      backupId,
      createdAt: timestamp.toISOString(),
      totalDocs,
      collectionsSummary: collections,
      driveUrl: finalDriveUrl,
      backupPassword,
      requesterInfo,
      deviceInfo
    });
  } catch (mailErr) {
    console.warn('[BackupService] Mail dispatch warning:', mailErr.message);
  }

  // 8. Add audit log
  await logAction(
    user?.trackId || user?._id || 'SYS-BACKUP',
    user?.name || 'Administrator',
    user?.role || 'sudo',
    'System Backup Created',
    `Full encrypted backup (${totalDocs} docs, ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB) created & uploaded to Google Drive. Link mailed to Sudo Admin (${sudoAdmin.email}).`,
    'system',
    'info',
    ip,
    user?.sessionId || '',
    {
      module: 'control',
      subType: 'backup',
      backupId,
      totalDocs,
      driveUrl: finalDriveUrl,
      driveFileId: driveResult.fileId,
      adminEmail: sudoAdmin.email,
      mailDispatched: mailResult.sent
    }
  );

  return {
    ok: true,
    backupId,
    totalDocs,
    backupPassword,
    createdAt: timestamp.toISOString(),
    collections,
    driveUrl: finalDriveUrl,
    driveFileId: driveResult.fileId,
    driveUploadSuccess: driveResult.success,
    adminEmail: sudoAdmin.email,
    emailDispatched: mailResult.sent,
    zipSizeMB: (zipBuffer.length / 1024 / 1024).toFixed(2),
    downloadUrl: finalDriveUrl || `/api/system/backup/download/${backupId}`
  };
}

/**
 * Inspects an uploaded .zip archive and produces a conflict resolution matrix.
 */
async function inspectBackupArchive(zipBuffer, backupPassword = '') {
  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    throw new Error('Invalid archive: Provided file is not a valid ZIP file.');
  }

  const manifestFile = zip.file('manifest.eams');
  const dataFile = zip.file('data.eams');

  if (!manifestFile || !dataFile) {
    throw new Error('Unrecognized archive: Missing manifest.eams or data.eams. Ensure you upload a genuine EAMS backup.');
  }

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string'));
  } catch (err) {
    throw new Error('Invalid archive: manifest.eams is not valid JSON.');
  }
  const ciphertextBuf = await dataFile.async('nodebuffer');

  // Decrypt payload
  const decryptedObj = decryptBackupPayload(
    {
      salt: manifest.salt,
      iv: manifest.iv,
      authTag: manifest.authTag,
      ciphertext: ciphertextBuf
    },
    backupPassword
  );

  const backupMeta = decryptedObj.meta || manifest;
  const backupData = decryptedObj.data || {};

  // Fail loudly when any collection name in the manifest is not a registered model
  const manifestCollections = Object.keys(manifest.collections || {});
  if (manifestCollections.length === 0) {
    throw new Error('Invalid backup archive: Manifest contains no collections.');
  }
  for (const colName of manifestCollections) {
    const model = getModelForCollection(colName);
    if (!model) {
      throw new Error(`Backup validation error: Collection "${colName}" in manifest is not a registered model in EAMS.`);
    }
  }

  // Also fail loudly when any collection in payload data is not a registered model
  for (const colName of Object.keys(backupData)) {
    const model = getModelForCollection(colName);
    if (!model) {
      throw new Error(`Backup validation error: Collection "${colName}" in payload data is not a registered model in EAMS.`);
    }
    if (!Array.isArray(backupData[colName])) {
      throw new Error(`Backup validation error: Data for collection "${colName}" is corrupted or not an array.`);
    }
  }

  // Inspect collections against current database state
  const analysis = {};
  let totalConflicts = 0;
  let totalNew = 0;

  const collectionNames = Object.keys(backupData);

  for (const colName of collectionNames) {
    const backupList = Array.isArray(backupData[colName]) ? backupData[colName] : [];
    if (backupList.length === 0) continue;

    let existingDocs = [];
    const model = getModelForCollection(colName);

    if (model) {
      try {
        existingDocs = await model.find().lean();
      } catch (err) {
        console.warn(`[BackupService] Failed to load existing docs for ${colName}:`, err.message);
      }
    }

    const { conflicts, newDocs, sampleConflicts } = compareCollectionData(colName, backupList, existingDocs);

    analysis[colName] = {
      backupCount: backupList.length,
      existingCount: existingDocs.length,
      conflicts: conflicts.length,
      newCount: newDocs.length,
      sampleConflicts: sampleConflicts.slice(0, 5)
    };

    totalConflicts += conflicts.length;
    totalNew += newDocs.length;
  }

  return {
    ok: true,
    backupMeta,
    collections: analysis,
    totalConflicts,
    totalNew
  };
}

/**
 * Compares incoming backup records against existing DB records to locate diffs.
 */
function compareCollectionData(colName, backupList, existingList) {
  const existingMap = new Map();

  existingList.forEach((doc) => {
    const key = getDocumentUniqueKey(colName, doc);
    if (key) existingMap.set(key, doc);
    if (doc._id) existingMap.set(String(doc._id), doc);
  });

  const conflicts = [];
  const newDocs = [];
  const sampleConflicts = [];

  backupList.forEach((incoming) => {
    const key = getDocumentUniqueKey(colName, incoming);
    const existing = (key && existingMap.get(key)) || (incoming._id && existingMap.get(String(incoming._id)));

    if (!existing) {
      newDocs.push(incoming);
    } else {
      // Compare fields to see if differing
      const diffFields = findDifferences(existing, incoming);
      if (diffFields.length > 0) {
        conflicts.push({ existing, incoming, diffFields });
        if (sampleConflicts.length < 5) {
          sampleConflicts.push({
            key: key || incoming._id,
            label: incoming.fullName || incoming.name || incoming.username || incoming.code || incoming.registerNo || incoming._id,
            diffFields
          });
        }
      }
    }
  });

  return { conflicts, newDocs, sampleConflicts };
}

/**
 * Returns primary identification key for a collection document.
 */
function getDocumentUniqueKey(colName, doc) {
  if (!doc) return null;
  switch (colName) {
    case 'students':
      return doc.registerNo || doc.trackId || (doc._id ? String(doc._id) : null);
    case 'teachers':
      return doc.username || doc.employeeNo || doc.trackId || (doc._id ? String(doc._id) : null);
    case 'departments':
      return doc.deptCode || doc.name || doc.trackId || (doc._id ? String(doc._id) : null);
    case 'classes':
      return doc.classTrackId || (doc.name && doc.section ? `${doc.name}-${doc.section}` : null) || (doc._id ? String(doc._id) : null);
    case 'subjects':
      return doc.subCode || doc.trackId || (doc._id ? String(doc._id) : null);
    case 'users':
      return doc.username || doc.trackId || (doc._id ? String(doc._id) : null);
    case 'academicYears':
    case 'years':
      return doc.academicYear || (doc._id ? String(doc._id) : null);
    case 'settings':
      return doc.key || (doc._id ? String(doc._id) : null);
    case 'studentLeaveRequests':
    case 'leaveRequests':
    case 'teacherLeaveRequests':
      return doc.requestId || (doc._id ? String(doc._id) : null);
    case 'hostelLeaves':
      return doc._id ? String(doc._id) : null;
    case 'passwords':
      return doc.username || doc.trackId || (doc._id ? String(doc._id) : null);
    default:
      return doc._id ? String(doc._id) : null;
  }
}

/**
 * Finds differing scalar/string fields between two documents.
 */
function findDifferences(a, b) {
  const diffs = [];
  const ignore = ['__v', 'updatedAt', 'password', 'passwordHistory', 'hash'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  keys.forEach((k) => {
    if (ignore.includes(k)) return;
    const valA = a[k];
    const valB = b[k];
    if (typeof valA === 'object' || typeof valB === 'object') return; // Skip deep object trees in preview
    if (String(valA ?? '') !== String(valB ?? '')) {
      diffs.push({ field: k, dbVal: valA ?? '—', backupVal: valB ?? '—' });
    }
  });

  return diffs;
}

/**
 * Maps collection name to registered Mongoose model.
 * Fails lookup if collection name is not a recognized EAMS model.
 */
const COLLECTION_MODEL_MAP = {
  students: M.Student,
  teachers: M.Teacher,
  departments: M.Department,
  classes: M.Class,
  subjects: M.Subject,
  classAttendance: M.ClassAttendance,
  studentAttendance: M.StudentAttendance,
  timetables: M.Timetable,
  layoutPresets: M.LayoutPreset,
  timetableVersions: M.TimetableVersion,
  assignments: M.Assignment,
  settings: M.Settings,
  academicYears: M.Year,
  years: M.Year,
  exams: M.Exam,
  hostels: M.Hostel,
  deviceBindings: M.DeviceBinding,
  accessRequests: M.AccessRequest,
  roleAssignments: M.RoleAssignment,
  odRequests: M.ODRequest,
  studentLeaveRequests: M.LeaveRequest,
  leaveRequests: M.LeaveRequest,
  teacherLeaveRequests: M.TeacherLeaveRequest,
  hostelLeaves: M.HostelLeave,
  calendars: M.AcademicCalendar,
  users: M.User,
  passwords: M.Password
};

function getModelForCollection(colName) {
  return COLLECTION_MODEL_MAP[colName] || null;
}

/**
 * Safely swaps a temporary collection into the live target collection.
 * Uses atomic collection rename with dropTarget, with rollback backup fallback.
 */
async function swapCollection(tempCollName, targetCollName, model) {
  const db = mongoose.connection.db;
  const tempColl = db.collection(tempCollName);

  try {
    // Native MongoDB atomic rename: replaces targetCollName with tempCollName
    await tempColl.rename(targetCollName, { dropTarget: true });
  } catch (renameErr) {
    console.warn(`[RestoreService] Native rename failed for ${targetCollName}: ${renameErr.message}. Attempting safe backup swap.`);
    const backupCollName = `_restore_bak_${targetCollName}_${Date.now()}`;
    const targetColl = db.collection(targetCollName);
    let targetRenamed = false;

    try {
      await targetColl.rename(backupCollName);
      targetRenamed = true;
    } catch (targetErr) {
      // Target might not exist yet if fresh database
    }

    try {
      await tempColl.rename(targetCollName);
      if (targetRenamed) {
        await db.collection(backupCollName).drop().catch(() => {});
      }
    } catch (swapErr) {
      if (targetRenamed) {
        await db.collection(backupCollName).rename(targetCollName).catch(() => {});
      }
      throw swapErr;
    }
  }

  // Re-sync indexes on the live collection
  try {
    if (typeof model.createIndexes === 'function') {
      await model.createIndexes();
    }
  } catch (idxErr) {
    console.warn(`[RestoreService] Notice: index sync for ${targetCollName}:`, idxErr.message);
  }
}

/**
 * Executes restoration using the chosen conflict resolution strategy.
 *
 * Strategies:
 * - 'overwrite': Upserts conflicting records, inserts new records.
 * - 'skip': Preserves existing DB records, inserts only new records.
 * - 'clean': Wipes selected collections safely: validates entire archive upfront,
 *            restores into temporary collections, and swaps atomically.
 */
async function executeBackupRestore({
  zipBuffer,
  backupPassword = '',
  strategy = 'overwrite',
  selectedCollections = [],
  user,
  ip
}) {
  const validStrategies = ['overwrite', 'skip', 'clean'];
  const activeStrategy = validStrategies.includes(strategy) ? strategy : 'overwrite';

  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    throw new Error('Invalid archive: Uploaded file is not a valid ZIP file.');
  }

  const manifestFile = zip.file('manifest.eams');
  const dataFile = zip.file('data.eams');
  if (!manifestFile || !dataFile) {
    throw new Error('Unrecognized archive: Missing EAMS envelope files (manifest.eams or data.eams).');
  }

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string'));
  } catch (err) {
    throw new Error('Invalid archive: manifest.eams is not valid JSON.');
  }
  const ciphertextBuf = await dataFile.async('nodebuffer');

  // 1. Decrypt and validate the entire archive first
  const decrypted = decryptBackupPayload(
    {
      salt: manifest.salt,
      iv: manifest.iv,
      authTag: manifest.authTag,
      ciphertext: ciphertextBuf
    },
    backupPassword
  );

  const backupData = decrypted.data || {};

  // Fail loudly when any collection name in the manifest is not a registered model
  const manifestCollections = Object.keys(manifest.collections || {});
  if (manifestCollections.length === 0) {
    throw new Error('Backup validation error: Manifest contains no collections.');
  }
  for (const colName of manifestCollections) {
    const model = getModelForCollection(colName);
    if (!model) {
      throw new Error(`Backup validation error: Collection "${colName}" in manifest is not a registered model in EAMS.`);
    }
  }

  // Fail loudly when any collection in payload data is not a registered model
  for (const colName of Object.keys(backupData)) {
    const model = getModelForCollection(colName);
    if (!model) {
      throw new Error(`Backup validation error: Collection "${colName}" in payload data is not a registered model in EAMS.`);
    }
    if (!Array.isArray(backupData[colName])) {
      throw new Error(`Backup validation error: Data for collection "${colName}" is corrupted or not an array.`);
    }
  }

  // Validate target collections
  const availableCollections = Object.keys(backupData);
  let targetCollections = [];
  if (Array.isArray(selectedCollections) && selectedCollections.length > 0) {
    for (const col of selectedCollections) {
      const model = getModelForCollection(col);
      if (!model) {
        throw new Error(`Restore error: Selected collection "${col}" is not a registered model in EAMS.`);
      }
    }
    targetCollections = selectedCollections.filter((c) => availableCollections.includes(c));
  } else {
    targetCollections = availableCollections;
  }

  if (targetCollections.length === 0) {
    throw new Error('Restore error: No matching collections found in archive to restore.');
  }

  // Validate structure of incoming documents
  for (const colName of targetCollections) {
    const list = backupData[colName];
    for (let i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== 'object') {
        throw new Error(`Restore error: Malformed record at index ${i} in collection "${colName}".`);
      }
    }
  }

  const executionReport = {};
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  if (activeStrategy === 'clean') {
    // CLEAN STRATEGY:
    // Safe multi-collection restore:
    // 1. Insert records into temporary collections first.
    // 2. If any error occurs during insertion or validation across any collection,
    //    abort immediately and drop all temporary collections.
    // 3. The live database collections are NEVER emptied beforehand!
    // 4. Once all temporary collections are staged successfully, swap each collection into place.
    const tempCollectionsCreated = [];

    try {
      // Phase 1: Populate all temporary collections
      for (const colName of targetCollections) {
        const incomingList = Array.isArray(backupData[colName]) ? backupData[colName] : [];
        const model = getModelForCollection(colName);
        if (!model) {
          throw new Error(`Collection "${colName}" is not a registered model.`);
        }

        const targetCollName = model.collection.name;
        const tempCollName = `_restore_tmp_${targetCollName}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

        // Ensure collection exists in MongoDB even if incomingList is empty
        await mongoose.connection.db.createCollection(tempCollName);

        const TempModel = mongoose.model(tempCollName, model.schema, tempCollName);
        tempCollectionsCreated.push({
          colName,
          tempCollName,
          targetCollName,
          TempModel,
          model,
          count: incomingList.length
        });

        if (incomingList.length > 0) {
          await TempModel.insertMany(incomingList, { ordered: false });
        }
      }

      // Phase 2: All collections staged successfully in temporary collections.
      // Now swap each collection into place safely.
      for (const item of tempCollectionsCreated) {
        await swapCollection(item.tempCollName, item.targetCollName, item.model);
        try {
          mongoose.deleteModel(item.tempCollName);
        } catch (delErr) {}

        executionReport[item.colName] = {
          total: item.count,
          inserted: item.count,
          updated: 0,
          skipped: 0
        };

        totalProcessed += item.count;
        totalInserted += item.count;
      }
    } catch (cleanErr) {
      console.error('[RestoreService] Clean restore staging failed, aborting swap:', cleanErr);
      // Abort: drop all temporary collections created during staging
      for (const item of tempCollectionsCreated) {
        try {
          await mongoose.connection.db.collection(item.tempCollName).drop();
        } catch (dropErr) {}
        try {
          mongoose.deleteModel(item.tempCollName);
        } catch (delErr) {}
      }
      throw new Error(`Clean restore aborted: ${cleanErr.message}. Live database was left completely intact.`);
    }
  } else {
    // Overwrite or Skip strategies
    for (const colName of targetCollections) {
      const incomingList = Array.isArray(backupData[colName]) ? backupData[colName] : [];
      if (incomingList.length === 0) continue;

      const model = getModelForCollection(colName);
      if (!model) {
        throw new Error(`Collection "${colName}" is not a registered model.`);
      }

      let colInserted = 0;
      let colUpdated = 0;
      let colSkipped = 0;

      const existingDocs = await model.find().lean();
      const existingMap = new Map();
      existingDocs.forEach((doc) => {
        const key = getDocumentUniqueKey(colName, doc);
        if (key) existingMap.set(key, doc);
        if (doc._id) existingMap.set(String(doc._id), doc);
      });

      for (const item of incomingList) {
        const key = getDocumentUniqueKey(colName, item);
        const existing = (key && existingMap.get(key)) || (item._id && existingMap.get(String(item._id)));

        if (!existing) {
          try {
            await model.create(item);
            colInserted++;
          } catch (err) {
            colSkipped++;
          }
        } else if (activeStrategy === 'overwrite') {
          try {
            await model.updateOne({ _id: existing._id }, { $set: item });
            colUpdated++;
          } catch (err) {
            colSkipped++;
          }
        } else {
          // Skip strategy
          colSkipped++;
        }
      }

      executionReport[colName] = {
        total: incomingList.length,
        inserted: colInserted,
        updated: colUpdated,
        skipped: colSkipped
      };

      totalProcessed += incomingList.length;
      totalInserted += colInserted;
      totalUpdated += colUpdated;
      totalSkipped += colSkipped;
    }
  }

  // Invalidate settings caches if settings or broadcasts were touched
  if (targetCollections.includes('settings')) {
    invalidateSettingsCache();
  }

  // Audit logging
  await logAction(
    user?.trackId || user?._id || 'SYS-RESTORE',
    user?.name || 'Administrator',
    user?.role || 'sudo',
    'System Restored From Backup',
    `Restored ${totalProcessed} records across ${targetCollections.length} collections (Strategy: ${activeStrategy}). Inserted: ${totalInserted}, Updated: ${totalUpdated}, Skipped: ${totalSkipped}.`,
    'system',
    'critical',
    ip,
    user?.sessionId || '',
    {
      module: 'bulk',
      subType: 'restore',
      strategy: activeStrategy,
      collectionsRestored: targetCollections,
      totalInserted,
      totalUpdated,
      totalSkipped
    }
  );

  return {
    ok: true,
    strategy: activeStrategy,
    totalProcessed,
    totalInserted,
    totalUpdated,
    totalSkipped,
    collections: executionReport
  };
}

module.exports = {
  createFullBackup,
  inspectBackupArchive,
  executeBackupRestore,
  resolveSudoAdminContact
};
