# Deploying Property Services V1

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
git remote add origin https://github.com/<you>/property-services-v1.git
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
| `BRAND_NAME` | your business name | |
| `BUSINESS_PHONE` | your number | Shown to customers |
| `OWNER_NAME` | your name | The operator record |
| `TZ` | e.g. `America/Detroit` | So job times read correctly |

Leave `SECURE_COOKIES` and `TRUST_PROXY` unset — `NODE_ENV=production` sets
both correctly for Render.

### 5. Deploy

**Manual Deploy** → **Deploy latest commit**. Watch the log for:

```
<BRAND> running on http://localhost:10000  (admin: /admin/login)
[config] secure cookies: on | trust proxy: 1 | off-site backup: ...
[backup] daily backup scheduled for 03:00 local time
```

If it says *"Refusing to start"*, a secret is missing or too weak — the log
names which one. It never prints the value.

Visit `https://<your-service>.onrender.com` and sign in at `/admin/login`.

---

## DNS and HTTPS

Render issues and renews certificates automatically. There is no certbot step.

1. Render → your service → **Settings** → **Custom Domains** → add
   `yourbusiness.com` and `www.yourbusiness.com`.
2. Render shows the records to create. At your registrar (Namecheap, GoDaddy,
   Cloudflare):

| Type | Name | Value |
|---|---|---|
| `A` | `@` | the IP Render shows |
| `CNAME` | `www` | `<your-service>.onrender.com` |

3. Wait for propagation (usually minutes, up to 48h). Render verifies the
   domain, then issues the certificate and redirects HTTP → HTTPS on its own.

**If you use Cloudflare**, set the records to **DNS only** (grey cloud) until
Render verifies, then switch to proxied if you want. Set Cloudflare SSL mode to
**Full (strict)** — "Flexible" would make Cloudflare talk to Render over plain
HTTP and break the secure cookie.

Confirm when done:

```bash
curl -sI https://yourbusiness.com | head -1       # expect 200
curl -sI http://yourbusiness.com | grep -i location  # expect https:// redirect
```

---

## Off-site backups

The app writes a local snapshot daily at 03:00 and, if configured, uploads a
single `.tar.gz` to object storage. **A backup on the same disk as the original
is not a backup** — configure the off-site half.

### Cloudflare R2 (recommended: 10 GB free, no egress fees)

1. Cloudflare dashboard → **R2** → **Create bucket**, name it
   `property-services-backups`.
2. **Manage R2 API Tokens** → **Create API Token** → permission **Object Read &
   Write**, scoped to that bucket. Copy the Access Key ID and Secret.
3. Note your endpoint: `https://<account-id>.r2.cloudflarestorage.com`
4. Add to Render's environment:

| Variable | Value |
|---|---|
| `BACKUP_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `property-services-backups` |
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

Expect `offsite  property-services-backups/2026-10-06_03-00-00.tar.gz`.

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

`PORT` (host sets it), `BRAND_NAME`, `BUSINESS_PHONE`, `OWNER_NAME`,
`OWNER_PHONE`, `OWNER_EMAIL`, `BACKUP_DAILY`, `BACKUP_HOUR`,
`BACKUP_KEEP_LOCAL`, `BACKUP_S3_*`.

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
| Honeypot field | Hidden decoy; filled = silently discarded |
| Submit timing | Signed timestamp; under 3 seconds = discarded |

Rejected spam gets a success-looking redirect so bots do not retune and retry.
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
