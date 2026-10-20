'use strict';

// The public service pages, as content rather than as markup.
//
// One layout renders all of them, but the substance of each is written
// separately and differs throughout: different jobs, different things to
// expect, different limits, different questions. A page that was this page
// with the nouns swapped would be a doorway page, and would deserve to be
// treated as one.
//
// Everything here has to stay true of what the business actually does. No
// same-day promises, no licensing or insurance claims, no capability with
// hazardous material, and nothing about price beyond "we quote it".

const PAGES = [
  // -------------------------------------------------------- estate cleanouts
  //
  // The flagship. First in this array on purpose: the order here drives the
  // homepage grid, the service-area list, the offer catalog and the sitemap,
  // so "position in the hierarchy" is a one-line change rather than six.
  //
  // This page is held to a higher standard than the rest of the file, because
  // the people reading it are often sorting out a house after a death. Nothing
  // here may read as an offer to buy the contents, to value them, or to decide
  // on the customer's behalf what is worth keeping. Everything RYDJA may do
  // with an item is something the customer authorized first.
  {
    slug: 'estate-cleanouts',
    // The flagship page ran to 2,000 words with nothing to look at. One
    // photograph after the intro: a part-packed room, no people in it, nothing
    // staged as distress. Licensed stock, and it is never presented as our own
    // work -- provenance is in the private asset manifest.
    images: {
      afterIntro: {
        base: 'estate-cleanout-boxes',
        width: 1000,
        height: 563,
        alt: 'Labelled moving boxes and a sheeted armchair in a part-packed room'
      }
    },
    nav: 'Estate Cleanouts',
    // How this service is named and described wherever it is listed rather
    // than read: the homepage grid and the services hub. Longer than `nav`,
    // because a card has room to say what the job actually is, and written
    // for a customer scanning rather than for a crawler counting.
    card: {
      title: 'Estate Cleanouts',
      blurb:
        'A whole property emptied after a death, a move or an inheritance. House, garage, basement, attic, barn and outbuildings, at the pace the family needs.'
    },
    // The quote form's own option for this work. The nav label is shorter than
    // the form's wording, and a CTA has to prefill something the select
    // actually offers -- server.js checks that at boot.
    quoteService: 'Estate / whole-property cleanout',
    title: 'Estate & Whole-House Cleanouts Near Lowell, MI | RYDJA',
    h1: 'Estate and whole-property cleanouts near Lowell, Michigan',
    description:
      'Shed removal, playset and fence removal, small deck tear-downs in Lowell, Ada, Rockford, Greenville and Ionia, MI. Non-structural only, debris hauled away. Free photo estimate.',
    lede:
      'When a house has to be emptied and there is far more in it than one family can shift, this is the work we do. House, garage, basement, attic, barn and outbuildings &mdash; cleared at the pace you need.',
    intro: [
      'An estate cleanout is rarely about junk. It is a house full of a life, and someone &mdash; an executor, an adult child, a surviving spouse, a new owner, a property manager &mdash; is now responsible for emptying it, usually on a deadline they did not choose. The volume is the obvious problem. The decisions are the harder one.',
      'RYDJA handles the physical side of that: the lifting, the stairs, the loads, the disposal, and the sweep-up at the end. You decide what goes. We clear what you have told us to clear, and we keep you informed while we do it.',
      'You do not need to know what every box holds before you contact us. Send photographs of the rooms and the buildings involved and we will come back with a price and an honest read on how long it will take.'
    ],
    jobsHeading: 'The whole-property work we take on',
    jobs: [
      '<strong>Estate cleanouts</strong> &mdash; a full property emptied after a death, for the family or the executor',
      '<strong>Inherited-home cleanouts</strong> &mdash; a house you now own and have never lived in',
      '<strong>Whole-house cleanouts</strong> &mdash; every room, plus whatever is in the roof and under the stairs',
      '<strong>Downsizing</strong> &mdash; moving to somewhere smaller, and deciding what does not come along',
      '<strong>Moving and relocation cleanouts</strong> &mdash; everything the movers would not take or you chose to leave',
      '<strong>Garage, basement, attic and barn clearing</strong> &mdash; the outbuildings an estate accumulates, as part of the same job',
      '<strong>Property preparation before sale</strong> &mdash; getting a house empty, swept and photographable for a listing',
      '<strong>Landlord and property-manager clearing</strong> &mdash; a whole unit or a whole building returned to empty'
    ],
    expect: [
      {
        h: 'Nothing is loaded until you have said it can be',
        p: 'The single most important part of this job happens before we start. Walk the property, and set aside or clearly mark anything that is staying &mdash; for you, for a relative, for an auction, for a buyer. We work from what you tell us. A sealed box of papers and a sealed box of nothing look identical from the doorway, and we will not guess which is which.'
      },
      {
        h: 'It can run at the pace the family needs',
        p: 'Some properties get cleared in a day because the family has already been through everything. Others need two or three visits, with time in between for relatives to come and collect what they want. Both are normal. Tell us which one you are, and we will plan the job around that rather than around our calendar.'
      },
      {
        h: 'You choose the order, room by room',
        p: 'If the garage and basement need to be gone this week and the bedrooms can wait a fortnight, say so. It is often easier to stand in one empty room than to face eleven full ones, and there is no reason the work has to start at the front door.'
      },
      {
        h: 'Deadlines get a straight answer',
        p: 'Closings, listing dates, move-out dates and probate timelines are real, and we would rather turn a job down than miss one. Send the date with your request and we will tell you plainly whether it is workable &mdash; before you are relying on it.'
      },
      {
        h: 'If the scope turns out to be bigger, we talk to you',
        p: 'A full attic nobody had opened, or a crawl space nobody mentioned, changes the job. When that happens we stop and discuss it with you rather than quietly adding to the bill. The number you approved is the number, unless you agree to a different one.'
      }
    ],
    // Rendered after "What to expect". These are the two things that make an
    // estate job different from every other page in this file, and neither of
    // them survives being compressed into a bullet.
    sections: [
      {
        h: 'Before we load: what to take out yourself',
        paras: [
          'Once a property is actively being cleared, small things are easy to lose, and some of them cannot be replaced. Please go through the rooms first &mdash; or ask us to hold off on a particular area until you have &mdash; and pull out anything of this kind yourself.'
        ],
        list: [
          'Identification, passports, birth certificates and immigration papers',
          'Financial records, cheque books, bank statements and tax paperwork',
          'Wills, deeds, titles, insurance policies and other legal documents',
          'Family photographs, letters, albums and keepsakes',
          'Medication, medical equipment and medical records',
          'Firearms, ammunition and weapons of any kind',
          'Jewellery, cash, coins, collections and anything of unusual or sentimental value',
          'Computers, phones, drives and anything else holding personal data',
          'Hazardous material &mdash; chemicals, fuels, solvents, paint, propane, batteries &mdash; which we are not equipped to take at all'
        ],
        note:
          'If you find something of this kind after work has started, tell the crew immediately and we will stop and set it aside. Our full position on this is in the <a class="text-link" href="/terms#removal">terms</a>, and it has not changed for this page: we remove what you designate for removal, and nothing else.'
      },
      {
        h: 'Not everything in the house is treated as trash',
        paras: [
          'This is the part of the job most people expect to be worse than it is. A dumpster-and-done operation prices the fastest possible route to a landfill, because that is the only outcome it has. We would rather the usable things stayed usable.',
          'Where it is practical, and only where you have authorized it, items coming out of a property can be separated instead of buried. In practice that means sorting as we load:'
        ],
        list: [
          '<strong>Keep</strong> &mdash; set aside for you, a relative or a buyer, and left where you want it',
          '<strong>Donate</strong> &mdash; furniture, household goods and clothing still fit for someone else to use',
          '<strong>Recycle</strong> &mdash; cardboard, paper, electronics and material with a stream to go into',
          '<strong>Scrap</strong> &mdash; metal, appliances and anything with salvage weight to it',
          '<strong>Reuse or salvage</strong> &mdash; tools, fixtures, timber and working equipment with life left in them',
          '<strong>Dispose</strong> &mdash; what genuinely has nowhere else to go'
        ],
        note:
          'Two honest limits on that. We are not appraisers: we do not value antiques, art or collectibles, and if you think something in the house might be worth real money, have it looked at by someone who does that for a living <em>before</em> we arrive. And recovery is not a discount you are owed &mdash; if a particular job includes a credit for what comes out of it, that is agreed in writing on that job, in the quote, and never assumed.'
      },
      {
        h: 'Executors, agents and property managers',
        paras: [
          'A good share of this work comes from people clearing a property they do not live in. Executors and personal representatives settling an estate. Agents and owners getting a house empty before photographs are taken. Landlords and property managers turning over a unit or an entire building.',
          'What we need from you is the same in every case: the authority to have the contents removed, safe and lawful access to the property, and a clear statement of what stays. We handle the physical clearing only &mdash; we are not involved in probate, title, tenancy law or anything an attorney should be handling, and we will say so rather than offer an opinion we have no business having.',
          'If you place this kind of work regularly rather than once, there is a page written for you: <a class="text-link" href="/property-professionals">how RYDJA works with Realtors, property managers and estate professionals</a>. For a tenancy ending rather than an estate being settled, see <a class="text-link" href="/rental-property-cleanouts">rental property cleanouts and turnovers</a>.'
        ]
      }
    ],
    // The five steps, in the order the system actually runs them.
    stepsHeading: 'How an estate cleanout runs',
    steps: [
      {
        h: 'Send photographs',
        p: 'Room by room, plus the garage, basement, attic, barn and anything else involved. Include the route out to where a truck can park &mdash; on a big property that matters as much as the volume does.'
      },
      {
        h: 'Tell us which areas need clearing',
        p: 'The whole property, or three rooms and the garage. Mention a deadline if you have one, and anything that is definitely staying.'
      },
      {
        h: 'We send a price',
        p: 'Based on volume, access, labour, how much sorting is involved and what disposal will cost. No obligation, and nothing is booked yet.'
      },
      {
        h: 'You approve it and confirm a time',
        p: 'Approve from your phone. If we have proposed an appointment with the quote, confirming it schedules the job on the spot; if that time does not suit, ask for another.'
      },
      {
        h: 'We clear it',
        p: 'We load, haul and dispose of what you authorized, separate what can be reused, and sweep up behind us where that makes sense. Multiple loads and multiple visits are normal on a property this size.'
      }
    ],
    limits: [
      'No hazardous waste, asbestos, chemicals, fuels, solvents, paint, propane or batteries',
      'No biohazards, regulated medical waste, or contaminated or soiled material',
      'We do not appraise, value or purchase estate contents, and we do not offer cash for a property&rsquo;s belongings',
      'We are not a cleaning service &mdash; we clear and sweep, we do not deep clean or prepare a surface for paint',
      'No probate, legal, title or tenancy work: that is an attorney&rsquo;s job, not ours',
      'Nothing structural, and no asbestos-era material we are not equipped for',
      'Anything that is staying has to be identified before we load'
    ],
    faqs: [
      {
        q: 'How do you price a whole-property cleanout?',
        a: 'From photographs, the same as any other job, and then a conversation. What moves the number is volume, access, how many buildings are involved, how much sorting we are doing rather than straight loading, and what the disposal weighs. A one-bedroom apartment and a farmhouse with a barn are not the same job, which is why there is no flat rate on this page.'
      },
      {
        q: 'Do we have to sort everything out before you come?',
        a: 'No. Sorting is part of the work and we expect to do it. The one thing only you can do is decide what stays &mdash; so go through the rooms for documents, photographs, medication and anything valuable or sentimental, and mark or remove whatever is not going. Everything after that is ours.'
      },
      {
        q: 'Can you clear the house, garage and barn in the same job?',
        a: 'Yes, and that is usually how it is quoted &mdash; one job, several buildings, however many loads it takes. Photograph each building separately when you send the request so the price covers all of it rather than being revised later.'
      },
      {
        q: 'Will you buy what is in the house?',
        a: 'No. We are not buyers, dealers or appraisers, and we will not make you an offer on the contents of a property. If you believe there is something genuinely valuable in there, speak to an estate-sale company, an auction house or a specialist appraiser first. We are the people who clear what is left afterwards.'
      },
      {
        q: 'Can you work to a closing date or a move-out date?',
        a: 'Send the date with your request. We will give you a straight answer about whether it is workable rather than an optimistic one, because a missed closing is a far bigger problem than a job we turned down.'
      },
      {
        q: 'Does the family need to be there while you work?',
        a: 'Not necessarily. What matters is that we have safe and lawful access, that someone with the authority to authorize the work has done so, and that anything staying has already been pointed out. Plenty of these jobs are arranged by someone two states away; tell us the access arrangements when you send the request.'
      },
      {
        q: 'What happens to everything you take?',
        a: 'Items you designate for removal may be disposed of, recycled, donated, scrapped, reused or resold. Where it is practical and you have authorized it, we separate the usable from the genuinely finished rather than sending it all the same way. We cannot retrieve anything once it has been processed, which is why the pass through the rooms beforehand matters so much.'
      }
    ],
    // Larger jobs travel better than small ones, and on this page that is
    // worth saying rather than leaving the reader to infer it from the area
    // page. Replaces the shared sentence, so nothing is said twice.
    areaNote:
      'A whole-property cleanout is usually worth the drive to anywhere we work, and often to somewhere a little past it &mdash; several loads over several visits pays for the travel in a way a single pickup does not. Send the address with your photographs and we will tell you plainly whether we can reach it.',
    related: [
      { href: '/cleanouts', label: 'a single garage, basement or storage unit rather than a whole property' },
      { href: '/rental-property-cleanouts', label: 'a rental turnover after a tenant has moved out' },
      { href: '/junk-removal', label: 'one load of household junk, with no sorting involved' },
      { href: '/hauling-moving-help', label: 'moving or delivering the things you are keeping' },
      { href: '/light-demolition', label: 'taking down shelving, sheds or built-ins once a space is empty' },
      { href: '/property-professionals', label: 'placing this work as a Realtor, property manager or estate professional' }
    ]
  },

  // ------------------------------------------------------------------ junk
  //
  // This page owns BOTH of the disposal-side phrases: junk removal and junk
  // hauling. They are the same job -- material leaves the property and does
  // not come back -- and splitting them into two pages would have produced
  // two thin pages competing with each other for one intent.
  //
  // The transport side is a genuinely different job and lives on
  // /hauling-moving-help: there the thing has a destination. The line between
  // the two pages is "does it have somewhere to go?", and both pages point at
  // each other so a visitor who landed on the wrong one can cross over.
  {
    slug: 'junk-removal',
    nav: 'Junk Removal',
    card: {
      title: 'Junk Removal & Hauling',
      blurb:
        'Household junk, furniture, appliances, scrap and debris hauled away. One item or a whole load, and you do not have to carry it outside.'
    },
    quoteService: 'Junk / hauling',
    title: 'Junk Removal & Hauling Near Lowell, MI | RYDJA',
    h1: 'Junk removal and hauling in the Lowell area',
    description:
      'Junk removal and junk hauling in Lowell, Ionia, Belding and Stanton, MI: household junk, furniture, appliances, scrap and debris. One item or a whole load.',
    lede:
      'The pile in the corner of the garage, the couch nobody wants, the load that will not fit in your car. Send photos, get a price, and we take it away.',
    intro: [
      'This is the core of what RYDJA does. You point at what needs to go, we load it, and we haul it off the property. Most jobs are one visit, and you do not have to be the one lifting anything.',
      'Junk removal and junk hauling are the same job described two ways, and both are this page: unwanted material leaves and does not come back. If what you have needs taking <em>somewhere</em> rather than taking away &mdash; a delivery, a Marketplace pickup, furniture moving between two houses &mdash; that is <a class="text-link" href="/hauling-moving-help">local hauling and moving help</a> instead.',
      'We work from photographs rather than a sales visit. That means you get a real number without anyone standing in your kitchen, and we arrive already knowing what we are picking up and what it will take.'
    ],
    jobsHeading: 'Typical junk removal and hauling jobs',
    jobs: [
      'Single items &mdash; a couch, a mattress, a fridge, a treadmill',
      'The slow accumulation in a garage, shed or spare room',
      'Boxes, bags and household clutter after a sort-out',
      'Old furniture and unwanted items left behind by a tenant or a previous owner',
      'Scrap metal, appliances and anything else with a bit of weight to it',
      'Construction offcuts and small amounts of renovation debris',
      'A truckload of mixed junk you simply want gone'
    ],
    // Three sections, each answering a question the old version of this page
    // left the visitor to guess at: will you take my kind of thing, what
    // actually happens on the day, and is my job too small to bother with.
    sections: [
      {
        h: 'What we haul away',
        paras: [
          'The most common question on this page is simply whether we take a particular kind of thing. Almost always the answer is yes. In rough order of how often it comes up:'
        ],
        list: [
          '<strong>Couches, sectionals and furniture</strong> &mdash; including the sleeper sofa nobody can get back down the stair',
          '<strong>Mattresses and box springs</strong> &mdash; the item kerbside collection most often refuses',
          '<strong>Appliances</strong> &mdash; fridges, freezers, washers, dryers, ovens, dishwashers, water heaters',
          '<strong>Household clutter</strong> &mdash; the spare room, the closet, the pile that has been growing behind the door',
          '<strong>Boxes and bagged junk</strong> &mdash; after a sort-out, a move or a clear-out',
          '<strong>Garage junk</strong> &mdash; tools, tyres, paint-free leftovers, shelving, the half of it you have not touched in years',
          '<strong>Basement junk</strong> &mdash; decades of storage, carried up the stair by us rather than by you',
          '<strong>Scrap metal</strong> &mdash; appliances, bed frames, pipe, fencing and anything with salvage weight',
          '<strong>Exercise equipment</strong> &mdash; treadmills, weight benches, rowers, the bike that became a clothes rail',
          '<strong>Shelving and storage units</strong> &mdash; freestanding or dismantled off a wall',
          '<strong>Outdoor clutter</strong> &mdash; grills, planters, patio furniture, play equipment, the thing under the tarp',
          '<strong>Small amounts of renovation debris</strong> &mdash; offcuts, old cabinetry, torn-out carpet, drywall from one room'
        ],
        note:
          'Bulkier outdoor material &mdash; brush, branches, storm damage &mdash; is <a class="text-link" href="/yard-cleanup">yard cleanup and debris removal</a>, and a whole space coming back to empty is a <a class="text-link" href="/cleanouts">garage, basement or property cleanout</a>. Same truck, same crew; they are separate pages because they are priced differently and the photographs we need are different.'
      },
      {
        h: 'What a junk-removal job actually looks like',
        paras: [
          'Nobody books this twice a year, so here is the whole shape of it before you send anything.'
        ],
        list: [
          '<strong>A photo quote</strong> &mdash; you send pictures of what is going, we send back a price. No sales visit, no walkthrough appointment, no obligation.',
          '<strong>Access</strong> &mdash; we look at the route out as closely as the pile itself: the stair, the doorway, the turn, and where a truck and trailer can actually park.',
          '<strong>Loading</strong> &mdash; our labour, our equipment. You point at things; we carry them.',
          '<strong>Haul-away</strong> &mdash; it leaves on the same visit in almost every case. We do not stage material at the kerb for someone else to deal with.',
          '<strong>Sorting and recovery</strong> &mdash; what still has life in it gets pulled out for donation, recycling, scrap or resale instead of being buried, where you have authorized that.',
          '<strong>Disposal</strong> &mdash; what genuinely has nowhere else to go goes to a proper disposal site, and the fee for that is already inside the price you approved.'
        ]
      },
      {
        h: 'One item or a whole load: both are normal',
        paras: [
          'There is no minimum here. A single couch is a job we quote and do, and so is a trailer packed to the rail. The small ones are frequently the reason somebody calls at all: one heavy awkward thing, no truck, no second pair of hands.',
          'What this is <em>not</em> is a bin service or a replacement for your weekly collection. RYDJA is on-demand: you ask when you have something to shift, we come once, and there is nothing recurring to cancel. If what you need is a dumpster parked on the drive for a fortnight, that is a different trade and we will say so.'
        ]
      }
    ],
    expect: [
      {
        h: 'You do not have to move it outside',
        p: 'If it is inside, we come and get it. Carrying everything to the kerb first is the part most people dread, and it is the part you are hiring us for. Tell us where it is and how we get to it.'
      },
      {
        h: 'We sort before we dump',
        p: 'Anything reusable gets separated for donation, recycling, scrap or resale rather than going straight into a hole in the ground. On some jobs that recovery is part of why the price comes down.'
      },
      {
        h: 'One price, agreed before we start',
        p: 'You see the number before anyone turns up. If the job turns out to be materially bigger than the photos showed, we talk to you before carrying on &mdash; we do not quietly add to the bill.'
      },
      {
        h: 'Stairs, basements and tight access are the job, not a surprise',
        p: 'A basement with a narrow stair takes longer than a garage with a driveway, which is why we ask for a photo of the route rather than only the pile. Send both and the price you get is the price that holds.'
      }
    ],
    limits: [
      'No hazardous waste, asbestos, chemicals, fuels, solvents or paint',
      'No biohazards, medical waste or anything contaminated',
      'No propane tanks, batteries or anything that should not go in a trailer',
      'Not a bin, dumpster or recurring collection service &mdash; we come when you ask us',
      'Anything you want to keep needs pointing out before we load'
    ],
    faqs: [
      {
        q: 'What kinds of junk do you take?',
        a: 'Household clutter, furniture, mattresses, appliances, scrap metal, garage and basement contents, yard waste, small amounts of renovation debris and general unwanted items. If it is physical property work and it is not on the exclusion list above, it is probably a yes &mdash; send a photo and ask.'
      },
      {
        q: 'Do you haul junk from inside the house, or only from outside?',
        a: 'From inside. Bedrooms, basements, attics, closets, up and down stairs &mdash; wherever it is. Carrying it out is what you are paying for, and a job where everything is already on the drive is simply a cheaper version of the same job.'
      },
      {
        q: 'Do I need to move it to the kerb first?',
        a: 'No. Leave it where it is and tell us how to get to it. If it <em>is</em> already at the kerb or in the driveway, say so when you send the photos &mdash; easy access shows up in the price.'
      },
      {
        q: 'Will you take just one item?',
        a: 'Yes. Single-item pickups are completely normal and there is no minimum load. One couch, one fridge, one treadmill &mdash; send a photo and we price it like any other job.'
      },
      {
        q: 'Do you take construction or renovation debris?',
        a: 'Small volumes, yes &mdash; offcuts, old cabinetry, torn-out carpet, the drywall from one room. Heavy material like concrete, brick, soil and roofing needs checking first, because weight rather than space is the limit on a trailer. Send a photo and tell us roughly how much.'
      },
      {
        q: 'Can you remove furniture and appliances in the same visit?',
        a: 'Yes, and that is one job and one price rather than two. If appliances are involved, make sure they are unplugged, emptied and defrosted, and tell us about anything that still needs a plumber or an electrician to disconnect &mdash; that is work we are not licensed to do.'
      },
      {
        q: 'Is this the same as my weekly trash collection?',
        a: 'No. Municipal collection is recurring and takes what fits in the bin. This is on-demand junk removal for the things that do not: the volume, the weight and the awkward items. You call when you have something to shift, and there is nothing ongoing to cancel.'
      },
      {
        q: 'Do I need to be there?',
        a: 'Not always. What matters is that we can reach the items safely and lawfully, and that anything staying has been pointed out in advance. Tell us the access arrangements when you send the request.'
      },
      {
        q: 'What happens to what you take?',
        a: 'Items you designate for removal may be disposed of, recycled, donated, scrapped, reused or resold. Please pull out anything you want to keep before we arrive &mdash; especially documents, medication and anything sentimental.'
      }
    ],
    related: [
      { href: '/furniture-appliance-removal', label: 'one heavy item &mdash; a couch, a mattress, a fridge' },
      { href: '/cleanouts', label: 'clearing a whole garage, basement or storage unit' },
      { href: '/yard-cleanup', label: 'brush, branches and outdoor debris instead' },
      { href: '/rental-property-cleanouts', label: 'what a tenant left behind in a rental' },
      { href: '/estate-cleanouts', label: 'emptying an entire house or property' },
      { href: '/hauling-moving-help', label: 'moving something rather than getting rid of it' }
    ]
  },

  // -------------------------------------------------------------- cleanouts
  {
    slug: 'cleanouts',
    images: {
      afterIntro: {
        base: 'garage-cleanout',
        width: 1000,
        height: 563,
        alt: 'A cleared residential garage with shelving, a wheelbarrow and a stepladder'
      }
    },
    nav: 'Cleanouts',
    card: {
      title: 'Garage, Basement & Property Cleanouts',
      blurb:
        'A whole space back to empty: garages, basements, barns, outbuildings, storage units and spare rooms. Cleared and swept, however many loads it takes.'
    },
    quoteService: 'Garage / basement cleanout',
    title: 'Garage, Basement & Barn Cleanouts Near Lowell, MI | RYDJA',
    h1: 'Garage, basement, attic and barn cleanouts near Lowell',
    description:
      'Garage, basement, barn, outbuilding and storage unit cleanouts in Lowell, Ionia, Belding and Stanton, MI. A whole space emptied and swept. Photo quotes, no obligation.',
    lede:
      'A cleanout is a whole space emptied, not a single pickup. Garages, basements, barns, outbuildings, storage units and spare rooms &mdash; we clear the lot and leave the floor swept.',
    intro: [
      'Cleanouts are the jobs where a space has to come back to empty. They tend to be bigger and slower than a straight junk pickup, and they are usually happening because something else is going on: a move, a sale, a tenancy ending, a space that has to be useful again.',
      'We quote a cleanout from photographs of the whole space rather than a list of items, because what matters is volume, access and how much sorting is involved.',
      'Two kinds of cleanout have pages of their own, because the job around them is different rather than the lifting: <a class="text-link" href="/estate-cleanouts">estate and whole-property cleanouts</a>, where a family is settling a house, and <a class="text-link" href="/rental-property-cleanouts">rental turnovers</a>, where a landlord or property manager is working to a date between tenants. Everything else is this page.'
    ],
    jobsHeading: 'The cleanouts we handle',
    jobs: [
      '<strong>Garage cleanouts</strong> &mdash; the most common job we do, and usually a single visit',
      '<strong>Basement cleanouts</strong> &mdash; stairs, tight corners and decades of storage',
      '<strong>Barn and outbuilding cleanouts</strong> &mdash; mixed scrap, timber, old equipment',
      '<strong>Shed and workshop clear-outs</strong> &mdash; emptied, and taken down too if that is what you want',
      '<strong>Storage unit cleanouts</strong> &mdash; often on a deadline before the next billing date',
      '<strong>Spare room, attic and closet cleanouts</strong> &mdash; a room you want back',
      '<strong>Move-out cleanouts</strong> &mdash; everything the movers would not take, before you hand the keys over',
      '<strong>Whole-space resets before a sale or an inspection</strong> &mdash; empty, swept and photographable'
    ],
    expect: [
      {
        h: 'Tell us what stays before we start',
        p: 'This matters more on a cleanout than on any other job. Walk the space, set aside or mark anything that is staying, and make sure documents, medication, firearms, photographs and anything of sentimental value are out before we load. We work from what you point out.'
      },
      {
        h: 'A storage unit is usually a deadline, not a volume problem',
        p: 'Most storage-unit cleanouts are racing a billing date. Send the unit size and the date you need it empty by along with the photographs, and we will tell you straight away whether it is workable rather than optimistically.'
      },
      {
        h: 'Access decides a lot of the price',
        p: 'A garage with a driveway is a different job from a basement with a narrow stair and a tight turn at the bottom. Photograph the route out as well as the pile &mdash; it is the single most useful thing you can send us.'
      },
      {
        h: 'Reusable material is separated',
        p: 'Furniture, tools, metal and anything with life left in it is pulled out for reuse, donation, recycling, scrap or resale instead of being buried.'
      }
    ],
    limits: [
      'No hazardous waste, asbestos, chemicals, fuels, solvents or paint',
      'No biohazards, medical waste, or contaminated or soiled material',
      'We are not a cleaning service &mdash; we clear and sweep, we do not deep clean',
      'We do not handle legal or probate matters, only the physical clearing'
    ],
    faqs: [
      {
        q: 'Can you clean out an entire garage?',
        a: 'Yes, and it is the job we do most. Send photos of the whole space with the door open, including the path from the garage to where a truck can park.'
      },
      {
        q: 'Can you empty a basement if everything has to come up a stair?',
        a: 'Yes &mdash; that is normal and it is most of the labour on a basement job. Photograph the stair, the doorway at the top and the turn at the bottom, because those decide the price far more than the volume does.'
      },
      {
        q: 'Do you clear barns and outbuildings?',
        a: 'Yes. Barns tend to hold mixed scrap, timber, old equipment and things nobody has looked at in years, which usually means more sorting and more than one load. Photograph each building separately so the quote covers all of it.'
      },
      {
        q: 'Can you clear a storage unit before my next billing date?',
        a: 'Often, yes. Send the unit size, the facility access hours and the date it has to be empty by. We would rather tell you no than have you pay for another month because we were optimistic.'
      },
      {
        q: 'Do I need to sort everything first?',
        a: 'No. Sorting is part of the work. What you do need to do is identify what is staying, because we cannot tell a box of keepsakes from a box of junk by looking at it.'
      },
      {
        q: 'Can you do it before a property closing or a tenancy ends?',
        a: 'Send the date when you request the quote and we will tell you honestly whether it is workable. We would rather say no than miss your deadline. If it is a tenancy, the <a class="text-link" href="/rental-property-cleanouts">rental turnover page</a> covers how those jobs run.'
      }
    ],
    related: [
      { href: '/estate-cleanouts', label: 'a whole property, or an estate the family is settling' },
      { href: '/rental-property-cleanouts', label: 'a rental between tenants, on a turnover deadline' },
      { href: '/junk-removal', label: 'a single load rather than a whole space' },
      { href: '/furniture-appliance-removal', label: 'furniture and appliances on their own' },
      { href: '/light-demolition', label: 'taking down shelving, sheds or built-ins first' }
    ]
  },

  // ------------------------------------------------- rental property cleanouts
  //
  // Genuinely a different page from /cleanouts rather than the same job with
  // "rental" in front of it. The physical work overlaps; everything around it
  // does not. The reader is a landlord, a property manager or an investor, the
  // clock is a turnover date rather than a weekend, and the authorization
  // question is live in a way it never is in somebody's own garage.
  //
  // The hard constraint on this page: RYDJA clears property, and the owner or
  // their authorized agent is the one who holds -- and warrants -- the lawful
  // authority to have the contents removed. Nothing here may read as advice on
  // eviction, abandonment or tenancy law, because none of that is ours to
  // give. Every sentence that touches it points back at the customer's own
  // counsel, deliberately.
  {
    slug: 'rental-property-cleanouts',
    nav: 'Rental Cleanouts',
    card: {
      title: 'Rental Property Cleanouts',
      blurb:
        'Turnovers for landlords, property managers and investors. Abandoned furniture and household contents cleared to a date, so the unit can be relet.'
    },
    quoteService: 'Rental / property turnover',
    title: 'Rental Turnover Cleanouts Near Lowell, MI | RYDJA',
    h1: 'Rental turnover and move-out cleanouts near Lowell',
    description:
      'Rental turnover cleanouts in Lowell, Ionia and Stanton, MI for landlords and property managers: furniture, household contents, garages and storage cleared to your date.',
    lede:
      'A unit that cannot be shown is a unit that is not earning. We clear what the last tenant left so the turnover can get on with painting, cleaning and reletting.',
    intro: [
      'Rental turnovers are a timing problem before they are a volume problem. The unit is empty of people and full of things, the next showing is already in the diary, and every day it stays like that is a day of lost rent.',
      'RYDJA handles the clearing part of that: furniture, appliances, bagged household contents, the garage, the storage area, whatever is in the basement. One visit on most units, several on the bigger ones. What we hand back is an empty space the painters and cleaners can actually work in.',
      'This work comes from landlords, property managers, real-estate investors, owners and authorized agents, and it is quoted the same way as everything else &mdash; from photographs, remotely, without anyone needing to meet us at the property.'
    ],
    jobsHeading: 'Rental and turnover work we take on',
    jobs: [
      '<strong>Tenant move-out cleanouts</strong> &mdash; what was left behind once the unit is vacant and yours to clear',
      '<strong>Rental turnover clearing</strong> &mdash; the gap between one tenancy ending and the next beginning',
      '<strong>Apartment and single-unit cleanouts</strong> &mdash; one unit, one load, often one visit',
      '<strong>Abandoned furniture and household contents</strong> &mdash; beds, couches, wardrobes, white goods, bagged belongings',
      '<strong>House cleanouts after a move-out</strong> &mdash; a whole single-family rental emptied room by room',
      '<strong>Garage, basement and storage-area clearing</strong> &mdash; the parts of a unit that get forgotten until the walkthrough',
      '<strong>Multi-load and multi-unit cleanouts</strong> &mdash; a building, a block of units, or one unit that turns out to hold four trailer loads',
      '<strong>Pre-listing clearing on an investment property</strong> &mdash; getting a rental empty before it is photographed and sold'
    ],
    sections: [
      {
        h: 'Rental turnovers do not wait, so neither does the quote',
        paras: [
          'The reason this is quoted from photographs rather than from a site visit is that a site visit costs you two days you do not have. Send pictures from your phone &mdash; or have whoever did the walkthrough send theirs &mdash; and the price comes back without anybody arranging to meet.',
          'Tell us the date the unit has to be clear by when you send it. We will give you a straight answer about whether that date is workable rather than an encouraging one, because a turnover you planned around a promise we could not keep is worse than a turnover you planned around a no.'
        ]
      },
      {
        h: 'Working with property managers and owners at a distance',
        paras: [
          'Plenty of these jobs are arranged by somebody who will never be at the property. That is normal and the process is built for it.'
        ],
        list: [
          '<strong>One point of contact</strong> &mdash; you deal with the owner-operator who priced the job and who will be on site, not a dispatcher',
          '<strong>Remote approval</strong> &mdash; the quote goes to your phone or inbox and you approve it from there; nothing is scheduled until you do',
          '<strong>Access on your terms</strong> &mdash; lockbox, key handover, a code, or a maintenance contact meeting us there; tell us which when you send the request',
          '<strong>A reference on every job</strong> &mdash; each request carries its own work reference, which is the thing to quote on an invoice or in a message about it',
          '<strong>Photographs where we have them</strong> &mdash; we send pictures of the finished space, which is usually what you need for your own file',
          '<strong>Repeat work handled the same way</strong> &mdash; if you turn units over regularly, see <a class="text-link" href="/property-professionals">how RYDJA works with property professionals</a>'
        ]
      },
      {
        h: 'What has to be settled before we arrive',
        paras: [
          'This is the part that is genuinely different from clearing your own garage, and it is worth being plain about.',
          'RYDJA removes contents on the instruction of the owner or their authorized agent. By asking us to clear a unit you are confirming that you hold the lawful authority to have those contents removed and that the property is yours to let us into. That is the whole basis on which we take the job.',
          'What we do not do is decide that question for you. We are not attorneys, an eviction service, process servers or law enforcement, and we do not advise on tenancy law, notice periods, storage obligations or whether particular belongings count as abandoned. Those are real legal questions with real consequences and they belong with your own counsel or your management company&rsquo;s, not with the people loading the trailer.',
          'So: once possession is yours and the contents are yours to remove, send it through and we will clear it. If that is still unresolved, resolve it first &mdash; we would rather wait a week than be the reason a dispute gets worse.'
        ]
      }
    ],
    stepsHeading: 'How a turnover cleanout runs',
    steps: [
      {
        h: 'Send photographs and the date',
        p: 'Every room that has something in it, plus the garage, basement and any storage area. Include the route out and where a truck can park. The date it has to be clear by matters as much as the volume.'
      },
      {
        h: 'Tell us the access arrangement',
        p: 'Lockbox, code, key collection, or someone meeting us there. Also say whether anything in the unit is staying &mdash; appliances that come with the let, for instance.'
      },
      {
        h: 'We send a price',
        p: 'Based on volume, access, labour and disposal. No obligation, nothing booked, and no site visit needed to get it.'
      },
      {
        h: 'You approve it remotely',
        p: 'Approve from wherever you are. If we have proposed a time with the quote, confirming it schedules the job; if that slot does not fit the turnover, ask for another.'
      },
      {
        h: 'We clear it and tell you it is done',
        p: 'We load, haul and dispose of what you authorized, separate what can be reused, and sweep up. You get told when the unit is empty rather than having to chase it.'
      }
    ],
    expect: [
      {
        h: 'Say what stays, in writing, before we load',
        p: 'On a rental that usually means the appliances, the window blinds, anything the let includes and anything the owner is storing on site. Mark it or list it in the request. We clear what you designate and nothing else.'
      },
      {
        h: 'Personal documents are set aside, not binned',
        p: 'Paperwork turns up in abandoned contents more often than people expect. If we find documents, identification or anything that looks personal and important, we stop and set it aside for you rather than making a judgement about it.'
      },
      {
        h: 'Multi-load jobs are one price, not a running meter',
        p: 'A unit that holds four loads is quoted as a four-load job up front. If the photographs understated it materially we come back to you before carrying on &mdash; the number you approved is the number unless you agree to a different one.'
      },
      {
        h: 'We clear and sweep; we are not the cleaning crew',
        p: 'What you get back is an empty, swept space ready for your cleaners and painters. Carpet shampooing, deep cleaning, paint prep and repairs are somebody else&rsquo;s trade and we will not pretend otherwise.'
      }
    ],
    limits: [
      'No hazardous waste, asbestos, chemicals, fuels, solvents, paint or propane',
      'No biohazards, regulated medical waste, sewage, or contaminated or soiled material',
      'No pest or mould remediation &mdash; we are not a remediation contractor',
      'We are not a cleaning service: we clear and sweep, we do not deep clean or prepare surfaces',
      'No legal, eviction, notice-serving or tenancy advice of any kind, and we do not determine abandonment',
      'Nothing structural, and no repairs, patching or decorating',
      'Lawful possession, access and authority to remove the contents are yours to hold before we start'
    ],
    faqs: [
      {
        q: 'Can you clear a rental after a tenant has moved out?',
        a: 'Yes &mdash; that is the most common job on this page. Once the unit is vacant and the contents are yours to remove, send photographs and the date you need it clear by, and we will price it and take it away.'
      },
      {
        q: 'Can a property manager authorize the job without being there?',
        a: 'Yes. Quote, approval and scheduling all happen remotely, and plenty of these jobs are arranged by somebody in another city. What we need is the access arrangement, a clear statement of anything that stays, and your authorization to remove the rest.'
      },
      {
        q: 'Can you work to a turnover deadline between tenants?',
        a: 'Send the date with the request. We will tell you plainly whether it is workable &mdash; and if it is tight, what would make it work, such as splitting the job across two visits or starting with the rooms the painters need first.'
      },
      {
        q: 'What if belongings in the unit may still legally belong to the tenant?',
        a: 'Then that has to be resolved before we arrive. The owner or property manager is responsible for holding lawful authority to remove belongings from a unit, including any notice or storage obligations that apply. RYDJA does not determine whether property is abandoned and does not advise on tenancy rights &mdash; that is a question for your own attorney or management company. Once the contents are yours to clear, we will clear them.'
      },
      {
        q: 'Do you handle multiple units or a whole building?',
        a: 'Yes. Photograph each unit separately when you send the request so the quote covers all of them, and tell us whether they have to be done together or can be staged over a week or two.'
      },
      {
        q: 'Will you take appliances and furniture in the same job?',
        a: 'Yes, and that is one price rather than two. Appliances need to be unplugged, emptied and defrosted, and anything still connected to gas, water or hard wiring has to be disconnected by a licensed trade before we arrive.'
      },
      {
        q: 'How is it priced?',
        a: 'From the photographs: volume, access, labour and what disposal will cost. There is no flat per-unit rate on this page because a studio with a couch in it and a four-bedroom house with a full garage are not the same job.'
      },
      {
        q: 'Do you clean the unit afterwards?',
        a: 'We clear it and sweep it. Deep cleaning, carpets, paint and repairs are a different trade &mdash; what we hand back is an empty space your cleaners can start on the same day.'
      }
    ],
    areaNote:
      'Turnovers are usually single-unit jobs, so travel has to make sense for the size of the load. If you manage property a little outside the named communities it is still worth asking, particularly if you turn units over regularly or have more than one to clear at once.',
    related: [
      { href: '/cleanouts', label: 'a garage, basement or storage unit on its own' },
      { href: '/junk-removal', label: 'a single load of junk rather than a whole unit' },
      { href: '/furniture-appliance-removal', label: 'one abandoned couch, mattress or appliance' },
      { href: '/estate-cleanouts', label: 'an inherited property rather than a tenancy ending' },
      { href: '/property-professionals', label: 'placing this work regularly as a manager or investor' }
    ]
  },

  // ------------------------------------------------------------ yard cleanup
  {
    slug: 'yard-cleanup',
    nav: 'Yard Cleanup',
    card: {
      title: 'Yard Cleanup & Debris Removal',
      blurb:
        'Brush, branches, fallen limbs, storm debris and outdoor clutter cleared and hauled off. Material already on the ground: we are not a tree service.'
    },
    quoteService: 'Yard / brush cleanup',
    title: 'Yard Waste & Brush Removal Near Lowell, MI | RYDJA',
    h1: 'Yard cleanup, brush and storm debris removal near Lowell',
    description:
      'Brush removal, branch and fallen-limb cleanup, storm debris hauling and outdoor junk removal in Lowell, Ionia, Belding and Stanton, MI. Send photos for a quote.',
    lede:
      'Brush piles, storm damage, the corner of the yard that has been filling up for years. We clear it, load it and haul it off.',
    intro: [
      'Yard work generates volume fast, and most of it will not fit in a car or a kerbside bin. A single downed limb can be a trailer load once it is cut up, and a bad night of wind can put three of them across a lawn.',
      'We take the outdoor material and the clutter that has drifted outside with it &mdash; brush and branches, leaf and seasonal piles, storm debris, old furniture on a porch, a collapsed shed, scrap behind the garage.',
      'One honest limit up front, because it decides whether this is the right page: we clear material that is already down. We do not fell standing trees, climb, or work at height.'
    ],
    jobsHeading: 'Outdoor jobs we take on',
    jobs: [
      '<strong>Brush and branch removal</strong> &mdash; piles that have been growing at the back of a lot for years',
      '<strong>Fallen-limb cleanup</strong> &mdash; material already on the ground, cut down further where that is practical',
      '<strong>Storm debris removal</strong> &mdash; the morning after, hauled off rather than stacked at the kerb',
      '<strong>Leaf and seasonal clean-up piles</strong> &mdash; bagged or loose',
      '<strong>Old fencing, decking boards and landscape timber</strong>',
      '<strong>Outdoor junk removal</strong> &mdash; furniture, grills, play equipment, planters, the thing under the tarp',
      '<strong>Yard debris hauling</strong> &mdash; a load you have already gathered yourself and cannot shift',
      '<strong>Scrap and junk along a fence line or behind a garage</strong>',
      '<strong>General property tidy-ups</strong> &mdash; before a sale, a showing or an inspection'
    ],
    expect: [
      {
        h: 'Piles are easier to quote than scattered material',
        p: 'If the debris is already in a pile, photograph the pile with something for scale. If it is spread across the yard, step back far enough that we can see the whole area &mdash; scattered material takes longer to collect than the same volume stacked.'
      },
      {
        h: 'We bring the labour',
        p: 'You do not need to drag anything to the driveway. Tell us where it is and whether a truck and trailer can get near it.'
      },
      {
        h: 'Green waste is kept separate where it makes sense',
        p: 'Clean organic material goes where organic material should go rather than into general disposal, which is better for the landfill and sometimes better for your price.'
      }
    ],
    limits: [
      'No tree felling or climbing &mdash; we take material that is already down',
      'No stump grinding or excavation',
      'No chemically treated soil, contaminated ground or hazardous material',
      'Large volumes of dirt, concrete and masonry need checking first: weight limits are real'
    ],
    faqs: [
      {
        q: 'Can you cut up a fallen tree?',
        a: 'We handle cutting down of material that is already on the ground where it is practical, but we are not a tree service and we do not fell standing trees or work at height. If a tree is still up or leaning, call an arborist first and then call us for the removal.'
      },
      {
        q: 'Do you take dirt, sod or concrete?',
        a: 'Sometimes, in limited volumes. Weight is the limiting factor rather than space. Send a photo and tell us roughly how much, and we will tell you whether it is workable.'
      },
      {
        q: 'Can you come after a storm?',
        a: 'Send the request with photos and we will tell you where you land. Storm weeks get busy, and we would rather give you a real date than an optimistic one.'
      }
    ],
    related: [
      { href: '/junk-removal', label: 'indoor junk, household clutter and debris hauling' },
      { href: '/light-demolition', label: 'taking down a shed, deck, fence or playset' },
      { href: '/cleanouts', label: 'emptying the garage or barn while we are there' },
      { href: '/hauling-moving-help', label: 'hauling a load you have already gathered somewhere' }
    ]
  },

  // ------------------------------------------- furniture + appliance removal
  {
    slug: 'furniture-appliance-removal',
    nav: 'Furniture & Appliances',
    card: {
      title: 'Furniture & Appliance Removal',
      blurb:
        'Couch removal, mattress removal, fridges, washers and dryers. One heavy awkward item carried out and hauled off by us, not by you.'
    },
    quoteService: 'Furniture / appliance removal',
    title: 'Furniture & Appliance Removal Near Lowell, MI | RYDJA',
    h1: 'Furniture and appliance removal near Lowell, Michigan',
    description:
      'Couch, sofa, mattress, fridge, washer and dryer removal in Lowell, Ionia, Belding and Stanton, MI. Single-item pickups welcome. We carry it out, you do not.',
    lede:
      'One couch down a narrow stair, a fridge that will not fit through the door, a mattress nobody will take. Heavy single items are their own kind of problem.',
    intro: [
      'Plenty of calls are not a whole cleanout. They are one heavy, awkward thing that has to leave the building, and the real difficulty is getting it out rather than getting rid of it.',
      'That is a labour and logistics job: two people, the right angle through a doorway, and a trailer waiting outside. We would rather do that than have you hurt your back on a sleeper sofa.',
      'Single-item junk removal is a completely normal booking here &mdash; there is no minimum, and one couch is a job we quote the same way as any other. If several things are going at once, that is <a class="text-link" href="/junk-removal">junk removal and hauling</a> and usually a better price per item.'
    ],
    jobsHeading: 'What we pick up',
    jobs: [
      '<strong>Couch and sofa removal</strong> &mdash; sectionals, recliners and sleeper sofas included',
      '<strong>Mattress and box-spring removal</strong> &mdash; the item kerbside collection most often refuses',
      '<strong>Refrigerator and freezer removal</strong> &mdash; unplugged, emptied and defrosted, with the sealed system intact',
      '<strong>Washer and dryer removal</strong> &mdash; disconnected before we arrive',
      '<strong>Ovens, ranges and dishwashers</strong> &mdash; electric unplugged, or disconnected by a licensed trade',
      '<strong>Dressers, wardrobes, desks and bookcases</strong>',
      '<strong>Exercise equipment</strong> &mdash; treadmills, weight benches, rowers',
      '<strong>Pianos, safes and gun cabinets</strong> &mdash; ask first; dead weight is its own calculation',
      '<strong>Hot tubs and large outdoor items</strong> &mdash; ask first, these vary enormously'
    ],
    expect: [
      {
        h: 'Photograph the route, not just the item',
        p: 'The item is rarely the hard part. Send a photo of the doorway, the stair, the turn at the bottom and where a truck can park. That is what decides whether a job takes twenty minutes or two hours.'
      },
      {
        h: 'We disconnect the simple things',
        p: 'An unplugged appliance we can take. Anything needing a plumber, an electrician or a gas fitter has to be disconnected before we arrive &mdash; we are not licensed for that work and will not pretend otherwise.'
      },
      {
        h: 'Good items get a second life where possible',
        p: 'Furniture and appliances in working order are separated for donation or resale rather than scrapped. Tell us if something still works; it is useful to know.'
      }
    ],
    limits: [
      'We do not disconnect gas, plumbing or hard-wired electrical appliances',
      'No appliances containing leaking refrigerant or damaged sealed systems',
      'Pianos, safes and hot tubs need checking before we commit to a date',
      'Nothing contaminated, soiled or infested'
    ],
    faqs: [
      {
        q: 'Do I need to get it outside first?',
        a: 'No. Carrying it out is the job. Just make sure the path is clear and tell us about stairs, tight turns and anything fragile along the way.'
      },
      {
        q: 'Can you take a fridge or freezer?',
        a: 'Yes, as long as it is unplugged, emptied and defrosted, and the sealed system is intact. Appliances with damaged or leaking refrigerant lines need specialist handling we do not offer.'
      },
      {
        q: 'Will you take just one item?',
        a: 'Yes. Single-item pickups are a normal part of the work and there is no minimum load. Send a photo and we will price it like any other job.'
      },
      {
        q: 'Do you take mattresses? Nobody else will.',
        a: 'Yes, mattresses and box springs both. They are bulky rather than heavy and they are one of the most common single items we are called for, precisely because kerbside collection usually refuses them.'
      },
      {
        q: 'Can you take a washer and dryer out of a basement?',
        a: 'Yes, as long as they have been disconnected from the water, drain and gas before we arrive. The carrying is ours; the plumbing is not &mdash; we are not licensed for that work and will not pretend otherwise.'
      }
    ],
    related: [
      { href: '/junk-removal', label: 'a mixed load rather than one item' },
      { href: '/cleanouts', label: 'emptying a whole room, garage or basement' },
      { href: '/rental-property-cleanouts', label: 'furniture a tenant left behind in a rental' },
      { href: '/hauling-moving-help', label: 'moving something rather than disposing of it' }
    ]
  },

  // ------------------------------------------------- hauling + moving labour
  {
    slug: 'hauling-moving-help',
    nav: 'Hauling & Moving Help',
    // A real photograph of the actual truck and trailer -- the same equipment
    // that turns up to the job. It is already on /service-area; this page is
    // literally about loading and hauling, so it is the one service page an
    // existing genuine asset fits without reaching for stock.
    images: {
      afterIntro: {
        base: 'rydja-truck-trailer',
        width: 1000,
        height: 563,
        alt: 'A pickup and trailer loaded with furniture and household items for a haul'
      }
    },
    card: {
      title: 'Hauling, Delivery & Moving Help',
      blurb:
        'When the thing has somewhere to go: local hauling, furniture delivery, Marketplace and auction pickups, loading and unloading help. Labour-only is fine.'
    },
    quoteService: 'Moving / delivery help',
    title: 'Moving Labor & Local Hauling Near Lowell, MI | RYDJA',
    h1: 'Moving help, loading and local hauling near Lowell',
    description:
      'Local hauling, furniture delivery, Marketplace and auction pickups, single-item transport and loading or unloading help across Lowell, Ionia, Belding and Stanton, MI.',
    lede:
      'Sometimes nothing needs throwing away &mdash; it just needs moving, and you do not have a truck or a second pair of hands.',
    intro: [
      'This is the job where the thing has somewhere to go. A purchase that will not fit in your car, a delivery across town, furniture moving between two rooms or two houses, a load to the transfer station you would rather not make yourself.',
      'That destination is the whole difference between this page and <a class="text-link" href="/junk-removal">junk removal and hauling</a>. There, material leaves and does not come back. Here it is transport: we bring the vehicle and the labour, and where it goes is up to you.'
    ],
    jobsHeading: 'What hauling and moving help covers',
    jobs: [
      '<strong>Marketplace pickups</strong> &mdash; the thing you bought that will not fit in your car',
      '<strong>Auction and estate-sale pickups</strong> &mdash; collected and delivered, often on the sale&rsquo;s own deadline',
      '<strong>Local furniture delivery</strong> &mdash; a purchase, a gift, a piece moving between family houses',
      '<strong>Appliance and material delivery</strong> &mdash; picked up from the store or the yard and brought to you',
      '<strong>Loading and unloading help</strong> &mdash; labour only, for a truck or container you have already hired',
      '<strong>Moving help</strong> &mdash; heavy items between rooms, floors or properties on moving day',
      '<strong>Single-item transport</strong> &mdash; one piece, one trip, where a car will not do',
      '<strong>Hauling a gathered load somewhere</strong> &mdash; to disposal, to donation, to storage'
    ],
    expect: [
      {
        h: 'Tell us both ends of the job',
        p: 'Pickup and drop-off both matter: the access, the stairs, the parking, and whether anyone will be there. A job that is easy at one end and impossible at the other is still impossible.'
      },
      {
        h: 'Labour-only is a real option',
        p: 'If you have the truck and need the muscle, that is a job we will quote. You do not have to use our vehicle to use our time.'
      },
      {
        h: 'We are not a licensed moving company',
        p: 'We are a local hauling and labour operation. For a full household relocation with valuation coverage, a licensed mover is the right call, and we will say so rather than take the work.'
      }
    ],
    limits: [
      'Not a licensed interstate or long-distance moving company',
      'No hazardous material, fuels or chemicals in transit',
      'Pianos, safes and similar need checking before we commit',
      'We do not pack, crate or provide moving insurance'
    ],
    faqs: [
      {
        q: 'Can you pick something up I bought online?',
        a: 'Yes &mdash; Marketplace and auction pickups are common. Send the item details, the pickup address and where it needs to go, and we will quote the round trip.'
      },
      {
        q: 'Can I hire just the labour?',
        a: 'Yes. If you have a truck or a container and need loading or unloading, send the details and we will price the time rather than the vehicle.'
      },
      {
        q: 'Can you move my whole house?',
        a: 'For a full household move with coverage for your belongings, use a licensed mover. We are the right call for loads, single items, labour and the awkward jobs around the edges of a move.'
      }
    ],
    related: [
      { href: '/furniture-appliance-removal', label: 'removing a heavy item rather than moving it' },
      { href: '/junk-removal', label: 'getting rid of what the movers left' },
      { href: '/estate-cleanouts', label: 'clearing a whole property after a move or a death' },
      { href: '/yard-cleanup', label: 'clearing the yard before a sale' }
    ]
  },

  // ---------------------------------------------------------- light demolition
  {
    slug: 'light-demolition',
    nav: 'Light Demolition',
    card: {
      title: 'Shed Removal & Light Demolition',
      blurb:
        'Sheds, playsets, fences, small decks, shelving and cabinets taken down and hauled away in one job. Non-structural work only.'
    },
    quoteService: 'Light demolition',
    title: 'Shed Removal & Light Demolition Near Lowell, MI | RYDJA',
    h1: 'Shed removal and light demolition near Lowell',
    description:
      'Shed removal, playset and fence removal, small deck tear-downs and shelving or cabinet removal in Lowell, Ionia, Belding and Stanton, MI. Non-structural only, debris hauled away.',
    lede:
      'Some things have to come apart before they can leave. Sheds, playsets, fences, small decks and built-in units &mdash; taken down and taken away in one job.',
    intro: [
      'Light demolition is tear-down plus haul-away. The point is that you are left with a clear space, not a pile of broken timber and a second problem.',
      'The word to pay attention to is <strong>light</strong>. This is non-structural work: nothing holding a building up, nothing requiring an engineer, nothing we are not equipped for.'
    ],
    jobsHeading: 'What we take down',
    jobs: [
      '<strong>Shed removal</strong> &mdash; garden sheds and small outbuildings, dismantled and hauled off',
      '<strong>Playset and swing-set removal</strong> &mdash; including trampolines and the frame nobody has used in years',
      '<strong>Fence removal</strong> &mdash; fencing, gates and posts',
      '<strong>Small deck removal</strong> &mdash; low decks, porches and raised platforms',
      '<strong>Shelving removal</strong> &mdash; garage shelving, workbenches and built-in storage',
      '<strong>Cabinet removal</strong> &mdash; old cabinetry, closet systems and panelling, non-structural only',
      '<strong>Small concrete pads and walkways</strong> &mdash; ask first, weight limits apply',
      '<strong>Tear-down and haul-away as one job</strong> &mdash; the debris leaves with us'
    ],
    expect: [
      {
        h: 'The debris goes with us',
        p: 'Tear-down and removal are one job, not two. We do not leave the material stacked at the kerb for you to deal with afterwards.'
      },
      {
        h: 'Check for permits before you book',
        p: 'Some tear-downs need a permit or a utility disconnection, depending on your municipality and what is attached. That is your responsibility to arrange, and we will tell you if we think a job looks like it needs one.'
      },
      {
        h: 'Older structures need a careful look',
        p: 'Anything built before the 1990s can contain material we are not equipped to handle. If something looks like it might, we will stop and tell you rather than press on.'
      }
    ],
    limits: [
      'Non-structural only &mdash; nothing load-bearing, no building demolition',
      'No asbestos, lead paint abatement or any regulated material',
      'No gas, electrical or plumbing disconnection &mdash; arrange a licensed trade first',
      'No excavation, foundations or heavy machinery work',
      'Permits, approvals and utility shut-offs are the property owner’s responsibility'
    ],
    faqs: [
      {
        q: 'Can you take down my shed and remove it the same day?',
        a: 'Usually yes &mdash; on most sheds the tear-down and the haul-away are a single visit. Send photos of the structure and of how we get a trailer near it.'
      },
      {
        q: 'Can you demolish part of my house?',
        a: 'No. We do not touch anything structural or anything that forms part of a building’s envelope. That is a licensed demolition contractor’s work and it is the right call for it.'
      },
      {
        q: 'What if there is asbestos?',
        a: 'We stop. We are not equipped or permitted for asbestos, lead abatement or any regulated material, and we will not guess. You will need a licensed abatement contractor before we can carry on.'
      }
    ],
    related: [
      { href: '/junk-removal', label: 'hauling the debris from work you have already done' },
      { href: '/yard-cleanup', label: 'clearing the brush and yard debris around it' },
      { href: '/cleanouts', label: 'emptying the shed or garage before the tear-down' },
      { href: '/estate-cleanouts', label: 'clearing a whole property, outbuildings included' }
    ]
  }
];

