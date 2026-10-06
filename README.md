# RYDJA — Clear the way.

The app behind getrydja.com. Takes local property-services jobs: customer sends photos →
you price it → they approve → it becomes a job → you log costs and salvage →
you see what you actually made.

Nothing speculative is in here. No marketplace, no bidding, no dispatch, no
analytics. One owner-operator, real jobs, real money.

## First run

Requires Node 22.5+. SQLite comes from Node itself (`node:sqlite`), so there is
nothing to compile. Four dependencies: express, ejs, multer, cookie-session.

**1. Install**

```bash
npm install
```

**2. Create your `.env`**

```bash
cp .env.example .env
```

**3. Set the two required secrets.** The app refuses to start without them —
there are no defaults, because a default is how an app ends up live with a
password of `changeme`.

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then edit `.env`:

```
ADMIN_PASSWORD=<your own password, 12+ characters, not a placeholder>
SESSION_SECRET=<paste the 64-character string from the command above>
```

**4. Start it**

```bash
npm run dev     # local, auto-restarts on edits, reads .env
npm start       # production, reads real environment variables
```

If a secret is missing, too short, or still a placeholder, the app prints
exactly what is wrong and exits. It never prints the values themselves.

**5. Open it**

| | |
|---|---|
| Public site | <http://localhost:3000> |
| Quote form | <http://localhost:3000/quote> |
| Admin sign-in | <http://localhost:3000/admin/login> |
| Lead inbox | <http://localhost:3000/admin/leads> |
| Job board | <http://localhost:3000/admin/jobs> |

Customers never sign in. Each request gets a private link at `/q/<token>` —
that page is where they see the price and approve it. After you send a quote,
**text them that link**; it is on the lead page in your admin.

## Where your data lives

| What | Path | Configurable with |
|---|---|---|
| Database | `./data/app.db` | `DB_PATH` |
| Photos | `./uploads/` | `UPLOAD_DIR` |
| Backups | `./backups/` | `BACKUP_DIR` |

All three are gitignored. **Those two directories are the entire business** —
every lead, every job, every photo. Nothing is stored anywhere else.

## Backing up

```bash
npm run backup
```

Writes `backups/<timestamp>/` containing `app.db` plus every photo, and prints
what it captured.

The database is snapshotted with SQLite's `VACUUM INTO`, not a plain file copy.
That matters: the database runs in WAL mode, so recent leads can still be
sitting in `app.db-wal`, and copying `app.db` by itself would silently miss
them. `VACUUM INTO` always writes one consistent file you can restore from.

To restore, stop the server and copy the backup's `app.db` to `data/app.db` and
the backup's `uploads/` contents into `uploads/`.

A backup also runs automatically every day at 03:00 local time (set
`BACKUP_HOUR`, or `BACKUP_DAILY=0` to turn it off). It checks every 15 minutes
whether the day's run has happened, so a restart never skips a day.

**A backup on the same disk as the original is not a backup.** Set the
`BACKUP_S3_*` variables and each run also uploads one `.tar.gz` to object
storage — Cloudflare R2's free tier covers this entirely. Setup and the full
restore procedure are in [DEPLOY.md](DEPLOY.md).

## The flow

| Step | Where |
|---|---|
| Customer browses | `/` and `/services` |
| Customer sends job + photos | `/quote` |
| Lead lands in your inbox | `/admin/leads` |
| You review photos, type a price | `/admin/leads/:id` |
| Customer approves or declines | `/q/:token` (their private link) |
| Approved quote becomes a job | automatic, assigned to the owner operator |
| You work the job | `/admin/jobs` → `/admin/jobs/:id` |
| Mark scheduled / in progress / complete | job page |
| Log expenses, dump fees, salvage, before/after photos | job page |
| See net contribution | job page + job board totals |

After you send a quote, **text the customer their `/q/...` link**. That page is
how they see the price and approve it. There is no email or SMS sending in V1 —
you send the link yourself.

## Profit math

```
customer revenue
- expenses          (includes the dump/disposal fee)
+ realized salvage  (only what actually sold)
= net contribution
```

Estimated salvage value is tracked but deliberately **not** counted in net until
you record what the item really sold for. Unsold estimates show as a separate
"pending" line so an optimistic guess never inflates a job's numbers.

## Files

```
server.js            every route (public, customer, admin)
db.js                SQLite connection + owner-operator seed
schema.sql           the whole data model
security.js          rate limiting + bot filtering
backup.js            snapshot the database and photos
schedule-backup.js   runs the daily backup in-process
s3.js                signed upload to S3-compatible storage
tar.js               minimal tar writer for the backup archive
views/               EJS templates
public/              styles.css
uploads/             photos (gitignored)
data/                app.db (gitignored)
backups/             snapshots (gitignored)
```

## Configuration

All in `.env` — see `.env.example`. `BRAND_NAME` is used everywhere the business
name appears, so renaming the company later is a one-line change.

Setting `NODE_ENV=production` turns on secure cookies and proxy trust together;
you should not need to set either by hand.

## What protects what

- **Admin pages** — password from `ADMIN_PASSWORD`, compared in constant time,
  session in a signed `httpOnly` cookie. There is no account system and no
  password reset; the password *is* the authentication.
- **Customer pages** — the `/q/<token>` URL is the credential. Tokens are 128
  bits from `crypto.randomBytes`, so they cannot be guessed or walked
  sequentially, and the page shows a token-derived reference rather than the
  internal row id.
- **Photos** — stored under random 32-character hex names, validated by their
  actual file signature (not the browser-supplied content type), and served
  with `nosniff` and a sandbox CSP so a stored file can never execute.
- **Uploads directory** — no directory listing, no dotfiles, no traversal.

## Deploying

See **[DEPLOY.md](DEPLOY.md)** — host comparison, step-by-step setup, DNS and
HTTPS, every environment variable, off-site backups and the restore procedure.

Short version: Render Starter with a 1 GB persistent disk, about $8/month.
Point `DB_PATH` and `UPLOAD_DIR` at the disk, set `NODE_ENV=production`, and
configure the `BACKUP_S3_*` variables so backups leave the machine.

## Deliberately not built

Contractor marketplace, bidding, AI pricing, automated dispatch, routing,
analytics dashboards, resale-channel integrations, inventory/warehouse,
customer logins, payments, SMS/email automation, reviews.

The data model leaves room for the first one: every job already carries an
`operator_id` pointing at an `operators` row, and operators have a `role`
(`owner` / `contractor`). Adding a second operator later is a new row and an
assignment dropdown — not a rewrite.

Payments in V1 are however you already take them: cash, check, Venmo, a card
reader. Add Stripe when a customer actually refuses to pay another way.
