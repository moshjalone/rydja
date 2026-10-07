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
    nav: 'Estate Cleanouts',
    // The quote form's own option for this work. The nav label is shorter than
    // the form's wording, and a CTA has to prefill something the select
    // actually offers -- server.js checks that at boot.
    quoteService: 'Estate / whole-property cleanout',
    title: 'Estate Cleanouts in West Michigan | RYDJA',
    h1: 'Estate and whole-property cleanouts',
    description:
      'Estate, inherited-home and whole-property cleanouts across West Michigan. House, garage, basement, barn and outbuildings cleared. Send photos for a quote.',
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
          'What we need from you is the same in every case: the authority to have the contents removed, safe and lawful access to the property, and a clear statement of what stays. We handle the physical clearing only &mdash; we are not involved in probate, title, tenancy law or anything an attorney should be handling, and we will say so rather than offer an opinion we have no business having.'
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
    related: [
      { href: '/cleanouts', label: 'a single garage, basement or storage unit rather than a whole property' },
      { href: '/junk-removal', label: 'one load of household junk, with no sorting involved' },
      { href: '/hauling-moving-help', label: 'moving or delivering the things you are keeping' },
      { href: '/light-demolition', label: 'taking down shelving, sheds or built-ins once a space is empty' }
    ]
  },

  // ------------------------------------------------------------------ junk
  {
    slug: 'junk-removal',
    nav: 'Junk Removal',
    title: 'Junk Removal in West Michigan | RYDJA',
    h1: 'Junk removal in West Michigan',
    description:
      'Local junk removal and hauling: household junk, furniture, appliances, scrap and debris. Send photos and get a price back, with no obligation.',
    lede:
      'The pile in the corner of the garage, the couch nobody wants, the load that will not fit in your car. Send photos, get a price, and we take it away.',
    intro: [
      'Junk removal is the core of what RYDJA does. You point at what needs to go, we load it, and we haul it off. Most jobs are one visit, and you do not have to be the one lifting anything.',
      'We work from photos rather than a sales visit. That means you get a real number without anyone standing in your kitchen, and we arrive already knowing what we are picking up and what it will take.'
    ],
    jobsHeading: 'Typical junk removal jobs',
    jobs: [
      'Single items &mdash; a couch, a mattress, a fridge, a treadmill',
      'The slow accumulation in a garage, shed or spare room',
      'Boxes, bags and household clutter after a sort-out',
      'Old furniture left behind by a tenant or a previous owner',
      'Scrap metal, appliances and anything else with a bit of weight to it',
      'Construction offcuts and small amounts of renovation debris',
      'A truckload of mixed junk you simply want gone'
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
      }
    ],
    limits: [
      'No hazardous waste, asbestos, chemicals, fuels, solvents or paint',
      'No biohazards, medical waste or anything contaminated',
      'No propane tanks, batteries or anything that should not go in a trailer',
      'Anything you want to keep needs pointing out before we load'
    ],
    faqs: [
      {
        q: 'What kinds of junk do you take?',
        a: 'Household junk, furniture, appliances, scrap metal, yard waste, renovation debris and general clutter. If it is physical property work and it is not on the exclusion list above, it is probably a yes &mdash; send a photo and ask.'
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
      { href: '/cleanouts', label: 'clearing a whole garage, basement or storage unit' },
      { href: '/estate-cleanouts', label: 'emptying an entire house or property' },
      { href: '/furniture-appliance-removal', label: 'single furniture and appliance pickups' },
      { href: '/hauling-moving-help', label: 'hauling and moving labour' }
    ]
  },

  // -------------------------------------------------------------- cleanouts
  {
    slug: 'cleanouts',
    nav: 'Cleanouts',
    title: 'Cleanouts in West Michigan | RYDJA',
    h1: 'Garage, basement and property cleanouts',
    description:
      'Full cleanouts across West Michigan: garages, basements, barns, storage units, rental turnovers and estates. Photo quotes, no obligation.',
    lede:
      'A cleanout is a whole space emptied, not a single pickup. Garages, basements, barns, storage units, rentals and estates &mdash; we clear the lot and leave the floor swept.',
    intro: [
      'Cleanouts are the jobs where a space has to come back to empty. They tend to be bigger, slower and more personal than a straight junk pickup, and they are usually happening because something else is going on: a move, a sale, a tenancy ending, a family member who has died.',
      'We quote a cleanout from photos of the whole space rather than a list of items, because what matters is volume, access and how much sorting is involved.'
    ],
    jobsHeading: 'The cleanouts we handle',
    jobs: [
      '<strong>Garage cleanouts</strong> &mdash; the most common job we do, and usually a single visit',
      '<strong>Basement cleanouts</strong> &mdash; stairs, tight corners and decades of storage',
      '<strong>Barn and outbuilding cleanouts</strong> &mdash; mixed scrap, timber, old equipment',
      '<strong>Storage unit cleanouts</strong> &mdash; often on a deadline before the next billing date',
      '<strong>Rental and property cleanouts</strong> &mdash; turnovers, abandoned belongings, getting a unit relettable',
      '<strong>Estate cleanouts</strong> &mdash; handled carefully, at whatever pace the family needs',
      '<strong>Moving cleanouts</strong> &mdash; everything the movers would not take'
    ],
    expect: [
      {
        h: 'Tell us what stays before we start',
        p: 'This matters more on a cleanout than on any other job. Walk the space, set aside or mark anything that is staying, and make sure documents, medication, firearms, photographs and anything of sentimental value are out before we load. We work from what you point out.'
      },
      {
        h: 'Estate work goes at your pace',
        p: 'Estate cleanouts are rarely just a volume problem. If the family needs to go through things first, or wants certain items kept back, say so and we will plan around it rather than around our schedule.'
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
        q: 'Do I need to sort everything first?',
        a: 'No. Sorting is part of the work. What you do need to do is identify what is staying, because we cannot tell a box of keepsakes from a box of junk by looking at it.'
      },
      {
        q: 'Can you do it before a property closing or a tenancy ends?',
        a: 'Send the date when you request the quote and we will tell you honestly whether it is workable. We would rather say no than miss your deadline.'
      }
    ],
    related: [
      { href: '/estate-cleanouts', label: 'a whole property, or an estate the family is settling' },
      { href: '/junk-removal', label: 'a single load rather than a whole space' },
      { href: '/furniture-appliance-removal', label: 'furniture and appliances on their own' },
      { href: '/light-demolition', label: 'taking down shelving, sheds or built-ins first' }
    ]
  },

  // ------------------------------------------------------------ yard cleanup
  {
    slug: 'yard-cleanup',
    nav: 'Yard Cleanup',
    title: 'Yard Cleanup & Debris Removal | RYDJA',
    h1: 'Yard cleanup and debris removal',
    description:
      'Brush, branches, storm debris, leaves and outdoor clutter cleared and hauled away across West Michigan. Send photos for a quote.',
    lede:
      'Brush piles, storm damage, the corner of the yard that has been filling up for years. We clear it, load it and haul it off.',
    intro: [
      'Yard work generates volume fast, and most of it will not fit in a car or a kerbside bin. A single downed limb can be a trailer load once it is cut up.',
      'We take the outdoor material and the clutter that has drifted outside with it &mdash; old furniture on a porch, a collapsed shed, scrap behind the garage.'
    ],
    jobsHeading: 'Outdoor jobs we take on',
    jobs: [
      'Brush, branches and cut limbs',
      'Storm debris after a bad night',
      'Leaf and seasonal clean-up piles',
      'Old fencing, decking boards and landscape timber',
      'Outdoor furniture, grills, play equipment and planters',
      'Scrap and junk that has accumulated behind a garage or along a fence line',
      'General property tidy-ups before a sale or an inspection'
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
      { href: '/hauling-moving-help', label: 'hauling a load you have already gathered' },
      { href: '/junk-removal', label: 'indoor junk and household clutter' },
      { href: '/light-demolition', label: 'taking down a shed, deck or fence' }
    ]
  },

  // ------------------------------------------- furniture + appliance removal
  {
    slug: 'furniture-appliance-removal',
    nav: 'Furniture & Appliances',
    title: 'Furniture & Appliance Removal | RYDJA',
    h1: 'Furniture and appliance removal',
    description:
      'Couch, mattress, fridge, washer and other heavy single-item removals across West Michigan. We carry it out, you do not.',
    lede:
      'One couch down a narrow stair, a fridge that will not fit through the door, a mattress nobody will take. Heavy single items are their own kind of problem.',
    intro: [
      'Plenty of calls are not a whole cleanout. They are one heavy, awkward thing that has to leave the building, and the real difficulty is getting it out rather than getting rid of it.',
      'That is a labour and logistics job: two people, the right angle through a doorway, and a trailer waiting outside. We would rather do that than have you hurt your back on a sleeper sofa.'
    ],
    jobsHeading: 'What we pick up',
    jobs: [
      'Sofas, sectionals, recliners and sleeper sofas',
      'Mattresses and box springs',
      'Fridges, freezers, washers, dryers, ovens and dishwashers',
      'Dressers, wardrobes, desks and bookcases',
      'Pianos, safes, gun cabinets and other dead weight &mdash; ask first',
      'Exercise equipment and treadmills',
      'Hot tubs and large outdoor items &mdash; ask first, these vary enormously'
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
        a: 'Yes. Single-item pickups are a normal part of the work. Send a photo and we will price it like any other job.'
      }
    ],
    related: [
      { href: '/junk-removal', label: 'a mixed load rather than one item' },
      { href: '/cleanouts', label: 'emptying a whole room or garage' },
      { href: '/hauling-moving-help', label: 'moving something rather than disposing of it' }
    ]
  },

  // ------------------------------------------------- hauling + moving labour
  {
    slug: 'hauling-moving-help',
    nav: 'Hauling & Moving Help',
    title: 'Hauling & Moving Help | RYDJA',
    h1: 'Hauling and moving help',
    description:
      'A truck, a trailer and the labour to load it: local hauling, delivery, Marketplace pickups and labour-only moving help in West Michigan.',
    lede:
      'Sometimes nothing needs throwing away &mdash; it just needs moving, and you do not have a truck or a second pair of hands.',
    intro: [
      'This is the job where the thing has somewhere to go. A purchase that will not fit in your car, a delivery across town, furniture moving between two rooms or two houses, a load to the transfer station you would rather not make yourself.',
      'We bring the vehicle and the labour. Where it goes is up to you.'
    ],
    jobsHeading: 'What hauling and moving help covers',
    jobs: [
      'Marketplace, auction and estate-sale pickups',
      'Local delivery of furniture, appliances and materials',
      'Labour-only help loading or unloading a truck you have already hired',
      'Moving heavy items between rooms, floors or properties',
      'Hauling a load you have already gathered to disposal or donation',
      'Single-item transport where a car will not do',
      'An extra set of hands on moving day'
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
    title: 'Light Demolition & Debris Hauling | RYDJA',
    h1: 'Light demolition and debris hauling',
    description:
      'Sheds, decks, fences, playsets and built-ins taken down and hauled away in West Michigan. Non-structural work only, debris included.',
    lede:
      'Some things have to come apart before they can leave. Sheds, decks, fences, playsets and built-in units &mdash; taken down and taken away in one job.',
    intro: [
      'Light demolition is tear-down plus haul-away. The point is that you are left with a clear space, not a pile of broken timber and a second problem.',
      'The word to pay attention to is <strong>light</strong>. This is non-structural work: nothing holding a building up, nothing requiring an engineer, nothing we are not equipped for.'
    ],
    jobsHeading: 'What we take down',
    jobs: [
      'Garden sheds and small outbuildings',
      'Decks, porches and raised platforms',
      'Fencing and gates',
      'Playsets, swing sets and trampolines',
      'Garage shelving, workbenches and built-in storage',
      'Non-structural interior fittings &mdash; old cabinetry, closet systems, panelling',
      'Small concrete pads and walkways &mdash; ask first, weight limits apply'
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
      { href: '/yard-cleanup', label: 'clearing the yard around it' },
      { href: '/cleanouts', label: 'emptying the space before the tear-down' }
    ]
  }
];

const BY_SLUG = new Map(PAGES.map((p) => [p.slug, p]));

module.exports = { SERVICE_PAGES: PAGES, servicePage: (slug) => BY_SLUG.get(slug) || null };
