import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWorld, stepWorld, angDiff, R_FLAT, R_TOP, WALL_H, LAVA_Y, MAX_HP } from './sim.js';
import { CARS } from './cars.js';
import { ARENAS } from './arenas.js';
import { S, persist, levelInfo, applyReward, MAX_LEVEL } from './store.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const ICON = { shield: '🛡️', missile: '🚀', blast: '💥', bow: '🏹', glove: '🥊' };
const PAD_COLOR = { shield: 0x38bdf8, missile: 0xef4444, blast: 0xff8a1f, bow: 0x4ade80, glove: 0xfacc15 };
const CAR_COLORS = ['#4ade80', '#ff5d5d', '#5db7ff', '#ffd23f'];
const BOT_NAMES = ['Макс', 'Рокет', 'Турбо', 'Дрифт', 'Нитро', 'Бустер', 'Гонщик', 'Тайфун', 'Вихрь', 'Скорпион'];

// ---------------------------------------------------------------- звук
let ac = null;
function beep(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
  if (S.vol <= 0) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol * S.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* звук недоступен */
  }
}
const SND = {
  bump: () => beep(120, 0.12, 'square', 0.12, -60),
  pickup: () => { beep(520, 0.1, 'triangle', 0.2); setTimeout(() => beep(780, 0.12, 'triangle', 0.2), 70); },
  launch: () => beep(300, 0.25, 'sawtooth', 0.12, 500),
  boom: () => beep(90, 0.4, 'sawtooth', 0.25, -60),
  shield: () => beep(660, 0.3, 'sine', 0.2, 300),
  fall: () => beep(500, 0.7, 'sine', 0.18, -420),
  hurt: () => beep(200, 0.18, 'sawtooth', 0.16, -100),
  tick: () => beep(600, 0.12, 'square', 0.15),
  go: () => beep(900, 0.35, 'square', 0.18),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.22), i * 120)),
  lose: () => [400, 330, 260].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'triangle', 0.2), i * 150)),
};

// ---------------------------------------------------------------- three: основа
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1220);
const camera = new THREE.PerspectiveCamera(62, 2, 0.5, 1100);

// отражения на кузове: готовим один раз
try {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
} catch {
  /* без отражений тоже играбельно */
}

const hemi = new THREE.HemisphereLight(0xffffff, 0x666688, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera;
sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.06;
sun.position.set(-30, 60, 25);
scene.add(sun);
scene.add(sun.target);

function updateParticleScale() {
  const sc2 = (window.innerHeight * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  fxAdd.mat.uniforms.uScale.value = sc2;
  fxMix.mat.uniforms.uScale.value = sc2;
}
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateParticleScale();
}
function canvasTex(w, h, draw, repeat, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- лава (две движущиеся плёнки)
function lavaTexture(base, blob1, blob2, count) {
  return canvasTex(256, 256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 10 + Math.random() * 30;
      for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, Math.random() < 0.5 ? blob1 : blob2);
        gr.addColorStop(1, 'rgba(255,90,0,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, TAU);
        g.fill();
      }
    }
  }, 34);
}
const lavaTexA = lavaTexture('#c42a06', 'rgba(255,205,70,.95)', 'rgba(255,120,20,.85)', 80);
const lavaTexB = lavaTexture('#000000', 'rgba(255,170,40,.9)', 'rgba(255,60,0,.8)', 40);
lavaTexB.repeat.set(18, 18);
const lavaA = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial({ map: lavaTexA, toneMapped: false }));
lavaA.rotation.x = -Math.PI / 2;
lavaA.position.y = LAVA_Y;
scene.add(lavaA);
const lavaB = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshBasicMaterial({ map: lavaTexB, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
);
lavaB.rotation.x = -Math.PI / 2;
lavaB.position.y = LAVA_Y + 0.05;
scene.add(lavaB);

// ---------------------------------------------------------------- частицы
const P_VERT = `
attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`;
const P_FRAG = `
varying vec4 vC;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vC.a;
  if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`;

class Particles {
  constructor(max, additive) {
    this.n = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.geo = g;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0) {
    const i = this.i;
    this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a; this.grav[i] = grav;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = s0;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.col[i * 4 + 3] = this.a0[i] * (1 - k) * (1 - k * 0.3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
    this.col.fill(0);
  }
}
const fxAdd = new Particles(900, true); // искры, огонь, угли
const fxMix = new Particles(700, false); // пыль, дым
scene.add(fxAdd.mesh);
scene.add(fxMix.mesh);

function burst(x, y, z, n, kind) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU);
    const e = rnd(-0.2, 1);
    const sp = rnd(3, 12);
    const vx = Math.cos(a) * sp;
    const vz = Math.sin(a) * sp;
    if (kind === 'spark') fxAdd.emit(x, y, z, vx, rnd(2, 9), vz, rnd(0.25, 0.5), 0.35, 0.05, 1, rnd(0.7, 0.95), 0.35, 1, 22);
    else if (kind === 'fire') fxAdd.emit(x, y + 0.5, z, vx * 0.7, e * 8 + 2, vz * 0.7, rnd(0.4, 0.8), rnd(1.6, 2.6), 0.3, 1, rnd(0.35, 0.65), 0.1, 1, 4);
    else if (kind === 'smoke') fxMix.emit(x, y + 0.5, z, vx * 0.35, rnd(2, 6), vz * 0.35, rnd(0.9, 1.6), 1.6, 4.5, 0.12, 0.12, 0.13, 0.7, -1);
    else if (kind === 'splash') fxAdd.emit(x, y, z, vx * 0.6, rnd(6, 14), vz * 0.6, rnd(0.6, 1.0), rnd(0.8, 1.6), 0.2, 1, rnd(0.45, 0.7), 0.1, 1, 24);
  }
}

// ---------------------------------------------------------------- небо
let sky = null;
function buildSky(theme) {
  if (sky) {
    scene.remove(sky);
    sky.geometry.dispose();
    sky.material.map.dispose();
    sky.material.dispose();
  }
  const tex = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, theme.sky[0]);
    gr.addColorStop(0.28, theme.sky[1]);
    gr.addColorStop(0.5, theme.sky[2]);
    gr.addColorStop(0.62, theme.sky[3]);
    gr.addColorStop(1, theme.sky[3]);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const glow = (x, y, r, c0, c1) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c0);
      rg.addColorStop(1, c1);
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    };
    if (theme.id === 'halloween') {
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.3, 0.9)})`; g.fillRect(rnd(0, w), rnd(0, h * 0.4), 2, 2); }
      glow(w * 0.3, h * 0.2, 150, 'rgba(255,230,160,.5)', 'rgba(255,230,160,0)');
      g.fillStyle = '#fff1b8';
      g.beginPath(); g.arc(w * 0.3, h * 0.2, 46, 0, TAU); g.fill();
      g.fillStyle = 'rgba(210,180,110,.5)';
      for (const [dx, dy, r] of [[-14, -8, 9], [12, 10, 12], [-6, 18, 6]]) { g.beginPath(); g.arc(w * 0.3 + dx, h * 0.2 + dy, r, 0, TAU); g.fill(); }
      g.fillStyle = '#12081f';
      for (let i = 0; i < 14; i++) { const x = rnd(0, w); const y = rnd(h * 0.12, h * 0.42); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 12, x + 22, y); g.quadraticCurveTo(x + 11, y - 4, x, y); g.fill(); }
    } else if (theme.id === 'christmas') {
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.3, 0.8)})`; g.fillRect(rnd(0, w), rnd(0, h * 0.25), 2, 2); }
      const au = g.createLinearGradient(0, h * 0.15, 0, h * 0.4);
      au.addColorStop(0, 'rgba(120,255,190,0)'); au.addColorStop(0.5, 'rgba(120,255,190,.22)'); au.addColorStop(1, 'rgba(120,255,190,0)');
      g.fillStyle = au; g.fillRect(0, h * 0.15, w, h * 0.25);
    } else if (theme.id === 'desert') {
      glow(w * 0.62, h * 0.3, 190, 'rgba(255,250,210,.95)', 'rgba(255,240,190,0)');
      g.fillStyle = '#fffbe6';
      g.beginPath(); g.arc(w * 0.62, h * 0.3, 34, 0, TAU); g.fill();
      g.fillStyle = 'rgba(205,150,80,.55)';
      g.beginPath(); g.moveTo(0, h * 0.5);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, h * 0.5 - 10 - Math.abs(Math.sin(x * 0.011)) * 26);
      g.lineTo(w, h * 0.5); g.fill();
    } else {
      for (let i = 0; i < 38; i++) {
        const x = rnd(0, w); const y = rnd(h * 0.18, h * 0.5); const r = rnd(30, 90);
        glow(x, y, r, 'rgba(255,255,255,.8)', 'rgba(255,255,255,0)');
        glow(x + r * 0.6, y + 6, r * 0.8, 'rgba(255,255,255,.7)', 'rgba(255,255,255,0)');
      }
    }
  }, 0);
  sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color(theme.fog), 300, 900);
  scene.background = new THREE.Color(theme.fog);
}

