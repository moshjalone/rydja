# RYDJA — Organic Acquisition: Diagnosis and 30-Day Plan

**Written:** 2026-10-20
**Scope:** why a live site is producing no leads, what was wrong, what has been
built, and what has to be done by a person with a login.

---

## 0. The one-paragraph answer

The website is not the problem. It is technically sound — nineteen indexable
pages, correct canonicals, valid structured data, a static sitemap that
validates, hard-coded privacy on every customer page, HTTPS with `www` and
`http` both redirecting to the apex, brotli compression, a 7.5 KB homepage over
the wire, and 436 passing tests. Nothing in the audit below found a broken
page, a mis-set canonical, a `noindex` leak or a crawl blocker.

**The problem is that nothing was measured and nothing was verified.** There
was no Google Search Console property, so nobody could see whether a single
page was indexed or what anybody searched for. There was no visitor
measurement, so "no leads" could not be told apart from "no visitors" — and
those have opposite fixes. And the site answered the query *"junk removal"*
well and the query *"junk removal lowell mi"* only incidentally, which is the
query that actually exists.

Everything in sections 3–7 is now built and tested. Section 8 is the part that
cannot be built: four account-level tasks behind logins, each of which is worth
more than any further change to the pages.

---

## 1. Prioritised diagnosis

Ranked by how likely each is to produce a real customer conversation, not by
how easy it is to fix.

### P0 — Nothing can see whether the site is indexed

| | |
|---|---|
| **Finding** | No `google-site-verification` tag was served, anywhere. No Search Console property existed. |
| **Why it matters** | Search Console is the *only* source of indexing status, impressions, queries and crawl errors. Without it, every decision about the site is a guess, and "we are not ranking" cannot be distinguished from "we are not indexed" or "nobody searches for that". |
| **Evidence** | `curl -s https://getrydja.com/ \| grep -i verification` → nothing. No verification file in `public/`. No mention of Search Console anywhere in the repo. |
| **Status** | **Mechanism built.** `GOOGLE_SITE_VERIFICATION` renders the tag on indexable pages only, validates the token, and refuses to boot if one of the app's own secrets is pasted in. **Verification itself is owner-performed** — see §8.1. |

> **An indexing claim is not made anywhere in this document.** It cannot be. A
> page returning 200, a sitemap that validates and a passing `noindex` test are
> all necessary and none is evidence of indexing. The closest first-party
> evidence available is the new crawler log, which can prove Googlebot
> *fetched* a page — and a crawl is still not an index.

### P0 — No measurement, so the bottleneck was unknown

| | |
|---|---|
| **Finding** | No analytics of any kind. Lead *source* was recorded (`attribution.js`, first-party, good), but nothing counted visits, quote-button clicks, form starts or call taps. |
| **Why it matters** | The two explanations for zero leads need opposite months of work. Nobody arriving → Business Profile, local content, partners. Everybody arriving and leaving → headlines, form, first screen. Spending a month on the wrong one is the single most expensive mistake available. |
| **Evidence** | `DEPLOY.md` §Tracking, as written, audited the site as having no analytics. Confirmed: the only script served is the site's own `app.js`. |
| **Status** | **Built.** `analytics.js` + `/api/event` + `/admin/traffic`. First-party, no cookie, no IP stored, no user-agent stored, day-rotating visitor key. Page views from the browser; submissions counted server-side. §3. |

### P1 — The Business Profile is the lead channel, and the site was not feeding it

| | |
|---|---|
| **Finding** | The Google Business Profile is live, claimed, 5.0-rated, with the correct name, category, phone and website, and no public address (`business-listing-tracker.csv`, audited 2026-10-08). `GOOGLE_REVIEW_URL` is configured locally. **Needs confirming on the production host.** |
| **Why it matters** | For junk removal and cleanouts, the local pack and Maps are where this work is found — ahead of the organic ten blue links, usually well ahead. Review count and recency are among the strongest signals there, and the completed-job page is the only place RYDJA ever asks. |
| **Evidence** | Tracker row 1. Review link verified signed-out to the correct Place ID on 2026-10-08. Local `.env` has `GOOGLE_REVIEW_URL` set; the production value cannot be read from here. |
| **Status** | **Owner action.** §8.2 and §8.3. No code change needed — the review link already renders on a completed job when configured. |

