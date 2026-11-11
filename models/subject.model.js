const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
  trackId:     { type: String, trim: true },
  name:        { type: String, required: true, trim: true },
  courseCode:  { type: String, trim: true, default: '', uppercase: true }, // e.g. 25CSS301
  code:        { type: String, trim: true, default: '', uppercase: true }, // Alias for courseCode
  shortForm:   { type: String, required: true, trim: true, uppercase: true }, // Subject Short Form, e.g. DSA
  shortName:   { type: String, trim: true, default: '', uppercase: true }, // Alias for shortForm
  subjectCode: { type: String, required: true, trim: true, unique: true, sparse: true, uppercase: true }, // courseCode + '-' + shortForm (e.g. 25CSS301-DSA)
  credits:     { type: Number, default: 3 },
  type:        { type: String, enum: ['Theory','Lab','Project'], default: 'Theory' },
  deptId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName:    { type: String, default: '' },
  deptCode:    { type: String, default: '' },
  regulation:  { type: String, trim: true, default: '' },
  slotsMin:         { type: Number, default: 5 },
  slotsTarget:      { type: Number, default: 5 },
  slotsMax:         { type: Number, default: 7 },
  isBlend:          { type: Boolean, default: false },
  blendTheorySlots: { type: Number, default: 0 },
  blendLabSlots:    { type: Number, default: 0 },
  blockLength:      { type: Number, default: 1 },
  category:         { type: String, enum: ['important','easy','hard'], default: 'easy' },
  component:        { type: String, enum: ['theory', 'lab', 'both'], default: 'theory' },
  labComponentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  theoryComponentId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
}, { timestamps: true });

SubjectSchema.index({ deptId: 1 });
SubjectSchema.index({ deptId: 1, regulation: 1 });
SubjectSchema.index({ regulation: 1 });
SubjectSchema.index({ courseCode: 1 });
SubjectSchema.index({ code: 1 });
SubjectSchema.index({ shortForm: 1 });
SubjectSchema.index({ shortName: 1 });
SubjectSchema.index({ category: 1 });
SubjectSchema.index({ labComponentId: 1 });
SubjectSchema.index({ theoryComponentId: 1 });

function syncSubjectModelFields(doc) {
  if (!doc) return;
  var cCode = (doc.courseCode || doc.code || '').trim().toUpperCase();
  var sForm = (doc.shortForm || doc.shortName || '').trim().toUpperCase();
  doc.courseCode = cCode;
  doc.code = cCode;
  doc.shortForm = sForm;
  doc.shortName = sForm;
  if (cCode && sForm) {
    doc.subjectCode = cCode + '-' + sForm;
  }
  if (doc.type === 'Lab') {
    doc.component = 'lab';
  } else if (doc.isBlend) {
    doc.component = 'both';
  } else if (!doc.component) {
    doc.component = 'theory';
  }
}

SubjectSchema.pre('validate', function (next) {
  syncSubjectModelFields(this);
  if (typeof next === 'function') next();
});

SubjectSchema.pre('save', function (next) {
  syncSubjectModelFields(this);
  if (typeof next === 'function') next();
});

SubjectSchema.pre('findOneAndUpdate', function () {
  var update = this.getUpdate();
  if (update) {
    if (update.$set) {
      syncSubjectModelFields(update.$set);
    } else {
      syncSubjectModelFields(update);
    }
    this.setUpdate(update);
  }
});

module.exports = {
  Subject: mongoose.model('Subject', SubjectSchema),
};