// ---------------------------------------------------------------- сборка арены
let root = null;
let ramp = null;
let snow = null;
let floorMesh = null;
let rimRing = null;
let rimTube = null;
const padViews = [];
const softTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
}, 0);

function disposeRoot() {
  if (!root) return;
  scene.remove(root);
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && o.material.map !== softTex) o.material.map.dispose();
      o.material.dispose();
    }
  });
  root = null;
  ramp = null;
  snow = null;
  floorMesh = null;
  rimRing = null;
  rimTube = null;
  padViews.length = 0;
}

const std = (color, rough = 0.7, metal = 0.05, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

function floorTile(theme) {
  return canvasTex(256, 256, (g, s) => {
    const R = (a, b) => a + Math.random() * (b - a);
    const wrap = (x, y, fn) => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) fn(x + ox, y + oy); };
    const blob = (x, y, r, c0, c1) => wrap(x, y, (X, Y) => { const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); });
    if (theme.id === 'halloween') {
      g.fillStyle = '#3f2c5c'; g.fillRect(0, 0, s, s);
      g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(s / 2, 0, s / 2, s / 2); g.fillRect(0, s / 2, s / 2, s / 2);
      g.strokeStyle = 'rgba(255,150,40,.4)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (let i = 0; i < 40; i++) g.fillRect(R(0, s), R(0, s), R(1, 4), R(1, 4));
    } else if (theme.id === 'christmas') {
      g.fillStyle = '#eaf3ff'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 14; i++) blob(R(0, s), R(0, s), R(25, 60), 'rgba(170,200,240,.45)', 'rgba(170,200,240,0)');
      g.fillStyle = 'rgba(255,255,255,.95)';
      for (let i = 0; i < 60; i++) g.fillRect(R(0, s), R(0, s), 2, 2);
    } else if (theme.id === 'desert') {
      g.fillStyle = '#e3b96e'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 9; i++) { const y = R(0, s); g.strokeStyle = `rgba(${R(160, 200) | 0},${R(110, 145) | 0},60,.4)`; g.lineWidth = R(2, 5); g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y - 12, s * 0.7, y + 12, s, y); g.stroke(); }
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${R(120, 170) | 0},${R(80, 120) | 0},40,${R(0.15, 0.4)})`; g.fillRect(R(0, s), R(0, s), 2, 2); }
    } else {
      g.fillStyle = '#d3eaff'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 18; i++) blob(R(0, s), R(0, s), R(30, 70), 'rgba(255,255,255,.95)', 'rgba(255,255,255,0)');
      for (let i = 0; i < 8; i++) blob(R(0, s), R(0, s), R(25, 50), 'rgba(110,170,235,.25)', 'rgba(110,170,235,0)');
    }
  }, 13);
}

// светящаяся разметка поля, как на футбольном поле в Rocket League
function floorMarks(theme) {
  const col = '#' + theme.rim.toString(16).padStart(6, '0');
  return canvasTex(1024, 1024, (g, s) => {
    g.clearRect(0, 0, s, s);
    const c = s / 2;
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 16;
    g.lineCap = 'round';
    const ring = (r, w, a) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(c, c, s * r, 0, TAU); g.stroke(); };
    ring(0.485, 12, 0.95);
    ring(0.33, 6, 0.6);
    ring(0.17, 6, 0.6);
    ring(0.045, 10, 0.9);
    g.globalAlpha = 0.4;
    g.lineWidth = 5;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * s * 0.06, c + Math.sin(a) * s * 0.06);
      g.lineTo(c + Math.cos(a) * s * 0.47, c + Math.sin(a) * s * 0.47);
      g.stroke();
    }
    // пунктир там, где стоят платформы
    g.setLineDash([14, 18]);
    for (const r of [18, 44, 66]) ring((r / R_FLAT) * 0.5, 4, 0.5);
    g.setLineDash([]);
  }, 0);
}

// стадион вокруг арены: трибуны с публикой, неоновые кольца, прожекторы
function buildStadium(theme, parent) {
  const rb = R_TOP + 24;
  const rt = R_TOP + 76;
  const top = 48;
  const pal = {
    halloween: ['#ff8a1f', '#9b5de5', '#ffd23f', '#3a2350', '#ffffff'],
    christmas: ['#d8262f', '#ffffff', '#1f8a4c', '#ffd23f', '#38bdf8'],
    desert: ['#ffd23f', '#ff8a1f', '#f4f0e6', '#c0662b', '#3b82f6'],
    sky: ['#ffffff', '#7dd3fc', '#fbbf24', '#ec4899', '#a78bfa'],
  }[theme.id];
  const crowd = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#0d1020';
    g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 14) {
      for (let x = (y / 14) % 2 ? 6 : 0; x < w; x += 12) {
        g.globalAlpha = 0.5 + Math.random() * 0.5;
        g.fillStyle = pal[(Math.random() * pal.length) | 0];
        g.fillRect(x, y, 8, 9);
      }
    }
    g.globalAlpha = 1;
  }, 0);
  crowd.wrapS = THREE.RepeatWrapping;
  crowd.repeat.set(8, 1);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, top + 3, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: crowd, side: THREE.DoubleSide, color: 0xd0d0d0 }),
  );
  bowl.position.y = (top - 3) / 2;
  parent.add(bowl);

  const panels = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#0b0e1a';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = Math.random() < 0.6 ? 'rgba(255,240,200,.85)' : 'rgba(120,160,255,.5)'; g.fillRect(x + 4, 18, 24, 34); g.fillRect(x + 4, 70, 24, 34); }
  }, 0);
  panels.wrapS = THREE.RepeatWrapping;
  panels.repeat.set(8, 1);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rt, 18, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: panels, side: THREE.DoubleSide, toneMapped: false }),
  );
  wall.position.y = top + 9;
  parent.add(wall);

  const neon = new THREE.MeshBasicMaterial({ color: theme.rim, toneMapped: false });
  for (const [r, y, t] of [[rt, top, 0.9], [rt, top + 18, 0.7], [rb, -2.6, 0.8]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 160), neon);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    parent.add(ring);
  }

  // прожекторы: башня, лампа и широкий луч к центру арены
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false });
  const poleMat = std(0x20243a, 0.6, 0.5);
  const TOWERS = 10;
  for (let i = 0; i < TOWERS; i++) {
    const a = (i / TOWERS) * TAU + 0.2;
    const x = Math.cos(a) * (rt - 8);
    const z = Math.sin(a) * (rt - 8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.6, top + 22, 8), poleMat);
    pole.position.set(x, (top + 22) / 2 - 3, z);
    parent.add(pole);
    const hy = top + 20;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 2.4), lampMat);
    lamp.position.set(x, hy, z);
    lamp.lookAt(0, 0, 0);
    parent.add(lamp);
    const len = Math.hypot(x, hy, z);
    const geo = new THREE.CylinderGeometry(22, 0.8, len, 18, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, len / 2);
    const beam = new THREE.Mesh(geo, beamMat);
    beam.position.set(x, hy, z);
    beam.lookAt(0, 0, 0);
    parent.add(beam);
  }
}

const RAMP_N = 128;
function buildRamp(c1, c2) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(RAMP_N * 4 * 3);
  const col = new Float32Array(RAMP_N * 4 * 3);
  const idx = [];
  const a = new THREE.Color(c1);
  const b = new THREE.Color(c2);
  for (let i = 0; i < RAMP_N; i++) {
    const c = i % 2 ? b : a;
    for (let k = 0; k < 4; k++) col.set([c.r, c.g, c.b], (i * 4 + k) * 3);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  updateRamp(g, R_FLAT, R_TOP);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  m.receiveShadow = true;
  return m;
}
function updateRamp(g, rIn, rOut) {
  const p = g.attributes.position.array;
  for (let i = 0; i < RAMP_N; i++) {
    const a0 = (i / RAMP_N) * TAU;
    const a1 = ((i + 1) / RAMP_N) * TAU;
    const c0 = Math.cos(a0); const s0 = Math.sin(a0);
    const c1 = Math.cos(a1); const s1 = Math.sin(a1);
    p.set([c0 * rIn, 0.02, s0 * rIn, c0 * rOut, WALL_H, s0 * rOut, c1 * rIn, 0.02, s1 * rIn, c1 * rOut, WALL_H, s1 * rOut], i * 12);
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}

function padIcons() {
  const g = new THREE.Group();
  const mk = (geo, color) => {
    const m = new THREE.Mesh(geo, std(color, 0.35, 0.3, { emissive: color, emissiveIntensity: 0.6 }));
    m.visible = false;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const icons = {
    shield: mk(new THREE.SphereGeometry(0.85, 16, 12), PAD_COLOR.shield),
    missile: mk(new THREE.ConeGeometry(0.5, 1.8, 12), PAD_COLOR.missile),
    blast: mk(new THREE.TorusGeometry(0.7, 0.28, 10, 20), PAD_COLOR.blast),
    bow: mk(new THREE.TorusGeometry(0.8, 0.15, 8, 20, Math.PI), PAD_COLOR.bow),
    glove: mk(new THREE.BoxGeometry(1.05, 1.05, 1.05), PAD_COLOR.glove),
  };
  icons.blast.rotation.x = Math.PI / 2;
  return { g, icons };
}

function decorate(theme, parent) {
  const N = 44;
  const pillarMat = std(theme.id === 'sky' ? 0xdfeaf7 : 0x2a2d44, 0.8, 0.1);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.1;
    const r = R_TOP + 2.6;
    const g = new THREE.Group();
    // колонна от лавы до верхнего края
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, WALL_H - LAVA_Y + 2, 10), pillarMat);
    pil.position.y = (WALL_H + LAVA_Y) / 2 - 1;
    g.add(pil);
    const top = new THREE.Group();
    top.position.y = WALL_H + 0.8;
    top.scale.setScalar(1.7);
    g.add(top);
    if (theme.id === 'halloween') {
      if (i % 2 === 0) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(1.9, 14, 10), std(0xff7a14, 0.5, 0.05, { emissive: 0xff5a00, emissiveIntensity: 0.5 }));
        p.scale.y = 0.8; p.position.y = 1.4; top.add(p);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.9, 6), std(0x2f7d32));
        st.position.y = 2.9; top.add(st);
        const eyeM = new THREE.MeshBasicMaterial({ color: 0xffe36b, toneMapped: false });
        for (const sx of [-0.6, 0.6]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 3), eyeM); e.position.set(sx, 1.8, 1.65); e.rotation.x = Math.PI / 2; top.add(e); }
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 0.2), eyeM);
        mouth.position.set(0, 0.95, 1.7); top.add(mouth);
        g.rotation.y = -a + Math.PI / 2;
      } else {
        const t = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 7), std(0x2a1f3d, 0.9));
        t.position.y = 3; top.add(t);
        const t2 = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4, 7), std(0x3b2c55, 0.9));
        t2.position.y = 6; top.add(t2);
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9dff6b, toneMapped: false }));
        lantern.position.set(1.0, 1.4, 0); top.add(lantern);
      }
    } else if (theme.id === 'christmas') {
      if (i % 2 === 0) {
        const cols = [0xd8262f, 0xffd23f, 0x38bdf8];
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(2.6 - k * 0.6, 2.8, 10), std(0x1f8a4c, 0.8));
          c.position.y = 1.9 + k * 1.7; top.add(c);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: cols[(k + i) % 3], toneMapped: false }));
          ball.position.set(1.3 - k * 0.4, 1.2 + k * 1.7, 1.0); top.add(ball);
        }
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: 0xffe36b, toneMapped: false }));
        star.position.y = 7.3; top.add(star);
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), std(i % 4 === 1 ? 0xd8262f : 0x2f6fd8, 0.4, 0.2));
        box.position.y = 1.1; top.add(box);
        const rb = new THREE.Mesh(new THREE.BoxGeometry(2.45, 2.25, 0.5), std(0xffd23f, 0.3, 0.5));
        rb.position.y = 1.1; top.add(rb);
        const rb2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.25, 2.45), std(0xffd23f, 0.3, 0.5));
        rb2.position.y = 1.1; top.add(rb2);
      }
    } else if (theme.id === 'desert') {
      if (i % 2 === 0) {
        const m = std(0x2f9e44, 0.8);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 5, 10), m);
        body.position.y = 2.5; top.add(body);
        for (const s of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 2, 8), m);
          arm.position.set(s * 1.3, 3.2, 0); top.add(arm);
          const lnk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.3, 8), m);
          lnk.rotation.z = Math.PI / 2; lnk.position.set(s * 0.7, 2.3, 0); top.add(lnk);
        }
      } else {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.8), std(0xa8743c, 0.95));
        r.position.y = 1.2; r.scale.y = 0.7; top.add(r);
      }
    } else {
      const m = std(0xffffff, 0.95);
      for (const [x, y, z, s] of [[0, 1.6, 0, 2.2], [1.8, 1.1, 0.3, 1.7], [-1.7, 1.1, -0.2, 1.8], [0.3, 2.7, 0.2, 1.7]]) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 9), m);
        p.position.set(x, y, z); top.add(p);
      }
    }
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    parent.add(g);
  }
  if (theme.id === 'christmas') {
    const cols = [0xff4d4d, 0xffd23f, 0x4ade80, 0x38bdf8];
    for (let i = 0; i < 220; i++) {
      const a = (i / 220) * TAU;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % 4], toneMapped: false }));
      bulb.position.set(Math.cos(a) * (R_TOP + 0.5), WALL_H + 0.5, Math.sin(a) * (R_TOP + 0.5));
      parent.add(bulb);
    }
  }
}

function buildArena(theme) {
  disposeRoot();
  root = new THREE.Group();
  scene.add(root);
  buildSky(theme);

  floorMesh = new THREE.Group();
  const floorBase = new THREE.Mesh(new THREE.CircleGeometry(R_FLAT, 128), std(0xffffff, 0.85, 0.02, { map: floorTile(theme) }));
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.receiveShadow = true;
  floorMesh.add(floorBase);
  const floorLines = new THREE.Mesh(
    new THREE.CircleGeometry(R_FLAT, 128),
    new THREE.MeshBasicMaterial({ map: floorMarks(theme), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  floorLines.rotation.x = -Math.PI / 2;
  floorLines.position.y = 0.04;
  floorMesh.add(floorLines);
  root.add(floorMesh);

  ramp = buildRamp(theme.wall[0], theme.wall[1]);
  root.add(ramp);

  // светящиеся кромки: внизу стены и по верхнему краю
  rimRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 192), new THREE.MeshBasicMaterial({ color: theme.rim, side: THREE.DoubleSide, toneMapped: false }));
  rimRing.rotation.x = -Math.PI / 2;
  rimRing.position.y = 0.05;
  rimRing.scale.set(R_FLAT, R_FLAT, 1);
  root.add(rimRing);
  rimTube = new THREE.Mesh(new THREE.TorusGeometry(R_TOP, 0.4, 8, 192), new THREE.MeshBasicMaterial({ color: theme.rim, toneMapped: false }));
  rimTube.rotation.x = -Math.PI / 2;
  rimTube.position.y = WALL_H;
  root.add(rimTube);

  decorate(theme, root);
  buildStadium(theme, root);

  if (theme.snow) {
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rnd(-55, 55), rnd(0, 45), rnd(-55, 55)], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, map: softTex, transparent: true, opacity: 0.95, depthWrite: false }));
    snow.frustumCulled = false;
    root.add(snow);
  }

  hemi.color.set(theme.hemi[0]);
  hemi.groundColor.set(theme.hemi[1]);
  hemi.intensity = theme.hemi[2];
  sun.color.set(theme.sun[0]);
  sun.intensity = theme.sun[1];
}

// ---------------------------------------------------------------- машины
function buildCar(def, isPlayer, team) {
  const g = new THREE.Group();
  const b = def.body;
  const bodyY = b.wr * 0.9 + b.h / 2;
  const paint = std(def.color, 0.28, 0.6, def.ghost ? { transparent: true, opacity: 0.78 } : {});
  const glass = std(0x0a141f, 0.08, 0.9);
  const body = new THREE.Mesh(new RoundedBoxGeometry(b.len, b.h, b.wid, 3, Math.min(0.2, b.h * 0.3)), paint);
  body.position.y = bodyY;
  body.castShadow = true;
  g.add(body);
  const top = bodyY + b.h / 2;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(b.cl, b.ch, b.wid * 0.84, 3, Math.min(0.16, b.ch * 0.3)), glass);
  cab.position.set(b.co, top + b.ch / 2 - 0.04, 0);
  cab.castShadow = true;
  g.add(cab);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(b.cl * 0.9, 0.1, b.wid * 0.78, 2, 0.04), paint);
  roof.position.set(b.co, top + b.ch - 0.02, 0);
  g.add(roof);
  // бамперы и решётка
  const dark = std(0x16181f, 0.6, 0.3);
  const fb = new THREE.Mesh(new RoundedBoxGeometry(0.28, b.h * 0.42, b.wid * 1.02, 2, 0.06), dark);
  fb.position.set(b.len / 2, bodyY - b.h * 0.2, 0);
  g.add(fb);
  const rb = fb.clone();
  rb.position.x = -b.len / 2;
  g.add(rb);

  // колёса: покрышка + диск + спицы, вращаются при езде
  const tireM = std(0x101014, 0.95, 0);
  const rimM = std(0xcfd6e2, 0.22, 1);
  const tg = new THREE.CylinderGeometry(b.wr, b.wr, 0.44, 18);
  const dg = new THREE.CylinderGeometry(b.wr * 0.62, b.wr * 0.62, 0.47, 14);
  const sg = new THREE.BoxGeometry(b.wr * 1.1, 0.5, b.wr * 0.16);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(sx * b.len * 0.31, b.wr, sz * (b.wid / 2));
      const inner = new THREE.Group();
      inner.rotation.x = Math.PI / 2;
      const tire = new THREE.Mesh(tg, tireM);
      tire.castShadow = true;
      inner.add(tire);
      inner.add(new THREE.Mesh(dg, rimM));
      const sp1 = new THREE.Mesh(sg, dark);
      const sp2 = sp1.clone();
      sp2.rotation.y = Math.PI / 2;
      inner.add(sp1);
      inner.add(sp2);
      piv.add(inner);
      g.add(piv);
      wheels.push(piv);
    }
  }
  const acc = std(def.accent, 0.35, 0.4);
  if (b.stripe) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(b.len * 0.9, 0.03, 0.32), new THREE.MeshBasicMaterial({ color: def.accent }));
    s.position.set(0, top + 0.02, 0);
    g.add(s);
  }
  if (b.spoiler) {
    const sp = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.1, b.wid * 0.96, 2, 0.03), acc);
    sp.position.set(-b.len / 2 + 0.15, top + 0.5, 0);
    sp.castShadow = true;
    g.add(sp);
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.09), dark);
      leg.position.set(-b.len / 2 + 0.15, top + 0.25, sz * b.wid * 0.3);
      g.add(leg);
    }
  }
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6c8, toneMapped: false });
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
  for (const sz of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.36), hl);
    l.position.set(b.len / 2 + 0.03, bodyY + 0.05, sz * b.wid * 0.34);
    g.add(l);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.4), tl);
    t.position.set(-b.len / 2 - 0.03, bodyY + 0.08, sz * b.wid * 0.34);
    g.add(t);
  }
  {
    const gl = new THREE.Mesh(
      new THREE.PlaneGeometry(b.len * 1.35, b.wid * 1.45),
      new THREE.MeshBasicMaterial({ color: def.glow || parseInt(team.slice(1), 16), map: softTex, transparent: true, opacity: def.glow ? 0.85 : 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    gl.rotation.x = -Math.PI / 2;
    gl.position.y = 0.1;
    g.add(gl);
  }
  g.scale.setScalar(1.3);

  const holder = new THREE.Group();
  holder.add(g);
  if (isPlayer) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.9, 40),
      new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    holder.add(ring);
  }
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x4cc9ff, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }),
  );
  shield.position.y = 1.3;
  shield.visible = false;
  holder.add(shield);
  return { holder, body: g, shield, wheels, paint, flash: 0, tiltX: 0, tiltZ: 0 };
}

// ---------------------------------------------------------------- кольца-ударные волны
const ringFx = [];
const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
function ringBurst(x, z, color, size, dur, y = 0.4) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const m = new THREE.Mesh(ringGeo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.scale.setScalar(0.3);
  scene.add(m);
  ringFx.push({ m, t: 0, dur, size });
}
function updateRings(dt) {
  for (let i = ringFx.length - 1; i >= 0; i--) {
    const f = ringFx[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) {
      scene.remove(f.m);
      f.m.material.dispose();
      ringFx.splice(i, 1);
      continue;
    }
    f.m.scale.setScalar(0.3 + f.size * k);
    f.m.material.opacity = 0.9 * (1 - k);
  }
}
function clearRings() {
  for (const f of ringFx) { scene.remove(f.m); f.m.material.dispose(); }
  ringFx.length = 0;
}

// ---------------------------------------------------------------- матч
let mode = 'menu'; // menu | game
let W = null;
let carViews = [];
let shotViews = new Map();
let player = null;
let lastCount = 4;
let accum = 0;
let resultShown = false;
let curTheme = ARENAS[0];
let tagEls = [];
let specId = -1;
let shake = 0;

// камера от третьего лица
const cam = { yaw: 0, x: 0, y: 10, z: 20, lx: 0, ly: 0, lz: 0, fov: 62 };

const shotGeo = {
  missile: new THREE.ConeGeometry(0.45, 2.2, 10),
  arrow: new THREE.BoxGeometry(1.8, 0.14, 0.14),
};

function pickOpponentCars(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(CARS.length - 1, S.car + Math.round((Math.random() - 0.5) * 6)));
    out.push(CARS[idx]);
  }
  return out;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function groundH(r) {
  if (!W || r <= W.rFlat) return 0;
  return Math.min(1, (r - W.rFlat) / Math.max(0.1, W.rTop - W.rFlat)) * WALL_H;
}

function startMatch() {
  curTheme = ARENAS[S.arena] || ARENAS[0];
  buildArena(curTheme);
  clearRings();
  fxAdd.clear();
  fxMix.clear();
  shotViews.forEach((v) => root.remove(v));
  shotViews = new Map();

  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const opp = pickOpponentCars(3);
  const entries = [{ name: S.name, def: CARS[S.car], isPlayer: true }];
  opp.forEach((d, i) => entries.push({ name: names[i], def: d }));
  W = createWorld(entries);
  player = W.cars[W.playerId];

  carViews = W.cars.map((c, i) => {
    const v = buildCar(c.def, c.isPlayer, CAR_COLORS[i]);
    v.trail = hexRgb(CAR_COLORS[i]);
    root.add(v.holder);
    return v;
  });

  W.pads.forEach((p) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.35, 28), std(0x1d2238, 0.4, 0.7));
    base.position.y = 0.17;
    base.receiveShadow = true;
    g.add(base);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, side: THREE.DoubleSide, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.85, 2.3, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.37;
    g.add(ring);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.0, 7, 18, 1, true), beamMat);
    beam.position.y = 3.8;
    g.add(beam);
    const ic = padIcons();
    ic.g.position.y = 2.0;
    g.add(ic.g);
    root.add(g);
    padViews.push({ g, ic, ring, ringMat, beam, beamMat });
  });

  // плашки здоровья над соперниками
  $('tags').innerHTML = '';
  tagEls = W.cars.map((c, i) => {
    if (c.isPlayer) return null;
    const d = document.createElement('div');
    d.className = 'tag';
    d.innerHTML = `<div style="color:${CAR_COLORS[i]}">${c.name}</div><div class="tb"><i style="background:${CAR_COLORS[i]};width:100%"></i></div>`;
    $('tags').appendChild(d);
    return { d, bar: d.querySelector('i') };
  });

  // камера сразу встаёт за машину
  cam.yaw = player.h;
  snapCamera(player);

  mode = 'game';
  accum = 0;
  resultShown = false;
  lastCount = 4;
  specId = -1;
  shake = 0;
  show('hud');
  $('hud').className = 'screen on ' + (S.side === 'right' ? 'R' : 'L');
  $('abil').style.setProperty('--s', String(S.btn));
  $('spec').style.display = 'none';
  $('big').textContent = '';
  $('alive').textContent = '';
  onResize();
}

function endToMenu() {
  mode = 'menu';
  W = null;
  disposeRoot();
  clearRings();
  fxAdd.clear();
  fxMix.clear();
  shotViews = new Map();
  carViews = [];
  $('tags').innerHTML = '';
  scene.background = new THREE.Color(0x0f1220);
  showMenu();
}

// ---------------------------------------------------------------- камера
function camTarget() {
  if (player && player.alive && !player.falling) return player;
  if (player && player.falling) return player; // провожаем падение
  const live = W.cars.filter((c) => c.alive && !c.falling);
  if (!live.length) return W.winner || player;
  let t = live.find((c) => c.id === specId);
  if (!t) {
    t = live[0];
    specId = t.id;
  }
  return t;
}

function desiredCam(t) {
  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  const sp = Math.hypot(t.vx, t.vz);
  const dist = 15.5 + Math.min(3.5, sp * 0.11);
  let x = t.x - fx * dist;
  let z = t.z - fz * dist;
  const r = Math.hypot(x, z);
  const maxR = W.rTop + 3.5;
  if (r > maxR) { x = (x / r) * maxR; z = (z / r) * maxR; }
  const gh = groundH(Math.min(r, W.rTop + 1));
  const y = Math.max(t.y + 6.9, gh + 5.4);
  return { x, y, z };
}

function snapCamera(t) {
  const d = desiredCam(t);
  cam.x = d.x; cam.y = d.y; cam.z = d.z;
  cam.lx = t.x + Math.cos(cam.yaw) * 6;
  cam.lz = t.z + Math.sin(cam.yaw) * 6;
  cam.ly = t.y + 1.2;
}

function updateCamera(dt) {
  const t = camTarget();
  // камера плавно поворачивается за направлением машины (как в Rocket League)
  const sp = Math.hypot(t.vx, t.vz);
  const follow = sp > 1.2 || t === player ? t.h : cam.yaw;
  cam.yaw += angDiff(cam.yaw, follow) * (1 - Math.exp(-3.4 * dt));
  const d = desiredCam(t);
  const k = 1 - Math.exp(-9 * dt);
  cam.x += (d.x - cam.x) * k;
  cam.y += (d.y - cam.y) * k;
  cam.z += (d.z - cam.z) * k;
  const lk = 1 - Math.exp(-12 * dt);
  const lx = t.x + Math.cos(cam.yaw) * 6;
  const lz = t.z + Math.sin(cam.yaw) * 6;
  cam.lx += (lx - cam.lx) * lk;
  cam.lz += (lz - cam.lz) * lk;
  cam.ly += (t.y + 1.3 - cam.ly) * lk;

  shake = Math.max(0, shake - dt * 2.2);
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  camera.position.set(cam.x + sx, cam.y + sy, cam.z + sx);
  camera.lookAt(cam.lx, cam.ly, cam.lz);

  // на скорости угол обзора чуть растёт
  const fov = 62 + Math.min(10, sp * 0.45);
  if (Math.abs(fov - camera.fov) > 0.05) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();
    updateParticleScale();
  }
  // небо следует за камерой, тени и свет — за машиной
  if (sky) sky.position.set(camera.position.x, 0, camera.position.z);
  sun.target.position.set(t.x, 0, t.z);
  sun.position.set(t.x - 30, 60, t.z + 25);
}

// ---------------------------------------------------------------- синхронизация вида с симуляцией
const tmpV = new THREE.Vector3();
function syncViews(dt) {
  const t = performance.now() / 1000;
  const R0 = W.rFlat;
  const slope = Math.atan2(WALL_H, Math.max(0.1, W.rTop - W.rFlat));
  const dustCol = curTheme.dust;

  W.cars.forEach((c, i) => {
    const v = carViews[i];
    v.holder.visible = c.alive;
    if (!c.alive) return;
    v.holder.position.set(c.x, c.y + 0.02, c.z);
    v.holder.rotation.y = -c.h;
    const sp = Math.hypot(c.vx, c.vz);
    for (const w of v.wheels) w.rotation.z -= (sp / (c.def.body.wr * 1.3)) * dt * (Math.cos(Math.atan2(c.vz, c.vx) - c.h) >= 0 ? 1 : -1);

    if (c.falling) {
      v.body.rotation.z += dt * 4;
      v.body.rotation.x += dt * 2.4;
    } else {
      // на стене машина встаёт вдоль наклона
      const r = Math.hypot(c.x, c.z);
      let tx = 0;
      let tz = 0;
      if (r > R0 && r > 0.1) {
        const nx = c.x / r;
        const nz = c.z / r;
        tz = slope * (Math.cos(c.h) * nx + Math.sin(c.h) * nz);
        tx = -slope * (-Math.sin(c.h) * nx + Math.cos(c.h) * nz);
      }
      v.tiltX += (tx - v.tiltX) * 0.25;
      v.tiltZ += (tz - v.tiltZ) * 0.25;
      v.body.rotation.x = v.tiltX;
      v.body.rotation.z = v.tiltZ;
    }
    v.shield.visible = c.shield;
    if (c.shield) v.shield.scale.setScalar(1 + Math.sin(t * 6 + i) * 0.04);

    // вспышка при ударе
    if (v.flash > 0) {
      v.flash = Math.max(0, v.flash - dt * 4);
      v.paint.emissive.setHex(0xffffff);
      v.paint.emissiveIntensity = v.flash * 1.6;
    } else if (v.paint.emissiveIntensity !== 0) {
      v.paint.emissiveIntensity = 0;
    }

    if (!c.falling) {
      // пыль из-под колёс
      if (sp > 5 && c.y < 0.5 && Math.random() < Math.min(1, sp / 12) * 0.9) {
        const bx = c.x - Math.cos(c.h) * 1.8;
        const bz = c.z - Math.sin(c.h) * 1.8;
        fxMix.emit(bx + rnd(-0.6, 0.6), 0.4, bz + rnd(-0.6, 0.6), -c.vx * 0.08 + rnd(-0.6, 0.6), rnd(0.4, 1.4), -c.vz * 0.08 + rnd(-0.6, 0.6), rnd(0.5, 0.9), 0.7, 2.4, dustCol[0], dustCol[1], dustCol[2], 0.32, 0);
      }
      // светящийся след цвета команды (на скорости)
      if (sp > 13) {
        const lx = -Math.sin(c.h);
        const lz = Math.cos(c.h);
        for (const side of [-1, 1]) {
          fxAdd.emit(c.x - Math.cos(c.h) * 2.3 + lx * side * 0.95, 0.55 + c.y, c.z - Math.sin(c.h) * 2.3 + lz * side * 0.95, -c.vx * 0.04, 0.1, -c.vz * 0.04, 0.45, 0.65, 0.08, v.trail[0], v.trail[1], v.trail[2], 0.85, 0);
        }
      }
      // повреждённая машина дымит, а при совсем малом здоровье горит
      const hpK = c.hp / MAX_HP;
      if (hpK < 0.4 && Math.random() < (0.4 - hpK) * 1.6) {
        fxMix.emit(c.x + rnd(-0.5, 0.5), c.y + 1.4, c.z + rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(2, 4), rnd(-0.5, 0.5), rnd(0.8, 1.3), 0.8, 3, 0.1, 0.1, 0.11, 0.65, -0.5);
      }
      if (hpK < 0.2 && Math.random() < 0.5) {
        fxAdd.emit(c.x + rnd(-0.5, 0.5), c.y + 1.3, c.z + rnd(-0.5, 0.5), rnd(-0.4, 0.4), rnd(2, 4.5), rnd(-0.4, 0.4), rnd(0.3, 0.55), 1.2, 0.2, 1, rnd(0.4, 0.6), 0.1, 0.9, 0);
      }
    }
  });

  // платформы со способностями
  W.pads.forEach((p, i) => {
    const m = padViews[i];
    m.g.visible = !p.off;
    m.g.position.set(p.x, 0, p.z);
    for (const k in m.ic.icons) m.ic.icons[k].visible = p.type === k;
    m.ic.g.visible = !!p.type;
    m.ic.g.rotation.y = t * 2;
    m.ic.g.position.y = 2.0 + Math.sin(t * 3 + i) * 0.22;
    const col = p.type ? PAD_COLOR[p.type] : 0x4b5568;
    m.ringMat.color.setHex(col);
    m.beam.visible = !!p.type;
    if (p.type) m.beamMat.color.setHex(col);
  });

  // пол и стена сужаются, когда поднимается лава
  if (W.shrinking) {
    const s = W.rFlat / R_FLAT;
    floorMesh.scale.set(s, 1, s);
    rimRing.scale.set(W.rFlat, W.rFlat, 1);
    rimTube.scale.set(W.rTop / R_TOP, W.rTop / R_TOP, 1);
    updateRamp(ramp.geometry, W.rFlat, W.rTop);
  }

  // снаряды
  const alive = new Set(W.shots);
  shotViews.forEach((v, s) => {
    if (!alive.has(s)) { root.remove(v); v.material.dispose(); shotViews.delete(s); }
  });
  for (const s of W.shots) {
    let v = shotViews.get(s);
    if (!v) {
      v = new THREE.Mesh(shotGeo[s.k], new THREE.MeshBasicMaterial({ color: s.k === 'missile' ? 0xff4a2a : 0xfff3b0, toneMapped: false }));
      root.add(v);
      shotViews.set(s, v);
    }
    v.position.set(s.x, 1.3, s.z);
    v.rotation.set(0, -s.h, s.k === 'missile' ? -Math.PI / 2 : 0);
    if (s.k === 'missile') {
      // огненный хвост
      fxAdd.emit(s.x - Math.cos(s.h) * 1.4, 1.3, s.z - Math.sin(s.h) * 1.4, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.35, 1.0, 0.2, 1, 0.55, 0.12, 0.9, 0);
      fxMix.emit(s.x - Math.cos(s.h) * 1.9, 1.3, s.z - Math.sin(s.h) * 1.9, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), 0.7, 0.6, 1.8, 0.5, 0.5, 0.5, 0.35, 0);
    } else {
      fxAdd.emit(s.x, 1.3, s.z, 0, 0, 0, 0.18, 0.4, 0.1, 1, 0.95, 0.6, 0.6, 0);
    }
  }

  // лава течёт
  lavaTexA.offset.set(t * 0.018, t * 0.012);
  lavaTexB.offset.set(-t * 0.03, t * 0.022);
  // угли поднимаются из лавы вокруг камеры
  if (Math.random() < 0.55) {
    const a = rnd(0, TAU);
    const r = rnd(5, 40);
    fxAdd.emit(camera.position.x + Math.cos(a) * r, LAVA_Y + 0.2, camera.position.z + Math.sin(a) * r, rnd(-0.6, 0.6), rnd(2.5, 6), rnd(-0.6, 0.6), rnd(1.6, 2.8), 0.5, 0.1, 1, rnd(0.4, 0.65), 0.1, 0.9, -0.2);
  }
  // снег падает вокруг игрока
  if (snow) {
    const tg = camTarget();
    snow.position.set(tg.x, 0, tg.z);
    const p = snow.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= dt * 4.5;
      p[i] += Math.sin(t * 0.9 + i) * dt * 0.9;
      if (p[i + 1] < -1) p[i + 1] = 45;
    }
    snow.geometry.attributes.position.needsUpdate = true;
  }
}

function handleEvents() {
  for (const e of W.events) {
    switch (e.t) {
      case 'bump':
        ringBurst(e.x, e.z, 0xffffff, 1.5 + e.p * 2.5, 0.25);
        burst(e.x, 1.0, e.z, 4 + ((e.p * 8) | 0), 'spark');
        SND.bump();
        if (Math.hypot(e.x - player.x, e.z - player.z) < 5) shake = Math.max(shake, 0.35 * e.p + 0.1);
        break;
      case 'hit': ringBurst(e.x, e.z, 0xffd23f, 3.2, 0.3); burst(e.x, 1.0, e.z, 8, 'spark'); SND.bump(); break;
      case 'dmg': {
        const v = carViews[e.id];
        if (v) v.flash = 1;
        if (e.id === W.playerId) {
          const f = $('flash');
          f.classList.add('on');
          setTimeout(() => f.classList.remove('on'), 60);
          SND.hurt();
          shake = Math.max(shake, 0.5);
        }
        break;
      }
      case 'pickup': if (e.id === W.playerId) SND.pickup(); break;
      case 'launch': SND.launch(); break;
      case 'blast': ringBurst(e.x, e.z, 0xff8a1f, 8, 0.45); burst(e.x, 0.8, e.z, 18, 'fire'); SND.boom(); break;
      case 'glove': ringBurst(e.x + Math.cos(e.h) * 4, e.z + Math.sin(e.h) * 4, 0xfacc15, 5, 0.3); burst(e.x + Math.cos(e.h) * 4, 1, e.z + Math.sin(e.h) * 4, 10, 'spark'); SND.boom(); break;
      case 'explosion':
        ringBurst(e.x, e.z, 0xff6a1a, 6, 0.4);
        burst(e.x, 1.0, e.z, 22, 'fire');
        burst(e.x, 1.0, e.z, 12, 'smoke');
        SND.boom();
        if (Math.hypot(e.x - player.x, e.z - player.z) < 14) shake = Math.max(shake, 0.7);
        break;
      case 'wreck':
        ringBurst(e.x, e.z, 0xffb02e, 10, 0.55);
        burst(e.x, 1.0, e.z, 34, 'fire');
        burst(e.x, 1.0, e.z, 22, 'smoke');
        burst(e.x, 1.0, e.z, 16, 'spark');
        SND.boom();
        shake = Math.max(shake, 0.9);
        break;
      case 'shield': if (e.id === W.playerId) SND.shield(); break;
      case 'shieldBreak': ringBurst(e.x, e.z, 0x4cc9ff, 4.5, 0.35); burst(e.x, 1.2, e.z, 12, 'spark'); break;
      case 'fall': SND.fall(); if (e.id === W.playerId) shake = Math.max(shake, 0.6); break;
      case 'splash': burst(e.x, LAVA_Y + 0.3, e.z, 30, 'splash'); burst(e.x, LAVA_Y + 0.5, e.z, 10, 'smoke'); break;
      case 'go': SND.go(); $('big').textContent = 'ВПЕРЁД!'; setTimeout(() => { if ($('big').textContent === 'ВПЕРЁД!') $('big').textContent = ''; }, 700); break;
      default: break;
    }
  }
  W.events.length = 0;
}

// ---------------------------------------------------------------- HUD
function hpColor(k) {
  return k > 0.6 ? '#4ade80' : k > 0.3 ? '#facc15' : '#ef4444';
}

const radar = $('radar');
const rctx = radar.getContext('2d');
function drawRadar() {
  const s = radar.width;
  const c = s / 2;
  const k = (c - 12) / (R_TOP + 2);
  rctx.clearRect(0, 0, s, s);
  rctx.fillStyle = 'rgba(12,16,34,.72)';
  rctx.beginPath(); rctx.arc(c, c, c - 2, 0, TAU); rctx.fill();
  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  const P = (x, z) => [c + (-fz * x + fx * z) * k, c - (fx * x + fz * z) * k];
  rctx.strokeStyle = 'rgba(255,255,255,.25)';
  rctx.lineWidth = 2;
  rctx.beginPath(); rctx.arc(c, c, W.rFlat * k, 0, TAU); rctx.stroke();
  rctx.strokeStyle = 'rgba(255,120,40,.7)';
  rctx.beginPath(); rctx.arc(c, c, W.rTop * k, 0, TAU); rctx.stroke();
  for (const p of W.pads) {
    if (p.off) continue;
    const [x, y] = P(p.x, p.z);
    rctx.fillStyle = p.type ? '#' + PAD_COLOR[p.type].toString(16).padStart(6, '0') : '#4b5568';
    rctx.fillRect(x - 5, y - 5, 10, 10);
  }
  W.cars.forEach((car, i) => {
    if (!car.alive || car.falling) return;
    const [x, y] = P(car.x, car.z);
    rctx.fillStyle = CAR_COLORS[i];
    rctx.beginPath(); rctx.arc(x, y, car.isPlayer ? 9 : 7, 0, TAU); rctx.fill();
    if (car.isPlayer) {
      // стрелка направления
      const a = car.h - cam.yaw;
      rctx.strokeStyle = '#fff';
      rctx.lineWidth = 3;
      rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x + Math.sin(a) * 18, y - Math.cos(a) * 18); rctx.stroke();
    }
  });
}

function updateTags() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  W.cars.forEach((c, i) => {
    const el = tagEls[i];
    if (!el) return;
    if (!c.alive || c.falling) { el.d.style.display = 'none'; return; }
    tmpV.set(c.x, c.y + 4.0, c.z).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.15 || Math.abs(tmpV.y) > 1.15) { el.d.style.display = 'none'; return; }
    const dist = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
    el.d.style.display = 'block';
    const sc = Math.max(0.65, Math.min(1.15, 28 / dist));
    el.d.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px) scale(${sc.toFixed(2)})`;
    const k = c.hp / MAX_HP;
    el.bar.style.width = (k * 100).toFixed(0) + '%';
    el.bar.style.background = hpColor(k);
  });
}