### P1 — The high-intent local queries had no page to land on

| | |
|---|---|
| **Finding** | `/service-area` listed ten communities and explicitly declined to build city pages. A test asserted `/lowell` and `/junk-removal-stanton` would 404. |
| **Why it matters** | "junk removal lowell mi" is a different query from "junk removal", with different intent and far less competition. The honest answer to it is a page about doing this work in Lowell. |
| **The tension** | The original reasoning — a page per town with the name swapped is a doorway page — was correct and is not overturned. |
| **Status** | **Built, narrowly.** Exactly two pages, for the two cities the business leads with, each with substance specific to its place, and a written rule plus a mechanical overlap test governing whether there is ever a third. §4. |

### P2 — Mobile intake was good and had two cheap gaps

| | |
|---|---|
| **Finding** | The quote form had already been trimmed in an earlier pass: photos moved up under the description, address and scheduling collapsed into `<details>`, one hidden anti-bot field and no decoy. Genuinely good. Missing: `autocomplete` attributes on the four fields a phone already knows, and the validation error was visible but not announced. |
| **Why it matters** | Autofill removes most of the typing from a form somebody is filling in standing in a garage. It is one attribute per field. |
| **Status** | **Built.** §5. |

### P2 — No system for the lead source worth the most

| | |
|---|---|
| **Finding** | Nothing recorded partners, referrals or outreach. `business-listing-master.md` and the tracker covered *directory listings*, which is a different thing. |
| **Why it matters** | Estate and whole-property cleanouts are the highest-value work and are almost never found by the person who needs them. They are handed over by an estate-sale company, a Realtor, a property manager, a probate attorney or a storage facility. That source costs nothing per lead and compounds. |
| **Status** | **Built.** `partners.js` + `/admin/partners`, with per-partner referral links so the question "which partner actually produced paying work" is answerable. §6. |

### P3 — Documentation had gone stale in a way that mattered

| | |
|---|---|
| **Finding** | `DEPLOY.md` claimed "Public pages set **no cookies at all**" — untrue since `ps_attr` was introduced; and "no analytics", which this work changes. The Local SEO section described six service pages when there were eight. |
| **Why it matters** | A stale privacy claim in the deployment record is how a *public* privacy claim goes stale next. |
| **Status** | **Fixed.** `DEPLOY.md` and `/privacy` both corrected. §7. |

### Checked and found correct — no action

Worth recording so nobody spends a day re-auditing these.

| Area | Finding |
|---|---|
| `robots.txt` | Allows everything, points at the sitemap, no `Disallow` advertising `/admin`. Correct posture |
| `sitemap.xml` | Static file, valid XML, no BOM, LF only, `application/xml; charset=utf-8`, every URL 200 |
| Canonicals | Absolute `https://getrydja.com` on every public page; `/x/` 301s to `/x`; `www` and `http` both 301 to the apex |
| Metadata | Unique title and description on every public page; full Open Graph and Twitter card set |
| Structured data | Valid `HomeAndConstructionBusiness` with `@id`, `areaServed`, real opening hours, offer catalog with no invented prices. No fabricated address, rating or credential |
| Private pages | `/q/<token>` and all of `/admin` carry `noindex,nofollow`, no canonical, no Open Graph, and are absent from the sitemap. Three independent locks stop IndexNow submitting them |
| Page speed | Homepage 28 KB raw / **7.5 KB brotli**; stylesheet 52 KB raw / 15 KB brotli; one 5 KB script, deferred; content-hashed `?v=` on every asset with immutable caching; images WebP with declared dimensions and `loading="lazy"` |
| Mobile | Viewport set, sticky call/text/quote bar below 860px, admin nav reachable on a phone, 44px+ touch targets |
| Quote submission | Verified end to end against a live server: lead written, photos stored, business notified, no private token in the notification, nothing personal in the log |
| IndexNow | Correctly implemented and correctly documented as **not reaching Google** |

