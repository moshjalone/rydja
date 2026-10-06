# Property Services V1

A working app for taking local property-services jobs: customer sends photos →
you price it → they approve → it becomes a job → you log costs and salvage →
you see what you actually made.

Nothing speculative is in here. No marketplace, no bidding, no dispatch, no
analytics. One owner-operator, real jobs, real money.

## Run it

```bash
npm install
cp .env.example .env     # then edit .env — at minimum change ADMIN_PASSWORD
npm run dev              # http://localhost:3000
```

`npm start` for production (reads real environment variables instead of `.env`).

Requires Node 22.5+. SQLite comes from Node itself (`node:sqlite`), so there is
nothing to compile. Four dependencies total: express, ejs, multer, cookie-session.

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
server.js      every route (public, customer, admin)
db.js          SQLite connection + owner-operator seed
schema.sql     the whole data model
views/         EJS templates
public/        styles.css
uploads/       photos (gitignored)
data/          app.db (gitignored)
```

## Configuration

All in `.env` — see `.env.example`. The two that matter before you go live:

- `ADMIN_PASSWORD` — the only thing protecting your admin pages
- `SESSION_SECRET` — any long random string

`BRAND_NAME` is used everywhere the business name appears, so renaming the
company later is a one-line change.

## Deploying

Any host that runs Node and gives you a persistent disk (Fly.io, Render,
Railway, a VPS). Point `DB_PATH` and `UPLOAD_DIR` at that disk — if they land on
ephemeral storage you lose your leads and photos on the next deploy.

Back up by copying `data/app.db` and the `uploads/` folder. That is the whole
business.

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
