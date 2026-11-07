// sim.js — вся логика матча без графики (поэтому её можно тестировать в Node)

export const R_FLAT = 78;   // радиус ровной арены (в начале матча)
export const RAMP_LEN = 7;  // длина наклонной стены
export const R_TOP = R_FLAT + RAMP_LEN; // радиус верхнего края стены (в начале матча)
export const SHRINK_START = 40; // через сколько секунд боя начинает подниматься лава
export const SHRINK_RATE = 1.0;  // на сколько сужается арена в секунду
export const SPEED_MUL = 1.35;   // общий множитель скорости машин (арена большая)
export const MIN_R = 3;         // до какого радиуса арена сужается (две машины уже не помещаются)
export const MIN_RAMP = 0.3;    // какой длины становится стена в конце (почти обрыв)
// кольца платформ со способностями: [радиус, сколько штук]
const PAD_RINGS = [[18, 4], [44, 8], [66, 6]];
export const WALL_H = 9;    // высота стены
export const MAX_HP = 100;  // здоровье машины
export const DMG = { missile: 9, blast: 5, glove: 7, arrow: 2.5 }; // урон от способностей
export const LAVA_Y = -3.2; // уровень лавы
export const CAR_R = 1.5;   // радиус столкновения машины
export const ABILITIES = ['shield', 'missile', 'blast', 'bow', 'glove'];

const TAU = Math.PI * 2;
// slope — насколько сильно стена тянет машину обратно на арену
// brake — торможение, когда стик отпущен; coast — как быстро гаснет скорость сверх потолка (после удара)
// rampCoast — как быстро гаснет скорость на стене: чем меньше, тем легче вылететь за стену своим ходом
export const TUNE = { slope: 26, brake: 1.2, coast: 1.5, rampCoast: 1.0 };
const RAMP_GRIP = 0.2; // на стене колёса почти не цепляются
export const KNOCK = { missile: 24, blast: 22, glove: 28, arrow: 14 }; // сила ударов

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function createWorld(entries) {
  const w = {
    time: 0,
    playT: 0,
    rFlat: R_FLAT, // текущий радиус арены (уменьшается, когда поднимается лава)
    rTop: R_TOP,
    shrinking: false,
    state: 'countdown', // countdown -> play -> ended
    countdown: 3.2,
    endT: 0,
    cars: [],
    pads: [],
    shots: [],
    events: [],
    winner: null,
    playerId: -1,
  };
  const n = entries.length;
  const off = Math.random() * TAU;
  entries.forEach((e, i) => {
    const a = off + (i / n) * TAU;
    const c = {
      id: i,
      name: e.name,
      def: e.def,
      isPlayer: !!e.isPlayer,
      x: Math.cos(a) * R_FLAT * 0.55,
      z: Math.sin(a) * R_FLAT * 0.55,
      vx: 0,
      vz: 0,
      h: a + Math.PI, // смотрит в центр
      y: 0,
      vy: 0,
      alive: true,
      falling: false,
      hp: MAX_HP,
      wrecked: false,
      shield: false,
      shieldT: 0,
      ability: null,
      mass: e.def.mass,
      place: 0,
      lastHit: -1,
      input: { sx: 0, sz: 0, use: false },
      bot: e.isPlayer ? null : { t: Math.random() * 0.3, use: 0, hold: 0 },
    };
    if (c.isPlayer) w.playerId = i;
    w.cars.push(c);
  });
  PAD_RINGS.forEach(([r0, cnt], ri) => {
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * TAU + 0.5 + ri * 0.4;
      w.pads.push({ a, r0, x: Math.cos(a) * r0, z: Math.sin(a) * r0, type: pick(ABILITIES), t: 0 });
    }
  });
  return w;
}

export function inPlayCount(w) {
  let n = 0;
  for (const c of w.cars) if (c.alive && !c.falling) n++;
  return n;
}