function updateHud() {
  if (W.state === 'countdown') {
    const n = Math.ceil(W.countdown);
    if (n !== lastCount && n > 0) { lastCount = n; SND.tick(); }
    $('big').textContent = n > 0 ? String(n) : '';
  }
  const left = W.cars.filter((c) => c.alive && !c.falling).length;
  $('alive').textContent = `🚗 Живых: ${left}`;
  const ab = $('abil');
  ab.textContent = player.ability ? ICON[player.ability] : '';
  ab.classList.toggle('has', !!player.ability);

  // здоровье игрока
  const hp = Math.max(0, Math.ceil(player.hp));
  const k = hp / MAX_HP;
  $('hpTxt').innerHTML = `<span>❤ Здоровье</span><b>${hp}</b>`;
  $('hpFill').style.width = (k * 100).toFixed(0) + '%';
  $('hpFill').style.background = hpColor(k);

  updateTags();
  drawRadar();

  const out = player.falling || !player.alive;
  if (out && W.state !== 'ended') {
    $('spec').style.display = 'flex';
    $('specTxt').textContent = player.wrecked ? 'Машина разбита! Смотрите бой или выходите' : 'Вы в лаве! Смотрите бой или выходите';
    $('specExit').textContent = 'Выйти (+5 🪙)';
  }
  if (W.state === 'ended' && W.endT > 1.6 && !resultShown) showResult();
}

