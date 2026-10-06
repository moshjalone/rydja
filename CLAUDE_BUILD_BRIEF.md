# Build Brief — Local Property Services + Recovery Marketplace

## Mission

Build a production-ready local property-services platform that initially operates as an owner-operated business but is architected from day one to become a multi-operator marketplace.

The owner is Operator #1.

The platform's differentiated economic model is:

1. Customer pays to have a physical property problem handled.
2. Operator performs the work.
3. Removed material is classified into:
   - dispose
   - recycle
   - donate
   - scrap
   - recover/resell
4. Recoverable inventory can flow into premium resale channels including Hitlyst and external marketplaces such as eBay and Facebook Marketplace.
5. Once local demand exceeds owner capacity, approved operators can claim or be assigned jobs for a defined payout while the platform keeps its fee.

Do NOT build a generic junk-removal brochure site. Build the foundation of a service marketplace with operational economics and a recovery engine.

## V1 Business Scope

Launch locally with:
- junk/trash removal
- garage/basement/barn cleanouts
- storage unit cleanouts
- estate cleanouts
- rental/property turnovers
- yard/brush/storm cleanup
- furniture/appliance removal
- scrap pickup
- moving and delivery help
- light demolition
- other physical property/labor jobs

Do not accept hazardous waste, asbestos, biohazards, unknown chemical drums, regulated medical waste, or similar high-risk material in V1.

## User Roles

### Customer
- submits quote request
- uploads photos
- chooses desired timing
- sees quote
- accepts/declines
- schedules
- pays
- receives status notifications
- sees completion evidence
- rates job

### Owner/Admin
- receives leads
- reviews uploaded photos
- creates quote
- applies optional salvage credit
- schedules job
- assigns operator
- records expenses
- records disposal
- captures before/after photos
- intakes salvage
- sees job-level P&L
- sees pipeline metrics

### Operator
V1 may only have owner account, but implement role/data model now.
Later:
- sees eligible jobs
- sees payout before accepting
- accepts/declines
- navigation/contact workflow
- before/during/after photos
- expense/disposal upload
- completion workflow
- payout status
- reliability score

## Critical Architecture Rule

Every Job has `operator_id` from day one.

Owner-operated job:
operator_id = owner's operator record.

Later contractor marketplace:
operator_id = independent operator.

Do not hard-code the business logic around a single worker.

## Lead Flow

1. Customer chooses service.
2. Provides:
   - name
   - phone
   - email
   - address or ZIP
   - description
   - access conditions
   - timing
   - heavy-item indicator
   - stairs indicator
   - hazardous-material confirmation
   - photos
3. Create lead with status NEW.
4. Notify admin.
5. Admin reviews lead.
6. Admin creates quote.
7. Quote can include:
   - base removal/service price
   - optional salvage credit
   - notes
   - expiration
8. Customer accepts.
9. Collect payment method / deposit per configured policy.
10. Create job.
11. Assign operator.
12. Complete service.
13. Record economics.
14. Request review.

## Job Economics

Persist:
- customer total
- operator payout
- platform fee
- disposal fees
- dump weight
- dump volume
- mileage
- fuel
- helpers
- supplies
- labor duration
- recovered item estimated value
- recovered item realized value
- channel fees
- net job contribution

We want enough data to later train/implement pricing recommendations.

## Recovery / Salvage Module

Each recovered item should support:
- source job
- photos
- title
- category
- disposition
- estimated resale
- actual resale
- acquisition cost / credit allocation
- storage location
- SKU
- condition
- target channel
- listing URL
- sold date
- net proceeds

Possible dispositions:
- KEEP_LIST
- BULK_SELL
- SCRAP
- DONATE
- RECYCLE
- DISPOSE
- RETURN_TO_CUSTOMER
- HOLD_RESEARCH

Future integrations:
- Hitlyst
- eBay
- Facebook Marketplace
- specialty resale channels

## Safety / Ownership Controls

Quote/customer agreement needs explicit language that:
- only designated property is removed
- customer confirms authority to dispose of/transfer designated property
- once transferred, operator/company may dispose, recycle, donate, retain, refurbish, scrap, or resell it unless otherwise agreed
- excluded/personal items must be identified before removal
- special handling flow for personal documents, IDs, family photos, medication, firearms/weapons, financial records, suspected stolen goods, hazardous materials

Do not generate definitive legal language without attorney review. Implement configurable agreement text.

## Recommended Production Stack

- Next.js App Router
- TypeScript
- Tailwind
- PostgreSQL
- Prisma
- Auth provider with roles
- Stripe
- Stripe Connect later for operator payouts
- S3/R2 for images
- SMS provider
- transactional email
- maps/geocoding
- background queue
- audit/event log

## Pages

Public:
- /
- /services
- /services/[slug]
- /quote
- /quote/[leadId]
- /job/[publicToken]
- /about
- /service-area
- /terms
- /privacy

Admin:
- /admin
- /admin/leads
- /admin/leads/[id]
- /admin/jobs
- /admin/jobs/[id]
- /admin/recovery
- /admin/recovery/[id]
- /admin/operators
- /admin/customers
- /admin/reports

Operator:
- /pro
- /pro/jobs
- /pro/jobs/[id]
- /pro/earnings
- /pro/profile

## Status Enums

Lead:
NEW
NEEDS_INFO
READY_TO_QUOTE
QUOTED
ACCEPTED
DECLINED
EXPIRED
CONVERTED

Job:
UNSCHEDULED
SCHEDULED
ASSIGNED
EN_ROUTE
IN_PROGRESS
COMPLETION_REVIEW
COMPLETE
CANCELLED

Salvage:
INTAKE
RESEARCH
READY_TO_LIST
LISTED
SOLD
DONATED
SCRAPPED
RECYCLED
DISPOSED
RETURNED

## Build Order

1. Initialize production app.
2. Implement DB schema/migrations.
3. Implement auth and roles.
4. Build public landing page.
5. Build quote form + multi-photo upload.
6. Persist lead.
7. Admin lead inbox.
8. Admin lead detail.
9. Quote builder.
10. Customer quote acceptance.
11. Job conversion.
12. Job board.
13. Owner operator account.
14. Job completion + before/after photos.
15. Expense/disposal logging.
16. Recovery intake.
17. Job P&L.
18. SMS/email notifications.
19. Payment flow.
20. Deploy.
21. Run real jobs before adding marketplace complexity.
22. Add contractor onboarding/claiming only after owner workflow proves stable.

## Design Direction

Do not make it look like a generic junk-removal site full of clip-art trucks.

Desired feel:
- modern
- practical
- trustworthy
- slightly industrial
- premium but approachable
- strong typography
- neutral colors with one high-visibility accent
- large customer photo-upload CTA
- mobile-first because leads and operators will use phones heavily

Working brand should remain configurable via constants/environment/config, because final company name is not selected.

## V1 Success Criteria

The platform is successful when:
1. A real customer can submit a job from their phone.
2. Admin receives it with photos.
3. Admin can quote it quickly.
4. Customer can approve.
5. Job appears in operator workflow.
6. Owner completes job.
7. Expenses/disposal/recovery are captured.
8. System computes job-level economics.
9. Customer receives completion and review request.
10. The next operator can be added without changing the Job data model.
