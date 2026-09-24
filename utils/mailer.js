const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Returns configured Nodemailer transporter or falls back to console logger in dev/mock mode
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  } else {
    // Development/Fallback mock transporter that logs to console
    transporter = {
      sendMail: async (options) => {
        console.log(`[EAMS Mailer Mock] Email dispatched:
  To: ${options.to}
  Subject: ${options.subject}
  Time: ${new Date().toISOString()}`);
        return { messageId: 'mock-' + Date.now(), accepted: [options.to] };
      }
    };
  }
  return transporter;
}

/**
 * Core sendMail helper
 */
async function sendMail(options) {
  try {
    const t = getTransporter();
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"EAMS Attendance & Scheduling" <no-reply@eams.local>',
      ...options
    };
    const result = await t.sendMail(mailOptions);
    return { success: true, result };
  } catch (err) {
    console.error('[EAMS Mailer Error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Triggered on HOD/Principal approval to notify assigned substitute teacher via email
 */
async function sendSubstituteNotificationEmail({
  toEmail,
  substituteName,
  teacherName,
  fromDate,
  toDate,
  approverName,
  approverRole,
  substitutions = []
}) {
  if (!toEmail) return { success: false, reason: 'No email address provided' };

  const subRowsHtml = (substitutions || []).map(s => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 12px;">${s.date || ''} (${s.day || ''})</td>
      <td style="padding: 8px 12px; font-weight: 600;">Period ${s.periodNumber || s.period || '—'}</td>
      <td style="padding: 8px 12px;">${s.className || 'Class'}</td>
      <td style="padding: 8px 12px;">${s.subjectName || s.subject || '—'}</td>
      <td style="padding: 8px 12px;">${s.hallNo || s.room || '—'}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #fed7aa; border-radius: 8px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: #ffffff; padding: 18px 20px; border-radius: 6px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 700;">⚡ Substitute Teaching Assignment</h2>
        <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.95;">EAMS Timetable &amp; Leave Integration</p>
      </div>

      <p style="font-size: 15px; color: #1e293b;">Hello <strong>${substituteName}</strong>,</p>
      
      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        You have been assigned as a substitute teacher for <strong>${teacherName}</strong> during their approved leave period (<strong>${fromDate} to ${toDate}</strong>).
        This assignment was reviewed and approved by <strong>${approverName || 'Department'} (${approverRole || 'HOD'})</strong>.
      </p>

      <h3 style="font-size: 14px; color: #0f172a; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Assigned Periods:</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; background-color: #f8fafc; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0;">
        <thead>
          <tr style="background-color: #f1f5f9; color: #475569; font-weight: 600;">
            <th style="padding: 10px 12px;">Date</th>
            <th style="padding: 10px 12px;">Period</th>
            <th style="padding: 10px 12px;">Class</th>
            <th style="padding: 10px 12px;">Subject</th>
            <th style="padding: 10px 12px;">Room</th>
          </tr>
        </thead>
        <tbody>
          ${subRowsHtml || '<tr><td colspan="5" style="padding:10px;text-align:center;color:#64748b;">No individual slots listed</td></tr>'}
        </tbody>
      </table>

      <div style="margin-top: 24px; padding: 12px 16px; background-color: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px;">
        <p style="margin: 0; font-size: 13px; color: #9a3412;">
          <strong>Notice:</strong> The timetable has been dynamically updated with your substitution highlighted in orange. Please mark student attendance for these sessions accordingly.
        </p>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        Electronic Attendance Management System (EAMS) · Automated Scheduling Notification
      </p>
    </div>
  `;

  return sendMail({
    to: toEmail,
    subject: `[EAMS] Substitute Assignment: ${teacherName} (${fromDate} – ${toDate})`,
    html,
    text: `Hello ${substituteName},\n\nYou have been assigned as a substitute teacher for ${teacherName} from ${fromDate} to ${toDate}.\nApproved by: ${approverName} (${approverRole}).\nPlease view your updated schedule in the EAMS Timetable Workspace.`
  });
}

module.exports = {
  getTransporter,
  sendMail,
  sendSubstituteNotificationEmail
};
