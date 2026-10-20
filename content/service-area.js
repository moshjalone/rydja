'use strict';

// Where RYDJA works, as one record.
//
// This file is the only place a place name is decided. The page copy, the
// footer, the meta descriptions, the structured data's areaServed and the
// county list all read from it, so they cannot drift and nobody has to
// remember to edit three files.
//
// ------------------------------------------------------------ the correction
//
// The site used to claim "West Michigan" as its primary territory, on all
// nineteen pages and in all eight service page titles. Twenty-eight days of
// Search Console told us exactly what that bought:
//
//   rydja                        25 impressions   brand; people who knew us
//   brush removal mancelona mi    8               Antrim County, 150 miles north
//   junk removal, various        23 on /junk-removal, 0 clicks, positions 62-100,
//                                 for Novi, Portage, West Branch, West Bloomfield
//
// West Michigan holds about two million people: Grand Rapids, Holland,
// Muskegon, Kalamazoo. Portage IS West Michigan, so that impression was a
// correct match against a wrongly stated territory -- and because nothing
// bounded the claim more tightly, the rest were guesses.
//
// The territory is now stated as what it is: a business based in the Lowell
// and Vergennes Township part of Kent County, working outward through Ada,
// Rockford, Greenville and Ionia, and reaching Stanton and Baldwin for work
// that justifies the drive. "West Michigan" still appears in prose, because
// it is true and people say it. It is no longer the targeting strategy.
//
// -------------------------------------------------------------- privacy rule
//
// RYDJA is a service-area business. The owner's operating address is
// residential and appears NOWHERE: not in this file, not in a comment, not in
// page copy, not in structured data, not in a commit message. The nearest this
// file goes is naming Lowell and Vergennes Township as the area worked from,
// which is a township of several thousand people and is already public on the
// Google Business Profile.

// ---------------------------------------------------------------- the tiers
//
// A tier is a MARKETING priority, not a boundary. Nothing here says where a
// job will be accepted: a whole-property estate cleanout four counties away
// can easily be worth the trip, and the service-area page says so in as many
// words. What a tier decides is which names lead the copy.

/** Worked constantly. These lead the headings and the first paragraph. */
const CORE = 'core';

/** Regularly, and named wherever there is room. */
const NEARBY = 'nearby';

/** Reached for work that justifies the drive. Named, never hidden. */
const EXTENDED = 'extended';

const TIERS = [
  { value: CORE, label: 'Where we work most', blurb: 'Our own patch. Normal-sized jobs here are straightforward.' },
  { value: NEARBY, label: 'Nearby, regularly', blurb: 'A short run out. Everything we do, we do here.' },
  {
    value: EXTENDED,
    label: 'Further out, for the right job',
    blurb:
      'Genuinely served, and the arithmetic depends on the size of the load rather than on the mileage. A whole ' +
      'property is usually worth the trip; a single chair may not be.'
  }
];

// ---------------------------------------------------------------- the places
//
// Eighteen, matching what the owner has set on the Google Business Profile.
// Nine were already live there; nine more were submitted on 2026-10-20 and are
// PENDING GOOGLE REVIEW at the time of writing -- see `pending` below. The
// website may describe them because they are places RYDJA genuinely serves;
// what nobody may claim is that Google has approved them.
//
// Counties are recorded per place rather than guessed, because the county list
// is derived from this one and a wrong county would publish a wrong boundary.

