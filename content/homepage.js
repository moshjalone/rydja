'use strict';

// Two homepage sections, as content rather than markup.
//
// Both exist to answer the question a visitor actually arrives with, which is
// almost never "what services do you offer". It is "do you take my kind of
// thing" and "is my situation the kind of thing you handle". The service grid
// above them answers neither: a card headed "Cleanouts" does not tell somebody
// holding a broken treadmill that they are in the right place.
//
// Rules this file is held to:
//
//   * Every item is something RYDJA genuinely takes. Nothing is listed to
//     catch a search for it.
//   * Every group links to a page that actually covers it. The alternative is
//     twenty thin pages, one per item, which is the mistake this file exists
//     to avoid making.
//   * These are the words a customer would use. Not "debris hauling services
//     West Michigan" -- "brush and branches".

// ------------------------------------------------- what can RYDJA haul away?
//
// Grouped rather than one flat list of forty nouns, because grouped is how
// somebody scanning on a phone finds their own thing in two seconds. Each
// group carries the page it belongs to, so a reader who sees their item is one
// tap from the page that prices it.
const HAUL_AWAY_GROUPS = [
  {
    heading: 'Furniture and household',
    href: '/furniture-appliance-removal',
    linkLabel: 'Furniture and appliance removal',
    items: [
      'Furniture',
      'Couches and sectionals',
      'Mattresses and box springs',
      'Dressers and wardrobes',
      'Desks and bookcases',
      'Outdoor and patio furniture'
    ]
  },
  {
    heading: 'Appliances and metal',
    href: '/junk-removal',
    linkLabel: 'Junk removal and hauling',
    items: [
      'Fridges and freezers',
      'Washers and dryers',
      'Ovens and dishwashers',
      'Scrap metal',
      'Exercise equipment',
      'Shelving and storage racks'
    ]
  },
  {
    heading: 'Whole spaces',
    href: '/cleanouts',
    linkLabel: 'Garage, basement and property cleanouts',
    items: [
      'Garage clutter',
      'Basement contents',
      'Attic and spare rooms',
      'Storage-unit contents',
      'Barns and outbuildings',
      'Household junk and boxes'
    ]
  },
  {
    heading: 'Outdoors',
    href: '/yard-cleanup',
    linkLabel: 'Yard cleanup and debris removal',
    items: [
      'Yard debris',
      'Brush and branches',
      'Storm debris',
      'Leaf and seasonal piles',
      'Old fencing and timber',
      'Grills and planters'
    ]
  },
  {
    heading: 'Structures and debris',
    href: '/light-demolition',
    linkLabel: 'Shed removal and light demolition',
    items: [
      'Sheds and small outbuildings',
      'Playsets and swing sets',
      'Small decks and platforms',
      'Fencing and gates',
      'Cabinets and built-ins',
      'Renovation debris'
    ]
  }
];

// --------------------------------------------------- when people call RYDJA
//
// Situations, not services. Every one of these is a real reason somebody has
// picked up the phone, written in the first person the way they describe it,
// and each points at the page that handles it.
//
// Deliberately not a keyword list with "near me" bolted on. If a line here
// would not come out of a customer's mouth, it does not belong in it.
const CALL_SITUATIONS = [
  { situation: 'Moving out, and there is more left than the movers would take', href: '/junk-removal' },
  { situation: 'Settling an estate, with a whole house to empty', href: '/estate-cleanouts' },
  { situation: 'Inherited a property nobody has lived in for years', href: '/estate-cleanouts' },
  { situation: 'Getting a house ready to photograph and sell', href: '/cleanouts' },
  { situation: 'A rental to turn over before the next tenant moves in', href: '/rental-property-cleanouts' },
  { situation: 'A tenant left furniture and belongings behind', href: '/rental-property-cleanouts' },
  { situation: 'The garage has not fitted a car in a decade', href: '/cleanouts' },
  { situation: 'The basement is full and it all has to come up a stair', href: '/cleanouts' },
  { situation: 'A storage unit to empty before the next billing date', href: '/cleanouts' },
  { situation: 'Downsizing, and deciding what does not come along', href: '/estate-cleanouts' },
  { situation: 'Storm took down limbs across the whole yard', href: '/yard-cleanup' },
  { situation: 'One old couch, fridge or mattress that has to go', href: '/furniture-appliance-removal' },
  { situation: 'A shed or playset to take down and haul off', href: '/light-demolition' },
  { situation: 'Bought something too big for the car and need it collected', href: '/hauling-moving-help' }
];

// Every string in this file is rendered escaped -- these are list items and
// link labels, not prose -- so an HTML entity written into one would be shown
// to the reader as its own source: "brush &mdash; branches". Prose with
// markup in it belongs in content/service-pages.js, in a field the template
// renders raw.
for (const group of HAUL_AWAY_GROUPS) {
  for (const value of [group.heading, group.linkLabel, ...group.items]) {
    if (/&[a-zA-Z#][a-zA-Z0-9]*;|<[a-zA-Z/]/.test(value)) {
      throw new Error(`haul-away copy is rendered escaped and may not carry markup: ${value}`);
    }
  }
}
for (const row of CALL_SITUATIONS) {
  if (/&[a-zA-Z#][a-zA-Z0-9]*;|<[a-zA-Z/]/.test(row.situation)) {
    throw new Error(`situation copy is rendered escaped and may not carry markup: ${row.situation}`);
  }
}

// Nothing here may link to a page that does not exist. A dead internal link on
// the homepage is worse than a missing section, and this list is long enough
// that an edit could introduce one without anybody noticing.
function checkLinks(slugs) {
  const known = new Set(slugs);
  for (const group of HAUL_AWAY_GROUPS) {
    if (!known.has(group.href)) throw new Error(`haul-away group "${group.heading}" links ${group.href}, which is not a page`);
  }
  for (const row of CALL_SITUATIONS) {
    if (!known.has(row.href)) throw new Error(`call situation "${row.situation}" links ${row.href}, which is not a page`);
  }
}

module.exports = { HAUL_AWAY_GROUPS, CALL_SITUATIONS, checkLinks };