---

## 2. What a crawl is, and what it is not

A short section because this is the single easiest thing to get wrong when
reporting on SEO work.

- `/admin/traffic` now records **crawler fetches**: which named bot, which
  path, what status code, when. That is first-party evidence that Googlebot
  reached a page and what it got back.
- It is **not** evidence that the page is indexed, and the admin page says so
  in those words, next to the numbers.
- What it is genuinely good for is ruling something out. If Googlebot has never
  fetched anything, the problem is reachability or verification and no amount
  of content work will fix it. If Googlebot fetched `/estate-cleanouts` and got
  a 200 and the page still is not ranking, the problem is somewhere else
  entirely.

---

## 3. Phase 2 — Measurement (built)

First-party, no third party contacted, no cookie, disclosed on `/privacy`.

| Thing | Where |
|---|---|
| The module, and the reasoning | `analytics.js` |
| The endpoint | `POST /api/event` — six allowed event names, rate limited, 204 with no body, identical answer for an accepted and a refused event |
| The page script | the last block of `public/app.js` — runs only where the server rendered `data-track` on `<body>`, honours `DNT`, no `localStorage`, no cookie, two fields |
| The reporting | `/admin/traffic` (7 / 30 / 90 days) and a four-figure summary on the dashboard |
| The tests | `test/analytics.test.js` (25) |

**Measured:** landing-page visits, traffic source, quote-button clicks, form
starts, photos attached, completed submissions, call taps, text taps, and the
funnel conversion between each.

**Not stored, and asserted against the database:** no IP address, no
user-agent string, no cookie for measurement, nothing typed into the form, no
referring page beyond its host, and nothing joinable to a person. A visitor is
counted with `HMAC(secret + calendar-day, ip + ua)` truncated to 16 hex
characters — one-way, and because the day is *inside* the salt, the same
visitor tomorrow is an unrelated value. Returning visitors are therefore not
countable. That is the deliberate cost.

**Page views come from the browser, not the server.** A server counts every
request and most requests to a small site are robots; counting those would
inflate the one number being read, and inflate it towards "we have traffic".
The bottom of the funnel — `quote_submit` — is counted server-side when the
lead row is written, so the figure that matters is exact and cannot be forged
from a browser. A test asserts a browser cannot report it.

### The diagnostic this exists for

| `/admin/traffic` says | The bottleneck is | Where the month goes |
|---|---|---|
| Visitors ≈ 0 | Nobody is arriving | Business Profile, local content, partners |
| Visitors fine, quote buttons ≈ 0 | The offer is not landing | Headlines, first screen, CTA wording |
| Buttons fine, forms started ≈ 0 | The form is frightening people | Fields, length, what it asks and when |
| Forms started, requests ≈ 0 | The form is failing | Validation, errors, photo upload on a real phone |

---

## 4. Phase 3 — Local SEO (built)

Two city pages, and a rule.

```
/junk-removal-lowell-mi     Lowell, Kent County
/junk-removal-stanton-mi    Stanton, Montcalm County
```

Both are in the sitemap, linked from `/service-area` and from the footer of
every page, carry `Service` + `BreadcrumbList` + `FAQPage` structured data, and
run to roughly 1,000 and 1,100 words of substance about those specific places.

**Why these two and not twelve.** Each had to earn it, against a rule written
at the top of `content/local-pages.js`: the city must be one
`SERVICE_AREA_PLACES` actually names (a page is a coverage claim); somebody
must be able to say what is *different* about the work there; and it must not
repeat another city page's sentences. `test/local-pages.test.js` measures
authored-prose overlap between the pages and fails above 10%.
`test/local-seo.test.js` additionally fails if `/lowell`,
`/junk-removal-belding-mi`, `/cleanouts-lowell-mi` or any other plausible
generated slug stops returning 404.

**What makes them genuinely different** — this is the test of whether a city
page deserves to exist:

