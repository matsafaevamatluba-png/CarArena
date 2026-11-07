// store.js — сохранение прогресса, уровни, награды

const KEY = 'arenacars_v1';
const def = () => ({ name: '', coins: 0, xp: 0, owned: [0], car: 0, arena: 0, vol: 0.7, side: 'left', btn: 1 });

function load() {
  try {
    return { ...def(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return def();
  }
}

export const S = load();

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* память недоступна — играем без сохранения */
  }
}

export const MAX_LEVEL = 100;
// сколько опыта нужно, чтобы перейти с уровня l на l+1
export const xpFor = (l) => 40 + 2 * l;

export function levelInfo(xp) {
  let l = 1;
  let need = xpFor(1);
  while (l < MAX_LEVEL && xp >= need) {
    xp -= need;
    l++;
    need = xpFor(l);
  }
  return { level: l, cur: l >= MAX_LEVEL ? need : xp, need };
}

export const REWARD = {
  win: { coins: 20, xp: 50 },
  lose: { coins: 5, xp: -5 },
};

export function applyReward(won) {
  const r = won ? REWARD.win : REWARD.lose;
  const before = levelInfo(S.xp).level;
  S.coins += r.coins;
  S.xp = Math.max(0, S.xp + r.xp);
  persist();
  return { coins: r.coins, xp: r.xp, before, after: levelInfo(S.xp).level };
}
