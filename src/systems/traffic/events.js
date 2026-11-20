// Events owned by the traffic system (namespaced, not part of core EV).
export const TRAFFIC_EV = {
  HONK: 'traffic:honk', //                 { x, y, vehicle }
  PED_DOWN: 'traffic:pedestrianDown', //   { x, y, killed, byPlayer, vehicle }
  CAR_PANIC: 'traffic:carPanic', //        { vehicle, mode: 'flee'|'angry' }  an AI car was rammed
  INJURY: 'traffic:injury', //            { severity: 1|2, byPlayer, killed, x, y, vehicle }  mayhem OFF: a pedestrian/cyclist was knocked down. NOT a CRIME: the traffic-rules/fines module penalises byPlayer ones.
};
