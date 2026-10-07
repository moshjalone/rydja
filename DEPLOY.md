# Deploying RYDJA

**Recommendation: Render, Starter plan, with a persistent disk. About $8/month
all in.** Reasoning is at the bottom; the steps below are for that path.

Nothing here deploys automatically. Every step is something you run or click.

---

## What this app needs from a host

| Need | Why it rules hosts out |
|---|---|
| Always-on Node process | Serverless (Vercel, Netlify, Lambda) cannot hold a SQLite file or a local photo folder. Rules them out entirely. |
| A persistent disk | The database and the photos are files. A host with ephemeral storage loses every lead on each deploy. |
| Exactly one instance | SQLite allows one writer. Never scale this app past 1 instance. |
| Automatic HTTPS | Your admin password crosses the network on every login. |
| Environment variables | Secrets must not live in the repo. |

**You do not need PostgreSQL.** SQLite on a persistent disk handles this
workload with enormous headroom — a busy local operator might write a few
hundred rows a month against a database that can serve tens of thousands of
reads per second. Migrating to Postgres would add a managed-database bill, a
connection string to rotate, and a second thing to back up, in exchange for
nothing you need. Revisit only if you ever run more than one app instance.

---

## Option comparison

| Host | Monthly | HTTPS | Disk | Verdict |
|---|---|---|---|---|
| **Render Starter** | **$7 + ~$0.25/GB** | automatic, free | yes, survives deploys | **Recommended** |
| Fly.io | ~$5–7 | automatic | volumes | Cheaper, but machine/volume lifecycle is fiddlier |
| Railway | ~$5+ usage | automatic | volumes | Fine; usage billing is less predictable |
| Hetzner / DO VPS | $4–6 | you set up certbot | yes | Cheapest, but you own OS patching, nginx, renewals |
| Vercel / Netlify | — | — | **no** | Cannot run this app |

A VPS is genuinely cheaper. It is not simpler: you become responsible for
security updates, nginx, systemd and certificate renewal forever. Render is
~$3/month more to never think about any of that.

---

## Deployment steps (Render)

### 1. Put the code on GitHub

```bash
git remote add origin https://github.com/<you>/rydja.git
git push -u origin main
```

`.gitignore` already excludes `.env`, the database, uploads and backups.
Verify nothing sensitive is staged before pushing:

```bash
git ls-files | grep -E '\.env$|\.db$' && echo "STOP — secrets staged" || echo "clean"
```

### 2. Create the web service

1. Render dashboard → **New** → **Web Service** → connect the repo.
2. Settings:
   - **Runtime**: Node
   - **Build command**: `npm ci`
   - **Start command**: `npm start`
   - **Instance type**: Starter ($7/mo — the free tier has no persistent disk
     and sleeps, so it will not work)
   - **Region**: closest to your customers
3. **Do not deploy yet** — add the disk and variables first.

### 3. Add the persistent disk

Service → **Disks** → **Add Disk**:

- **Name**: `data`
- **Mount path**: `/var/data`
- **Size**: 1 GB (about $0.25/mo; enough for ~10,000 photos)

Everything that matters lives here. Without it, your leads vanish on the next
deploy.

### 4. Set environment variables

Service → **Environment**. Generate the secrets locally first:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ADMIN_PASSWORD=' + require('crypto').randomBytes(12).toString('base64url'))"
```

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Turns on secure cookies and proxy trust |
| `ADMIN_PASSWORD` | *(generated)* | 12+ chars. App refuses to start otherwise |
| `SESSION_SECRET` | *(generated)* | 64 hex chars |
| `DB_PATH` | `/var/data/app.db` | **Must** be on the disk |
| `UPLOAD_DIR` | `/var/data/uploads` | **Must** be on the disk |
| `BACKUP_DIR` | `/var/data/backups` | |
| `BRAND_NAME` | `RYDJA` | |
| `BRAND_TAGLINE` | `Clear the way.` | |
| `SITE_URL` | `https://getrydja.com` | Canonical / link-preview URLs |
| `BUSINESS_PHONE` | your number | Shown to customers |
| `OWNER_NAME` | your name | The operator record |
| `TZ` | e.g. `America/Detroit` | So job times read correctly |