function showResult() {
  resultShown = true;
  const won = W.winner === player;
  const r = applyReward(won);
  $('spec').style.display = 'none';
  $('big').textContent = '';
  $('rTitle').textContent = won ? '🏆 Победа!' : '💀 Поражение';
  let html = `<div>Награда: <span class="coin">+${r.coins} 🪙</span></div><div>Опыт: <b>${r.xp > 0 ? '+' : ''}${r.xp}</b></div>`;
  if (r.after > r.before) html += `<div style="color:#4ade80">⬆ Новый уровень: ${r.after}!</div>`;
  if (r.after < r.before) html += `<div style="color:#f87171">⬇ Уровень понижен: ${r.after}</div>`;
  $('rInfo').innerHTML = html;
  (won ? SND.win : SND.lose)();
  show('result');
}

function leaveMatch() {
  // выход до конца боя засчитывается как поражение
  if (W && !resultShown) {
    const r = applyReward(false);
    toast(`+${r.coins} 🪙, опыт ${r.xp}`);
  }
  endToMenu();
}

// ---------------------------------------------------------------- управление
const zone = $('zone');
const base = $('stickBase');
const thumb = $('stickThumb');
let stickId = null;
let stickO = { x: 0, y: 0 };
const keys = {};
const STICK_R = 55;
let rawX = 0; // стик: вправо +, вниз +
let rawY = 0;

