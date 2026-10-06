'use strict';

// Minimal S3-compatible uploader: one signed PUT, written against the AWS
// Signature V4 spec using node's crypto and fetch.
//
// This exists so a daily off-site backup does not pull in the ~300 packages of
// the AWS SDK for a single HTTP request. It works with Cloudflare R2, Backblaze
// B2, Wasabi, DigitalOcean Spaces, MinIO and S3 itself.

const crypto = require('crypto');

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Each path segment is encoded, but the slashes between them are not. */
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

/**
 * Upload a buffer to an S3-compatible endpoint.
 *
 * @param {object} cfg
 * @param {string} cfg.endpoint   e.g. https://<account>.r2.cloudflarestorage.com
 * @param {string} cfg.region     'auto' for R2
 * @param {string} cfg.bucket
 * @param {string} cfg.accessKeyId
 * @param {string} cfg.secretAccessKey
 * @param {string} key            object key, e.g. 'backups/2026-10-06.tar.gz'
 * @param {Buffer} body
 * @param {string} [contentType]
 */
async function putObject(cfg, key, body, contentType = 'application/octet-stream') {
  const url = new URL(`${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${encodeKey(key)}`);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261006T131200Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const service = 's3';

  // --- canonical request ---
  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    url.pathname,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  // --- string to sign ---
  const scope = `${dateStamp}/${cfg.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  // --- signing key ---
  const kDate = hmac('AWS4' + cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Content-Type': contentType,
      'Content-Length': String(body.length)
    },
    body
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`S3 upload failed: ${res.status} ${res.statusText} ${detail}`);
  }

  return { key, bytes: body.length };
}

/** Reads the BACKUP_S3_* variables; returns null when off-site backup is off. */
function configFromEnv() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const bucket = process.env.BACKUP_S3_BUCKET;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.BACKUP_S3_REGION || 'auto',
    prefix: (process.env.BACKUP_S3_PREFIX || '').replace(/^\/+|\/+$/g, '')
  };
}

module.exports = { putObject, configFromEnv };
