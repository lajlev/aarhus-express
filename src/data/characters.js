// Playable characters. All fictional. Add up to 20 by appending entries:
// look colours drive the generated sprite (see world/textures.js), `bonus`
// adds levels on top of purchased skills (see core/state.js skillLevel()).
// Skill keys: driving, stamina, charm, streetSmarts, navigation.
export const CHARACTERS = [
  {
    id: 'freja',
    name: 'Freja Bønne',
    title: 'Latinerkvarteret barista',
    bio: 'Pulls the best cortado on Mejlgade and knows every regular by name. Customers tip her out of pure loyalty.',
    look: { shirt: 0x6b4a33, hair: 0xc8552b, skin: 0xf1c7a5, accent: 0xefe6d6, hat: 'bun' },
    bonus: { charm: 1 },
    startMoney: 300,
  },
  {
    id: 'kasper',
    name: 'Kasper "Kæmpe" Vestergaard',
    title: 'AGF superfan',
    bio: 'Has not missed a home match at Ceres Park since 2009. Knows every back alley from the stadium to the pub.',
    look: { shirt: 0xf4f4f4, hair: 0xd9b25c, skin: 0xf0c29a, accent: 0x1d4ea3, hat: 'scarf' },
    bonus: { streetSmarts: 1 },
    startMoney: 200,
  },
  {
    id: 'noor',
    name: 'Noor Haddad',
    title: 'ARoS art student',
    bio: 'Sketches the city from the rainbow panorama and has a mental map of every shortcut between galleries.',
    look: { shirt: 0x2a9d8f, hair: 0x1d1a1a, skin: 0xc68c62, accent: 0xe9c46a, hat: 'beanie' },
    bonus: { navigation: 1 },
    startMoney: 250,
  },
  {
    id: 'henning',
    name: 'Henning Kran',
    title: 'Harbour dock worker',
    bio: 'Thirty years of lifting containers at the harbour. Shrugs off bumps that would floor anyone else.',
    look: { shirt: 0xf28c28, hair: 0x8a8a8a, skin: 0xe8b48f, accent: 0x2b2b2b, hat: 'cap' },
    bonus: { stamina: 1 },
    startMoney: 350,
  },
  {
    id: 'ingrid',
    name: 'Ingrid Sporvogn',
    title: 'Retired tram driver',
    bio: 'Drove the old tram lines and later the Letbane. Takes corners like she still runs on rails.',
    look: { shirt: 0x3a5a8c, hair: 0xe6e6e6, skin: 0xf3cfb3, accent: 0xb8312f, hat: 'glasses' },
    bonus: { driving: 1 },
    startMoney: 400,
  },
];

export const getCharacter = (id) => CHARACTERS.find((c) => c.id === id);
