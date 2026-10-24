/**
 * services/bulk/notifications.js
 * Asynchronous notification and email dispatchers for the Bulk Chat workflow.
 */

const M = require('../../models');
const { sendGenericMail } = require('../../utils/mailer');

async function getSudoRecipients() {
  try {
    const list = [];
    if (M.Teacher && typeof M.Teacher.find === 'function') {
      const teachers = await M.Teacher.find({
        $or: [
          { 'pageRights.accessRole': 'sudoAdmin' },
          { 'specials.option': 'isAdmin' },
          { username: 'admin' }
        ]
      }).select('email fullName username trackId _id').lean();
      list.push(...(teachers || []));
    }
    if (M.User && typeof M.User.find === 'function') {
      const users = await M.User.find({
        $or: [
          { role: 'sudo' },
          { role: 'admin' },
          { username: 'admin' }
        ]
      }).select('email fullName username trackId _id').lean();
      list.push(...(users || []));
    }
    const seen = new Set();
    const result = [];
    for (const u of list) {
      const key = String(u._id || u.email || u.username);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(u);
      }
    }
    return result;
  } catch (err) {
    console.warn('[BulkNotifications] Failed to query sudo recipients:', err.message);
    return [];
  }
}

async function notifySudoOnForward(batch, uploader) {
  try {
    const title = `[EAMS Bulk] Initial Approval Required for ${batch.title || batch.type}`;
    const msg = `User ${uploader?.name || uploader?.username || 'Staff'} has staged ${batch.eligibleCount || 0} ${batch.type} records and submitted for Sudo Admin approval.`;

    // 1. In-app notification for Sudo Admins
    if (M.Notification && typeof M.Notification.create === 'function') {
      try {
        await M.Notification.create({
          type: 'info',
          from: uploader?.name || uploader?.username || 'Staff',
          fromRole: 'Staff',
          toTeacherId: null,
          toTeacherTrackId: '',
          toStudentId: null,
          toStudentTrackId: '',
          message: `${title}: ${msg}`,
          priority: 'High',
          status: 'Delivered',
          read: false,
          time: new Date()
        });
      } catch (notifErr) {
        console.warn('[BulkNotifications] Failed to create in-app notification on forward:', notifErr.message);
      }
    }

    // 2. Email dispatch to Sudo Admins
    const sudos = await getSudoRecipients();
    const emailRecipients = sudos.filter(s => s.email && s.email.includes('@'));
    for (const sudo of emailRecipients) {
      sendGenericMail({
        to: sudo.email,
        subject: title,
        text: msg
      }).catch(err => console.warn(`[BulkNotifications] Email to ${sudo.email} failed:`, err.message));
    }
  } catch (err) {
    console.warn('[BulkNotifications] Error in notifySudoOnForward:', err.message);
  }
}

async function notifySudoOnSubmitFinal(batch, uploader) {
  try {
    const title = `[EAMS Bulk] Final Commitment Approval Needed for ${batch.title || batch.type}`;
    const msg = `Verification is complete for ${batch.eligibleCount || 0} ${batch.type} records. Ready for database commitment.`;

    // 1. In-app notification for Sudo Admins
    if (M.Notification && typeof M.Notification.create === 'function') {
      try {
        await M.Notification.create({
          type: 'info',
          from: uploader?.name || uploader?.username || 'Staff',
          fromRole: 'Staff',
          toTeacherId: null,
          toTeacherTrackId: '',
          toStudentId: null,
          toStudentTrackId: '',
          message: `${title}: ${msg}`,
          priority: 'High',
          status: 'Delivered',
          read: false,
          time: new Date()
        });
      } catch (notifErr) {
        console.warn('[BulkNotifications] Failed to create in-app notification on submit final:', notifErr.message);
      }
    }

    // 2. Email dispatch to Sudo Admins
    const sudos = await getSudoRecipients();
    const emailRecipients = sudos.filter(s => s.email && s.email.includes('@'));
    for (const sudo of emailRecipients) {
      sendGenericMail({
        to: sudo.email,
        subject: title,
        text: msg
      }).catch(err => console.warn(`[BulkNotifications] Email to ${sudo.email} failed:`, err.message));
    }
  } catch (err) {
    console.warn('[BulkNotifications] Error in notifySudoOnSubmitFinal:', err.message);
  }
}