export function stepWorld(w, dt) {
  w.time += dt;
  if (w.state === 'countdown') {
    w.countdown -= dt;
    if (w.countdown <= 0) {
      w.state = 'play';
      w.events.push({ t: 'go' });
    }
  }
  if (w.state === 'play') {
    w.playT += dt;
    if (w.playT > SHRINK_START) {
      if (!w.shrinking) {
        w.shrinking = true;
        w.events.push({ t: 'shrink' });
      }
      // лава поднимается: арена сужается, а стена становится короче и круче
      const prog = Math.min(1, ((w.playT - SHRINK_START) * SHRINK_RATE) / (R_FLAT - MIN_R));
      w.rFlat = R_FLAT - prog * (R_FLAT - MIN_R);
      w.rTop = w.rFlat + RAMP_LEN - (RAMP_LEN - MIN_RAMP) * prog;
      // платформы отъезжают к центру вместе с краем арены
      for (const p of w.pads) {
        const pr = Math.min(p.r0, w.rFlat - 4);
        if (w.rFlat < 16) {
          // арена слишком мала — платформы исчезают
          p.off = true;
          p.type = null;
          p.t = 1e9;
        } else {
          p.x = Math.cos(p.a) * pr;
          p.z = Math.sin(p.a) * pr;
        }
      }
    }
    for (const c of w.cars) if (c.bot && c.alive) botThink(w, c, dt);
  }
  for (const c of w.cars) stepCar(w, c, dt);
  collide(w);
  if (w.state === 'play') stepPads(w, dt);
  stepShots(w, dt);

  if (w.state === 'play') {
    const left = w.cars.filter((c) => c.alive && !c.falling);
    if (left.length <= 1 && w.cars.length > 1) {
      w.state = 'ended';
      w.winner = left[0] || null;
      if (w.winner) w.winner.place = 1;
      w.shots.length = 0;
      w.events.push({ t: 'end' });
    }
  } else if (w.state === 'ended') {
    w.endT += dt;
  }
}

// ---------- машина ----------
function stepCar(w, c, dt) {
  if (!c.alive) return;
  if (c.shield) {
    c.shieldT -= dt;
    if (c.shieldT <= 0) c.shield = false;
  }
  if (c.falling) {
    c.vy -= 32 * dt;
    c.y += c.vy * dt;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    if (c.y < LAVA_Y - 0.6) {
      c.alive = false;
      w.events.push({ t: 'splash', x: c.x, z: c.z, id: c.id });
    }
    return;
  }
  const inp = c.input;
  if (inp.use) {
    inp.use = false;
    if (w.state === 'play' && c.ability) useAbility(w, c);
  }
  const def = c.def;
  const mag = Math.min(1, Math.hypot(inp.sx, inp.sz));
  let thr = 0;
  if (w.state === 'play' && mag > 0.08) {
    // стик задаёт желаемое направление на экране, машина плавно к нему поворачивает
    const target = Math.atan2(inp.sz, inp.sx);
    const dh = angDiff(c.h, target);
    const sp = Math.hypot(c.vx, c.vz);
    const turn = def.turn * (1 - 0.3 * Math.min(1, sp / (def.speed * SPEED_MUL)));
    const m = turn * dt;
    c.h += Math.max(-m, Math.min(m, dh));
    thr = mag * Math.max(0.35, Math.cos(dh));
    if (Math.hypot(c.x, c.z) > w.rFlat) thr *= RAMP_GRIP;
  }
  const onRamp = Math.hypot(c.x, c.z) > w.rFlat;
  const fx = Math.cos(c.h);
  const fz = Math.sin(c.h);
  let vf = c.vx * fx + c.vz * fz;
  let vl = -c.vx * fz + c.vz * fx;
  const target = def.speed * SPEED_MUL * thr;
  if (vf < target) {
    vf = Math.min(target, vf + def.accel * SPEED_MUL * dt);
  } else {
    // скорость выше потолка (например, от удара) гаснет мягко
    const rate = thr < 0.05 ? TUNE.brake : onRamp ? TUNE.rampCoast : TUNE.coast;
    vf = target + (vf - target) * Math.exp(-rate * dt);
  }
  vl *= Math.exp(-2.8 * dt); // боковое скольжение гаснет не сразу — удар сбоку тоже отбрасывает
  c.vx = fx * vf - fz * vl;
  c.vz = fz * vf + fx * vl;
  c.x += c.vx * dt;
  c.z += c.vz * dt;

  const r = Math.hypot(c.x, c.z);
  if (r > w.rFlat) {
    const nx = c.x / r;
    const nz = c.z / r;
    c.vx -= nx * TUNE.slope * dt;
    c.vz -= nz * TUNE.slope * dt;
    c.y = Math.min(1, (r - w.rFlat) / (w.rTop - w.rFlat)) * WALL_H;
    if (r > w.rTop) startFall(w, c, nx, nz);
  } else {
    c.y = 0;
  }
}

