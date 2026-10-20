'use strict';

// The twenty-three service offerings as entered on the Google Business
// Profile, mapped onto the eight pages that already describe them.
//
// ------------------------------------------------------------------ the point
//
// A customer arrives having typed the words for their own problem: "attic
// cleanout", "scrap metal pickup", "storm debris", "move-out cleanout". The
// site described all of that already, in prose, scattered through eight pages
// -- which means somebody scanning for their own job had to read to find it.
//
// So this is an index, not twenty-three pages. Each offering names the page
// that covers it and the quote-form option that prices it, and the services
// hub renders the whole thing in four groups. One link gets a customer from
// their own words to a prefilled quote.
//
// Twenty-three thin pages would be the other way to do it, and it would be
// doorway pages with extra steps: the same business, the same crew, the same
// truck, described twenty-three times. The brief rules it out and it would
// deserve to be ruled out.
//
// ---------------------------------------------------------------- honesty
//
// Every entry describes work RYDJA actually does with a truck, a trailer and
// labour. Nothing here implies:
//
//   - structural or engineered demolition (light, non-structural only)
//   - hazardous material, asbestos, chemicals, fuels or biohazards
//   - tree felling, climbing or storm-tree work (we haul what is already down)
//   - any disposal certification, licence, bond or insurance
//
// Where a limit exists it is stated in the entry rather than left to the page.
//
// ---------------------------------------------------------------- pending
//
// The Google service list was expanded on 2026-10-20 and some edits may still
// be under review. Two the owner still needs to confirm on the profile itself
// are flagged with `verifyOnProfile` -- that flag changes nothing on the site,
// it is a note so the admin page can list what is outstanding.

/**
 * The four groups, in the order a customer is most likely to need them.
 * `page` is the service page slug that covers the group's work.
 */
const GROUPS = [
  {
    key: 'junk',
    label: 'Junk removal and hauling',
    blurb: 'A load to get rid of, from one item to a full trailer.',
    page: 'junk-removal'
  },
  {
    key: 'cleanouts',
    label: 'Property and estate cleanouts',
    blurb: 'A whole space, or a whole property, emptied.',
    page: 'estate-cleanouts'
  },
  {
    key: 'outdoor',
    label: 'Furniture, yard and demolition',
    blurb: 'Heavy single items, what the yard has grown, and small structures.',
    page: 'yard-cleanup'
  },
  {
    key: 'moving',
    label: 'Moving and delivery',
    blurb: 'Where nothing is being thrown away and you need the truck and the hands.',
    page: 'hauling-moving-help'
  }
];

/**
 * The twenty-three offerings.
 *
 *   name     exactly as it reads on the Business Profile, so the two agree
 *   group    which of the four groups above
 *   page     the service page slug that describes this work
 *   quote    the quote-form option that prices it, by its stored value
 *   says     one line in the customer's own words, for the index
 *   limit    the honest boundary, where there is one
 */
