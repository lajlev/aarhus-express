/**
 * LoanService: "Kvikke Kasper" quick loans (kviklån), a satirical payday lender.   OWNER: economy specialist
 * Created by EconomySystem as `economy.loans`. Available in EVERY game (not an option). Money only: no LQ effects.
 *
 * Offer: 1,000..10,000 kr in 1,000 steps, instantly. Terms (data/finance.js LOAN): setup fee 149 kr + 6% (added to the debt),
 * 30% interest per week compounding, repaid in 4 equal weekly instalments (annuity). loanQuote(amount) gives the honest
 * numbers the app shows: you get, total to repay, cost, the schedule and an EU-style APR ("ÅOP") which is absurd on purpose.
 * Example: 5,000 kr -> debt 5,449 -> 4 x 2,515 kr = 10,060 kr (cost 5,060, APR in the hundreds of millions of percent).
 *
 * state.economy.loans[] = { id, principal, fee, debt, pmt, n, takenDay, nextDay, paid, missed, status: 'active'|'closed', early }
 * AUTO-DEBIT: at midnight of takenDay+7k the instalment is debited (reason 'loan instalment'). If the money is not there, the
 * instalment goes to a bill in COLLECTION at once (kind 'loan', +500 kr fee), garnishing job pay like any inkasso (Bills.js), and the
 * schedule continues. settle(id) repays the remaining balance early with no penalty.
 * PAGER ADS: onHour() sends at most ONE ad per in-game day; the hourly chance is higher when money is low or a bill is overdue.
 * Reasons start with 'loan' so loan money is never garnished and never counts as income or earnings.
 */
import { bus, pager } from '../../core/events.js';
import { opt } from '../../core/options.js';
import { BILLS, LOAN, LOAN_ADS, LOAN_ADS_BROKE, LOAN_ADS_OVERDUE, loanQuote, loanBalance } from '../../data/finance.js';
import { ECON_EV } from './events.js';
import { WEEK_DAYS } from './HomeService.js';

const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length) % a.length];

export class LoanService {
  constructor(ctx, eco) {
    this.ctx = ctx;
    this.eco = eco;
    const e = ctx.state.economy;
    e.loans ||= [];
    e.loanSeq ||= 1;
    e.loanAdDay ??= -1;
    this.list = e.loans;
    this.rng = Math.random; // tests may replace
  }

  get st() { return this.ctx.state.economy; }
  active() { return this.list.filter((l) => l.status === 'active'); }
  quote(amount) { return loanQuote(amount); }
  amounts() { const a = []; for (let v = LOAN.minAmount; v <= LOAN.maxAmount; v += LOAN.step) a.push(v); return a; }
  /** Instalments still to come (not paid and not missed). */
  left(l) { return l.n - l.paid - l.missed; }
  balance(l) { return loanBalance(this.quote(l.principal), l.paid + l.missed); }
  /** Sum of the instalments still ahead (what the schedule will still pull). */
  remainingTotal(l) { return this.left(l) * l.pmt; }

  take(amount) {
    amount = Math.round(amount);
    if (amount < LOAN.minAmount || amount > LOAN.maxAmount) return { ok: false, reason: 'Amount not offered' };
    if (this.active().length >= LOAN.maxActive) return { ok: false, reason: `Max ${LOAN.maxActive} loans at a time` };
    const q = this.quote(amount), d = this.eco.getClock().day;
    const l = { id: `l${this.st.loanSeq++}`, principal: q.principal, fee: q.fee, debt: q.debt, pmt: q.pmt, n: q.n, takenDay: d, nextDay: d + WEEK_DAYS, paid: 0, missed: 0, status: 'active', early: false };
    this.list.push(l);
    this.eco.pay(amount, 'loan', 'other', { income: false });
    bus.emit(ECON_EV.LOAN_TAKEN, { loan: l });
    pager(`${LOAN.brand}: ${kr(amount)} is in your account. ${q.n} x ${kr(q.pmt)} will be debited weekly (total ${kr(q.total)}). Thanks for choosing us!`, 'warn', LOAN.brand);
    return { ok: true, loan: l };
  }

  settle(id) {
    const l = this.list.find((q) => q.id === id && q.status === 'active');
    if (!l) return { ok: false, reason: 'No such loan' };
    const owe = this.balance(l);
    if (!opt('infiniteMoney') && this.eco.getMoney() < owe) return { ok: false, reason: `You need ${kr(owe)}` };
    this.eco.pay(-owe, 'loan settled', 'other');
    l.status = 'closed';
    l.early = true;
    bus.emit(ECON_EV.LOAN_CLOSED, { loan: l, early: true });
    pager(`Loan settled early: ${kr(owe)}. Kvikke Kasper is sad to see you go.`, 'info', LOAN.brand);
    return { ok: true, paid: owe };
  }

  onDay(d) {
    for (const l of this.list) {
      if (l.status !== 'active') continue;
      while (l.status === 'active' && d >= l.nextDay) {
        l.nextDay += WEEK_DAYS;
        const k = l.paid + l.missed + 1;
        if (opt('infiniteMoney') || this.eco.getMoney() >= l.pmt) {
          this.eco.pay(-l.pmt, 'loan instalment', 'other');
          l.paid++;
          bus.emit(ECON_EV.LOAN_PAYMENT, { loan: l, amount: l.pmt, n: k });
          pager(`${LOAN.brand}: instalment ${k}/${l.n} debited, ${kr(l.pmt)}.`, 'warn', LOAN.brand);
        } else {
          l.missed++;
          const bill = this.eco.bills.issue({ kind: 'loan', label: `Kviklån instalment ${k}/${l.n}`, amount: l.pmt, source: LOAN.brand, status: 'collection' });
          bill.fees += LOAN.missedFee;
          bus.emit(ECON_EV.LOAN_MISSED, { loan: l, bill });
          pager(`Missed ${LOAN.brand} instalment ${k}/${l.n}: ${kr(this.eco.bills.owed(bill))} (incl. ${kr(LOAN.missedFee)} fee) sent to inkasso. They take 30% of your job pay.`, 'crime', BILLS.collector);
        }
        if (l.paid + l.missed >= l.n) { l.status = 'closed'; bus.emit(ECON_EV.LOAN_CLOSED, { loan: l, early: false }); }
      }
    }
  }

  /** Ad chance for this hour, 0 when one was already sent today. */
  adChance() {
    const d = this.eco.getClock().day;
    if (this.st.loanAdDay === d) return 0;
    if (this.active().length >= LOAN.maxActive) return 0;
    let p = LOAN.adBaseChancePerHour;
    if (this.eco.getMoney() < LOAN.adBrokeBelow && !opt('infiniteMoney')) p = Math.max(p, LOAN.adBrokeChancePerHour);
    if (this.eco.bills.overdue()) p = Math.max(p, LOAN.adOverdueChancePerHour);
    return p;
  }

  sendAd(force = false) {
    const d = this.eco.getClock().day;
    if (!force && this.st.loanAdDay === d) return null;
    this.st.loanAdDay = d;
    let pool = LOAN_ADS;
    if (this.eco.bills.overdue()) pool = LOAN_ADS_OVERDUE;
    else if (this.eco.getMoney() < LOAN.adBrokeBelow) pool = LOAN_ADS_BROKE;
    const text = pick(pool, this.rng);
    bus.emit(ECON_EV.LOAN_AD, { text });
    pager(text, 'warn', LOAN.brand);
    return text;
  }

  onHour() {
    const p = this.adChance();
    if (p > 0 && this.rng() < p) this.sendAd();
  }
}
