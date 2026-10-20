'use strict';

// The two local pages: Lowell and Stanton.
//
// -------------------------------------------------------------- why only two
//
// /service-area used to carry a comment saying there were deliberately no
// per-city pages, because "a page per town with the same copy and the name
// swapped is a doorway page, and it would read like one to a visitor as much
// as to a crawler". That reasoning was right and it still is. Nothing here
// overturns it.
//
// What has changed is narrower: somebody in Lowell looking for this work types
// "junk removal lowell mi", and the honest answer to that query is a page
// about doing this work in Lowell -- not a statewide page with Lowell in a
// bulleted list of ten communities. So there are exactly two pages, for the
// two places the business actually leads with, and each one had to earn its
// existence by having something true and specific to say.
//
// --------------------------------------------------------- the rule for more
//
// A third page is allowed only when all of these hold:
//
//   1. It is a place RYDJA has committed to on the Google Business Profile,
//      recorded in business-listing-master.md §6. A page is a coverage claim.
//   2. Somebody can name what is *different* about doing this work there --
//      the housing stock, the county, the drive, the disposal, the kind of
//      property. If the only difference is the name, there is no page.
//   3. It does not repeat another local page's sentences. There is a test
//      that measures the overlap between these pages and fails when they
//      start converging, which is the mechanical version of the same rule.
//
// Failing any of those, the place belongs in the /service-area list, where it
// already is, and nowhere else.
//
// ------------------------------------------------------------- what is true
//
// Every geographic claim below is something a resident would recognise and
// could check: which county a city is in, which rivers meet there, which
// highways run through it, which towns are next door. Nothing invents a
// landmark, a disposal facility, a licence, a review, a price or a response
// time, and nothing claims a job RYDJA has not actually done. The two pages
// describe the same business honestly in two different places; they do not
// describe two different businesses.

