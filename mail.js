'use strict';

// Transactional email, all of it, in one file.
//
// One provider (Resend), one HTTPS call, no queue and no worker. The quote is
// already committed before anything here runs, so a failure can only ever mean
// "the owner has to text the customer themselves" — never a lost quote. Every
// path resolves; nothing in here throws at its caller.
//
// Nothing here is logged except a reason code. A bounce message or a provider
// error body can quote the recipient address back at you, so the response body
// is never printed — only the status that produced it.

const RESEND_BASE = (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const SEND_TIMEOUT_MS = 8000;

/** Read at call time, not at require time, so tests can set the environment. */
function config() {
  return {
    apiKey: (process.env.RESEND_API_KEY || '').trim(),
    from: (process.env.EMAIL_FROM || '').trim(),
    siteUrl: (process.env.SITE_URL || 'https://getrydja.com').replace(/\/+$/, ''),
    brand: process.env.BRAND_NAME || 'RYDJA',
    phone: (process.env.BUSINESS_PHONE || '').trim()
  };
}

/** False means "send nothing and say so", not "fail". */
function isConfigured() {
  const { apiKey, from } = config();
  return Boolean(apiKey && from);
}

const money = (cents) =>
  '$' + (Math.abs(cents || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * Dialable form for a tel: href — digits and a leading + only. The number is
 * still displayed however it was typed. Same rules as the one in server.js;
 * duplicated rather than imported to keep this module standalone.
 */
function telHref(value) {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits;
}

/**
 * "Thursday, March 12" and "9:00 AM" from a stored "2026-03-12 09:00" value.
 * That string is wall-clock time the owner typed, so it is split by hand and
 * never passed through a timezone -- the customer must read back exactly the
 * time that was offered.
 */
function splitWhen(stored) {
  const [datePart = '', timePart = ''] = String(stored || '').trim().split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePart || '00:00').split(':').map(Number);
  const dt = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
  if (isNaN(dt)) return { day: String(stored || ''), time: '' };
  return {
    day: dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    time: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  };
}

// ---------------------------------------------------------------- the email

/**
 * The quote email, as both HTML and plain text.
 *
 * Exported so a test can read what a customer would actually receive without
 * reaching the network.
 *
 * @param {object} o
 * @param {string} o.name          customer name, may be empty
 * @param {number} o.amountCents   the quoted price
 * @param {string} o.notes         admin notes meant for the customer, may be empty
 * @param {string} o.token         lead.public_token
 * @param {string} o.workRef       the permanent public reference, RYDJA-XXXXXX
 * @param {boolean} o.revised      true when this replaces an earlier quote
 */
function renderQuoteEmail({ name, amountCents, notes, token, workRef, revised }) {
  const { siteUrl, brand, phone } = config();
  const url = `${siteUrl}/q/${token}`;
  const amount = money(amountCents);
  const greeting = firstName(name) ? `Hi ${firstName(name)},` : 'Hi,';
  const intro = revised
    ? `We've revised the quote for your job. The updated price is ${amount}.`
    : `We've reviewed your request. Your quote is ${amount}.`;

  const subject = workRef
    ? `${revised ? 'Revised quote' : 'Your quote'} for ${workRef} — ${amount}`
    : `${revised ? 'Revised quote' : 'Your quote'} from ${brand} — ${amount}`;

  // Built up rather than filtered, so the blank lines that separate paragraphs
  // survive and only the optional blocks drop out.
  const lines = [greeting, ''];
  if (workRef) lines.push(`Reference: ${workRef}`, '');
  lines.push(intro);
  if (notes) lines.push('', 'Notes: ' + notes);
  lines.push('', 'Review the full quote and approve or decline it here:', url);
  lines.push('', 'Nothing is booked until you approve it.');
  if (phone) lines.push('', `Questions? Call or text ${phone}.`);
  lines.push('', `— ${brand}`);
  const text = lines.join('\n');

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f0e8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Inter,-apple-system,'Segoe UI',sans-serif;color:#171816;">
    <div style="font-size:21px;font-weight:900;letter-spacing:-0.04em;margin-bottom:28px;">${escapeHtml(brand)}</div>

    <div style="background:#fffdf7;border:1px solid #d8d4c9;border-radius:14px;padding:28px;">
      ${
        workRef
          ? `<div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:16px;">${escapeHtml(workRef)}</div>`
          : ''
      }
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(
        revised ? "We've revised the quote for your job." : "We've reviewed your request."
      )}</p>

      <div style="font-size:40px;font-weight:900;letter-spacing:-0.04em;margin:0 0 4px;">${escapeHtml(amount)}</div>
      <p style="margin:0 0 24px;font-size:13px;color:#66685f;">${escapeHtml(
        revised ? 'Updated price' : 'Your quote'
      )}</p>

      ${
        notes
          ? `<div style="border-top:1px solid #d8d4c9;padding-top:18px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:8px;">NOTES</div>
        <p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(notes)}</p>
      </div>`
          : ''
      }

      <a href="${escapeHtml(url)}" style="display:block;background:#171816;color:#ffffff;text-decoration:none;border-radius:999px;padding:16px 22px;font-weight:800;font-size:15px;text-align:center;">Review your quote</a>

      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#66685f;">
        That link is private to you. Open it to see the full quote and approve or decline it &mdash;
        nothing is booked until you approve.
      </p>
    </div>

    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#66685f;">
      ${phone ? `Questions? Call or text <a href="tel:${escapeHtml(telHref(phone))}" style="color:#171816;font-weight:800;">${escapeHtml(phone)}</a>.` : ''}
    </p>
    <p style="margin:8px 0 0;font-size:13px;color:#66685f;">&mdash; ${escapeHtml(brand)}</p>
  </div>
</body>
</html>`;

  return { subject, html, text, url };
}

/**
 * The proposed-appointment email. Same shape as the quote one: a reference, a
 * fact, and one button to the private page where the customer answers.
 *
 * @param {object} o
 * @param {string} o.name         customer name, may be empty
 * @param {string} o.workRef      RYDJA-XXXXXX
 * @param {string} o.service      what the job is
 * @param {string} o.proposedFor  stored wall-clock time, "YYYY-MM-DD HH:MM"
 * @param {string} o.token        lead.public_token
 */
function renderScheduleEmail({ name, workRef, service, proposedFor, token }) {
  const { siteUrl, brand, phone } = config();
  const url = `${siteUrl}/q/${token}`;
  const { day, time } = splitWhen(proposedFor);
  const greeting = firstName(name) ? `Hi ${firstName(name)},` : 'Hi,';

  const subject = `Proposed appointment for ${workRef}`;

  const lines = [greeting, '', `Reference: ${workRef}`, ''];
  lines.push(`We'd like to come out for your ${service} job at:`);
  lines.push('', day + (time ? ' at ' + time : ''));
  lines.push('', 'Please confirm this appointment or ask for a different time:', url);
  lines.push('', 'Nothing is locked in until you confirm.');
  if (phone) lines.push('', `Questions? Call or text ${phone}.`);
  lines.push('', `— ${brand}`);
  const text = lines.join('\n');

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f0e8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Inter,-apple-system,'Segoe UI',sans-serif;color:#171816;">
    <div style="font-size:21px;font-weight:900;letter-spacing:-0.04em;margin-bottom:28px;">${escapeHtml(brand)}</div>

    <div style="background:#fffdf7;border:1px solid #d8d4c9;border-radius:14px;padding:28px;">
      <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:16px;">${escapeHtml(workRef)}</div>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(greeting)} we'd like to come out for your ${escapeHtml(service)} job at:</p>

      <div style="border-top:1px solid #d8d4c9;border-bottom:1px solid #d8d4c9;padding:20px 0;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:10px;">PROPOSED APPOINTMENT</div>
        <div style="font-size:26px;font-weight:900;letter-spacing:-0.03em;line-height:1.2;">${escapeHtml(day)}</div>
        ${time ? `<div style="font-size:20px;font-weight:800;margin-top:4px;">${escapeHtml(time)}</div>` : ''}
      </div>

      <a href="${escapeHtml(url)}" style="display:block;background:#171816;color:#ffffff;text-decoration:none;border-radius:999px;padding:16px 22px;font-weight:800;font-size:15px;text-align:center;">Confirm or change this time</a>

      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#66685f;">
        Please confirm this appointment or ask for a different time. Nothing is locked in until you confirm.
      </p>
    </div>

    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#66685f;">
      ${phone ? `Questions? Call or text <a href="tel:${escapeHtml(telHref(phone))}" style="color:#171816;font-weight:800;">${escapeHtml(phone)}</a>.` : ''}
    </p>
    <p style="margin:8px 0 0;font-size:13px;color:#66685f;">&mdash; ${escapeHtml(brand)}</p>
  </div>
</body>
</html>`;

  return { subject, html, text, url };
}

// ---------------------------------------------------------------- sending

/**
 * The one HTTP call. Never throws and never rejects -- a caller gets a reason
 * code, and the quote or proposal it just committed stands either way.
 *
 * @returns {Promise<{ok: boolean, reason: string}>} reason is a fixed code,
 *   safe to log: sent | no_email | not_configured | http_<status> | timeout |
 *   network_error.
 */
async function send({ to, subject, html, text }) {
  if (!String(to || '').trim()) return { ok: false, reason: 'no_email' };
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const { apiKey, from } = config();

  try {
    const res = await fetch(RESEND_BASE + '/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });

    // The body is deliberately not read: a provider error echoes the address.
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    return { ok: true, reason: 'sent' };
  } catch (err) {
    return { ok: false, reason: err?.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
}

/** Send the quote email. */
async function sendQuoteEmail({ to, name, amountCents, notes, token, workRef, revised }) {
  const { subject, html, text } = renderQuoteEmail({ name, amountCents, notes, token, workRef, revised });
  return send({ to, subject, html, text });
}

/** Send the proposed-appointment email. */
async function sendScheduleEmail({ to, name, workRef, service, proposedFor, token }) {
  const { subject, html, text } = renderScheduleEmail({ name, workRef, service, proposedFor, token });
  return send({ to, subject, html, text });
}

module.exports = {
  isConfigured,
  renderQuoteEmail,
  sendQuoteEmail,
  renderScheduleEmail,
  sendScheduleEmail
};
