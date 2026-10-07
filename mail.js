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
    // The one public address: where a customer's reply lands, and where our
    // own notifications are sent. EMAIL_FROM carries a display name and has to
    // be a domain Resend has verified; this is the plain address a human
    // actually reads, and the two are allowed to differ. CONTACT_EMAIL is the
    // old name, honoured so an environment set before the rename keeps
    // working. Unset means "send no Reply-To" rather than "guess one", and no
    // business notification at all rather than one addressed nowhere.
    businessEmail: (process.env.BUSINESS_EMAIL || process.env.CONTACT_EMAIL || '').trim(),
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
 * An address fit to put in a header, or ''.
 *
 * Reply-To on a business notification is the customer's own address, which is
 * the one piece of user input that reaches a header field. The payload is JSON
 * and a newline could not break out of it, but this is the wrong place to rely
 * on that: anything that is not a single plain address is dropped, and the
 * caller falls back to the business address.
 */
function safeAddress(value) {
  const addr = String(value == null ? '' : value).trim();
  if (!addr || addr.length > 254) return '';
  // One local part, one domain, no spaces, no quotes, no angle brackets, and
  // above all no CR or LF.
  if (!/^[^\s<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(addr)) {
    return '';
  }
  return addr;
}

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
 * @param {string} o.proposedFor   an appointment offered with the quote, if any
 * @param {boolean} o.revised      true when this replaces an earlier quote
 */
function renderQuoteEmail({ name, amountCents, notes, token, workRef, proposedFor, revised }) {
  const { siteUrl, brand, phone } = config();
  const url = `${siteUrl}/q/${token}`;
  const amount = money(amountCents);
  const greeting = firstName(name) ? `Hi ${firstName(name)},` : 'Hi,';
  const when = proposedFor ? splitWhen(proposedFor) : null;
  const intro = revised
    ? `We've revised the quote for your job. The updated price is ${amount}.`
    : `We've reviewed your request. Your quote is ${amount}.`;

  // The subject says what is actually in the email, so a customer with a time
  // to agree to can see that before opening it.
  const lead = revised ? 'Revised quote' : 'Your quote';
  const subject = when
    ? `${revised ? 'Revised quote' : 'Quote'} & proposed appointment from ${brand} — ${workRef}`
    : `${lead} from ${brand} — ${amount}`;

  // Built up rather than filtered, so the blank lines that separate paragraphs
  // survive and only the optional blocks drop out.
  const lines = [greeting, ''];
  if (workRef) lines.push(`Reference: ${workRef}`, '');
  lines.push(intro);
  if (notes) lines.push('', 'Notes: ' + notes);
  if (when) {
    lines.push('', 'Proposed appointment:', when.day + (when.time ? ' at ' + when.time : ''));
    lines.push('', 'Review the quote here — you can approve it and confirm this time in one go,');
    lines.push('or approve it and ask for a different time:', url);
  } else {
    lines.push('', 'Review the full quote and approve or decline it here:', url);
  }
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

      ${
        when
          ? `<div style="border-top:1px solid #d8d4c9;padding-top:18px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:10px;">PROPOSED APPOINTMENT</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:-0.03em;line-height:1.2;">${escapeHtml(when.day)}</div>
        ${when.time ? `<div style="font-size:18px;font-weight:800;margin-top:2px;">${escapeHtml(when.time)}</div>` : ''}
      </div>`
          : ''
      }

      <a href="${escapeHtml(url)}" style="display:block;background:#171816;color:#ffffff;text-decoration:none;border-radius:999px;padding:16px 22px;font-weight:800;font-size:15px;text-align:center;">Review your quote</a>

      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#66685f;">
        That link is private to you. ${
          when
            ? 'Open it to approve the quote and confirm this time in one go &mdash; or approve it and ask for a different time.'
            : 'Open it to see the full quote and approve or decline it.'
        } Nothing is booked until you approve.
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
async function send({ to, subject, html, text, replyTo }) {
  if (!String(to || '').trim()) return { ok: false, reason: 'no_email' };
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const { apiKey, from, businessEmail } = config();

  // Resend's REST field is snake_case; the camelCase spelling is the Node
  // SDK's, which this does not use. Omitted entirely when unset -- an empty
  // reply_to is worse than none, because it overrides the From address.
  //
  // A caller may override it (a notification about one customer replies to
  // that customer), but only with an address that survives safeAddress.
  const payload = { from, to: [to], subject, html, text };
  const reply = safeAddress(replyTo) || businessEmail;
  if (reply) payload.reply_to = reply;

  try {
    const res = await fetch(RESEND_BASE + '/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
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
async function sendQuoteEmail({ to, name, amountCents, notes, token, workRef, proposedFor, revised }) {
  const { subject, html, text } = renderQuoteEmail({
    name, amountCents, notes, token, workRef, proposedFor, revised
  });
  return send({ to, subject, html, text });
}

/** Send the proposed-appointment email. */
async function sendScheduleEmail({ to, name, workRef, service, proposedFor, token }) {
  const { subject, html, text } = renderScheduleEmail({ name, workRef, service, proposedFor, token });
  return send({ to, subject, html, text });
}

// ------------------------------------------------- notifications to ourselves
//
// Everything above goes to a customer. Everything below goes to us, so that
// the owner is not required to sit refreshing the admin to find out a lead
// arrived. Same transport, different audience and different rules:
//
//   - the recipient is always BUSINESS_EMAIL, never anything from a request
//   - the subject is a fixed phrase plus the work reference, which the server
//     generated -- no customer input reaches a header
//   - the body carries the admin link, and never the customer's private token
//   - a failure is logged as a reason code and changes nothing else

/** Is a business notification possible at all? */
function canNotify() {
  return isConfigured() && Boolean(config().businessEmail);
}

/**
 * One internal notification, rendered the same way every time: a reference, a
 * headline, a table of facts, any free text the customer wrote, and a button
 * into the admin.
 *
 * Plain and scannable on a phone, because that is where it gets read. No
 * marketing shell -- this is a work email.
 *
 * @param {object} o
 * @param {string} o.title     the headline, e.g. 'New quote request'
 * @param {string} o.workRef   RYDJA-XXXXXX
 * @param {Array<[string, string]>} o.rows  label/value pairs; blank values drop
 * @param {Array<{heading: string, body: string}>} [o.blocks]  free text
 * @param {string} o.adminPath path under SITE_URL, e.g. '/admin/leads/12'
 * @param {string} o.adminLabel text for the button
 */
function renderNotification({ title, workRef, rows = [], blocks = [], adminPath, adminLabel }) {
  const { siteUrl, brand } = config();
  const adminUrl = siteUrl + adminPath;
  const present = rows.filter(([, value]) => String(value == null ? '' : value).trim() !== '');
  const written = blocks.filter((b) => String(b.body == null ? '' : b.body).trim() !== '');

  const subject = `${title} — ${workRef}`;

  const lines = [title.toUpperCase(), '', `Reference: ${workRef}`, ''];
  for (const [label, value] of present) lines.push(`${label}: ${value}`);
  for (const { heading, body } of written) lines.push('', heading + ':', String(body));
  lines.push('', adminLabel + ':', adminUrl, '', `— ${brand}`);
  const text = lines.join('\n');

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f0e8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Inter,-apple-system,'Segoe UI',sans-serif;color:#171816;">
    <div style="background:#fffdf7;border:1px solid #d8d4c9;border-radius:14px;padding:28px;">
      <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:10px;">${escapeHtml(workRef)}</div>
      <h1 style="margin:0 0 22px;font-size:23px;font-weight:900;letter-spacing:-0.03em;line-height:1.2;">${escapeHtml(title)}</h1>

      <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">
        ${present
          .map(
            ([label, value]) => `<tr>
          <td style="padding:7px 14px 7px 0;color:#66685f;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:7px 0;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`
          )
          .join('\n        ')}
      </table>

      ${written
        .map(
          ({ heading, body }) => `<div style="border-top:1px solid #d8d4c9;padding-top:18px;margin-top:20px;">
        <div style="font-size:11px;font-weight:900;letter-spacing:0.14em;color:#66685f;margin-bottom:8px;">${escapeHtml(
          heading.toUpperCase()
        )}</div>
        <p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(body)}</p>
      </div>`
        )
        .join('\n      ')}

      <a href="${escapeHtml(adminUrl)}" style="display:block;margin-top:24px;background:#171816;color:#ffffff;text-decoration:none;border-radius:999px;padding:16px 22px;font-weight:800;font-size:15px;text-align:center;">${escapeHtml(
        adminLabel
      )}</a>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#66685f;">You will be asked to sign in.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text, adminUrl };
}

/**
 * Send one notification to BUSINESS_EMAIL.
 *
 * `replyTo` is the customer's address on the events where hitting Reply should
 * reach them -- a new request, a question, a request for another time. On a
 * status event it is left out, and send() falls back to the business address,
 * because replying to "quote declined" reaches nobody useful.
 *
 * @returns {Promise<{ok: boolean, reason: string}>} same fixed reason codes as
 *   send(), plus not_configured when there is no business address to send to.
 */
async function sendBusinessNotification({ replyTo, ...parts }) {
  const { businessEmail } = config();
  if (!businessEmail) return { ok: false, reason: 'not_configured' };
  const { subject, html, text } = renderNotification(parts);
  return send({ to: businessEmail, subject, html, text, replyTo });
}

module.exports = {
  isConfigured,
  canNotify,
  safeAddress,
  renderQuoteEmail,
  sendQuoteEmail,
  renderScheduleEmail,
  sendScheduleEmail,
  renderNotification,
  sendBusinessNotification
};
