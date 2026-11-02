// Числа, от которых зависит, как ощущается герой: скорости, высоты, расход сил.

export const G = 22, WALK = 4.6, RUN = 7.0, JUMP = 7.0;
export const SAFE_FALL = 6, DEADLY_FALL = 32;
export const CLIMB_UP = 1.5, CLIMB_DOWN = 2.1, CLIMB_SIDE = 1.7, WALL_OFF = 0.42;
export const HANG = 1.9;                                   // руки над ногами, когда висим
export const ROPE_MIN = 1.0, ROPE_MAX = 75, ROPE_DOWN = 5, ROPE_UP = 2.2;
export const HOOK_RANGE = 14;
export const ZIP_RANGE = 7;
export const COST = { run: 8, jump: 3, climb: 6.5, hang: 2.2, grab: 10, rope: 1.2, ropeUp: 7, regen: 22 };