| | Lowell | Stanton |
|---|---|---|
| County | Kent | Montcalm |
| Shape of the work | Splits in two: tight older houses in town where the problem is the stairs, and acreage outside it where the problem is the volume | Mostly whole properties. The county's probate court is in Stanton, so the people who most need this are executors |
| The drive | Shortest on the map, which is why a single-item pickup makes sense here | Far end, in another county — a small job out there may honestly not be worth it, and the page says so |
| What to photograph | The way out of the basement | The outbuildings, first, because they decide the load count |
| The local hazard | Riverside basements after water; we clear, we do not remediate | Asbestos barn roofs, farm chemical drums, two-stroke fuel in a boathouse |

**Nothing fabricated.** Every geographic claim is something a resident could
check — which county, which rivers meet there, which towns are next door, where
the county courthouse is. No invented landmark, no disposal facility named, no
population figure, no price, no rating, no review count, no response-time
promise, no licence or insurance claim, no street address. A test asserts each
of those absences on both pages.

**The owner's residential address appears nowhere**, as before. `RYDJA LLC` is
named; the registered address, the EIN and any SSN are not, and tests assert
it.

---

## 5. Phase 4 — Conversion (built, on top of good existing work)

The quote form had already been shortened in an earlier pass. What was added:

- `autocomplete` on name, phone, email and ZIP, plus `street-address`,
  `address-level1/2` in the collapsed address block; `inputmode` and
  `autocapitalize` where they help. One tap fills the top of the form.
- `role="alert"` on the validation error, so a screen reader is told why the
  form came back instead of the reader having to go looking.
- Measurement through the whole funnel, so the next conversion change is made
  against a number rather than a hunch.

**Unchanged on purpose:** the signed form stamp (the entire bot filter), the
hazard acknowledgement, and the photo upload. Spam protection and the ability
to price a job were both explicitly not to be traded away, and the photo is the
one field that most decides whether a job can be priced at all.

**Phone, text and photos stay the most visible options.** The sticky mobile bar
carries Call / Text / Get Quote as three separate links — `tel:` and `sms:` are
different schemes and both are linked, because a tel: link labelled "text"
would be a small lie. `/quote` offers "Rather talk?" above the first field.

**The whole workflow was tested end to end**, safely, against a throwaway
database and a local mail stub that reaches no network:
`test/workflow-end-to-end.test.js` walks one job in order — form with two
photographs → business notified once → nothing private in the log → lead in the
inbox flagged as estate work → quote with a proposed time → customer approves
and confirms in one click → double-click produces no second job → job started,
costed, salvaged, completed → the job page and the dashboard agree on the
profit to the cent → the reference never changed → and the website's funnel
recorded exactly one submission.

---

## 6. Phase 5 — The organic lead engine (built)

`partners.js` and `/admin/partners`. 25 tests in `test/partners.test.js`.

**Eleven kinds of partner, each with a stated reason**, because a partner kind
nobody can justify does not belong on the list: estate-sale companies,
Realtors, property managers, self-storage facilities, probate attorneys,
auctioneers, senior-move managers, contractors, cleaning services, donation
centres, other.

**Per-partner referral links.** Each partner gets a five-character code and a
link — `https://getrydja.com/?ref=K7M2Q` — which opens the homepage exactly as
normal. Every quote request that follows is credited to them, and their page
shows leads, approvals and approved value. This is the point: an outreach
system that cannot tell you which partner produced paying work is a to-do
list.

A `?ref=` code overrides a stored visit — the single exception to first-touch
attribution, because a partner handing over a card is a deliberate act by a
third party rather than an inference from a header. Partner leads are their own
row on the dashboard, never folded into "Referral".

**What it does not do, and the tests assert the absence:**

- **It sends nothing.** No mail, no queue, no scheduler, no "sequence", and no
  send button. It drafts a message and the owner edits it and sends it himself,
  to one person, from his own mailbox. Unsolicited bulk commercial email is
  regulated; a sending reputation does not come back; and a message nobody read
  before it went out is the one that embarrasses a local business in a market
  where everybody knows everybody.