Leave `SECURE_COOKIES` and `TRUST_PROXY` unset — `NODE_ENV=production` sets
both correctly for Render.

### 5. Deploy

**Manual Deploy** → **Deploy latest commit**. Watch the log for:

```
RYDJA running on http://localhost:10000  (admin: /admin/login)
[config] secure cookies: on | trust proxy: 1 | off-site backup: ...
[backup] daily backup scheduled for 03:00 local time
```

If it says *"Refusing to start"*, a secret is missing or too weak — the log
names which one. It never prints the value.

Visit `https://rydja.onrender.com` and sign in at `/admin/login`.

---

## DNS and HTTPS

Render issues and renews certificates automatically. There is no certbot step.

1. Render → your service → **Settings** → **Custom Domains** → add
   `getrydja.com` and `www.getrydja.com`.
2. Render shows the records to create. At your registrar (Namecheap, GoDaddy,
   Cloudflare):

| Type | Name | Value |
|---|---|---|
| `A` | `@` | the IP Render shows |
| `CNAME` | `www` | `rydja.onrender.com` |

3. Wait for propagation (usually minutes, up to 48h). Render verifies the
   domain, then issues the certificate and redirects HTTP → HTTPS on its own.

**If you use Cloudflare**, set the records to **DNS only** (grey cloud) until
Render verifies, then switch to proxied if you want. Set Cloudflare SSL mode to
**Full (strict)** — "Flexible" would make Cloudflare talk to Render over plain
HTTP and break the secure cookie.

Confirm when done:

```bash
curl -sI https://getrydja.com | head -1       # expect 200
curl -sI http://getrydja.com | grep -i location  # expect https:// redirect
```

---

## Off-site backups

The app writes a local snapshot daily at 03:00 and, if configured, uploads a
single `.tar.gz` to object storage. **A backup on the same disk as the original
is not a backup** — configure the off-site half.

### Cloudflare R2 (recommended: 10 GB free, no egress fees)

1. Cloudflare dashboard → **R2** → **Create bucket**, name it
   `rydja-backups`.
2. **Manage R2 API Tokens** → **Create API Token** → permission **Object Read &
   Write**, scoped to that bucket. Copy the Access Key ID and Secret.
3. Note your endpoint: `https://<account-id>.r2.cloudflarestorage.com`
4. Add to Render's environment:

| Variable | Value |
|---|---|
| `BACKUP_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `rydja-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` | *(from step 2)* |
| `BACKUP_S3_SECRET_ACCESS_KEY` | *(from step 2)* |
| `BACKUP_S3_REGION` | `auto` |

Backblaze B2, Wasabi, DigitalOcean Spaces and AWS S3 all work the same way —
set the matching endpoint and region.

After the next deploy the startup line should read
`off-site backup: configured`. Force one immediately from Render's **Shell**:

```bash
npm run backup
```

Expect `offsite  rydja-backups/2026-10-06_03-00-00.tar.gz`.

### Backup tuning

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DAILY` | on | `0` disables the scheduler |
| `BACKUP_HOUR` | `3` | Local hour to run (0–23) |
| `BACKUP_KEEP_LOCAL` | `7` | Local snapshots kept before pruning |

The scheduler checks every 15 minutes whether today's backup has run, so a
restart or a missed window does not skip a day. A failure is logged and retried
rather than marked done.

**Check it weekly for the first month.** A backup you have never seen succeed
is not a backup.

---

## Customer email (Resend)

When the owner sends or revises a quote, the customer gets an email with the
amount, any notes, and a button to their private `/q/<token>` page where they
approve or decline. Optional: leave it unconfigured and the app behaves exactly
as it did before — the quote saves and the owner texts the link by hand.

