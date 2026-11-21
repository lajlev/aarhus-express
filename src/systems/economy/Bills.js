/**
 * BillService: the bills ledger, reminders, debt collection and wage garnishment.   OWNER: economy specialist
 * Created by EconomySystem as `economy.bills`. Everything is in in-game days of the economy clock.
 *
 * state.economy.bills[] = { id, kind: 'fine'|'loan', label, amount, fees, paidPart, issuedDay, dueDay, reminders,
 *                           status: 'open'|'collection'|'paid', source, collectionDay }
 *   owed(b) = amount + fees - paidPart.
 * LIFE OF A BILL (numbers in data/finance.js BILLS)
 *   issued         due in 7 days (police fines: police/traffic/index.js issue() -> economy.bills.issue()).
 *   past due       reminder ("rykker"): +100 kr fee, due again 3 days later. Pager + ECON_EV.BILL_REMINDER.
 *   3 reminders    the next missed due date goes to debt collection ("inkasso"): +500 kr fee, status 'collection',
 *                  ECON_EV.BILL_COLLECTION.
 *   collection     while ANY bill is in collection, 30% of every job payout (positive REQUEST_PAY whose reason is not a
 *                  loan/gambling reason) is garnished and applied to the oldest collection bill first (ECON_EV.GARNISHED).
 *   paid           pay(id) in the Bills tab (full amount incl. fees) or garnished down to 0. ECON_EV.BILL_PAID.
 * Infinite money: a bill is paid the moment it is issued (auto-pay) and never reaches the ledger as open.
 * Rent is NOT a bill: it keeps its own auto-debit / arrears flow (HomeService).
 */
import { bus, pager } from '../../core/events.js';
import { opt } from '../../core/options.js';
import { BILLS } from '../../data/finance.js';
import { ECON_EV } from './events.js';
import { dayName } from './HomeService.js';

const kr = (n) => `kr ${Math.round(n).toLocaleString('da-DK')}`;
export const dueLabel = (day) => dayName(day).slice(0, 3);

export class BillService {
  constructor(ctx, eco) {
    this.ctx = ctx;
    this.eco = eco;
    const e = ctx.state.economy;
    e.bills ||= [];
    e.billSeq ||= 1;
    this.list = e.bills;
  }

  get st() { return this.ctx.state.economy; }
  today() { return this.eco.getClock().day; }
  owed(b) { return Math.max(0, b.amount + b.fees - (b.paidPart || 0)); }
  open() { return this.list.filter((b) => b.status !== 'paid'); }
  total() { return this.open().reduce((s, b) => s + this.owed(b), 0); }
  collecting() { return this.list.some((b) => b.status === 'collection'); }
  overdue() { return this.list.some((b) => b.status !== 'paid' && (b.reminders > 0 || b.status === 'collection')); }

  /** Create a bill. Returns the bill (already status 'paid' under infinite money). */
  issue({ kind = 'fine', label, amount, source = 'Politiet', status = 'open' }) {
    const d = this.today();
    const b = {
      id: `b${this.st.billSeq++}`, kind, label, amount: Math.round(amount), fees: 0, paidPart: 0, issuedDay: d,
      dueDay: d + BILLS.dueDays, reminders: 0, status, source, collectionDay: status === 'collection' ? d : null,
    };
    this.list.push(b);
    bus.emit(ECON_EV.BILL_ISSUED, { bill: b });
    if (opt('infiniteMoney')) this.pay(b.id, true);
    return b;
  }

  /** Pay one bill in full. Returns { ok, reason?, paid? }. */
  pay(id, auto = false) {
    const b = this.list.find((q) => q.id === id);
    if (!b || b.status === 'paid') return { ok: false, reason: 'No such bill' };
    const owe = this.owed(b);
    if (!auto && !opt('infiniteMoney') && this.eco.getMoney() < owe) return { ok: false, reason: `You need ${kr(owe)}` };
    this.eco.pay(-owe, `bill: ${b.label}`, 'other');
    b.paidPart = (b.paidPart || 0) + owe;
    b.status = 'paid';
    bus.emit(ECON_EV.BILL_PAID, { bill: b, amount: owe, auto });
    if (auto) pager(`Bill paid automatically: ${b.label} (${kr(owe)}).`, 'info', b.source);
    return { ok: true, paid: owe };
  }

  /** Pay every open bill you can afford, oldest first. Returns the number paid. */
  payAll() {
    let n = 0;
    for (const b of this.open()) if (this.pay(b.id).ok) n++;
    return n;
  }

  /** Called by EconomySystem for every positive job payout. Returns { net, cut }. */
  garnish(amount) {
    if (!(amount > 0) || !this.collecting() || opt('infiniteMoney')) return { net: amount, cut: 0 };
    let room = this.list.filter((b) => b.status === 'collection').reduce((s, b) => s + this.owed(b), 0);
    let cut = Math.min(Math.round(amount * BILLS.garnish), room);
    if (cut <= 0) return { net: amount, cut: 0 };
    const taken = cut;
    for (const b of this.list) {
      if (b.status !== 'collection' || cut <= 0) continue;
      const part = Math.min(cut, this.owed(b));
      b.paidPart = (b.paidPart || 0) + part;
      cut -= part;
      if (this.owed(b) <= 0) { b.status = 'paid'; bus.emit(ECON_EV.BILL_PAID, { bill: b, amount: part, auto: false, garnished: true }); }
    }
    room = this.list.filter((b) => b.status === 'collection').reduce((s, b) => s + this.owed(b), 0);
    bus.emit(ECON_EV.GARNISHED, { amount: taken, of: amount, remaining: room });
    pager(`${BILLS.collector} took ${kr(taken)} (30%) of your pay.${room > 0 ? ` Still owed: ${kr(room)}.` : ' Debt cleared.'}`, 'warn', BILLS.collector);
    return { net: amount - taken, cut: taken };
  }

  /** Daily tick (midnight of day d). */
  onDay(d) {
    for (const b of this.list) {
      if (b.status === 'paid') continue;
      if (b.status === 'open') {
        if (d >= b.dueDay) {
          if (b.reminders < BILLS.maxReminders) {
            b.reminders++;
            b.fees += BILLS.reminderFee;
            b.dueDay = d + BILLS.reminderDays;
            bus.emit(ECON_EV.BILL_REMINDER, { bill: b, n: b.reminders });
            pager(`Rykker ${b.reminders}/${BILLS.maxReminders}: ${b.label}. +${kr(BILLS.reminderFee)} fee. Pay ${kr(this.owed(b))} by ${dueLabel(b.dueDay)} [J > Bills].`, 'warn', b.source);
          } else {
            b.status = 'collection';
            b.collectionDay = d;
            b.fees += BILLS.collectionFee;
            bus.emit(ECON_EV.BILL_COLLECTION, { bill: b });
            pager(`INKASSO: ${b.label} was sent to ${BILLS.collector}. +${kr(BILLS.collectionFee)} fee, now ${kr(this.owed(b))}. They take ${Math.round(BILLS.garnish * 100)}% of every job payout until it is paid.`, 'crime', BILLS.collector);
          }
        } else if (d === b.dueDay - BILLS.warnDays) {
          pager(`Bill due tomorrow: ${b.label} (${kr(this.owed(b))}) [J > Bills].`, 'info', b.source);
        }
      }
    }
  }
}