// стик задаёт направление относительно камеры: вверх — вперёд, влево/вправо — поворот
function applyInput() {
  if (!player || !W) return;
  if (player.falling || !player.alive) { player.input.sx = 0; player.input.sz = 0; return; }
  const fx = Math.cos(cam.yaw);
  const fz = Math.sin(cam.yaw);
  player.input.sx = -fz * rawX + fx * -rawY;
  player.input.sz = fx * rawX + fz * -rawY;
}

zone.addEventListener('pointerdown', (e) => {
  if (stickId !== null) return;
  stickId = e.pointerId;
  zone.setPointerCapture(e.pointerId);
  stickO = { x: e.clientX, y: e.clientY };
  base.style.display = 'block';
  base.style.left = e.clientX + 'px';
  base.style.top = e.clientY + 'px';
  thumb.style.left = '36px';
  thumb.style.top = '36px';
  if (ac && ac.state === 'suspended') ac.resume();
});
zone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  let dx = e.clientX - stickO.x;
  let dy = e.clientY - stickO.y;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) { dx = (dx / d) * STICK_R; dy = (dy / d) * STICK_R; }
  thumb.style.left = 36 + dx + 'px';
  thumb.style.top = 36 + dy + 'px';
  rawX = dx / STICK_R;
  rawY = dy / STICK_R;
});
const stickEnd = (e) => {
  if (e.pointerId !== stickId) return;
  stickId = null;
  base.style.display = 'none';
  rawX = 0;
  rawY = 0;
};
zone.addEventListener('pointerup', stickEnd);
zone.addEventListener('pointercancel', stickEnd);