1. Make a Resend account and verify the sending domain (`getrydja.com`).
2. Create an API key.
3. Set both variables on the service and redeploy.

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` from Resend |
| `EMAIL_FROM` | `RYDJA <quotes@getrydja.com>` — must be on the verified domain |

`SITE_URL` must be correct too: the link in the email is `SITE_URL` + `/q/<token>`.

**Email never blocks a quote.** The quote is committed before anything is sent,
so a missing key, a provider outage or a bad address cannot lose it. When
delivery fails the lead page says so, and the log says why:

```
[mail] quote email sent for lead #12
[mail] lead #13 has no email on file — nothing sent
[mail] quote email FAILED for lead #14 (http_422) — text the customer instead
```

The reason is a fixed code — `http_<status>`, `timeout`, `network_error`,
`not_configured`, `no_email`. No address, name, phone or quote token is ever
logged, and the provider's response body is never printed, because a bounce
message repeats the recipient address back at you.

No SMS, no queue, no retries. If an email fails, text the customer.

---

## Work references and scheduling

Every request is given a permanent reference the moment it arrives — `RYDJA-7K4M2Q`.
It is public, it is what gets read out over the phone, and it never changes: the
job a customer approves keeps the reference their request was given, all the way
to completion. Jobs reach it through `lead_id` rather than storing a copy, so a
job and its lead can never end up with different references.

**It is not a password.** `/q/<token>` remains the only customer capability URL;
the reference on its own opens nothing. Sequential `lead.id` / `job.id` are never
shown to a customer.

At intake the customer may say when they'd like you — up to two preferred
dates with a time window, a "flexible" flag and a note. All optional; a lead is
never refused over them, and a date that cannot be real (free text, Feb 31st,
last year, five years out) is dropped rather than argued about. They are shown
on the lead page as **Customer availability**, next to the quote form.

**A preference is not a booking.** Nothing the customer types at intake can
reach `jobs.scheduled_for`. Only a time the owner proposed, and the customer
then confirmed, ever fills it.

Preferred dates are bare `YYYY-MM-DD` in local business time, stored exactly as
picked — the same way `scheduled_for` is wall clock. There is no timezone
conversion anywhere in scheduling, deliberately: a date rendered through UTC
prints as the previous day for anyone west of Greenwich.

Scheduling is a proposal the customer answers:

```
job created          status = unscheduled
owner proposes       status = schedule_pending   proposed_for set, scheduled_for still NULL
customer accepts     status = scheduled          scheduled_for = proposed_for
customer asks again  status = schedule_pending   scheduled_for stays NULL, message saved
```

A job is never "scheduled" because the owner suggested a time. Only acceptance
books it. A new proposal replaces the open one, clears the change request, and
emails again. There is no calendar, no slot picker and no reminders.

### Quote and appointment in one answer

A quote can carry a proposed appointment (`quotes.proposed_for`, optional). When
it does, the customer's page offers one button for both — **Approve quote &
confirm time** — and the job is created already scheduled. They can instead
approve and ask for a different time, which creates the job `schedule_pending`
with their message attached and `scheduled_for` still NULL. A quote sent without
a time behaves exactly as it always has: approve, and the job arrives
`unscheduled` for the owner to propose a time later.

The approval is one transaction, and the "is this quote still open?" check lives
inside it, so a double-tapped Approve cannot produce two jobs. A unique index on
`jobs(quote_id)` is the backstop: one quote, one job, enforced by the database
rather than by remembering to check.

The quote email adapts — `Your quote from RYDJA — $450.00` with no time
attached, `Quote & proposed appointment from RYDJA — RYDJA-7K4M2Q` with one.

The proposal email needs the same `RESEND_API_KEY` / `EMAIL_FROM` as quotes, and
like them it cannot cost you the proposal: if it is unconfigured, has no address
to send to, or the provider refuses, the proposed time is already saved and the
job page tells the owner to contact the customer and send the link by hand.

Logs carry the work reference and a fixed event code, never a token, a customer
or what the customer wrote:

```
[lead] new lead #12 RYDJA-7K4M2Q — Garage / basement cleanout — 3 photo(s)
[mail] schedule proposal sent for RYDJA-7K4M2Q
[schedule] RYDJA-7K4M2Q change requested by customer
[schedule] RYDJA-7K4M2Q confirmed by customer
[job] RYDJA-7K4M2Q quote scheduled by customer
[question] RYDJA-7K4M2Q asked a question
```

A scheduling note, a change request and a customer's question are all their own
words and stay out of the log entirely — the owner reads them in the admin.

### Upgrading an existing deployment

Nothing to do. `migrate()` in `db.js` runs on boot: it adds `leads.work_ref`,
the four `jobs.schedule_*` columns, the six `leads` preference columns and
`quotes.proposed_for` if they are missing, assigns a reference to every lead
that has none, and creates the unique indexes. It is additive and
idempotent — tokens, quotes, jobs, photos, expenses and salvage rows are never
touched, existing bookmarks keep working, and a second boot is a no-op. Take a
backup first anyway (`npm run backup`); that advice never changes.

---

## Search engines and sharing

The public surface is three pages: `/`, `/services` and `/quote`. Everything
else -- the customer's own `/q/<token>` page and the whole admin -- carries
`noindex,nofollow`, has no canonical and no Open Graph tags, and is kept out of
the sitemap. A private link pasted into a chat app will not unfurl into a
preview card.

| URL | What it is |
|---|---|
| `/robots.txt` | Allows the public site, disallows `/admin`, `/q/` and `/quote/sent`, points at the sitemap |
| `/sitemap.xml` | The three public pages, absolute `https://getrydja.com` URLs |
| `/og-image.jpg` | 1200x630 share card, 39KB |
| JSON-LD on `/` | `HomeAndConstructionBusiness`: name, url, phone, description, areaServed, logo |

