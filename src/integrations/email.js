'use strict';

/**
 * Transactional email integration.
 *
 * Mock mode: SENDGRID_API_KEY and POSTMARK_API_KEY both unset.
 *   - Logs email to console
 *   - Appends to data/emails.json
 * Real mode: Uses SendGrid (if SENDGRID_API_KEY) or Postmark (if POSTMARK_API_KEY).
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const FROM   = process.env.EMAIL_FROM || 'hello@n3ware.com';
const isMock = !process.env.SENDGRID_API_KEY && !process.env.POSTMARK_API_KEY;

const DATA_DIR    = process.env.DATA_DIR || './data';
const EMAILS_FILE = path.resolve(path.join(DATA_DIR, 'emails.json'));

/**
 * Append a sent email record to data/emails.json (mock mode only).
 * @param {string} to
 * @param {string} subject
 * @param {string} body
 */
function _logEmail(to, subject, body) {
  console.log(`[email][mock] To: ${to} | Subject: ${subject}`);

  let records = [];
  try {
    if (fs.existsSync(EMAILS_FILE)) {
      records = JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'));
    }
  } catch {
    records = [];
  }

  records.push({ to, from: FROM, subject, body, sentAt: new Date().toISOString() });

  try {
    fs.mkdirSync(path.dirname(EMAILS_FILE), { recursive: true });
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.error('[email] Failed to write emails.json:', err.message);
  }
}

/**
 * Make an HTTPS POST request with a JSON body and return the response.
 * @param {object} options  - https.request options
 * @param {object} body     - JSON-serializable payload
 * @returns {Promise<{ statusCode, body }>}
 */
function _httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { ...options, method: 'POST' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Send via SendGrid.
 * @param {string} to
 * @param {string} subject
 * @param {string} htmlBody
 * @returns {Promise<{ messageId: string }>}
 */
async function _sendViaSendGrid(to, subject, htmlBody) {
  const result = await _httpsPost(
    {
      hostname: 'api.sendgrid.com',
      path:     '/v3/mail/send',
      headers:  {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      },
    },
    {
      personalizations: [{ to: [{ email: to }] }],
      from:             { email: FROM },
      subject,
      content:          [{ type: 'text/html', value: htmlBody }],
    }
  );
  const messageId = `sg_${Date.now()}`;
  if (result.statusCode >= 400) {
    throw new Error(`SendGrid error ${result.statusCode}: ${result.body}`);
  }
  return { messageId };
}

/**
 * Send via Postmark.
 * @param {string} to
 * @param {string} subject
 * @param {string} htmlBody
 * @returns {Promise<{ messageId: string }>}
 */
async function _sendViaPostmark(to, subject, htmlBody) {
  const result = await _httpsPost(
    {
      hostname: 'api.postmarkapp.com',
      path:     '/email',
      headers:  {
        'Content-Type':            'application/json',
        'Accept':                  'application/json',
        'X-Postmark-Server-Token': process.env.POSTMARK_API_KEY,
      },
    },
    { From: FROM, To: to, Subject: subject, HtmlBody: htmlBody }
  );
  if (result.statusCode >= 400) {
    throw new Error(`Postmark error ${result.statusCode}: ${result.body}`);
  }
  let messageId = `pm_${Date.now()}`;
  try {
    const parsed = JSON.parse(result.body);
    if (parsed.MessageID) messageId = parsed.MessageID;
  } catch { /* ignore */ }
  return { messageId };
}

/**
 * Dispatch an email through whichever provider is configured.
 */
async function _send(to, subject, htmlBody) {
  if (isMock) {
    _logEmail(to, subject, htmlBody);
    return { messageId: `mock_${Date.now()}` };
  }
  if (process.env.SENDGRID_API_KEY) {
    return _sendViaSendGrid(to, subject, htmlBody);
  }
  return _sendViaPostmark(to, subject, htmlBody);
}

/**
 * Send a welcome email to a new user.
 * @param {string} email
 * @param {string} name
 */
async function sendWelcome(email, name) {
  const subject = `Welcome to n3ware, ${name}!`;
  const html = `
    <h1>Welcome to n3ware, ${name}!</h1>
    <p>We're thrilled to have you on board. Your account is ready to go.</p>
    <p>
      <a href="https://n3ware.com/dashboard" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Go to your Dashboard
      </a>
    </p>
    <p>If you have any questions, just reply to this email.</p>
    <p>— The n3ware team</p>
  `;
  return _send(email, subject, html);
}

/**
 * Send a password reset email.
 * @param {string} email
 * @param {string} resetLink
 */
async function sendPasswordReset(email, resetLink) {
  const subject = 'Reset your n3ware password';
  const html = `
    <h1>Reset your password</h1>
    <p>We received a request to reset the password for your n3ware account.</p>
    <p>
      <a href="${resetLink}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Reset Password
      </a>
    </p>
    <p>This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
    <p>— The n3ware team</p>
  `;
  return _send(email, subject, html);
}

/**
 * Notify a user that their site has been published.
 * @param {string} email
 * @param {string} siteName
 * @param {string} siteUrl
 */
async function sendSitePublished(email, siteName, siteUrl) {
  const subject = `Your site '${siteName}' is live!`;
  const html = `
    <h1>Your site is live! 🎉</h1>
    <p><strong>${siteName}</strong> has been published and is now accessible at:</p>
    <p>
      <a href="${siteUrl}" style="background:#10B981;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Visit ${siteUrl}
      </a>
    </p>
    <p>Share it with the world!</p>
    <p>— The n3ware team</p>
  `;
  return _send(email, subject, html);
}

/**
 * Send a weekly usage report.
 * @param {string} email
 * @param {{ views: number, sites: number }} stats
 */
async function sendWeeklyReport(email, stats) {
  const subject = 'Your n3ware weekly report';
  const html = `
    <h1>Your n3ware weekly report</h1>
    <p>Here's a summary of your activity for the past week:</p>
    <table style="border-collapse:collapse;width:100%;max-width:400px;">
      <tr>
        <td style="padding:12px;border:1px solid #e5e7eb;font-weight:bold;">Total page views</td>
        <td style="padding:12px;border:1px solid #e5e7eb;">${stats.views.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:12px;border:1px solid #e5e7eb;font-weight:bold;">Active sites</td>
        <td style="padding:12px;border:1px solid #e5e7eb;">${stats.sites}</td>
      </tr>
    </table>
    <br>
    <p>
      <a href="https://n3ware.com/dashboard" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        View full analytics
      </a>
    </p>
    <p>— The n3ware team</p>
  `;
  return _send(email, subject, html);
}

module.exports = { sendWelcome, sendPasswordReset, sendSitePublished, sendWeeklyReport };
