/**
 * bulk.config.js
 * Configuration constants, type metadata, and status mappings for Bulk Chat UI.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var TYPES = {
    dept: {
      key: 'dept',
      label: 'Departments',
      singular: 'Department',
      icon: 'building2',
      desc: 'Create academic departments, branches and courses',
      color: '#3b82f6',
      badgeClass: 'badge-dept',
      exportUrl: '/api/depts',
      needsVerification: false,
      templateName: 'Department_Template.xlsx'
    },
    teacher: {
      key: 'teacher',
      label: 'Teachers',
      singular: 'Teacher',
      icon: 'teacher',
      desc: 'Create faculty accounts with track IDs and designations',
      color: '#8b5cf6',
      badgeClass: 'badge-teacher',
      exportUrl: '/api/teachers',
      needsVerification: true,
      templateName: 'Teacher_Template.xlsx'
    },
    class: {
      key: 'class',
      label: 'Classes',
      singular: 'Class',
      icon: 'chalkboard',
      desc: 'Define class sections, semesters and batch years',
      color: '#06b6d4',
      badgeClass: 'badge-class',
      exportUrl: '/api/classes',
      needsVerification: false,
      templateName: 'Class_Template.xlsx'
    },
    subject: {
      key: 'subject',
      label: 'Subjects',
      singular: 'Subject',
      icon: 'book-open',
      desc: 'Register subjects, course codes and curriculum credits',
      color: '#10b981',
      badgeClass: 'badge-subject',
      exportUrl: '/api/subjects',
      needsVerification: false,
      templateName: 'Subject_Template.xlsx'
    },
    student: {
      key: 'student',
      label: 'Students',
      singular: 'Student',
      icon: 'graduation-cap',
      desc: 'Enroll students with register numbers and class assignments',
      color: '#f59e0b',
      badgeClass: 'badge-student',
      exportUrl: '/api/students',
      needsVerification: true,
      templateName: 'Student_Template.xlsx'
    }
  };

  var STATUSES = {
    draft: { label: 'Draft', step: 0, pill: 'st-draft' },
    uploading: { label: 'Uploading…', step: 0, pill: 'st-proc' },
    processing: { label: 'Processing…', step: 0, pill: 'st-proc' },
    failed: { label: 'Failed', step: 0, pill: 'st-fail' },
    staged: { label: 'Staged', step: 1, pill: 'st-staged' },
    skipped_resolved: { label: 'Skipped Resolved', step: 1, pill: 'st-staged' },
    pending_sudo_initial: { label: 'Awaiting Sudo', step: 2, pill: 'st-pending' },
    sudo_initial_approved: { label: 'Initial Approved', step: 3, pill: 'st-prog' },
    verifying: { label: 'Verifying', step: 3, pill: 'st-prog' },
    verified_all: { label: 'Verified All', step: 3, pill: 'st-prog' },
    sudo_review: { label: 'Admin Review', step: 4, pill: 'st-pending' },
    pending_final_approval: { label: 'Final Approval Needed', step: 5, pill: 'st-pending' },
    committing: { label: 'Committing…', step: 6, pill: 'st-proc' },
    committed: { label: 'Committed', step: 6, pill: 'st-done' },
    rejected: { label: 'Rejected', step: 0, pill: 'st-fail' },
    cancelled: { label: 'Cancelled', step: 0, pill: 'st-fail' }
  };

  var STEPS = [
    { num: 0, label: 'Upload' },
    { num: 1, label: 'Review' },
    { num: 2, label: 'Approval' },
    { num: 3, label: 'Verification' },
    { num: 4, label: 'Admin Review' },
    { num: 5, label: 'Final Approval' },
    { num: 6, label: 'Committed' }
  ];

  function getStepForStatus(status) {
    var meta = STATUSES[status] || { step: 0 };
    return meta.step;
  }

  root.Bulk.config = {
    TYPES: TYPES,
    STATUSES: STATUSES,
    STEPS: STEPS,
    getStepForStatus: getStepForStatus
  };
})(window);