function startFall(w, c, nx, nz) {
  c.place = inPlayCount(w);
  c.falling = true;
  c.vy = 3;
  const vr = c.vx * nx + c.vz * nz;
  if (vr < 6) {
    c.vx += nx * (6 - vr);
    c.vz += nz * (6 - vr);
  }
  w.events.push({ t: 'fall', id: c.id });
}

function collide(w) {
  const cs = w.cars;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i];
      const b = cs[j];
      if (!a.alive || !b.alive || a.falling || b.falling) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      const min = CAR_R * 2;
      if (d >= min) continue;
      if (d < 0.001) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const ov = min - d;
      const ma = a.mass;
      const mb = b.mass;
      const ts = ma + mb;
      a.x -= nx * ov * (mb / ts);
      a.z -= nz * ov * (mb / ts);
      b.x += nx * ov * (ma / ts);
      b.z += nz * ov * (ma / ts);
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = (-(1 + 1.1) * rv) / (1 / ma + 1 / mb); // упругие, «резиновые» столкновения
        a.vx -= (imp * nx) / ma;
        a.vz -= (imp * nz) / ma;
        b.vx += (imp * nx) / mb;
        b.vz += (imp * nz) / mb;
        a.lastHit = b.id;
        b.lastHit = a.id;
        if (-rv > 6) w.events.push({ t: 'bump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, p: Math.min(1, -rv / 20) });
        // таран: чем сильнее удар, тем больше урона; лёгкая машина получает больше тяжёлой
        const ram = Math.min(6, Math.max(0, (-rv - 9) * 0.3));
        if (ram > 0) {
          if (!a.shield) damage(w, a, (ram * 2 * mb) / ts);
          if (!b.shield) damage(w, b, (ram * 2 * ma) / ts);
        }
      }
    }
  }
}

// ---------- способности ----------
function damage(w, c, amount) {
  if (w.state !== 'play' || !c.alive || c.falling || amount <= 0.01) return;
  c.hp -= amount;
  w.events.push({ t: 'dmg', id: c.id, amount, x: c.x, z: c.z });
  if (c.hp <= 0) {
    // машина разбита: выбывает прямо на арене
    c.hp = 0;
    c.place = inPlayCount(w);
    c.alive = false;
    c.wrecked = true;
    w.events.push({ t: 'wreck', id: c.id, x: c.x, z: c.z });
  }
}

function hit(w, v, by, ix, iz, s, dmg = 0) {
  if (w.state !== 'play') return;
  if (v.shield) {
    v.shield = false;
    v.shieldT = 0;
    w.events.push({ t: 'shieldBreak', id: v.id, x: v.x, z: v.z });
    return;
  }
  // чем меньше здоровья, тем сильнее отбрасывает (до 1.8 раза)
  const kb = 1 + (1 - v.hp / MAX_HP) * 0.8;
  v.vx += (ix * s * kb) / v.mass;
  v.vz += (iz * s * kb) / v.mass;
  v.lastHit = by;
  w.events.push({ t: 'hit', x: v.x, z: v.z });
  damage(w, v, dmg);
}

