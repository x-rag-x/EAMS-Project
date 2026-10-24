const nodemailer = require('nodemailer');

/**
 * Configure Nodemailer transport using environment variables or fallback
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }

  // Fallback in-memory or simulated transport for environments without external SMTP
  return null;
}

/**
 * Send welcome email with login credentials and EAMS overview.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.fullName - Recipient name
 * @param {string} params.username - Login username
 * @param {string} params.password - Initial temporary password
 * @param {string} params.role - 'student' | 'teacher'
 * @param {string} [params.institutionName] - Optional institution name
 * @param {string} [params.portalUrl] - Login portal link
 * @returns {Promise<{ sent: boolean, simulated: boolean, messageId?: string, error?: string }>}
 */
async function sendWelcomeCredentialsMail({
  to,
  fullName,
  username,
  password,
  role = 'student',
  institutionName = 'EAMS Institution',
  portalUrl = ''
}) {
  if (!to || !to.includes('@')) {
    return { sent: false, simulated: true, error: 'No valid recipient email provided' };
  }

  const roleLabel = role === 'teacher' ? 'Faculty Member' : 'Student';

  // Format loginUrl ensuring a valid absolute URL with protocol scheme
  let loginUrl = (portalUrl || '').trim();
  if (!loginUrl) {
    let domain = (process.env.PRODUCTION_DOMAIN || '').trim();
    if (!domain) domain = 'http://localhost:3000';
    if (!/^https?:\/\//i.test(domain)) {
      domain = (/localhost|127\.0\.0\.1/i.test(domain)) ? `http://${domain}` : `https://${domain}`;
    }
    loginUrl = `${domain.replace(/\/+$/, '')}/index.html`;
  } else if (!/^https?:\/\//i.test(loginUrl)) {
    loginUrl = `http://${loginUrl}`;
  }

  const subject = `Welcome to EAMS – Your ${roleLabel} Account & Credentials`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f7f4; margin: 0; padding: 24px; color: #1a2e1a; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1.5px solid #a5d6a7; overflow: hidden; box-shadow: 0 4px 24px rgba(27,94,32,0.08); }
    .header { background: linear-gradient(135deg, #1b5e20, #2e7d32); color: #ffffff; padding: 28px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.2px; }
    .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.9; }
    .body { padding: 28px 24px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .intro { font-size: 13.5px; line-height: 1.6; color: #405940; margin-bottom: 20px; }
    .cred-box { background: #e8f5e9; border: 1.5px solid #a5d6a7; border-radius: 12px; padding: 18px; margin-bottom: 22px; }
    .cred-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13.5px; border-bottom: 1px solid rgba(27,94,32,0.1); }
    .cred-row:last-child { border-bottom: none; }
    .cred-label { color: #5a7a5a; font-weight: 500; }
    .cred-val { font-weight: 700; color: #1b5e20; font-family: 'Consolas', monospace; }
    .btn { display: inline-block; background: #1b5e20; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 22px; margin-top: 8px; text-align: center; }
    .notice { font-size: 12px; color: #d97706; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin-top: 20px; line-height: 1.5; }
    .footer { background: #fafbfa; padding: 18px 24px; text-align: center; font-size: 11.5px; color: #5a7a5a; border-top: 1px solid rgba(27,94,32,0.08); }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${institutionName}</h1>
      <p>Electronic Attendance Management System (EAMS)</p>
    </div>
    <div class="body">
      <div class="greeting">Hello, ${fullName}!</div>
      <div class="intro">
        Your institutional profile has been verified and registered on <b>EAMS</b> as a <b>${roleLabel}</b>.
        You can now access digital attendance tracking, timetable schedules, session records, and institutional tools.
      </div>

      <div class="cred-box">
        <div class="cred-row">
          <span class="cred-label">Login Username:</span>
          <span class="cred-val">${username}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Initial Password:</span>
          <span class="cred-val">${password}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Registered Email:</span>
          <span class="cred-val">${to}</span>
        </div>
      </div>

      <div style="text-align:center;margin:26px 0 20px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
          <tr>
            <td align="center" style="border-radius:24px;background:#1b5e20;">
              <a href="${loginUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 34px;font-family:'Segoe UI',Arial,sans-serif;font-size:14.5px;color:#ffffff !important;font-weight:700;text-decoration:none;border-radius:24px;background-color:#1b5e20;border:1px solid #1b5e20;cursor:pointer;line-height:1.2;">
                <span style="color:#ffffff !important;text-decoration:none;">Sign in to EAMS Portal &rarr;</span>
              </a>
            </td>
          </tr>
        </table>
        <div style="margin-top:12px;font-size:12px;color:#5a7a5a;line-height:1.5;">
          Direct login link: <a href="${loginUrl}" target="_blank" rel="noopener noreferrer" style="color:#1b5e20;font-weight:600;text-decoration:underline;word-break:break-all;">${loginUrl}</a>
        </div>
      </div>

      <div class="notice">
        <b>Security Notice:</b> You are required to change your temporary password upon your first sign in.
        Never disclose your credentials to anyone.
      </div>
    </div>
    <div class="footer">
      This is an automated notification from ${institutionName} EAMS.<br>
      If you did not expect this message, please contact your departmental administrator.
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Hello ${fullName},

Welcome to ${institutionName} Electronic Attendance Management System (EAMS).
Your account (${roleLabel}) has been verified.

Your Login Credentials:
- Username: ${username}
- Password: ${password}
- Portal URL: ${loginUrl}

Please change your password upon first login.
  `.trim();

  // 1. Google Mail API (OAuth2) - Primary Institutional Transport
  try {
    const { getGmailAccessToken } = require('./googleMailer');
    const accessToken = await getGmailAccessToken();
    if (accessToken) {
      const senderEmail = process.env.GMAIL_SENDER_EMAIL || 'emas.project.siet@gmail.com';
      const fromAddr = `EAMS Institutional Core <${senderEmail}>`;
      const rawMessage = [
        `From: ${fromAddr}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlContent
      ].join('\r\n');

      const base64UrlMessage = Buffer.from(rawMessage).toString('base64url');

      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: base64UrlMessage })
      });

      const result = await response.json();
      if (result.id) {
        console.log(`[Mailer:GmailAPI] Credentials email delivered to ${to} for user @${username} (Msg ID: ${result.id})`);
        return { sent: true, simulated: false, provider: 'gmail-api', messageId: result.id };
      }
      console.warn('[Mailer:GmailAPI] Gmail API dispatch warning, response:', result);
    }
  } catch (gmailErr) {
    console.warn('[Mailer:GmailAPI] Error dispatching via Gmail API:', gmailErr.message);
  }

  // 2. Nodemailer SMTP Transport
  const transporter = getTransporter();

  if (transporter) {
    try {
      const fromAddr = process.env.SMTP_FROM || `EAMS Notifications <noreply@${process.env.SMTP_HOST || 'eams.edu'}>`;
      const info = await transporter.sendMail({
        from: fromAddr,
        to,
        subject,
        text: textContent,
        html: htmlContent
      });
      return { sent: true, simulated: false, provider: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.warn('[Mailer] SMTP delivery error, falling back to simulated dispatch:', err.message);
      return { sent: true, simulated: true, error: err.message };
    }
  }

  // 3. Simulated delivery when no email transport configured
  console.log(`[Mailer:Simulated] Credentials email simulated to ${to} for user @${username}`);
  return { sent: true, simulated: true, provider: 'simulated' };
}

/**
 * Send a generic institutional email notification with fallback.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Subject line
 * @param {string} [params.text] - Plain text content
 * @param {string} [params.html] - HTML content
 * @returns {Promise<{ sent: boolean, simulated: boolean, messageId?: string, error?: string }>}
 */
async function sendGenericMail({
  to,
  subject,
  text = '',
  html = ''
}) {
  if (!to || !to.includes('@')) {
    return { sent: false, simulated: true, error: 'No valid recipient email provided' };
  }

  const htmlContent = html || `<div style="font-family:sans-serif;line-height:1.6;color:#333;">${(text || '').replace(/\n/g, '<br>')}</div>`;
  const textContent = text || (html ? html.replace(/<[^>]+>/g, '') : '');

  // 1. Google Mail API (OAuth2) - Primary Institutional Transport
  try {
    const { getGmailAccessToken } = require('./googleMailer');
    const accessToken = await getGmailAccessToken();
    if (accessToken) {
      const senderEmail = process.env.GMAIL_SENDER_EMAIL || 'emas.project.siet@gmail.com';
      const fromAddr = `EAMS Institutional Core <${senderEmail}>`;
      const rawMessage = [
        `From: ${fromAddr}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlContent
      ].join('\r\n');

      const base64UrlMessage = Buffer.from(rawMessage).toString('base64url');

      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: base64UrlMessage })
      });

      const result = await response.json();
      if (result.id) {
        console.log(`[Mailer:GmailAPI] Email dispatched to ${to} (Msg ID: ${result.id})`);
        return { sent: true, simulated: false, provider: 'gmail-api', messageId: result.id };
      }
      console.warn('[Mailer:GmailAPI] Gmail API dispatch warning, response:', result);
    }
  } catch (gmailErr) {
    console.warn('[Mailer:GmailAPI] Error dispatching via Gmail API:', gmailErr.message);
  }

  // 2. Nodemailer SMTP Transport
  const transporter = getTransporter();
  if (transporter) {
    try {
      const fromAddr = process.env.SMTP_FROM || `EAMS Notifications <noreply@${process.env.SMTP_HOST || 'eams.edu'}>`;
      const info = await transporter.sendMail({
        from: fromAddr,
        to,
        subject,
        text: textContent,
        html: htmlContent
      });
      return { sent: true, simulated: false, provider: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.warn('[Mailer] SMTP delivery error, falling back to simulated dispatch:', err.message);
      return { sent: true, simulated: true, error: err.message };
    }
  }

  // 3. Simulated delivery when no email transport configured
  console.log(`[Mailer:Simulated] Email simulated to ${to}: ${subject}`);
  return { sent: true, simulated: true, provider: 'simulated' };
}

module.exports = {
  sendWelcomeCredentialsMail,
  sendGenericMail
};