/**
 * Every field of a page that reaches the browser through <%= %> rather than
 * <%- %>, paired with its name.
 *
 * The distinction is not cosmetic. A card blurb is plain text, a <title> and a
 * meta description are attribute values, and a heading is interpolated
 * escaped -- so "hauled off &mdash; by us" in any of them is rendered to the
 * reader literally, ampersand and semicolon included. The prose fields (lede,
 * intro, jobs, the paragraphs and lists inside sections, faq answers, related
 * labels) are rendered raw and may use entities and markup freely.
 *
 * Kept in step with views/service-page.ejs by hand, which is why it is written
 * out rather than inferred: if a field moves from <%= %> to <%- %> or back,
 * this list is the thing to change with it.
 */
function escapedFields(page) {
  const out = [
    ['nav', page.nav],
    ['title', page.title],
    ['description', page.description],
    ['h1', page.h1],
    ['jobsHeading', page.jobsHeading],
    ['card.title', page.card.title],
    ['card.blurb', page.card.blurb]
  ];
  if (page.stepsHeading) out.push(['stepsHeading', page.stepsHeading]);
  (page.steps || []).forEach((s, i) => out.push([`steps[${i}].h`, s.h]));
  (page.expect || []).forEach((e, i) => out.push([`expect[${i}].h`, e.h]));
  (page.sections || []).forEach((b, i) => out.push([`sections[${i}].h`, b.h]));
  (page.faqs || []).forEach((f, i) => out.push([`faqs[${i}].q`, f.q]));
  return out;
}

