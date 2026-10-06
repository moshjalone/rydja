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
 * @param {boolean} o.revised      true when this replaces an earlier quote
 */
function renderQuoteEmail({ name, amountCents, notes, token, revised }) {
  const { siteUrl, brand, phone } = config();
  const url = `${siteUrl}/q/${token}`;
  const amount = money(amountCents);
  const greeting = firstName(name) ? `Hi ${firstName(name)},` : 'Hi,';
  const intro = revised
    ? `We've revised the quote for your job. The updated price is ${amount}.`
    : `We've reviewed your request. Your quote is ${amount}.`;

  const subject = `${revised ? 'Revised quote' : 'Your quote'} from ${brand} — ${amount}`;

  // Built up rather than filtered, so the blank lines that separate paragraphs
  // survive and only the optional blocks drop out.
  const lines = [greeting, '', intro];
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
      ${phone ? `Questions? Call or text <a href="tel:${escapeHtml(phone)}" style="color:#171816;font-weight:800;">${escapeHtml(phone)}</a>.` : ''}
    </p>
    <p style="margin:8px 0 0;font-size:13px;color:#66685f;">&mdash; ${escapeHtml(brand)}</p>
  </div>
</body>
</html>`;

  return { subject, html, text, url };
}

// ---------------------------------------------------------------- sending

/**
 * Send the quote email. Never throws and never rejects.
 *
 * @returns {Promise<{ok: boolean, reason: string}>} reason is a fixed code,
 *   safe to log: sent | no_email | not_configured | http_<status> | timeout |
 *   network_error.
 */
async function sendQuoteEmail({ to, name, amountCents, notes, token, revised }) {
  if (!String(to || '').trim()) return { ok: false, reason: 'no_email' };
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const { apiKey, from } = config();
  const { subject, html, text } = renderQuoteEmail({ name, amountCents, notes, token, revised });

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

module.exports = { isConfigured, renderQuoteEmail, sendQuoteEmail };