const PLACES = [
  // ---- core: the base and the four markets worked outward from it
  {
    name: 'Lowell',
    county: 'Kent',
    tier: CORE,
    // The anchor. Titles and headings say "near Lowell" because this is where
    // the truck starts, which is the honest reason a Lowell job is the easiest
    // one we price.
    anchor: true
  },
  { name: 'Ada Township', county: 'Kent', tier: CORE, short: 'Ada' },
  { name: 'Rockford', county: 'Kent', tier: CORE },
  { name: 'Greenville', county: 'Montcalm', tier: CORE, pending: true },
  { name: 'Ionia', county: 'Ionia', tier: CORE },
  { name: 'Vergennes Township', county: 'Kent', tier: CORE, pending: true, short: 'Vergennes' },
  { name: 'Grattan Township', county: 'Kent', tier: CORE, pending: true, short: 'Grattan' },

  // ---- nearby
  { name: 'Alto', county: 'Kent', tier: NEARBY },
  { name: 'Cascade Township', county: 'Kent', tier: NEARBY, pending: true },
  { name: 'Forest Hills', county: 'Kent', tier: NEARBY, pending: true,
    // Not a municipality: it is the Forest Hills school-district area, spanning
    // parts of Ada, Cascade and Grand Rapids townships. Kept because people
    // genuinely call the area that and search for it, but it OVERLAPS Ada
    // Township and Cascade Township -- which is a duplicate-area question for
    // the Business Profile, not for this site.
    note: 'An area name rather than a municipality; overlaps Ada and Cascade townships.' },
  { name: 'Cannonsburg', county: 'Kent', tier: NEARBY, pending: true,
    note: 'An unincorporated community inside Cannon Township.' },
  { name: 'Cannon Township', county: 'Kent', tier: NEARBY, pending: true },
  { name: 'Belmont', county: 'Kent', tier: NEARBY, pending: true,
    // Submitted to Google as "Belmont / Plainfield Township". Stored as the
    // place people say, with the township recorded rather than slashed into
    // the name: a schema.org Place called "Belmont / Plainfield Township" is
    // one name for two things.
    township: 'Plainfield Township',
    note: 'An unincorporated community inside Plainfield Township.' },
  { name: 'Saranac', county: 'Ionia', tier: NEARBY, pending: true },
  { name: 'Belding', county: 'Ionia', tier: NEARBY },
  { name: 'Grand Rapids', county: 'Kent', tier: NEARBY },

  // ---- extended: preserved coverage, explicitly protected
  //
  // Both of these carry `protect: true`. Stanton has a landing page, its own
  // content, its own structured data, a sitemap entry and internal links, and
  // none of that is to be undone. Baldwin is the owner's own coverage claim.
  // The guard below restores either if a configuration override drops it.
  {
    name: 'Stanton',
    county: 'Montcalm',
    tier: EXTENDED,
    protect: true,
    anchor: true,
    note: 'County seat of Montcalm County; the county probate court sits there, which is why estate work leads that page.'
  },
  {
    name: 'Baldwin',
    county: 'Lake',
    tier: EXTENDED,
    protect: true,
    note: 'The furthest point served, and the owner\'s own coverage claim.'
  }
];

// ---------------------------------------------------------------- derived
//
// Everything below is computed from PLACES. Adding a place to the list is the
// whole of adding it to the site.

const byTier = (tier) => PLACES.filter((p) => p.tier === tier);

/** "Lowell, Michigan" — the shape schema.org areaServed wants. */
const qualified = (place) => place.name + ', Michigan';

/** Just the names, in list order. */
const names = (places = PLACES) => places.map((p) => p.name);

/**
 * The name a sentence uses.
 *
 * "Ada Township" is correct on a map and nobody says it out loud; prose wants
 * "Ada". Where a place needs a different spoken form it carries `short`, and
 * everything that writes a sentence reads that instead.
 */
const spoken = (place) => place.short || place.name;
const spokenNames = (places = PLACES) => places.map(spoken);

/** The counties the places actually sit in, each once, in first-seen order. */
const COUNTIES = [...new Set(PLACES.map((p) => p.county))];

/** "Kent, Ionia, Montcalm and Lake" */
function joinNames(list, conjunction = 'and') {
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return list.slice(0, -1).join(', ') + ' ' + conjunction + ' ' + list[list.length - 1];
}

