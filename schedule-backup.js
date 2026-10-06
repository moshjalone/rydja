'use strict';

// Runs the daily backup from inside the web process.
//
// Why in-process rather than cron: this app is one small always-on process, and
// every cheap host handles scheduled jobs differently (Render bills a separate
// Cron Job service, Fly needs a second machine, a VPS needs crontab). Doing it
// here means the backup works identically everywhere, costs nothing extra, and
// cannot be forgotten when the host changes.
//
// It checks every 15 minutes whether today's run has happened yet, so a restart
// or a missed window does not skip a day.

const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Local-date key, so "once a day" means the owner's day, not UTC's. */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function start({ runBackup, hour, stateFile }) {
  const readLastRun = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastRun || '';
    } catch {
      return '';
    }
  };

  const writeLastRun = (day) => {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ lastRun: day }, null, 2));
    } catch (err) {
      console.error('[backup] could not record last-run state:', err.message);
    }
  };

  let running = false;

  async function maybeRun() {
    if (running) return;

    const day = todayKey();
    if (readLastRun() === day) return;          // already done today
    if (new Date().getHours() < hour) return;   // not time yet

    running = true;
    try {
      const result = await runBackup({ quiet: true });
      writeLastRun(day);
      const where = result.offsite ? `off-site: ${result.offsite.key}` : 'local only';
      console.log(`[backup] daily backup complete — ${result.counts.leads} leads, ${result.counts.jobs} jobs (${where})`);
    } catch (err) {
      // Deliberately does not mark the day done, so the next check retries.
      console.error('[backup] daily backup FAILED:', err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(maybeRun, CHECK_INTERVAL_MS);
  timer.unref();
  setTimeout(maybeRun, 30 * 1000).unref(); // also check shortly after boot

  console.log(`[backup] daily backup scheduled for ${String(hour).padStart(2, '0')}:00 local time`);
}

module.exports = { start };