- **It scrapes nothing.** Every partner is entered by hand from somewhere
  public and meant to be read — a business's own site, its own public listing,
  a trade association's published member directory, a county or state register.
  `source_url` records where.
- **The drafts claim nothing unverified.** A test runs every one of the eleven
  and fails on "licensed", "insured", "same day", "guaranteed", a price, a
  rating or a deadline tactic. Each one offers an opt-out in the first message
  and states plainly that RYDJA does not buy or appraise contents.

`/admin/partners` carries the authorised discovery sources, and the list of
things that are not on it: buying a lead list, scraping a directory, using
somebody's contact form to pitch them, or sending one message to thirty
businesses.

---

## 7. Changes made, as a list

| File | Change |
|---|---|
| `analytics.js` | **New.** First-party measurement: events, crawler log, reporting queries |
| `partners.js` | **New.** Referral partners, touches, referral codes, outreach drafts |
| `content/local-pages.js` | **New.** The two city pages, plus the rule for a third and a guard on escaped fields |
| `views/local-page.ejs` | **New.** One layout for a city page |
| `views/admin/traffic.ejs` | **New.** Traffic and funnel |
| `views/admin/partners.ejs`, `views/admin/partner.ejs` | **New.** The referral engine's admin |
| `server.js` | `GOOGLE_SITE_VERIFICATION`; `PUBLIC_PATHS`; crawler middleware; `/api/event`; `quote_submit`; `/admin/traffic`; the two city routes with their JSON-LD; five partner routes; `cleanDateNear`; partner code overriding a stale visit; `partner` in `SOURCE_ORDER` |
| `attribution.js` | `?ref=` capture, `referral_code` on leads, `partner` source bucket and label |
| `db.js` | `leads.referral_code` + index, additive and not backfilled |
| `public/app.js` | The measurement block — the fourth script on the site |
| `public/styles.css` | Traffic page, partner pages, admin nav wrapping to five sections |
| `views/partials/head.ejs` | Verification tag, `data-track` on `<body>`, Traffic and Partners in both navs |
| `views/quote.ejs` | `autocomplete` / `inputmode` / `autocapitalize`, `role="alert"` on the error |
| `views/service-area.ejs`, `views/partials/foot.ejs` | Links to the city pages, filtered by the configured area |
| `views/legal/privacy.ejs` | The measurement disclosure, in plain words |
| `public/sitemap.xml` | The two city pages |
| `DEPLOY.md` | Search Console setup, Measurement, Referral partners; the stale "no cookies / no analytics" claim corrected; six service pages → eight |
| `test/` | Four new suites — `analytics`, `local-pages`, `partners`, `workflow-end-to-end`. Existing suites updated where behaviour deliberately changed |

**Tests: 436 passing, 0 failing** (from 356 before this work).

Four existing tests were deliberately changed rather than worked around, each
because the behaviour it asserted was intentionally replaced:

1. `legal.test.js` — the privacy policy's "no analytics, no advertising pixels"
   is now asserted as "no **third-party** analytics", because the site does
   count its own visits and denying it would be a false public claim. A second
   test was added asserting the new disclosure.
2. `local-seo.test.js` — "no thin city pages were generated" became "the only
   city pages are the two that earned one", which still catches what the
   original was built to catch.
3. `admin-mobile-nav.test.js` — the admin has five sections now, not three.
4. `conversion.test.js` — two assertions were order-sensitive about HTML
   attributes that gained a neighbour.

---

## 8. Account-level setup — owner only

**None of this can be done from the repository.** Every item is behind a login,
and every one is worth more than any further change to the pages. In priority
order.

### 8.1 — Google Search Console (30 minutes, do first)

Full steps in `DEPLOY.md` → **Google Search Console**. The short version:

1. `search.google.com/search-console` → Add property → **URL prefix** →
   `https://getrydja.com`