function useAbility() {
  if (player && mode === 'game') player.input.use = true;
}
$('abil').addEventListener('pointerdown', (e) => { e.preventDefault(); useAbility(); });

function keyVec() {
  let x = 0;
  let y = 0;
  if (keys.ArrowLeft || keys.a) x -= 1;
  if (keys.ArrowRight || keys.d) x += 1;
  if (keys.ArrowUp || keys.w) y -= 1;
  if (keys.ArrowDown || keys.s) y += 1;
  const l = Math.hypot(x, y);
  return l ? [x / l, y / l] : [0, 0];
}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') useAbility();
  if (stickId === null && mode === 'game') [rawX, rawY] = keyVec();
});
window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  if (stickId === null && mode === 'game') [rawX, rawY] = keyVec();
});

// ---------------------------------------------------------------- экраны
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('on');
  $(id).classList.add('on');
}
let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.style.display = 'none'; }, 2200);
}

function showMenu() {
  const li = levelInfo(S.xp);
  $('mName').textContent = S.name;
  $('mLvl').textContent = li.level >= MAX_LEVEL ? 'MAX' : li.level;
  $('mXp').style.width = Math.round((li.cur / li.need) * 100) + '%';
  $('mCoins').textContent = S.coins;
  const a = ARENAS[S.arena];
  const c = $('aCard');
  c.textContent = `${a.emoji} ${a.name}`;
  c.style.background = `linear-gradient(135deg, ${a.bg[0]}, ${a.bg[1]})`;
  show('menu');
}