**The structured data claims only what we actually know.** No street address,
no opening hours, no price range, no ratings, no reviews, no social profiles --
a knowledge panel that is wrong in public is worse than none, and a test
asserts those fields stay absent. Add them when they are real.

`SITE_URL` is what every canonical and Open Graph URL is built from, so a
request arriving on `www.` still canonicalises to the apex and cannot create a
duplicate. Set it correctly or the whole thing points at the wrong host.

`SERVICE_AREA` and `SERVICE_AREA_PLACES` drive the service-area section, the
meta descriptions and `areaServed` together, so the page and the markup cannot
drift apart.

### Icons

`favicon.ico` (16/32/48), `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` and
`site.webmanifest`. The mark is a lime R on a charcoal tile: the stacked
wordmark and the truck silhouette both turn to mush at 16px, and a single bold
letter does not. Around 25KB for the set.

They were drawn once in a browser canvas and committed; there is no build step
and no image dependency. To change the mark, redraw and recommit the files.

---

## Restore procedure

Tested end to end: database, photos, job P&L and customer links all survive.

### From an off-site archive

```bash
# 1. Download the archive you want (Cloudflare R2 dashboard, or rclone/aws cli)

# 2. Extract it
tar -xzf 2026-10-06_03-00-00.tar.gz
# -> 2026-10-06_03-00-00/app.db
# -> 2026-10-06_03-00-00/uploads/<photos>

# 3. Stop the app (Render: Settings -> Suspend Service)

# 4. Put the files back (paths as set in your env vars)
cp 2026-10-06_03-00-00/app.db        /var/data/app.db
cp 2026-10-06_03-00-00/uploads/*     /var/data/uploads/

# 5. Remove stale write-ahead files, or SQLite may replay over the restore
rm -f /var/data/app.db-wal /var/data/app.db-shm

# 6. Resume the service
```

### From a local snapshot

Same, using `backups/<timestamp>/` on the disk instead of a downloaded archive.

### Verify the restore

```bash
node -e "const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync(process.env.DB_PATH,{readOnly:true});
console.log(d.prepare('select (select count(*) from leads) leads,(select count(*) from jobs) jobs').get());"
```

Then open a job in `/admin/jobs` and confirm its photos load.

**Practise this once before you need it.** Restore the newest archive onto your
laptop and start the app against it — twenty minutes now, versus learning the
procedure during an outage.

---

## Complete environment variable reference

### Required

| Variable | Notes |
|---|---|
| `ADMIN_PASSWORD` | 12+ chars, not a placeholder. App exits without it |
| `SESSION_SECRET` | 32+ chars of randomness. App exits without it |

### Production

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` — enables secure cookies + proxy trust |
| `DB_PATH` | absolute path on the persistent disk |
| `UPLOAD_DIR` | absolute path on the persistent disk |
| `BACKUP_DIR` | absolute path on the persistent disk |
| `TZ` | your local timezone |

### Optional

`PORT` (host sets it), `BRAND_NAME`, `BRAND_TAGLINE`, `SITE_URL`, `BUSINESS_PHONE`, `OWNER_NAME`,
`OWNER_PHONE`, `OWNER_EMAIL`, `BACKUP_DAILY`, `BACKUP_HOUR`,
`BACKUP_KEEP_LOCAL`, `BACKUP_S3_*`.

Customer email — set both or neither:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_...`. Unset means no email is sent; quotes still save |
| `EMAIL_FROM` | Sender on a domain verified in Resend |

