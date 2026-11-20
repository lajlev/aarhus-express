// Traffic rules and fines: tuning. Fines in kr (Danish-style "boede"), distances in metres, times in seconds of play.
export const RULES = {
  /** Multiplies every fine (1 = realistic Danish values). */
  FINE_SCALE: 1,
  // ---- driving licence: "klip i koerekortet" ----
  CLIPS_TO_BAN: 3, //     clips that trigger a temporary driving ban on cars (bikes stay allowed)
  BAN_SECONDS: 240, //    length of the ban
  CLIP_DECAY: 600, //     seconds of clean driving after which one clip is removed
  BAN_DRIVE_FINE: 3000, // driving a car while banned (once per BAN_DRIVE_COOLDOWN)
  BAN_DRIVE_COOLDOWN: 40,
  // ---- speeding ----
  SPEED_TOL_KMH: 5, //    over the limit by more than this is an offence (the HUD sign turns red at the same point)
  /** [over limit as a fraction, fine, clips]; first tier whose `over` is >= the measured excess applies. */
  SPEED_TIERS: [[0.2, 1000, 0], [0.4, 2000, 1], [0.6, 3000, 1], [Infinity, 4000, 2]],
  CAMERA_RADIUS: 24, //   m: a fotovogn measures speed inside this radius
  CAMERA_COUNT: 8,
  CAMERA_SPACING: 450, // m minimum between two cameras
  CAMERA_MIN_ROAD: 10, // m: only roads at least this wide
  CAMERA_ACTIVATE: 150, // m: the van is spawned when the player is this close (despawned beyond CAMERA_DESPAWN)
  CAMERA_DESPAWN: 280,
  CAMERA_COOLDOWN: 14, // s per camera
  SPEED_COOLDOWN: 8, //   s between speeding fines overall
  // ---- patrol cars (AI police cars in normal traffic that ticket on sight) ----
  PATROL_COUNT: 1,
  PATROL_RESPAWN: [35, 80], // s until a lost patrol is replaced
  PATROL_SIGHT: 42, //    m, with line of sight
  PATROL_SPAWN_MIN: 85, PATROL_SPAWN_MAX: 150,
  // ---- red light ----
  RED_FINE: 2000, RED_CLIPS: 1, RED_BIKE_FINE: 1000,
  RED_MIN_SPEED: 2.0, //  m/s: above walking speed
  RED_GRACE: 0.4, //      s the light must have been red
  RED_COOLDOWN: 6,
  // ---- dangerous driving ----
  RAM_FINE: 1500, RAM_CLIPS: 1, RAM_MIN_IMPACT: 3, RAM_COOLDOWN: 12,
  PARKED_FINE: 600, PARKED_MIN_IMPACT: 4, PARKED_COOLDOWN: 12,
  PAVEMENT_FINE: 800, PAVEMENT_SPEED: 4, // m/s on a pavement or in a pedestrian zone
  PAVEMENT_WITNESS_T: 1.0, PAVEMENT_REPORT_T: 4.0, // seconds: patrol sees it / a passer-by reports it
  PAVEMENT_COOLDOWN: 25,
  WRONGWAY_FINE: 1500, WRONGWAY_CLIPS: 1, WRONGWAY_BIKE_FINE: 500, WRONGWAY_SPEED: 3,
  WRONGWAY_WITNESS_T: 1.2, WRONGWAY_REPORT_T: 4.0, WRONGWAY_COOLDOWN: 25,
  // ---- injuries (traffic:injury byPlayer, mayhem off) ----
  INJURY_FINE: 8000, INJURY_CLIPS: 2, INJURY_RATING: 15,
  KILL_FINE: 25000, KILL_CLIPS: 3, KILL_RATING: 30,
  INJURY_COOLDOWN: 4,
};