function norm(v, lo, hi) { return Math.round(((v - lo) / (hi - lo)) * 100); }
const RAR = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', legendary: 'Легендарная' };

function showGarage() {
  $('gCoins').textContent = S.coins;
  const list = $('garageList');
  list.innerHTML = '';
  for (const car of CARS) {
    const owned = S.owned.includes(car.id);
    const card = document.createElement('div');
    card.className = 'card' + (S.car === car.id ? ' sel' : '');
    const hex = '#' + car.color.toString(16).padStart(6, '0');
    const acc = '#' + car.accent.toString(16).padStart(6, '0');
    let btn;
    if (S.car === car.id) btn = '<button disabled>Выбрано</button>';
    else if (owned) btn = `<button class="green" data-sel="${car.id}">Выбрать</button>`;
    else btn = `<button class="gold" data-buy="${car.id}" ${S.coins < car.price ? 'disabled' : ''}>🪙 ${car.price}</button>`;
    card.innerHTML = `
      <div class="pic" style="background:linear-gradient(135deg,${hex},${acc})">🚗</div>
      <div><b>${car.name}</b><div class="rar-${car.rarity}" style="font-size:12px">${RAR[car.rarity]}</div></div>
      <div class="stat"><span>Скор.</span><div class="bar"><i style="width:${norm(car.speed, 14, 18)}%"></i></div></div>
      <div class="stat"><span>Разгон</span><div class="bar"><i style="width:${norm(car.accel, 24, 40)}%"></i></div></div>
      <div class="stat"><span>Манёвр</span><div class="bar"><i style="width:${norm(car.turn, 4, 5.8)}%"></i></div></div>
      <div class="stat"><span>Вес</span><div class="bar"><i style="width:${norm(car.mass, 0.85, 1.55)}%"></i></div></div>
      ${btn}`;
    list.appendChild(card);
  }
  show('garage');
}