const BY_SLUG = new Map(PAGES.map((p) => [p.slug, p]));

// This array is the marketing service catalog, full stop. The homepage grid,
// the services hub, the service-area list, the offer catalog, the routes and
// the sitemap all read from it, and there is deliberately no second list of
// services anywhere -- there used to be, in server.js, and it drifted: it
// named five services with different wording, linked almost none of them to
// the pages that already existed, and omitted one page entirely.
//
// A card without a page is the shape of that bug, so it cannot be written
// here: every entry must carry the copy its card needs and the quote-form
// option its CTA prefills. A missing one fails at require time rather than
// quietly shipping a card that links nowhere or a lead labelled something
// nothing else recognises.
for (const page of PAGES) {
  for (const field of ['slug', 'nav', 'title', 'h1', 'description', 'lede', 'quoteService']) {
    if (!page[field]) throw new Error(`service page "${page.slug || '?'}" is missing ${field}`);
  }
  if (!page.card || !page.card.title || !page.card.blurb) {
    throw new Error(`service page "${page.slug}" needs card.title and card.blurb to appear in a list`);
  }
  for (const rel of page.related || []) {
    if (rel.href === '/' + page.slug) throw new Error(`service page "${page.slug}" lists itself as related work`);
  }

  // These five are rendered escaped -- a card is plain text, a <title> and a
  // meta description are attribute values. An HTML entity written into one of
  // them is shown to the reader as its own source: "hauled off &mdash; by us".
  // Prose fields (lede, intro, jobs, expect, sections, faqs) are rendered raw
  // and may use entities and markup freely; these may not.
  for (const [field, value] of escapedFields(page)) {
    if (/&[a-zA-Z#][a-zA-Z0-9]*;/.test(value)) {
      throw new Error(
        `service page "${page.slug}" has an HTML entity in ${field}, which is rendered escaped ` +
        `and would be shown to the reader as its own source: ${value}`
      );
    }
    if (/<[a-zA-Z/]/.test(value)) {
      throw new Error(`service page "${page.slug}" has markup in ${field}, which is rendered escaped`);
    }
  }
}

module.exports = { SERVICE_PAGES: PAGES, servicePage: (slug) => BY_SLUG.get(slug) || null };
