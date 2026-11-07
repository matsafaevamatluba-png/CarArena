// cars.js — 20 машин. Чем новее машина, тем она дороже и чуть лучше по характеристикам.
// Разница в характеристиках небольшая, чтобы игра оставалась честной.

export const KINDS = {
  hatch:    { len: 3.0, wid: 1.7, h: 0.62, wr: 0.38, cl: 1.5, ch: 0.55, co: -0.1 },
  sedan:    { len: 3.4, wid: 1.75, h: 0.62, wr: 0.38, cl: 1.7, ch: 0.55, co: -0.15 },
  pickup:   { len: 3.5, wid: 1.8, h: 0.7, wr: 0.42, cl: 1.1, ch: 0.6, co: 0.55, bed: true },
  coupe:    { len: 3.3, wid: 1.8, h: 0.55, wr: 0.38, cl: 1.5, ch: 0.48, co: -0.2 },
  buggy:    { len: 2.9, wid: 1.9, h: 0.45, wr: 0.5, cl: 1.0, ch: 0.5, co: 0, cage: true },
  suv:      { len: 3.4, wid: 1.9, h: 0.8, wr: 0.5, cl: 2.0, ch: 0.65, co: -0.1 },
  muscle:   { len: 3.6, wid: 1.9, h: 0.6, wr: 0.42, cl: 1.4, ch: 0.5, co: -0.3, stripe: true },
  roadster: { len: 3.2, wid: 1.8, h: 0.5, wr: 0.38, cl: 0.9, ch: 0.3, co: -0.1 },
  cabrio:   { len: 3.4, wid: 1.8, h: 0.52, wr: 0.38, cl: 1.0, ch: 0.3, co: -0.15 },
  rally:    { len: 3.2, wid: 1.8, h: 0.6, wr: 0.42, cl: 1.4, ch: 0.55, co: -0.1, spoiler: true, stripe: true },
  sport:    { len: 3.5, wid: 1.9, h: 0.48, wr: 0.38, cl: 1.4, ch: 0.42, co: -0.2, spoiler: true },
  dragster: { len: 3.8, wid: 1.7, h: 0.5, wr: 0.42, cl: 1.0, ch: 0.4, co: 0.1, spoiler: true, stripe: true },
  monster:  { len: 3.4, wid: 2.1, h: 0.9, wr: 0.95, cl: 1.5, ch: 0.7, co: -0.1 },
  electric: { len: 3.5, wid: 1.85, h: 0.55, wr: 0.4, cl: 1.8, ch: 0.5, co: -0.1, stripe: true },
  hyper:    { len: 3.7, wid: 2.0, h: 0.42, wr: 0.38, cl: 1.3, ch: 0.38, co: -0.2, spoiler: true },
  futuro:   { len: 3.6, wid: 2.0, h: 0.4, wr: 0.36, cl: 1.2, ch: 0.36, co: 0, spoiler: true, stripe: true },
};

// speed — максимальная скорость, accel — разгон, turn — поворот (рад/с), mass — вес (тяжёлых сложнее отбросить)
const C = (name, rarity, price, kind, color, accent, speed, accel, turn, mass, extra = {}) => ({
  name, rarity, price, kind, body: KINDS[kind], color, accent, speed, accel, turn, mass, ...extra,
});

export const CARS = [
  C('Классик',       'common',    0,     'hatch',    0xd9534f, 0xffffff, 14.5, 26, 4.6, 1.00),
  C('Хэтчбек',       'common',    150,   'hatch',    0x3b82f6, 0xffffff, 14.8, 27, 4.8, 0.95),
  C('Седан',         'common',    250,   'sedan',    0x2ec27e, 0x1f2937, 15.0, 27, 4.5, 1.05),
  C('Пикап',         'common',    400,   'pickup',   0xf5a524, 0x1f2937, 14.6, 25, 4.2, 1.25),
  C('Купе',          'common',    600,   'coupe',    0x9b5de5, 0xffffff, 15.4, 28, 4.8, 1.00),
  C('Багги',         'common',    800,   'buggy',    0xffd23f, 0x222222, 15.2, 28, 5.2, 0.90),
  C('Внедорожник',   'rare',      1100,  'suv',      0x56752f, 0xd9d9d9, 15.0, 27, 4.4, 1.35),
  C('Мускул',        'rare',      1500,  'muscle',   0x111827, 0xff3b30, 15.9, 30, 4.4, 1.20),
  C('Родстер',       'rare',      2000,  'roadster', 0x00b4d8, 0xffffff, 16.0, 30, 5.0, 0.95),
  C('Ралли',         'rare',      2600,  'rally',    0xf4f4f4, 0x1e63d6, 16.2, 31, 5.2, 1.00),
  C('Спорткар',      'rare',      3300,  'sport',    0xe11d48, 0x111111, 16.5, 32, 4.9, 1.00),
  C('Кабриолет',     'rare',      4000,  'cabrio',   0xff7ab6, 0xffffff, 16.3, 31, 5.0, 1.05),
  C('Дрэг',          'epic',      4800,  'dragster', 0xfacc15, 0x111111, 16.8, 34, 4.4, 1.10),
  C('Монстр',        'epic',      5800,  'monster',  0x16a34a, 0xfacc15, 16.2, 30, 4.1, 1.50),
  C('Электрокар',    'epic',      7000,  'electric', 0xe5e7eb, 0x22d3ee, 16.9, 35, 5.1, 1.05, { glow: 0x22d3ee }),
  C('Тюнинг',        'epic',      8500, 'sport',    0xff5d00, 0x0ea5e9, 17.0, 35, 5.3, 1.10, { glow: 0xd946ef }),
  C('Гиперкар',      'legendary', 10000, 'hyper',    0xffd700, 0x111111, 17.4, 36, 5.2, 1.10, { glow: 0xffd700 }),
  C('Футуро',        'legendary', 12000, 'futuro',   0x38bdf8, 0xf0abfc, 17.5, 37, 5.4, 1.10, { glow: 0xf0abfc }),
  C('Призрак',       'legendary', 14500, 'sport',    0xb8c4ff, 0x6366f1, 17.6, 38, 5.5, 1.15, { glow: 0x818cf8, ghost: true }),
  C('Легенда',       'legendary', 18000, 'hyper',    0xef4444, 0xffd700, 17.8, 40, 5.6, 1.20, { glow: 0xffd700 }),
].map((c, i) => ({ ...c, id: i }));