async function notifyUploaderOnDecision(batch, decision, reason, sudoUser) {
  try {
    if (!batch.uploadedBy) return;

    // F-29 Fix: batch.uploadedBy is an object { userId, trackId, name, role... }, not an ObjectId!
    const uploaderId = batch.uploadedBy.userId || (typeof batch.uploadedBy === 'string' || batch.uploadedBy._bsontype === 'ObjectID' ? batch.uploadedBy : null);
    let uploader = null;

    if (uploaderId) {
      try {
        if (M.Teacher && typeof M.Teacher.findById === 'function') {
          uploader = await M.Teacher.findById(uploaderId).select('email fullName username trackId').lean();
        }
        if (!uploader && M.User && typeof M.User.findById === 'function') {
          uploader = await M.User.findById(uploaderId).select('email fullName username trackId').lean();
        }
      } catch (_) {}
    }

    if (!uploader && batch.uploadedBy.trackId) {
      try {
        if (M.Teacher && typeof M.Teacher.findOne === 'function') {
          uploader = await M.Teacher.findOne({ trackId: batch.uploadedBy.trackId }).select('email fullName username trackId').lean();
        }
        if (!uploader && M.User && typeof M.User.findOne === 'function') {
          uploader = await M.User.findOne({ trackId: batch.uploadedBy.trackId }).select('email fullName username trackId').lean();
        }
      } catch (_) {}
    }

    const uploaderName = uploader?.fullName || batch.uploadedBy.name || uploader?.username || 'Uploader';
    const uploaderTrackId = uploader?.trackId || batch.uploadedBy.trackId || '';
    const uploaderEmail = uploader?.email || (batch.uploadedBy.email && batch.uploadedBy.email.includes('@') ? batch.uploadedBy.email : null);
    const uploaderTargetId = uploader?._id || (batch.uploadedBy.userId ? batch.uploadedBy.userId : null);

    const title = `[EAMS Bulk] Your Import Request for ${batch.title || batch.type} was ${decision}`;
    const msg = `Sudo Administrator ${sudoUser?.name || 'Sudo Admin'} has marked your batch as ${decision}. ${reason ? `Reason: ${reason}` : ''}`.trim();

    // 1. In-app notification for the uploader
    if (M.Notification && typeof M.Notification.create === 'function') {
      try {
        await M.Notification.create({
          type: 'info',
          from: sudoUser?.name || 'Sudo Admin',
          fromRole: 'Admin',
          toTeacherId: uploaderTargetId || null,
          toTeacherTrackId: uploaderTrackId,
          toTeacherName: uploaderName,
          toStudentId: null,
          toStudentTrackId: '',
          message: `${title}: ${msg}`,
          priority: 'High',
          status: 'Delivered',
          read: false,
          time: new Date()
        });
      } catch (notifErr) {
        console.warn('[BulkNotifications] Failed to create in-app notification for uploader:', notifErr.message);
      }
    }

    // 2. Email dispatch to the uploader
    if (uploaderEmail && uploaderEmail.includes('@')) {
      sendGenericMail({
        to: uploaderEmail,
        subject: title,
        text: msg
      }).catch(err => console.warn(`[BulkNotifications] Email to uploader (${uploaderEmail}) failed:`, err.message));
    }
  } catch (err) {
    console.warn('[BulkNotifications] Error in notifyUploaderOnDecision:', err.message);
  }
}

module.exports = {
  notifySudoOnForward,
  notifySudoOnSubmitFinal,
  notifyUploaderOnDecision
};
