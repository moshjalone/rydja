'use strict';

// Shared harness. Every suite drives a real server process over HTTP rather
// than importing the app, so what is tested is what ships: middleware order,
// the bot filter, the rate limiter and the redirects all behave as they do on
// Render.
//
// The server runs with TRUST_PROXY=1, as it does in production, so a test can
// present its own X-Forwarded-For and get its own rate-limit bucket. That keeps
// tests independent of each other and of their order.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-admin-password-123';
const SESSION_SECRET = '9f1c4a7b2e6d08351c7a9be40d2f6a83cb5e17409d2a6b8c3f0e5172a4d6b9c8';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Boot a server on its own port, against its own throwaway database.
 *
 * @param {object} extraEnv  merged over the defaults — how a suite turns on
 *                           email, points it at a stub, or changes SITE_URL
 */
async function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-test-'));
  // A suite may point the server at a database it prepared itself — a
  // pre-migration one, say. The read handle has to follow it there, or it
  // opens a path nothing ever creates.
  const dbPath = extraEnv.DB_PATH || path.join(dir, 'app.db');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(dir, 'uploads'),
      BACKUP_DIR: path.join(dir, 'backups'),
      BACKUP_DAILY: '0', // no scheduled work during a test run
      NODE_ENV: 'test',
      TRUST_PROXY: '1', // one proxy hop, as on Render
      ADMIN_PASSWORD,
      SESSION_SECRET,
      BUSINESS_PHONE: '',
      // Blank unless a suite asks for them, so a value exported in the
      // developer's shell cannot change what a test sees.
      BUSINESS_EMAIL: '',
      CONTACT_EMAIL: '',
      FACEBOOK_URL: '',
      INSTAGRAM_URL: '',
      // Off unless a suite asks for it, so no test can reach a real provider.
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Everything the server printed, for the suites that assert on what is — and
  // is not — written to the log.
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in 15s')), 15000);
    const onData = (chunk) => {
      log += chunk;
      if (log.includes('running on http://')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('server exited with ' + code + ':\n' + log));
    });
  });

  // If this throws, the child is already running and nothing has a handle to
  // stop it — which hangs the whole runner rather than failing one test.
  let read;
  try {
    read = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    child.kill();
    throw err;
  }

  const get = (url, opts = {}) => fetch(base + url, { redirect: 'manual', ...opts });

  /** `ip` picks the rate-limit bucket, so each test can have one to itself. */
  const post = (url, fields, opts = {}) =>
    fetch(base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': opts.ip || '203.0.113.1',
        ...(opts.headers || {})
      },
      body: new URLSearchParams(fields).toString()
    });

  return {
    base,
    read,
    get,
    post,
    logs: () => log,
    count: (table) => read.prepare('select count(*) as n from ' + table).get().n,

    /** Logged-in admin cookie header. */
    async adminCookie() {
      const res = await post('/admin/login', { password: ADMIN_PASSWORD }, { ip: '203.0.113.99' });
      if (res.status !== 302) throw new Error('admin login failed: ' + res.status);
      return res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
    },

    stop() {
      try {
        read.close();
      } catch {
        /* already gone */
      }
      child.kill();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — Windows may still hold the db file */
      }
    }
  };
}

/**
 * The same stamp the server issues, built here so a test can choose the issue
 * time — the only way to exercise expiry without waiting six hours.
 */
function stampIssuedAt(ms) {
  const issued = Math.floor(ms).toString(36);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(issued).digest('base64url').slice(0, 16);
  return issued + '.' + sig;
}

/** The stamp the live form is carrying right now. */
async function freshStamp(server) {
  const html = await (await server.get('/quote')).text();
  const m = html.match(/name="form_stamp" value="([^"]+)"/);
  if (!m) throw new Error('quote form carried no stamp');
  return m[1];
}

function submission(overrides = {}) {
  return {
    name: 'Dana Reed',
    phone: '6165550144',
    email: 'dana@example.com',
    zip: '49503',
    address: '12 Oak St',
    city: 'Grand Rapids',
    state: 'MI',
    service: 'Garage / basement cleanout',
    description: 'Two-car garage, boxes and an old couch. Everything goes.',
    access: 'Garage / barn',
    timing: 'ASAP',
    hazard_ack: '1',
    ...overrides
  };
}

module.exports = {
  ADMIN_PASSWORD,
  SESSION_SECRET,
  startServer,
  stampIssuedAt,
  freshStamp,
  submission
};
