// Tunables for the whole game. Distances are world units, times are seconds.

export const ARENA_HALF = 92;           // arena spans [-ARENA_HALF, ARENA_HALF] on x and z
export const ARENA_MIN_HALF = 22;       // sudden death stops shrinking here
export const SUDDEN_DEATH_AT = 40;      // seconds into a round before the walls close in
export const SHRINK_RATE = 2.4;         // units per second the arena closes during sudden death
export const SHRINK_RATE_FAST = 5.5;    // faster once the player is out, so rounds wrap up quickly

export const BASE_SPEED = 26;           // cruising speed with the throttle held
export const BOOST_MULT = 1.5;
export const ACCEL = 17;                // throttle acceleration (u/s^2)
export const BOOST_ACCEL = 30;
export const COAST_DRAG = 3.2;          // slow-down with no throttle
export const BRAKE_DECEL = 34;
export const TURN_RATE = 2.5;           // rad/s at speed; scales down below TURN_FULL_SPEED
export const TURN_FULL_SPEED = 7;       // so bikes can't spin on the spot (min turn radius ~2.8u)
export const STEER_RESPONSE = 14;       // how quickly steering reaches full lock
export const IDLE_SPEED = 1.5;          // below this you're "standing still"
export const IDLE_LIMIT = 5;            // seconds standing still before you derez

export const BOOST_DRAIN = 0.42;        // full meter lasts ~2.4s
export const BOOST_REGEN = 0.07;        // passive regen per second
export const GRIND_DIST = 3.2;          // riding closer than this to a parallel wall grinds
export const GRIND_REGEN = 0.75;        // regen per second at full grind strength

export const GRAVITY = 36;
export const JUMP_V = 14.4;             // jump takeoff speed: ~2.9m high, ~0.8s of air
export const JUMP_TIME = (2 * JUMP_V) / GRAVITY;
export const JUMP_RECHARGE = 7;         // seconds for the jump to recharge
export const PAD_SPEED = 44;            // boost pads fling you to this speed
export const GHOST_TIME = 3.5;          // ghost pickup: ride through light walls this long
export const PICKUP_RESPAWN = 12;
export const PORTAL_R = 3.4;

export const WALL_HEIGHT = 1.45;
export const CLIMB_STEP = 0.45;         // taller than this is a cliff: ride into it and you crash
export const WALL_THICK = 0.14;
export const HIT_PAD = 0.1;             // collision padding around wall lines
export const OWN_SKIP = 2.2;            // your own freshest wall (this far behind the nose) can't hit you
export const COMMIT_ANGLE = 0.06;       // trail gets a new corner once heading drifts this far (rad)
export const BIKE_HIT_RADIUS = 0.85;    // bike-to-bike collision distance
export const DEREZ_TIME = 1.3;          // how long a dead rider's walls take to dissolve

export const ROUND_END_DELAY = 2.2;
export const WIN_POINTS = 3;
export const KILL_POINTS = 1;
export const MATCH_POINTS = 15;

// Heading angle θ: forward = (sin θ, -cos θ). θ = 0 faces north (-z); steering right increases θ.
export const fwdX = (a) => Math.sin(a);
export const fwdZ = (a) => -Math.cos(a);

export const RIDERS = [
  { name: 'YOU',  color: 0x22e8ff, css: '#22e8ff', bot: false },
  { name: 'VOLT', color: 0xff7a18, css: '#ff7a18', bot: true, persona: 'hunter' },
  { name: 'NOVA', color: 0xff38d6, css: '#ff38d6', bot: true, persona: 'survivor' },
  { name: 'RAZE', color: 0xc8ff2e, css: '#c8ff2e', bot: true, persona: 'wild' },
];

// Bot skill presets. "pilot" is the default: decent, beatable, occasionally dumb.
export const DIFFICULTY = {
  rookie: { label: 'ROOKIE', look: 0.34, react: 0.14, blunder: 0.3,  late: 0.1,  aggro: 0.25, spaceCap: 260, boostUse: 0.4, jumpSense: 0.55, think: 0.07, steerGain: 2.2 },
  pilot:  { label: 'PILOT',  look: 0.44, react: 0.09, blunder: 0.14, late: 0.05, aggro: 0.55, spaceCap: 520, boostUse: 0.7, jumpSense: 0.8,  think: 0.05, steerGain: 3.0 },
  ace:    { label: 'ACE',    look: 0.56, react: 0.045, blunder: 0.04, late: 0.012, aggro: 0.85, spaceCap: 950, boostUse: 1.0, jumpSense: 1.0, think: 0.035, steerGain: 4.0 },
};
