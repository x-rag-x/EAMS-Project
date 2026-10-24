const mongoose = require('mongoose');

const AcademicEventSchema = new mongoose.Schema({
  eventId:           { type: String, unique: true, required: true }, // EVT-YYYY-XXXXXX
  name:              { type: String, required: true, trim: true },
  organizer:         { type: String, required: true, trim: true },
  type:              {
    type: String,
    required: true,
    enum: [
      'Technical',
      'Academic',
      'Placement',
      'Research',
      'Professional Development',
      'Co-Curricular',
      'Extra-Curricular',
      'Other'
    ],
    default: 'Technical'
  },
  subType:           { type: String, required: true, trim: true },
  level:             {
    type: String,
    required: true,
    enum: [
      'Department',
      'College',
      'Inter-Collegiate',
      'University',
      'District',
      'State',
      'National',
      'International',
      'Industry',
      'Online'
    ],
    default: 'Inter-Collegiate'
  },
  mode:              { type: String, enum: ['Offline', 'Online', 'Hybrid'], default: 'Offline' },
  hostCollege:       { type: String, default: '' },
  city:              { type: String, default: '' },
  venue:             { type: String, default: '' },
  websiteUrl:        { type: String, default: '' },
  startDate:         { type: String, required: true }, // YYYY-MM-DD
  endDate:           { type: String, required: true }, // YYYY-MM-DD
  description:       { type: String, default: '' },
  createdBy: {
    trackId:         { type: String, required: true },
    name:            { type: String, default: '' },
    role:            { type: String, default: '' }
  },
  participantsCount: { type: Number, default: 0 },
  status:            { type: String, enum: ['upcoming', 'ongoing', 'completed', 'cancelled'], default: 'upcoming' }
}, { timestamps: true });

AcademicEventSchema.index({ startDate: 1, endDate: 1 });
AcademicEventSchema.index({ level: 1, type: 1 });
AcademicEventSchema.index({ name: 'text', organizer: 'text', hostCollege: 'text' });

const AcademicEventModel = mongoose.models.AcademicEvent || mongoose.model('AcademicEvent', AcademicEventSchema);

module.exports = {
  AcademicEvent: AcademicEventModel
};