const SERVICES = [
  // ---------------------------------------------- junk removal and hauling
  {
    name: 'Junk Removal',
    group: 'junk',
    page: 'junk-removal',
    quote: 'Junk / hauling',
    says: 'Household junk, boxes, furniture and whatever has collected in the corner.'
  },
  {
    name: 'Trash Removal',
    group: 'junk',
    page: 'junk-removal',
    quote: 'Junk / hauling',
    says: 'Bagged and loose household waste that will not fit in a kerbside bin.'
  },
  {
    name: 'Junk Hauling',
    group: 'junk',
    page: 'junk-removal',
    quote: 'Junk / hauling',
    says: 'Loaded onto the trailer and taken off the property in one trip where it fits.'
  },
  {
    name: 'Debris Removal',
    group: 'junk',
    page: 'junk-removal',
    quote: 'Junk / hauling',
    says: 'Construction offcuts, old decking boards, torn-out carpet, broken fixtures.',
    limit: 'General debris only. Nothing hazardous, and no asbestos.'
  },
  {
    name: 'Scrap Metal Pickup',
    group: 'junk',
    page: 'junk-removal',
    quote: 'Junk / hauling',
    says: 'Appliances, fencing, bed frames, pipe, farm metal and the pile behind the barn.'
  },

  // ------------------------------------------ property and estate cleanouts
  {
    name: 'Estate Cleanouts',
    group: 'cleanouts',
    page: 'estate-cleanouts',
    quote: 'Estate / whole-property cleanout',
    says: 'A whole property emptied after a death, at the pace the family needs.'
  },
  {
    name: 'Whole House Cleanouts',
    group: 'cleanouts',
    page: 'estate-cleanouts',
    quote: 'Estate / whole-property cleanout',
    says: 'Every room, plus the roof space and whatever is under the stairs.'
  },
  {
    name: 'Garage Cleanouts',
    group: 'cleanouts',
    page: 'cleanouts',
    quote: 'Garage / basement cleanout',
    says: 'One bay or two, cleared back to the floor and swept.'
  },
  {
    name: 'Basement Cleanouts',
    group: 'cleanouts',
    page: 'cleanouts',
    quote: 'Garage / basement cleanout',
    says: 'Including the stairs, the turn at the bottom and the door at the top.'
  },
  {
    name: 'Attic Cleanouts',
    group: 'cleanouts',
    page: 'cleanouts',
    quote: 'Garage / basement cleanout',
    says: 'Boxes nobody has opened since they went up there.'
  },
  {
    name: 'Storage Unit Cleanouts',
    group: 'cleanouts',
    page: 'cleanouts',
    quote: 'Storage unit cleanout',
    says: 'A unit emptied so it can be handed back or re-let. Priced off a photograph.'
  },
  {
    name: 'Rental Property Cleanouts',
    group: 'cleanouts',
    page: 'rental-property-cleanouts',
    quote: 'Rental / property turnover',
    says: 'What a tenant left, cleared so the unit can be cleaned and re-let.'
  },
  {
    name: 'Move-Out Cleanouts',
    group: 'cleanouts',
    page: 'rental-property-cleanouts',
    quote: 'Rental / property turnover',
    says: 'Everything the movers would not take, or you decided to leave behind.'
  },
  {
    name: 'Barn & Outbuilding Cleanouts',
    group: 'cleanouts',
    page: 'cleanouts',
    quote: 'Garage / basement cleanout',
    says: 'Pole barns, machine sheds and whatever is stacked at the back.',
    limit: 'Contents only. Drums, farm chemicals and asbestos sheeting are not ours to move.'
  },

  // ------------------------------------- furniture, yard and demolition
  {
    name: 'Furniture Removal',
    group: 'outdoor',
    page: 'furniture-appliance-removal',
    quote: 'Furniture / appliance removal',
    says: 'Couches, sofas, mattresses, recliners, desks. One item is a job.'
  },
  {
    name: 'Appliance Removal',
    group: 'outdoor',
    page: 'furniture-appliance-removal',
    quote: 'Furniture / appliance removal',
    says: 'Fridges, freezers, washers, dryers, stoves, water heaters.',
    verifyOnProfile: true
  },
  {
    name: 'Yard Waste Removal',
    group: 'outdoor',
    page: 'yard-cleanup',
    quote: 'Yard / brush cleanup',
    says: 'Leaves, clippings, sod, and the heap at the bottom of the garden.',
    verifyOnProfile: true
  },
  {
    name: 'Brush Removal',
    group: 'outdoor',
    page: 'yard-cleanup',
    quote: 'Yard / brush cleanup',
    says: 'Brush piles, cut branches and overgrown fence lines.'
  },
  {
    name: 'Storm Debris Removal',
    group: 'outdoor',
    page: 'yard-cleanup',
    quote: 'Yard / brush cleanup',
    says: 'Limbs and mess already on the ground after a bad night.',
    limit: 'We haul what is down. We do not fell, climb or cut standing trees.'
  },
  {
    name: 'Shed Removal',
    group: 'outdoor',
    page: 'light-demolition',
    quote: 'Light demolition',
    says: 'A shed taken apart and carried away, slab left or broken out as agreed.'
  },
  {
    name: 'Light Demolition',
    group: 'outdoor',
    page: 'light-demolition',
    quote: 'Light demolition',
    says: 'Decks, fences, playsets, built-in shelving and cabinets.',
    limit: 'Non-structural only. Nothing holding a building up, and no permitted demolition.'
  },

  // ---------------------------------------------------- moving and delivery
  {
    name: 'Moving Labor & Loading Help',
    group: 'moving',
    page: 'hauling-moving-help',
    quote: 'Moving / delivery help',
    says: 'Two people and a truck for the heavy end of a move you are running yourself.',
    limit: 'Local help only. We are not a licensed interstate or long-distance mover.'
  },
  {
    name: 'Local Hauling & Delivery',
    group: 'moving',
    page: 'hauling-moving-help',
    quote: 'Moving / delivery help',
    says: 'Marketplace and auction pickups, a single heavy item moved across town.'
  }
];

