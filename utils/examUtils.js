const M = require('../models');

async function refreshExamStatuses() {
  const today = new Date().toISOString().split('T')[0];
  await M.Exam.updateMany({ status: { $nin: ['cancelled'] }, endDate: { $lt: today } },   { $set: { status: 'completed' } });
  await M.Exam.updateMany({ status: { $nin: ['cancelled'] }, startDate: { $lte: today }, endDate: { $gte: today } }, { $set: { status: 'ongoing' } });
  await M.Exam.updateMany({ status: { $nin: ['cancelled'] }, startDate: { $gt: today } }, { $set: { status: 'upcoming' } });
}

module.exports = { refreshExamStatuses };