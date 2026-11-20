// Economy-owned events (namespaced 'economy:'). OWNER: economy / home & vehicles specialist.
export const ECON_EV = {
  MILESTONE: 'economy:milestone', //   { n, lq, skillPointsGained, skillPoints }
  BUY_FAILED: 'economy:buyFailed', //  { id, reason }
  LQ_DECAY: 'economy:lqDecay', //      { lq, delta }  (also emits EV.LQ_CHANGED)
  // ---- home & rent ----
  RENT_DUE: 'economy:rentDue', //      { amount, dueDay, stage: 'reminder'|'due' }  reminder = the day before, due = midnight it falls due
  RENT_PAID: 'economy:rentPaid', //    { amount, paidUntilDay, auto, late }  late = it was overdue
  RENT_LATE: 'economy:rentLate', //    { amount, daysLate, stage: 'late'|'warning'|'evicted' }
  SLEPT: 'economy:slept', //           { day, hour, lqGained, healed }
  MOVED: 'economy:moved', //           { tier, name, rent }
  WEEK: 'economy:week', //             { summary }  a finished week (income vs costs), see getWeeklySummary()
  // ---- vehicles ----
  VEHICLE_BOUGHT: 'economy:vehicleBought', //   { type, price, shop }
  VEHICLE_RENTED: 'economy:vehicleRented', //   { type, days, price, shop, endsAt }
  RENTAL_ENDED: 'economy:rentalEnded', //       { type, shop }  expired and returned automatically
  VEHICLE_REPAIRED: 'economy:vehicleRepaired', // { type, cost }
  INSURANCE: 'economy:insurance', //            { premium, paid }  weekly premium for owned cars/scooters
};

/** Defensive: the traffic/police specialist may emit this when the driving licence is suspended or restored.
 *  Accepted payloads: { banned: bool, until?: gameDay|ms }, { active: bool }, { suspended: bool } (any one). */
export const LICENCE_EV = 'police:licence';