/**
 * The town a heading names.
 *
 * One town, not a list. The previous attempt put four into every heading,
 * which reads like a directory entry rather than a sentence, and the brief is
 * explicit that eighteen must not be stuffed into a title. Lowell is the base,
 * so "near Lowell" is both the shortest true thing to say and the most useful.
 */
const ANCHOR = (PLACES.find((p) => p.anchor && p.tier === CORE) || PLACES[0]).name;

/**
 * The coverage sentence, used in the footer and wherever prose needs it.
 *
 * Names the core markets and then says "and surrounding communities", which is
 * true, readable, and does not attempt eighteen nouns in one breath.
 */
// The five core markets, as people say them. Townships are worked from and
// named in the body copy; a sentence does not want seven nouns.
const LEAD_PLACES = spokenNames(byTier(CORE)).filter((n) => !/^(Vergennes|Grattan)$/.test(n));

// Stanton is named in the sentence itself, not left to configuration. Its
// coverage is preserved and that preservation should be visible on the page,
// not merely true in a list somewhere.
// "surrounding communities" is the last item in the list rather than a clause
// bolted on after it, or the sentence reads "... Ionia and Stanton and
// surrounding communities" with two conjunctions in a row.
const SENTENCE =
  joinNames([...LEAD_PLACES, 'Stanton', 'surrounding communities']) +
  ' in ' +
  joinNames(COUNTIES) +
  ' counties';

/** A short form for places where the full sentence will not fit. */
const SHORT_SENTENCE = joinNames(LEAD_PLACES);

// ---------------------------------------------------------------- guards
//
// Two, and both are warnings rather than refusals.
//
// The brief asks for two things that pull against each other: a configuration
// change must not be able to drop Stanton or Baldwin by accident, and the app
// must not fail when the service area is legitimately reconfigured. A throw
// satisfies the first and breaks the second.
//
// So a protected place that goes missing from an override is RESTORED, with a
// loud log line. Coverage cannot be lost by editing an environment variable,
// and nothing stops booting. Deliberately dropping one means editing this
// file, which is a commit somebody reviews.

/** Places that must survive any override. */
const PROTECTED = PLACES.filter((p) => p.protect).map((p) => p.name);

/**
 * Apply an override list, restoring anything protected that it left out.
 *
 * @param {string[]|null} override  qualified names, e.g. ['Lowell, Michigan']
 * @param {Function} warn           where to report a restoration
 */
function resolvePlaces(override, warn = console.warn) {
  if (!override || !override.length) return PLACES.map(qualified);

  const kept = override.slice();
  const lower = kept.map((p) => p.toLowerCase());

  for (const name of PROTECTED) {
    const wanted = name + ', Michigan';
    if (!lower.some((p) => p.startsWith(name.toLowerCase()))) {
      kept.push(wanted);
      warn(
        `[service-area] ${name} was missing from SERVICE_AREA_PLACES and has been restored. ` +
          'It is protected coverage — to drop it, edit content/service-area.js.'
      );
    }
  }
  return kept;
}

// Nothing in this file may name a street address. The rule is asserted by a
// test over the whole repository, but checking the one file most likely to
// acquire one costs nothing and fails fast.
(function noStreetAddress() {
  const text = JSON.stringify(PLACES) + SENTENCE;
  if (/\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane)\b/.test(text)) {
    throw new Error('content/service-area.js must never contain a street address');
  }
})();

module.exports = {
  CORE,
  NEARBY,
  EXTENDED,
  TIERS,
  PLACES,
  COUNTIES,
  PROTECTED,
  ANCHOR,
  SENTENCE,
  SHORT_SENTENCE,
  byTier,
  names,
  spoken,
  spokenNames,
  LEAD_PLACES,
  qualified,
  joinNames,
  resolvePlaces,
  /** Places whose Business Profile entry is still awaiting Google's review. */
  pending: () => PLACES.filter((p) => p.pending).map((p) => p.name)
};
