// Bills, debt collection and quick loans: tuning and flavour text. OWNER: economy specialist.
// All days are in-game days of the economy clock (1 real second = 1 in-game minute, a day = 24 real minutes).
// Everything here is satire and original: "Kvikke Kasper" and "Krav & Klem Inkasso" are invented, not real companies.

export const BILLS = {
  dueDays: 7, //            a new bill is due this many days after it is issued
  reminderDays: 3, //       each reminder ("rykker") moves the due date this far
  reminderFee: 100, //      kr added per reminder
  maxReminders: 3, //       the 4th missed due date goes to debt collection ("inkasso")
  collectionFee: 500, //    kr added when it goes to collection
  garnish: 0.3, //          the collector takes this share of every job payout while any debt is in collection
  warnDays: 1, //           pager nudge this many days before a due date
  collector: 'Krav & Klem Inkasso',
};

/** REQUEST_PAY reasons that are NOT job income (never garnished). Everything else positive is job pay. */
export const NON_INCOME_PREFIXES = ['loan', 'gamble', 'bet', 'refund'];

export const LOAN = {
  brand: 'Kvikke Kasper',
  tagline: 'Lån på 2 sekunder. Tænk bagefter.',
  minAmount: 1000,
  maxAmount: 10000,
  step: 1000,
  weeklyRate: 0.3, //       30% interest per week, compounding on what is still owed
  setupFixed: 149, //       kr "oprettelsesgebyr" ...
  setupPct: 0.06, //        ... plus this share of the amount; both are added to the debt, not deducted from the payout
  weeks: 4, //              equal weekly instalments (annuity)
  missedFee: 500, //        a missed instalment goes to collection with this fee on top
  maxActive: 2,
  // pager ads: at most one per in-game day, more likely when you are broke or have an overdue bill
  adBaseChancePerHour: 0.05,
  adBrokeChancePerHour: 0.14, // money below adBrokeBelow
  adBrokeBelow: 300,
  adOverdueChancePerHour: 0.2, // some bill past its due date
};

export const LOAN_ADS = [
  'Tom for kroner? Kvikke Kasper har 5.000 kr til dig om 2 sekunder. Rente? Kun 30% om ugen!',
  'KVIKKE KASPER: Din husleje betaler sig ikke selv. Vores renter betaler sig selv. Tryk J.',
  'Pssst. Du ser lidt fattig ud. Lån op til 10.000 kr nu. Små bogstaver findes i appen.',
  'Kvikke Kasper: "Vi spørger ikke hvorfor." Det er det eneste vi ikke spørger om.',
  'Ny regning? Gammel regning? Nyt lån! Kvikke Kasper i telefonen (J), fanen Lån.',
  'Gratis at ansøge. Næsten gratis at låne. Dyrt at betale tilbage. Kvikke Kasper.',
  'Alle vil have penge. Vi giver dem. Mod 30% om ugen. Kvikke Kasper: det er ikke ulovligt.',
];
export const LOAN_ADS_OVERDUE = [
  'Rykker i postkassen? Kvikke Kasper lader dig låne til at betale den. Så skylder du bare os i stedet.',
  'Inkasso i hælene? Kvikke Kasper: nye problemer, hurtigere end de gamle.',
];
export const LOAN_ADS_BROKE = [
  'Kontoen er tom? Det er Kvikke Kasper ikke. Op til 10.000 kr, ingen spørgsmål.',
  'Dit saldo ser trist ud. Lad os gøre det til et trist lån i stedet. Kvikke Kasper.',
];

/** Pure helpers: the same numbers the app shows and the loan service charges. */
export function loanQuote(amount, cfg = LOAN) {
  const principal = Math.round(amount);
  const fee = Math.round(cfg.setupFixed + principal * cfg.setupPct);
  const debt = principal + fee; // what the interest runs on
  const r = cfg.weeklyRate, n = cfg.weeks;
  const pmt = Math.ceil((debt * r) / (1 - Math.pow(1 + r, -n)));
  const schedule = [];
  let bal = debt;
  for (let k = 1; k <= n; k++) {
    const interest = Math.round(bal * r);
    bal = bal + bal * r - pmt;
    schedule.push({ week: k, payment: pmt, interest, balance: Math.max(0, Math.round(bal)) });
  }
  const total = pmt * n;
  // effective weekly rate of the cash flows (you get `principal`, you pay `pmt` n times): bisection on the weekly IRR
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    let pv = 0;
    for (let k = 1; k <= n; k++) pv += pmt / Math.pow(1 + mid, k);
    if (pv > principal) lo = mid; else hi = mid;
  }
  const weekly = (lo + hi) / 2;
  const apr = Math.pow(1 + weekly, 52) - 1; // EU-style "ÅOP": effective annual rate, compounding weekly
  return { principal, fee, debt, pmt, n, total, cost: total - principal, schedule, weeklyEffective: weekly, apr };
}

/** Balance still owed after `paid` instalments (what "settle now" costs). */
export function loanBalance(quote, paid) {
  if (paid <= 0) return quote.debt;
  const row = quote.schedule[Math.min(paid, quote.n) - 1];
  return row ? row.balance : 0;
}

/** Human-readable APR for the app: tiny numbers stay plain, absurd ones get a unit. */
export function fmtApr(apr) {
  const pct = apr * 100;
  if (pct >= 1e9) return `${(pct / 1e9).toFixed(1).replace('.', ',')} mia. %`;
  if (pct >= 1e6) return `${(pct / 1e6).toFixed(1).replace('.', ',')} mio. %`;
  return `${Math.round(pct).toLocaleString('da-DK')} %`;
}