2. Verification method **HTML tag** → copy the `content` token
3. Render → Environment → `GOOGLE_SITE_VERIFICATION` = that token → redeploy
4. `curl -s https://getrydja.com/ | grep google-site-verification` to confirm
5. Press **Verify**
6. Sitemaps → submit `sitemap.xml`
7. URL Inspection → **Request Indexing** on `/`, `/estate-cleanouts`,
   `/junk-removal-lowell-mi`, `/junk-removal-stanton-mi`, `/quote`

Then record, in `business-listing-master.md`, the date it verified and what
each URL Inspection actually said. That is the first real indexing evidence
this business will have.

Also worth the ten minutes: **Bing Webmaster Tools**, imported from the Search
Console property. IndexNow already pings Bing on deploy, but nothing reports
back without the property.

### 8.2 — Confirm `GOOGLE_REVIEW_URL` is set in production

It is set locally; the production value cannot be read from here. Check Render →
Environment. It is the single highest-leverage variable on the service: without
it, a completed job offers no review link, and review count is one of the
strongest signals in the local pack where this work is actually found.

### 8.3 — Business Profile work, weekly

The profile is live, claimed and 5.0-rated. What it is not is *maximised*:

| Task | Why |
|---|---|
| Ask every completed customer for a review | The completed-job page already offers the link, the same for everyone, with no incentive and no filtering by how happy they seem. The ask is the owner's |
| Add the services list to the profile | Use the canonical names from `business-listing-master.md` §4, so the profile and the site agree |
| Add photographs | Real work, the truck, the owner. The approved set and its rules are in `image-asset-manifest.csv` |
| Post weekly | A finished job, with the customer's agreement. One or two sentences |
| Answer the Q&A yourself | Pre-empt "do you take appliances", "do you do estates", "how is it priced" |
| Finish the service-area refinement | `SERVICE_AREA_REFINEMENT_PENDING` in the tracker. The statewide claim is already gone, which was the important part |

### 8.4 — Finish the waiting directory listings

`business-listing-tracker.csv` has Bing Places, Apple Business Connect and
others at `WAITING_FOR_OWNER`, all blocked on a sign-in. Hours are now known
and canonical (`business-listing-master.md` §7), so the field that used to
block them no longer does.

---

## 9. The 30-day plan

Measurable, free, no paid advertising, no purchased leads.

### Baseline to record on day 1

Before anything changes, write these down. Without them nothing below is
measurable.

| Measure | Where |
|---|---|
| Indexed page count | Search Console → Pages |
| Impressions, clicks, average position | Search Console → Performance (expect near-zero) |
| Google review count and rating | The Business Profile |
| Visitors, funnel, call/text taps | `/admin/traffic`, 30 days |
| Leads, quotes, approvals, completed jobs | `/admin/dashboard` |
| Partners on the list | `/admin/partners` — zero |

### Week 1 — Make it visible and make it countable

| Day | Task | Done when |
|---|---|---|
| 1 | Deploy this work. Set `GOOGLE_SITE_VERIFICATION`. Confirm `GOOGLE_REVIEW_URL` is set in production | `curl` shows the tag; a test deploy serves both city pages |
| 1 | `npm run indexnow` after the deploy | Output shows the two city pages as CHANGED and submitted |
| 2 | Verify Search Console. Submit the sitemap | Property verified; sitemap shows a discovered-URL count |
| 2 | Request Indexing on the five money pages | Five requests submitted |
| 3 | Bing Webmaster Tools, imported from Search Console | Property live |
| 3 | Business Profile: services list, 10+ photographs, Q&A answered | Profile shows all three |
| 4–5 | Ask every past customer who was happy for a Google review — by text, individually, with the link | **Target: +3 reviews** |
| 6–7 | Add the first 10 partners you already know by name: the auctioneer, the cleaner, the Realtor, the storage place | 10 rows in `/admin/partners`, each with a source recorded |

**Week 1 is the week that matters most.** Everything after it compounds off
verification, reviews and the first partner conversations.

### Week 2 — Outreach, by hand