### Escape hatches — leave unset unless something is broken

| Variable | When |
|---|---|
| `SECURE_COOKIES=0` | Only if TLS terminates where the app cannot see it and you are locked out of `/admin` |
| `TRUST_PROXY` | Only if your host uses more than one proxy hop |

---

## Abuse protection in place

| Control | Limit |
|---|---|
| Admin login | 10 attempts per IP per 15 min, then 429 |
| Quote form | 5 submissions per IP per hour |
| Form stamp | Signed timestamp; forged, missing or over 6 hours old = rejected |

That is the whole bot filter. Two other controls were tried and removed, both
after they rejected real paying customers:

* **a minimum fill time.** A signed stamp proves the form came from this server;
  it cannot prove a human was slow. Autofill and a fast typist submit in well
  under a second.
* **a honeypot field.** A decoy input is invisible to a person but not to a
  browser or a password manager, which filled it in and got the customer
  refused without either of them ever seeing the field.

No CAPTCHA and no third-party service. If spam ever becomes a real problem,
tighten the rate limit first — it is the control that cannot misfire on a human.

A rejected submission is never shown the confirmation page — only a request that
was actually written reaches `/quote/sent`. Each rejection logs one line naming
the reason and nothing else:

```
[spam] rejected submission from 198.51.100.7 (bad)
[spam] rejected submission from 198.51.100.8 (expired)
```

`bad` is a forged or missing stamp; `expired` is a form left open over six hours.
A burst of `expired` is normal. A burst of `bad` from one address is a bot.

Counters are in memory, which is exact for a single instance — **another reason
never to scale this past 1**.

Ten bad logins locks you out for 15 minutes too. Use a password manager.

---

## Monthly cost

| Item | Cost |
|---|---|
| Render Starter | $7.00 |
| 1 GB persistent disk | ~$0.25 |
| Cloudflare R2 backups | $0.00 (under 10 GB) |
| Domain | ~$1.00 (≈$12/year) |
| **Total** | **≈ $8.25/month** |

One completed job pays for roughly six years of hosting.

---

## Pre-launch checklist

- [ ] `ADMIN_PASSWORD` and `SESSION_SECRET` set in the host, not in the repo
- [ ] `DB_PATH`, `UPLOAD_DIR`, `BACKUP_DIR` all point at the persistent disk
- [ ] `NODE_ENV=production`; startup log shows `secure cookies: on`
- [ ] Custom domain resolves over HTTPS, HTTP redirects
- [ ] `TZ` set so job times read correctly
- [ ] Startup log shows `off-site backup: configured`
- [ ] `npm run backup` run manually once and the archive seen in the bucket
- [ ] Restore practised onto a laptop at least once
- [ ] Submitted a real test quote from your phone end to end
- [ ] Instance count is **1**

---

## Why Render is the recommendation

For a one-person local services business, the scarce resource is your attention,
not $3 a month.

**Render fits because:**

1. **The disk survives deploys.** Point `DB_PATH` and `UPLOAD_DIR` at `/var/data`
   and SQLite keeps working exactly as it does on your laptop. No database
   migration, no second service, no connection string.
2. **HTTPS is handled.** Certificates are issued and renewed automatically. On a
   VPS that is certbot, a cron renewal, and an outage the day it silently fails.
3. **Nothing to administer.** No OS patching, no nginx, no systemd. The failure
   mode of a self-managed VPS is not a crash — it is an unpatched box you
   stopped thinking about six months ago.
4. **Deploys are a git push**, and the dashboard gives you a shell for
   `npm run backup` and restores without SSH keys.
5. **It stays out of the way at this size.** One instance, one disk, no
   autoscaling to misconfigure — which matches SQLite's one-writer rule exactly.

**Choose differently if:** you already run a VPS comfortably (Hetzner at
~$4/month is cheaper and you own the stack), or you are already on Fly for
something else.

**Do not choose:** Vercel, Netlify, or any serverless platform. They cannot keep
a SQLite file or a photo folder between requests, and adapting the app to them
means a managed database plus object storage — more moving parts and more cost
than the whole Render bill.