function nearestTo(w, x, z, exceptId) {
  let best = null;
  let bd = 1e9;
  for (const o of w.cars) {
    if (o.id === exceptId || !o.alive || o.falling) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best ? { o: best, d: bd } : null;
}

function useAbility(w, c) {
  const t = c.ability;
  c.ability = null;
  const fx = Math.cos(c.h);
  const fz = Math.sin(c.h);
  switch (t) {
    case 'shield':
      c.shield = true;
      c.shieldT = 15;
      w.events.push({ t: 'shield', id: c.id });
      break;
    case 'missile': {
      const e = nearestTo(w, c.x, c.z, c.id);
      w.shots.push({ k: 'missile', owner: c.id, x: c.x + fx * 2, z: c.z + fz * 2, h: c.h, sp: 26, life: 4, target: e ? e.o : null });
      w.events.push({ t: 'launch', x: c.x, z: c.z });
      break;
    }
    case 'blast':
      for (const o of w.cars) {
        if (o === c || !o.alive || o.falling) continue;
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < 7) hit(w, o, c.id, dx / d, dz / d, KNOCK.blast * (1 - (0.35 * d) / 7), DMG.blast);
      }
      w.events.push({ t: 'blast', x: c.x, z: c.z });
      break;
    case 'bow':
      for (const da of [-0.16, 0, 0.16]) {
        const a = c.h + da;
        w.shots.push({ k: 'arrow', owner: c.id, x: c.x + Math.cos(a) * 2, z: c.z + Math.sin(a) * 2, h: a, sp: 42, life: 0.9 });
      }
      w.events.push({ t: 'launch', x: c.x, z: c.z });
      break;
    case 'glove':
      for (const o of w.cars) {
        if (o === c || !o.alive || o.falling) continue;
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < 9 && Math.abs(angDiff(c.h, Math.atan2(dz, dx))) < 0.9) hit(w, o, c.id, dx / d, dz / d, KNOCK.glove, DMG.glove);
      }
      w.events.push({ t: 'glove', x: c.x, z: c.z, h: c.h });
      break;
  }
}

function stepShots(w, dt) {
  for (let i = w.shots.length - 1; i >= 0; i--) {
    const s = w.shots[i];
    s.life -= dt;
    if (s.k === 'missile') {
      if (!s.target || !s.target.alive || s.target.falling) {
        const e = nearestTo(w, s.x, s.z, s.owner);
        s.target = e ? e.o : null;
      }
      if (s.target) {
        const want = Math.atan2(s.target.z - s.z, s.target.x - s.x);
        const d = angDiff(s.h, want);
        const tr = 3.6 * dt;
        s.h += Math.max(-tr, Math.min(tr, d));
      }
    }
    s.x += Math.cos(s.h) * s.sp * dt;
    s.z += Math.sin(s.h) * s.sp * dt;
    let remove = s.life <= 0 || Math.hypot(s.x, s.z) > w.rTop + 6;
    if (!remove) {
      const rad = s.k === 'missile' ? 1.9 : 1.6;
      for (const o of w.cars) {
        if (o.id === s.owner || !o.alive || o.falling) continue;
        if (Math.hypot(o.x - s.x, o.z - s.z) < rad) {
          if (s.k === 'missile') {
            for (const v of w.cars) {
              if (v.id === s.owner || !v.alive || v.falling) continue;
              const dx = v.x - s.x;
              const dz = v.z - s.z;
              const d = Math.hypot(dx, dz);
              if (d < 4.5) {
                const ux = d < 0.5 ? Math.cos(s.h) : dx / d;
                const uz = d < 0.5 ? Math.sin(s.h) : dz / d;
                hit(w, v, s.owner, ux, uz, KNOCK.missile * (1 - (0.3 * d) / 4.5), DMG.missile);
              }
            }
            w.events.push({ t: 'explosion', x: s.x, z: s.z });
          } else {
            hit(w, o, s.owner, Math.cos(s.h), Math.sin(s.h), KNOCK.arrow, DMG.arrow);
          }
          remove = true;
          break;
        }
      }
    }
    if (remove) w.shots.splice(i, 1);
  }
}

