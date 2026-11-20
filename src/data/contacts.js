// Mission contacts per city: fictional people standing at real landmark ids
// (see map.landmarks). OWNER: MissionSystem. `jobs` are template ids (src/data/missions.js).
// `marker`: 'pager' (ring + beeper) or 'phone' (phone booth) drawn in the world.
export const CONTACTS = {
  aarhus: [
    { id: 'mette', name: 'Mette Mosegaard', at: 'streetfood', marker: 'phone', blurb: 'Runs a lunch courier collective.', legal: true, jobs: ['foodRush'] },
    { id: 'bjorn', name: 'Bjørn "Flyttekassen" Holm', at: 'godsbanen', marker: 'pager', blurb: 'Moves flats for students, cash in hand.', legal: true, jobs: ['movingHelp'] },
    { id: 'kaj', name: 'Taxa-Kaj', at: 'aarhush', marker: 'phone', blurb: 'Retired cabbie who still hands out fares.', legal: true, jobs: ['taxiFare'] },
    { id: 'ravn', name: 'Ravn', at: 'containerhavn', marker: 'pager', blurb: 'Nobody knows what is in the boxes.', legal: false, jobs: ['smuggle', 'hotCar'] },
    { id: 'sille', name: 'Sille "Nøglen"', at: 'randersvej', marker: 'phone', blurb: 'Fills "orders" for very specific cars.', legal: false, jobs: ['stealModel'] },
  ],
};

export const getContacts = (cityId) => CONTACTS[cityId] || [];
