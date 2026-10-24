
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const cfg = require('../config');
const { normalizeYearRange, toBatchTrackId } = require('./yearFormat');

const ROLE_MODELS = {
  teacher: () => M.Teacher,
  student: () => M.Student,
};

function modelFor(role) {
  const getModel = ROLE_MODELS[role];
  if (!getModel) throw new Error('Unknown role: ' + role);
  return getModel();
}

async function createUser(role, fields) {
  const Model = modelFor(role);

  if (!fields.fullName || !fields.username || !fields.password) {
    throw new Error('fullName, username, password are required');
  }

  const username = String(fields.username).toLowerCase().trim();
  if (username.startsWith('sb-') || username.startsWith('tr-')) {
    throw new Error("Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs");
  }
  const trackId  = fields.trackId;
  const hash     = await bcrypt.hash(fields.password, cfg.BCRYPT_ROUNDS);

  if (fields.admissionYear) fields.admissionYear = normalizeYearRange(fields.admissionYear);
  if (fields.batch) {
    fields.batch = normalizeYearRange(fields.batch);
    if (!fields.batchTrackId) fields.batchTrackId = toBatchTrackId(fields.batch);
  }

  const roleDoc = await Model.create(Object.assign({}, fields, {
    username,
    password: hash,
    trackId,
    mustChangePassword: fields.mustChangePassword !== false,
  }));

  await M.User.create({ username, role, trackId, status: 'active' });

  return roleDoc;
}

async function updateUser(role, id, fields) {
  const Model = modelFor(role);

  let newUsername = null;
  if (fields.username) {
    newUsername = String(fields.username).toLowerCase().trim();
    if (newUsername.startsWith('sb-') || newUsername.startsWith('tr-')) {
      throw new Error("Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs");
    }
  }

  if (fields.admissionYear) fields.admissionYear = normalizeYearRange(fields.admissionYear);
  if (fields.batch) {
    fields.batch = normalizeYearRange(fields.batch);
    if (!fields.batchTrackId) fields.batchTrackId = toBatchTrackId(fields.batch);
  }

  const roleDoc = await Model.findById(id);
  if (!roleDoc) return null;

  const oldUsername = roleDoc.username;

  const ALLOWED_FIELDS = [
    'fullName', 'firstName', 'lastName', 'email', 'phone', 'employeeNo',
    'department', 'deptId', 'deptCode', 'designation',
    'registerNo', 'class', 'classId', 'section', 'courseType', 'branch',
    'admissionYear', 'batch', 'batchTrackId', 'gender', 'residency',
    'hostelId', 'blockId', 'preferences', 'mustChangePassword'
  ];

  ALLOWED_FIELDS.forEach((key) => {
    if (fields[key] !== undefined) roleDoc[key] = fields[key];
  });
  if (newUsername) {
    roleDoc.username = newUsername;
  }
  if (fields.password) roleDoc.password = await bcrypt.hash(fields.password, cfg.BCRYPT_ROUNDS);

  await roleDoc.save();

  const shadowUser = await M.User.findOne({ username: oldUsername, role });
  if (shadowUser) {
    if (fields.username) shadowUser.username = roleDoc.username;
    if (fields.status) shadowUser.status = fields.status;
    if (fields.active !== undefined) shadowUser.status = fields.active ? 'active' : 'inactive';
    await shadowUser.save();
  }

  return roleDoc;
}


async function deleteUser(role, id, deletedByName) {
  const Model = modelFor(role);

  const roleDoc = await Model.findById(id);
  if (!roleDoc) return null;

  await M.UndoLog.create({
    collectionName: role + 's',
    label: `${role.charAt(0).toUpperCase()}${role.slice(1)}: ${roleDoc.fullName} (@${roleDoc.username})`,
    snapshot: roleDoc.toObject(),
    deletedBy: deletedByName || 'admin',
    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  });

  await Model.findByIdAndDelete(id);
  await M.User.deleteOne({ username: roleDoc.username, role });

  if (role === 'teacher') {
    await M.Assignment.deleteMany({ teacherId: String(id) });
  }

  return roleDoc;
}

module.exports = { createUser, updateUser, deleteUser };