const PAGES = [
  // ------------------------------------------------------------------ Lowell
  //
  // Kent County, and the closer of the two to Grand Rapids. The work here
  // divides cleanly along one line that is a real feature of the place: in
  // town it is older, tighter houses with awkward basements and narrow
  // driveways, and outside town it is acreage with a barn or a pole barn on
  // it. Those are two different jobs, and the page says so, because that is
  // what a Lowell resident is actually deciding between when they look at
  // their own property.
  {
    slug: 'junk-removal-lowell-mi',
    city: 'Lowell',
    state: 'Michigan',
    county: 'Kent County',
    nav: 'Lowell, MI',
    // The quote form option a CTA on this page prefills. The general one:
    // a city page covers everything, so it must not pre-narrow the request.
    quoteService: 'Junk / hauling',
    title: 'Junk Removal & Cleanouts in Lowell, MI | RYDJA',
    h1: 'Junk removal and cleanouts in Lowell, Michigan',
    description:
      'Junk removal, estate and garage cleanouts, barn clearing, yard cleanup and hauling in Lowell, MI and the ' +
      'surrounding Kent County townships. Send photos, get a price.',
    lede:
      'Lowell is the closest thing RYDJA has to a home base, and it is the shortest drive on the list. Send ' +
      'photographs of what needs to go and we will price it.',
    intro: [
      'Lowell sits in Kent County, where the Flat River runs into the Grand &mdash; a pleasant thing to live beside and an awkward thing to clear a basement in. Between the river, the age of the houses on and around Main Street, and the acreage that starts a mile outside the city limits, this one small city produces two completely different kinds of cleanout, and they get quoted differently.',
      'In town, the job is usually the building: a walk-out that is not a walk-out, a basement stairway with a turn in it, a single-car garage on an alley, a driveway that will not take a trailer. The volume is rarely the hard part. Getting it out of the house is.',
      'Outside town, towards Vergennes, Bowne and Ada, the job is usually the volume: a pole barn, a machine shed, a fence line somebody has been stacking behind for twenty years. Access is easy, the load is enormous, and the question is how many trips it takes.',
      'Both are work RYDJA does. Tell us which one you have &mdash; or send photographs and let us work it out &mdash; and we will come back with a price and an honest read on the time.'
    ],

    // ---- what is specifically true of working here ----
    //
    // The substance of the page. Not "we serve Lowell" five times: the things
    // about this place that change the job, the quote or the plan.
    localHeading: 'What clearing a property in Lowell actually involves',
    local: [
      {
        h: 'The older houses near downtown are a stairs problem, not a volume problem',
        p: 'A good part of Lowell&rsquo;s housing stock predates the idea that anybody would ever need to get a sofa out of a basement. Narrow treads, a turn at the bottom, a bulkhead door that opens onto three feet of nothing. When you send photographs of a basement here, <strong>photograph the way out as well as the pile</strong> &mdash; the stairs, the door at the top, the path to where a truck can park. That one photograph changes the quote more than anything else you can send us.'
      },
      {
        h: 'Riverside basements fill up with the aftermath of water',
        p: 'Properties near the Flat and the Grand deal with water, and what water leaves behind is a particular kind of cleanout: ruined carpet and pad, swollen particle-board furniture, boxes that have gone soft, appliances that were on the floor. We clear all of that. What we are not is a remediation contractor &mdash; we do not test for mould, we do not treat it, and if what you are describing sounds like it needs a remediation firm first we will tell you so rather than take the job.'
      },
      {
        h: 'Barns and pole barns are priced by loads, and photographed from the doorway',
        p: 'Outside the city the outbuildings get big. A barn clearing is a multiple-load job and the arithmetic is mostly disposal and trips, not labour. The useful photographs are wide ones taken from the main door, plus one of whatever is stacked at the back &mdash; which is nearly always the part nobody mentioned. If there is farm equipment, tyres, drums or anything that used to hold fuel or chemicals in there, say so up front: some of it we can take and some of it legally has to go elsewhere.'
      },
      {
        h: 'Being close to Grand Rapids changes what a small job costs',
        p: 'Lowell is a short run from Grand Rapids, and that is why a single-item pickup makes sense here when the same job forty miles out might not. If you have one couch, one mattress, one dead chest freezer, this is one of the places on our map where that is a straightforward call rather than a conversation about whether the drive is worth it.'
      },
      {
        h: 'Rental turnovers here run on a date somebody else set',
        p: 'A good share of the rental work around Lowell is on a deadline set by a lease end or a closing rather than by the landlord. If you have a date, send it with the request. We would rather tell you plainly that a Thursday is not workable than agree to it and leave you holding a unit you have already promised to somebody.'
      }
    ],

    // ---- the work most often asked for here ----
    //
    // Service slugs, in the order they come up in this place. Each resolves
    // to a real page; server.js checks that at boot.
    services: [
      ['estate-cleanouts', 'Clearing a parent&rsquo;s or grandparent&rsquo;s house in town, usually with family coming to collect things over a fortnight'],
      ['cleanouts', 'Garages, basements and barns &mdash; the two halves of Lowell in one service'],
      ['junk-removal', 'The ordinary load: furniture, appliances, boxes, scrap, construction leftovers'],
      ['rental-property-cleanouts', 'Turning a unit around between tenants, against a date somebody else set'],
      ['furniture-appliance-removal', 'One heavy thing and the stairs it has to come down'],
      ['yard-cleanup', 'Brush, storm damage off the river, and the fence line behind the barn'],
      ['hauling-moving-help', 'A truck and two people, where nothing is being thrown away'],
      ['light-demolition', 'A shed, a deck, a playset, a run of fence &mdash; and the debris afterwards']
    ],

    // ---- the places around it we reach on the same run ----
    //
    // Named because they are genuinely adjacent and on the Business Profile,
    // and because somebody in Saranac searching for this will not find a page
    // of their own and should still see that we come out there.
    nearbyHeading: 'Around Lowell',
    nearby: [
      'Ada and Ada Township',
      'Alto',
      'Cascade',
      'Saranac',
      'Clarksville',
      'Vergennes Township',
      'Lowell Township',
      'Bowne Township',
      'Grand Rapids and the east side suburbs'
    ],
    nearbyNote:
      'All of this is a short enough run from Lowell that a normal-sized job is straightforward. Further out it ' +
      'starts to depend on the size of the load, which is the whole of what the ' +
      '<a class="text-link" href="/service-area">service area</a> page explains.',

    faqs: [
      {
        q: 'Do you charge more to come to Lowell?',
        a: 'No. There is no travel surcharge on the quote and never has been. What distance affects is whether a very small job out at the edge of the area is worth either of us doing, and Lowell is not at the edge of the area.'
      },
      {
        q: 'Can you get a trailer up my driveway?',
        a: 'Often, and where we cannot we carry to the truck instead. A photograph of the driveway and the approach answers this before anybody is booked, which is better than finding out on the day. Narrow, steep and soft ground are all things we would rather know about in advance.'
      },
      {
        q: 'I have one item. Is that worth your time?',
        a: 'In Lowell, yes. Send a photograph of it and where it is in the building and we will give you a price for the one item.'
      },
      {
        q: 'Where does it all go?',
        a: 'To a licensed disposal site, with anything resellable, recyclable or donatable separated out first where it is worth doing. We will not pretend a load is diverted when it is not, and we do not charge you for the diversion.'
      },
      {
        q: 'Can you come while I am at work?',
        a: 'If everything that is going is clearly identified and we can get in, yes, and plenty of jobs run that way. For anything with judgement in it &mdash; an estate, a basement where some of it stays &mdash; it is much better if somebody is there for the first twenty minutes.'
      }
    ],

    closing:
      'Send photographs of the rooms, the buildings or the pile, whatever stage you are at. A price comes back ' +
      'to your phone, and nothing is booked and nothing is owed until you say so.'
  },

  // ----------------------------------------------------------------- Stanton
  //
  // Montcalm County, and a genuinely different proposition. Stanton is the
  // county seat, which means the probate court for the whole county sits
  // there -- and that is not trivia, it is the single most useful fact on the
  // page. The people who most need this service in Montcalm County are
  // executors and personal representatives, and Stanton is where that
  // paperwork happens.
  //
  // The rest of the county is rural, lake-scattered and agricultural, which
  // makes the jobs larger, further apart and more often about an inherited
  // property than about a sofa.
  {
    slug: 'junk-removal-stanton-mi',
    city: 'Stanton',
    state: 'Michigan',
    county: 'Montcalm County',
    nav: 'Stanton, MI',
    quoteService: 'Junk / hauling',
    title: 'Junk Removal & Estate Cleanouts in Stanton, MI | RYDJA',
    h1: 'Junk removal and estate cleanouts in Stanton, Michigan',
    description:
      'Estate and whole-property cleanouts, barn and outbuilding clearing, junk removal and hauling in Stanton, MI ' +
      'and across Montcalm County. Send photos for a price.',
    lede:
      'Stanton is the county seat of Montcalm County, and most of what RYDJA is called out here for is a whole ' +
      'property rather than a pickup load.',
    intro: [
      'Stanton is the Montcalm County seat, and Montcalm County&rsquo;s probate court sits there &mdash; which is why this page leads with estate work rather than with junk. If you have been appointed personal representative of an estate, the paperwork side of it happens here &mdash; and sooner or later somebody has to deal with the house, the garage and whatever is in the barn.',
      'That is the job RYDJA does most often in this part of the county. Not a bag of rubbish: a property, with a deadline attached to it, usually belonging to somebody who has died, and usually being sorted out by a relative who lives somewhere else and is driving up at weekends.',
      'The county around Stanton is rural and full of small lakes, so the other common version of the same job is a cottage or a lake property that has passed to the next generation along with forty years of what was left in it. Both of those are large, both are photographable, and both get a flat price before anybody turns up.',
      'There is ordinary junk removal and hauling here too, and we do it. It is simply not what most people in Montcalm County are searching for when they find this page.'
    ],

    localHeading: 'What a Montcalm County cleanout usually looks like',
    local: [
      {
        h: 'The property is nearly always more than the house',
        p: 'A Montcalm County estate is a house, a garage, and then the part nobody budgeted for: a pole barn, a machine shed, a couple of outbuildings, and whatever is parked behind them. When you ask us to price an estate out here, <strong>photograph the outbuildings first</strong>. They are what decides how many loads the job is, and a quote based on the house alone is a quote that is going to change.'
      },
      {
        h: 'Executors and personal representatives get a paper trail',
        p: 'If you are settling an estate you are accounting to somebody &mdash; a court, a sibling, a buyer. Every job RYDJA takes carries a permanent reference, the quote is written down before the work starts, and the price you approved is the price unless you agree to a different one. Nothing gets loaded that you have not designated for removal. We are not appraisers and we do not buy contents, so there is no question of us having an interest in what gets thrown away.'
      },
      {
        h: 'Distance is why the big jobs are the easy ones to say yes to',
        p: 'Stanton is the far end of our map, a little over thirty miles from Lowell and in a different county. For a whole-property cleanout that is nothing &mdash; the travel is a small share of a job that size, and it is worth the trip. For one chair it honestly may not be. If you have a small job out here, the thing that makes it work is combining it with something: a neighbour, a second property, or waiting until there is more.'
      },
      {
        h: 'A lake cottage is a different inventory from a house',
        p: 'Inherited lake property around Six Lakes, Crystal and the smaller lakes comes with its own list: boats and trailers that have not moved in years, docks stacked on the bank, outboard motors, water-logged deck furniture, a shed full of fishing tackle and spiders. We clear all of it. Fuel, two-stroke mix, old gas cans and batteries we cannot &mdash; set those aside and they need to go to a household hazardous waste collection, not on our trailer.'
      },
      {
        h: 'Farm clearing has a legal line in it, and we hold to it',
        p: 'Agricultural outbuildings in this county hold things that look like junk and are regulated waste: drums with residue in them, old pesticide and herbicide containers, waste oil, scrap tyres in quantity, asbestos sheeting on an older barn roof. We will take the scrap metal, the timber, the furniture and the general clutter. We will not take the regulated material, we will not quietly mix it into a load, and we will tell you which is which from your photographs rather than discovering it on the day.'
      },
      {
        h: 'Weather decides the calendar more than it does further south',
        p: 'A barn at the end of a two-track in March is a different job from the same barn in July. If your property has a long unpaved approach, say so, and we will plan the timing around getting a loaded trailer back out again rather than finding out that we cannot.'
      }
    ],

    services: [
      ['estate-cleanouts', 'The main reason people in Montcalm County call: a whole property emptied, at the pace the family needs'],
      ['cleanouts', 'Barns, machine sheds, outbuildings and the garage, usually as part of the same job'],
      ['light-demolition', 'A collapsing shed, a rotten deck, a fence line &mdash; and hauling the debris away'],
      ['junk-removal', 'The ordinary load, where that is genuinely all it is'],
      ['yard-cleanup', 'Brush, downed limbs and what a winter leaves on an acreage'],
      ['furniture-appliance-removal', 'Appliances and heavy single items out of a property nobody lives in'],
      ['rental-property-cleanouts', 'A unit or a whole building returned to empty'],
      ['hauling-moving-help', 'Moving what is being kept, rather than clearing what is not']
    ],

    nearbyHeading: 'Around Stanton, across Montcalm County',
    nearby: [
      'Sheridan',
      'Six Lakes',
      'Crystal',
      'Vestaburg',
      'Edmore',
      'Lakeview',
      'Greenville',
      'Howard City',
      'Belding',
      'Ionia'
    ],
    nearbyNote:
      'Montcalm County is spread out, and so is this list. A whole-property job anywhere on it is worth the drive; ' +
      'a small one depends on the day and on what else is going on. Ask, and we will give you a straight answer ' +
      'rather than a maybe &mdash; the <a class="text-link" href="/service-area">service area</a> page explains how ' +
      'we work it out.',

    faqs: [
      {
        q: 'I am the personal representative of an estate. What do you need from me?',
        a: 'Photographs of every building involved, including the outbuildings, and the deadline you are working to. That is enough for a price. You do not need an inventory and you do not need to have been through the boxes &mdash; and you should not throw anything out before we quote, because volume is what we are pricing, not value.'
      },
      {
        q: 'Can the job be split across several visits?',
        a: 'Yes, and on an estate out here it usually is. Families need time to come and collect things, and relatives driving up from downstate can only do weekends. Tell us roughly how it needs to be staged and we will plan around that rather than around our calendar.'
      },
      {
        q: 'Is it worth you coming this far for a small load?',
        a: 'Sometimes, and we will tell you honestly. Stanton is the far end of the area, so a single small item out here is the one case where the drive can cost more than the work. If the answer is no, you will get a no rather than an inflated price.'
      },
      {
        q: 'Do you buy anything, or take it off the price?',
        a: 'No. We do not buy contents, we do not appraise them, and we do not offer a credit against a quote for what is in the house. If something in there is worth selling, it is worth you selling it or getting an auctioneer in before we clear the rest &mdash; and we will happily work around whatever you are holding back.'
      },
      {
        q: 'What about the barn roof? I think it is asbestos.',
        a: 'Then it is not ours to touch, and nor is anything else that is bonded to it. Asbestos removal is licensed work with its own disposal chain. We will clear the contents of a building and leave the structure alone, and we will tell you plainly where that line falls on your property.'
      },
      {
        q: 'Do I have to be there?',
        a: 'For an estate, it helps enormously if somebody is there at the start, even for twenty minutes, to walk us round and point at what stays. After that, no. Plenty of jobs out here run with the family a hundred miles away and the keys in a lockbox.'
      }
    ],

    closing:
      'Send photographs of the house and every outbuilding, and tell us the date you are working to. A written ' +
      'price comes back before anybody is booked, and nothing is loaded that you have not said can go.'
  }
];

