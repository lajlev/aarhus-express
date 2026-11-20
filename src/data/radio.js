// Public live-stream candidates; runtime availability is not guaranteed.
// Official player links are the fallback. See README audio notes before release.
// Never proxy, download or bundle broadcasts with the game.
export const RADIO_STATIONS = [
  {
    id: 'gofm', name: 'go!FM · Aarhus',
    url: 'https://radioserver.dk/gofm',
    page: 'https://radio.side-walk.dk/webplayer/gofm',
  },
  {
    id: 'dr-p3', name: 'DR P3 · Danmark',
    url: 'https://live-icy.dr.dk/A/A05H.mp3',
    page: 'https://www.dr.dk/lyd/live/p3',
  },
  {
    id: 'dr-p4-ostjylland', name: 'DR P4 · Østjylland',
    url: 'https://live-icy.dr.dk/A/A14H.mp3',
    page: 'https://www.dr.dk/lyd/live/p4aarhus',
  },
];
