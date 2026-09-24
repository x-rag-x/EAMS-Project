const mongoose = require('mongoose');

const editFieldHistory = new mongoose.Schema({
  editedModule : { type: String, required: true},
  editedField : { type: String, required: true},
  updatedBy : {
    role:     { type: String, required: true},
    username: { type: String, required: true},
    trackId:  { type: String, required: true},
  },
  time: { type: Date, default: Date.now },
}, { timestamps:true });

const DataManagementSchema = new mongoose.Schema({
  key: { type: String, unique: true }, // "ADM-2025"
  value: {
    currentSem: Number,
    currentYear: Number,
    batch: String,  
  },
  updatedBy : String,
}, { timestamps:true }); 

const SettingsSchema = new mongoose.Schema({
  card: { 
    type: String, 
    enum: [
      'Institution Details', 
      'Pages & Portals', 
      'Attendance Policy', 
      'Academic Settings',
      'Password Policy', 
      'Models & Features',
      'System Broadcasts',
      'System Utilities',
      'Settings'
    ], 
    required: true 
  },
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedBy: { type: String, required: true },
}, { timestamps: true });

const SettingHistorySchema = new mongoose.Schema({
  card:          { type: String, required: true },
  key:           { type: String, required: true },
  field:         { type: String, required: true },
  previousValue: { type: mongoose.Schema.Types.Mixed },
  newValue:      { type: mongoose.Schema.Types.Mixed },
  updatedBy: {
    role:     { type: String, default: 'admin' },
    username: { type: String, default: 'admin' },
    name:     { type: String, default: 'Administrator' },
    trackId:  { type: String, default: '' },
    ip:       { type: String, default: '' },
  },
  timestamp:     { type: Date, default: Date.now },
}, { timestamps: true });
SettingHistorySchema.index({ timestamp: -1 });
SettingHistorySchema.index({ card: 1, key: 1 });

const BroadcastHistorySchema = new mongoose.Schema({
  message:          { type: String, required: true },
  level:            { type: String, enum: ['info', 'warning', 'urgent', 'success', 'message'], default: 'info' },
  tag:              { type: String, enum: ['admin', 'hod', 'principal'], default: 'admin' },
  targetRoles:      { type: [String], default: ['all'] },
  targetDeptId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  targetDeptCode:   { type: String, default: '' },
  broadcastType:    { type: String, enum: ['general', 'meet_defaulters'], default: 'general' },
  isForcedAll:      { type: Boolean, default: false },
  popupDurationSec: { type: Number, default: 10 },
  sentCount:        { type: Number, default: 0 },
  sentUserIds:      { type: [String], default: [] },
  failedCount:      { type: Number, default: 0 },
  failedDetails:    [{ userId: String, error: String }],
  dispatchedBy: {
    role:     { type: String, default: 'admin' },
    username: { type: String, default: 'admin' },
    name:     { type: String, default: 'Administrator' },
    trackId:  { type: String, default: '' },
    ip:       { type: String, default: '' },
  },
  dispatchedAt:     { type: Date, default: Date.now },
}, { timestamps: true });
BroadcastHistorySchema.index({ dispatchedAt: -1 });

const UndoLogSchema = new mongoose.Schema({
  collectionName: { type: String, required: true },
  action:   { type: String, default: 'delete' },
  label:    { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedBy:{ type: String, default: 'admin' },
  expiresAt:{ type: String, required: true},
}, { timestamps: true });
UndoLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  Settings:         mongoose.model('Settings',          SettingsSchema),
  SettingHistory:   mongoose.model('SettingHistory',    SettingHistorySchema),
  BroadcastHistory: mongoose.model('BroadcastHistory',  BroadcastHistorySchema),
  UndoLog:          mongoose.model('UndoLog',           UndoLogSchema),
  DataManagement:   mongoose.model('DataManagement',    DataManagementSchema),
  editFieldHistory: mongoose.model('editFieldHistory',  editFieldHistory),
};