$('garageList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sel !== undefined) {
    S.car = +b.dataset.sel;
    persist();
    showGarage();
  } else if (b.dataset.buy !== undefined) {
    const car = CARS[+b.dataset.buy];
    if (S.coins >= car.price && !S.owned.includes(car.id)) {
      S.coins -= car.price;
      S.owned.push(car.id);
      S.car = car.id;
      persist();
      toast(`Куплено: ${car.name}!`);
      showGarage();
    }
  }
});

function showSettings() {
  $('sVol').value = Math.round(S.vol * 100);
  $('sBtn').value = Math.round(S.btn * 100);
  $('sName').value = S.name;
  tmpSide = S.side;
  paintSide();
  show('settings');
}
let tmpSide = 'left';
function paintSide() {
  $('sLeft').className = tmpSide === 'left' ? 'green' : 'gray';
  $('sRight').className = tmpSide === 'right' ? 'green' : 'gray';
}
$('sLeft').onclick = () => { tmpSide = 'left'; paintSide(); };
$('sRight').onclick = () => { tmpSide = 'right'; paintSide(); };
let savedVol = S.vol;
$('sVol').oninput = () => { S.vol = $('sVol').value / 100; beep(660, 0.1, 'triangle', 0.2); };
$('sSave').onclick = () => {
  S.vol = $('sVol').value / 100;
  S.btn = $('sBtn').value / 100;
  S.side = tmpSide;
  const n = $('sName').value.trim();
  if (n) S.name = n.slice(0, 14);
  savedVol = S.vol;
  persist();
  toast('Сохранено');
  showMenu();
};
$('sBack').onclick = () => { S.vol = savedVol; showMenu(); };

$('nameOk').onclick = () => {
  const n = $('nameIn').value.trim();
  if (!n) { toast('Введи ник'); return; }
  S.name = n.slice(0, 14);
  persist();
  showMenu();
};
$('aPrev').onclick = () => { S.arena = (S.arena + ARENAS.length - 1) % ARENAS.length; persist(); showMenu(); };
$('aNext').onclick = () => { S.arena = (S.arena + 1) % ARENAS.length; persist(); showMenu(); };
$('bPlay').onclick = startMatch;
$('bGarage').onclick = showGarage;
$('bSet').onclick = showSettings;
$('gBack').onclick = showMenu;
$('rAgain').onclick = () => { endToMenu(); startMatch(); };
$('rMenu').onclick = endToMenu;
$('specExit').onclick = leaveMatch;
$('specNext').onclick = () => {
  const live = W ? W.cars.filter((c) => c.alive && !c.falling) : [];
  if (!live.length) return;
  const i = live.findIndex((c) => c.id === specId);
  specId = live[(i + 1) % live.length].id;
};
$('pause').onclick = () => {
  if (!W || resultShown) return;
  if (confirm('Выйти из матча? Это будет засчитано как поражение.')) leaveMatch();
};

// ---------------------------------------------------------------- главный цикл
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'game' && W) {
    applyInput();
    accum += dt;
    let n = 0;
    while (accum >= 1 / 60 && n < 5) {
      stepWorld(W, 1 / 60);
      accum -= 1 / 60;
      n++;
    }
    handleEvents();
    syncViews(dt);
    updateCamera(dt);
    updateHud();
  } else {
    // в меню — медленно плывущая камера над лавой
    camera.position.set(Math.sin(now / 6000) * 60, 30, Math.cos(now / 6000) * 60);
    camera.lookAt(0, 0, 0);
  }
  updateRings(dt);
  fxAdd.update(dt);
  fxMix.update(dt);
  renderer.render(scene, camera);
}
window.addEventListener('resize', onResize);
onResize();
requestAnimationFrame(frame);

// старт
if (S.name) showMenu();