// ---------------------------------------------------------------- derived

const byGroup = (key) => SERVICES.filter((s) => s.group === key);

/** The offerings a given service page covers, for the page to list. */
const forPage = (slug) => SERVICES.filter((s) => s.page === slug);

/** Everything still to be checked on the Business Profile itself. */
const verifyOnProfile = () => SERVICES.filter((s) => s.verifyOnProfile).map((s) => s.name);

/**
 * Check the mapping against the rest of the app. Called once at boot.
 *
 * Both halves matter. A service pointing at a page that does not exist is a
 * dead link in an index whose whole job is getting somebody to the right
 * page; a service pointing at a quote option the form does not offer is a CTA
 * that lands on a form with nothing selected, which is worse than no CTA.
 *
 * @param {string[]} pageSlugs       every service page slug that exists
 * @param {string[]} quoteServices   every option the quote form offers
 */
function check(pageSlugs, quoteServices) {
  const pages = new Set(pageSlugs);
  const quotes = new Set(quoteServices);
  const groups = new Set(GROUPS.map((g) => g.key));

  for (const s of SERVICES) {
    if (!groups.has(s.group)) throw new Error(`service "${s.name}" is in unknown group "${s.group}"`);
    if (!pages.has(s.page)) throw new Error(`service "${s.name}" points at /${s.page}, which is not a service page`);
    if (!quotes.has(s.quote)) {
      throw new Error(`service "${s.name}" prefills "${s.quote}", which the quote form does not offer`);
    }
    if (!s.says || s.says.length < 20) throw new Error(`service "${s.name}" needs a line a customer would recognise`);
  }
  for (const g of GROUPS) {
    if (!pages.has(g.page)) throw new Error(`group "${g.label}" points at /${g.page}, which is not a service page`);
    if (!byGroup(g.key).length) throw new Error(`group "${g.label}" has no services in it`);
  }

  // Claims the business has not earned must not reach a service description.
  const text = JSON.stringify(SERVICES).toLowerCase();
  for (const claim of ['licensed', 'insured', 'bonded', 'certified', 'accredited',
                       'same day', 'same-day', 'guaranteed', 'asbestos removal',
                       'hazardous waste', 'tree removal', 'tree service']) {
    // "not a licensed interstate mover" and "no asbestos" are disclaimers and
    // are allowed; an unqualified claim is not. The distinction is the word
    // before it.
    const re = new RegExp('(?<!not a |no |nothing |not )\\b' + claim.replace(/[-/]/g, '.') + '\\b');
    if (re.test(text)) {
      throw new Error(`a service description makes an unqualified claim about "${claim}"`);
    }
  }
}

module.exports = { GROUPS, SERVICES, byGroup, forPage, verifyOnProfile, check };
