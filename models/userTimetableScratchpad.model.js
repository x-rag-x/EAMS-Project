const mongoose = require('mongoose');
const { Schema } = mongoose;

const ScratchpadNoteSchema = new Schema({
  id:        { type: String, required: true },
  title:     { type: String, default: 'Untitled Note' },
  content:   { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const StashSlotSchema = new Schema({
  id:             { type: String, required: true },
  subject:        { type: String, default: '' },
  subjectCode:    { type: String, default: '' },
  subjectId:      { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  teacher:        { type: String, default: '' },
  teacherId:      { type: Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherTrackId: { type: String, default: '' },
  room:           { type: String, default: '' },
  roomId:         { type: Schema.Types.ObjectId, ref: 'Room', default: null },
  type:           { type: String, default: 'Theory' },
  duration:       { type: Number, default: 1 },
  isLab:          { type: Boolean, default: false },
  sourceSection:  { type: String, default: '' },
  sourceDay:      { type: String, default: '' },
  sourcePeriod:   { type: String, default: '' },
  comment:        { type: String, default: '' },
  savedAt:        { type: Date, default: Date.now }
}, { _id: false });

const ClipboardSlotSchema = new Schema({
  id:             { type: String, required: true },
  subject:        { type: String, default: '' },
  subjectCode:    { type: String, default: '' },
  subjectId:      { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  teacher:        { type: String, default: '' },
  teacherId:      { type: Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherTrackId: { type: String, default: '' },
  room:           { type: String, default: '' },
  roomId:         { type: Schema.Types.ObjectId, ref: 'Room', default: null },
  type:           { type: String, default: 'Theory' },
  duration:       { type: Number, default: 1 },
  isLab:          { type: Boolean, default: false },
  sourceSection:  { type: String, default: '' },
  sourceDay:      { type: String, default: '' },
  sourcePeriod:   { type: String, default: '' },
  comment:        { type: String, default: '' },
  copiedAt:       { type: Date, default: Date.now }
}, { _id: false });

const UserTimetableScratchpadSchema = new Schema({
  userId:           { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  notes:            { type: [ScratchpadNoteSchema], default: [] },
  savedSlots:       { type: [StashSlotSchema], default: [] },
  clipboardHistory: { type: [ClipboardSlotSchema], default: [] },
  activeNoteId:     { type: String, default: '' },
  lastSync:         { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = {
  UserTimetableScratchpad: mongoose.model('UserTimetableScratchpad', UserTimetableScratchpadSchema)
};