// Fields the template renders escaped, so markup or an HTML entity in one of
// them reaches the reader as its own source. Checked here rather than caught
// by a test on a rendered page, because the fix belongs next to the copy.
//
// Everything NOT on this list -- the intro paragraphs, the local sections'
// prose, the answers, the closing -- is rendered raw on purpose, carries
// &mdash; and &rsquo; throughout, and may hold a link.
const ESCAPED_FIELDS = (page) => [
  page.h1, page.nav, page.city, page.state, page.county, page.title,
  page.description, page.localHeading, page.nearbyHeading,
  ...page.local.map((s) => s.h),
  ...page.nearby,
  ...page.faqs.map((f) => f.q)
];

for (const page of PAGES) {
  for (const value of ESCAPED_FIELDS(page)) {
    if (/&[a-zA-Z#][a-zA-Z0-9]*;|<[a-zA-Z/]/.test(String(value))) {
      throw new Error(
        `${page.slug}: "${value}" is rendered escaped and may not carry markup or an entity`
      );
    }
  }
  // The meta description is also a plain-text attribute value, and is the one
  // place where an ampersand is legitimate -- but only as itself.
  if (page.description.includes('&') && !/&s/.test(page.description)) {
    throw new Error(`${page.slug}: the meta description may not carry an entity`);
  }
}

/** The page for a slug, or undefined. */
const localPage = (slug) => PAGES.find((p) => p.slug === slug);

/** Every service slug the local pages link to, for a boot-time check. */
const linkedServiceSlugs = () => [
  ...new Set(PAGES.flatMap((p) => p.services.map(([slug]) => slug)))
];

module.exports = { LOCAL_PAGES: PAGES, localPage, linkedServiceSlugs };
