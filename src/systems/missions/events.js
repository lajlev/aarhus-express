// Mission-specific events (namespaced 'mission:'), emitted by MissionSystem.
// The standard job events (EV.JOB_*) carry the main flow; these add detail for the HUD.
export const MISSION_EV = {
  ACCEPTED: 'mission:accepted', //          { job }  offer accepted (state.job now set)
  OFFER_CANCELLED: 'mission:offerCancelled', // { job, reason: 'declined'|'left'|'busy' }
  TARGET: 'mission:target', //              { x, y, name, action, stageIndex, job } or { job: null } when none
  TIMER: 'mission:timer', //                { job, timeLeft, timeLimit }  ~4x per second while a timer runs
  LOADING: 'mission:loading', //            { job, t }  0..1 while loading at a pickup marker, t=0 when it stops
  CARGO: 'mission:cargo', //                { job, damage, integrity }  integrity 1..0 for fragile cargo / passengers
  HINT: 'mission:hint', //                  { text }  short context hint ("Need a van (capacity 5)")
};

// Career events (namespaced 'jobs:'), emitted by systems/missions/careers/*. Not in core/events.js (lead-only);
// import { JOBS_EV } from '../systems/missions/events.js'.
export const JOBS_EV = {
  SIGNED_UP: 'jobs:signedUp', //          { career }                         signed up in the app (taxi, bus)
  SHIFT_STARTED: 'jobs:shiftStarted', //  { career, shift }                  taxi/bus shift began (company vehicle spawned)
  SHIFT_ENDED: 'jobs:shiftEnded', //      { career, ok, reason, pay, shift } shift over (pay already requested for bus)
  FARE: 'jobs:fare', //                   { job, fare, tip, km, minutes, hardBrakes } taxi fare paid
  FARE_HAIL: 'jobs:fareHail', //          { job, where }                     a passenger is hailing (offer auto-accepts, [N] refuses)
  BUS_STOP: 'jobs:busStop', //            { index, name, served, skipped, lateness, onTime, boarded, alighted } lateness in s (+ late)
  OFFERS: 'jobs:offers', //               { offers }                         courier offer list changed
  LEVEL_UP: 'jobs:levelUp', //            { career, level }
  RATING: 'jobs:rating', //               { rating }                         courier rating changed (1..5)
};

// Task events (namespaced 'tasks:'), emitted by the TaskBoard (systems/missions/tasks/TaskBoard.js).
export const TASKS_EV = {
  CHANGED: 'tasks:changed', //             { }                                the active list, tracked task or board changed (HUD/app refresh)
  TRACKED: 'tasks:tracked', //             { job }                            the tracked task changed (Tab or auto)
  GIG_SPAWNED: 'tasks:gigSpawned', //      { gig }                            a street gig appeared on the board
  EVENT_STARTED: 'tasks:eventStarted', //  { event }                          a city event began (announced on the pager and as a HUD banner)
  EVENT_ENDED: 'tasks:eventEnded', //      { event }
  CHALLENGE_OFFERED: 'tasks:challengeOffered', // { challenge }                a quick challenge was offered
};