| Task | Target |
|---|---|
| Read, edit and send the first-contact draft to the 10 partners from week 1 — individually, from your own mailbox, one a day or two | 10 sent, 10 logged as touches |
| Add 10 more partners from the authorised sources listed on `/admin/partners` | 20 on the list |
| Business Profile post: one finished job | 1 post |
| Keep asking for reviews on every completed job | **+2** |
| Read Search Console → Pages | Record the indexed count. It is the first real answer |

### Week 3 — Follow up, and let the data pick the next move

| Task | Target |
|---|---|
| Follow up the partners who have not replied — once, by a different channel, then stop | Every open partner has a logged follow-up |
| Read `/admin/traffic` over 14 days and use the table in §3 to pick the bottleneck | One named bottleneck, written down |
| Read Search Console → Queries | The real keyword list. It will not match anybody's guess |
| Act on the bottleneck, and only on it | One change, one reason |
| Add 10 more partners | 30 on the list |
| Reviews | **+2** |

### Week 4 — Measure against the baseline, then decide

| Task | Target |
|---|---|
| Fill in the scorecard below | Complete |
| Business Profile post | 1 |
| Reviews | **+2** |
| Decide on a third city page — only if §4's three rules are all satisfiable | A yes with a written reason, or a no |
| Write the next 30 days from what the numbers said, not from this document | Plan |

### The 30-day scorecard

| Measure | Day 1 | Day 30 | Target |
|---|---|---|---|
| Pages indexed (Search Console) | | | 15+ of 19 |
| Search impressions, 28 days | | | > 0, trending up |
| Google reviews | | | **+8 or more** |
| Website visitors, 30 days | | | > 0 and measurable |
| Quote-button clicks | | | — record it |
| Quote requests sent | | | **+1 or more from organic** |
| Call / text taps | | | — record it |
| Partners on the list | 0 | | **30** |
| Partners contacted | 0 | | **20** |
| Partners in conversation | 0 | | **5** |
| Leads from a partner link | 0 | | **1 or more** |

### What success actually looks like at 30 days

Not "we rank for junk removal". Realistically, in a month, on a site with no
history:

1. **Indexed and reporting.** Search Console verified, the sitemap read, most
   pages indexed, and real impression and query data arriving. This is the
   deliverable that unlocks every month after it.
2. **More reviews than competitors got that month.** Eight new reviews on a
   5.0 profile moves the local pack in a small market in a way nothing on the
   website can.
3. **Measurement in place, and a named bottleneck.** The difference between
   "we have no leads" and "forty people came, nine clicked the quote button,
   one started the form" is the difference between guessing and working.
4. **Five real partner conversations.** One estate-sale company that remembers
   your name is worth more than a month of blog posts, and it does not reset
   next month.

### Specifically *not* in this plan

- Paid advertising of any kind, including Local Services Ads
- Buying leads from Angi, Thumbtack, HomeAdvisor, Networx or anyone else
- A blog nobody will read, written for a crawler
- More city pages (the two earned it; a third has to as well)
- Review incentives, review gating, or asking only the customers who seem happy
- Anything that fabricates a review, a credential, a location, a response time
  or a price

---

## 10. Honest limits of this report

- **No page is claimed to be indexed.** No evidence available from here could
  support that claim. §8.1 is how the evidence gets collected.
- **The production environment cannot be read from here.** `GOOGLE_REVIEW_URL`
  and `INDEXNOW_KEY` are set in the local `.env`; whether they are set on
  Render has to be checked in Render.
- **Business Profile state rests on the 2026-10-08 audit** in
  `business-listing-tracker.csv`, which records honestly that the signed-out
  Maps view does not expose the service-area list and that part rests on the
  owner's confirmation.
- **The crawler log is empty until the deploy ships.** It records what happens
  from the moment it is live; it cannot say anything about the past.
- **Keyword guesses are guesses.** The service pages and city pages target
  phrases a careful person would expect. Search Console → Queries in week 2 is
  the first factual answer, and it should be allowed to overrule all of it.
- **The two city pages' local facts are checkable, not verified by a visit.**
  County, confluence, county seat, adjacent towns. If anything in them is wrong
  about Lowell or Stanton, a resident will know immediately — and that is the
  right test for a page like this.