function stepPads(w, dt) {
  for (const p of w.pads) {
    if (!p.type) {
      p.t -= dt;
      if (p.t <= 0) {
        p.type = pick(ABILITIES);
        w.events.push({ t: 'padSpawn' });
      }
      continue;
    }
    for (const c of w.cars) {
      if (!c.alive || c.falling || c.ability) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 2.3) {
        c.ability = p.type;
        p.type = null;
        p.t = rnd(10, 15); // способность снова появляется через 10-15 секунд
        w.events.push({ t: 'pickup', id: c.id });
        break;
      }
    }
  }
}

// ---------- боты ----------
function botThink(w, c, dt) {
  const b = c.bot;
  if (c.ability) b.hold += dt;
  else b.hold = 0;
  b.t -= dt;
  if (b.t > 0 || c.falling) return;
  b.t = rnd(0.08, 0.18);

  const en = nearestTo(w, c.x, c.z, c.id);
  let gx = 0;
  let gz = 0;
  let have = false;
  if (!c.ability) {
    let bd = 1e9;
    let bp = null;
    for (const p of w.pads) {
      if (!p.type) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) {
        bd = d;
        bp = p;
      }
    }
    if (bp) {
      gx = bp.x - c.x;
      gz = bp.z - c.z;
      have = true;
    }
  }
  if (!have && en) {
    // заходим к врагу со стороны центра, чтобы удар выталкивал его к краю
    const ex = en.o.x + en.o.vx * 0.25;
    const ez = en.o.z + en.o.vz * 0.25;
    const er = Math.hypot(ex, ez);
    let px = ex;
    let pz = ez;
    if (er > 5) {
      px = ex - (ex / er) * 4.5;
      pz = ez - (ez / er) * 4.5;
      if (Math.hypot(px - c.x, pz - c.z) < 3) {
        px = ex;
        pz = ez;
      }
    }
    gx = px - c.x;
    gz = pz - c.z;
    have = true;
  }
  if (!have) {
    gx = -c.x;
    gz = -c.z;
  }
  let l = Math.hypot(gx, gz) || 1;
  gx /= l;
  gz /= l;

  // держаться подальше от края
  const r = Math.hypot(c.x, c.z);
  const safe = w.rFlat - (w.shrinking ? 1.5 : 3.5); // когда лава поднимается, боты рискуют больше
  if (r > safe) {
    const k = Math.min(1, (r - safe) / 4);
    gx = gx * (1 - k) + (-c.x / r) * k;
    gz = gz * (1 - k) + (-c.z / r) * k;
    l = Math.hypot(gx, gz) || 1;
    gx /= l;
    gz /= l;
  }
  c.input.sx = gx;
  c.input.sz = gz;

  if (c.ability && en) {
    const o = en.o;
    const d = en.d;
    const ang = Math.abs(angDiff(c.h, Math.atan2(o.z - c.z, o.x - c.x)));
    let use = false;
    switch (c.ability) {
      case 'shield': use = d < 16; break;
      case 'missile': use = d > 5 && ang < 0.9; break;
      case 'blast': use = d < 6; break;
      case 'bow': use = d > 2 && d < 30 && ang < 0.3; break;
      case 'glove': use = d < 8 && ang < 0.55; break;
    }
    if (use || b.hold > 3.5) {
      b.use += 1;
      if (b.use >= 2) {
        c.input.use = true;
        b.use = 0;
      }
    } else {
      b.use = 0;
    }
  }
}
