const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
  trackId:     { type: String, trim: true },
  name:        { type: String, required: true, trim: true },
  courseCode:  { type: String, trim: true, default: '' }, // e.g. 25CSS301
  code:        { type: String, trim: true, default: '' }, // Alias for courseCode
  shortForm:   { type: String, required: true, trim: true }, // Subject Short Form, e.g. DSA
  shortName:   { type: String, trim: true, default: '' }, // Alias for shortForm
  subjectCode: { type: String, required: true, trim: true, unique: true, sparse: true }, // courseCode + '-' + shortForm (e.g. 25CSS301-DSA)
  credits:     { type: Number, default: 3 },
  type:        { type: String, enum: ['Theory','Lab','Project'], default: 'Theory' },
  deptId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName:    { type: String, default: '' },
  deptCode:    { type: String, default: '' },
  regulation:  { type: String, trim: true, default: '' },
}, { timestamps: true });

SubjectSchema.index({ deptId: 1 });
SubjectSchema.index({ deptId: 1, regulation: 1 });
SubjectSchema.index({ regulation: 1 });
SubjectSchema.index({ courseCode: 1 });
SubjectSchema.index({ code: 1 });
SubjectSchema.index({ shortForm: 1 });
SubjectSchema.index({ shortName: 1 });

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
}

SubjectSchema.pre('validate', function () {
  syncSubjectModelFields(this);
});

SubjectSchema.pre('save', function () {
  syncSubjectModelFields(this);
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

