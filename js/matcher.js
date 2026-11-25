// 복식 대진 생성 (순수 함수, DOM 의존 없음)
//  ① 경기 수 적은 인원 우선 선발  ② 코트 편성(지역 탐색)  ③ 코트별 최적 2:2 팀 분할
import { LEVEL_SCORE } from './state.js';

export const WEIGHTS = {
  partner: 10,   // 같은 파트너 반복 (횟수²)
  opponent: 3,   // 같은 상대 반복
  teamDiff: 6,   // 두 팀 급수 점수 합 차이
  spread: 1,     // 한 코트 내 급수 편차
  sameGroup: 4,  // 직전 라운드와 같은 4명이 다시 한 코트
  uneven: 30,    // 성별 구성이 다른 두 팀 (예: 여복 vs 혼복, 남복 vs 혼복). 남복 vs 여복은 아예 만들지 않음
  typeRepeat: 2, // 개인별 유형 비율이 목표(남자 남복:혼복=3:1, 여자 여복:혼복=2:1)보다 한쪽에 쏠린 정도 (1명당)
  ratio: 10,     // 전체 경기 유형 비율이 TYPE_RATIO에서 벗어난 정도 (목표 경기 수와의 차이 합)
};
// 목표 경기 유형 비율 (남복:여복:혼복). 인원 구성상 불가능한 유형은 빼고 나머지끼리 비율을 맞춘다.
export const TYPE_RATIO = { '남복': 3, '여복': 2, '혼복': 1 };
const TYPE_LABEL = { M: '남복', F: '여복', X: '혼복' };

// 팀 구성: 'M'(남남) 'F'(여여) 'X'(혼성), 성별 미지정이 있으면 null
const teamKind = (g1, g2) => (!g1 || !g2 ? null : g1 === g2 ? g1 : 'X');
export function matchType(teamA, teamB, gender) {
  const ka = teamKind(gender.get(teamA[0]), gender.get(teamA[1]));
  const kb = teamKind(gender.get(teamB[0]), gender.get(teamB[1]));
  if (!ka || !kb) return null;
  return ka === kb ? TYPE_LABEL[ka] : '기타';
}
// 한 팀은 남남, 다른 팀은 여여인 경기 (금지)
export function isMenVsWomen(teamA, teamB, gender) {
  const ka = teamKind(gender.get(teamA[0]), gender.get(teamA[1]));
  const kb = teamKind(gender.get(teamB[0]), gender.get(teamB[1]));
  return (ka === 'M' && kb === 'F') || (ka === 'F' && kb === 'M');
}
const RESTARTS = 40;

const pairKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
const groupKey = (ids) => ids.slice().sort((a, b) => a - b).join('-');
const inc = (map, k) => map.set(k, (map.get(k) || 0) + 1);
const cnt = (map, a, b) => map.get(pairKey(a, b)) || 0;

function buildHistory(rounds, gender) {
  const partner = new Map(), opp = new Map(), played = new Map(), last = new Map(), types = new Map();
  const typeCount = { '남복': 0, '여복': 0, '혼복': 0 };
  rounds.forEach((r, idx) => {
    for (const m of r.matches) {
      const t = matchType(m.teamA, m.teamB, gender);
      if (t in typeCount) typeCount[t]++;
      if (t) {
        for (const id of [...m.teamA, ...m.teamB]) {
          const tc = types.get(id) || {};
          tc[t] = (tc[t] || 0) + 1;
          types.set(id, tc);
        }
      }
      inc(partner, pairKey(m.teamA[0], m.teamA[1]));
      inc(partner, pairKey(m.teamB[0], m.teamB[1]));
      for (const x of m.teamA) for (const y of m.teamB) inc(opp, pairKey(x, y));
      for (const id of [...m.teamA, ...m.teamB]) { inc(played, id); last.set(id, idx); }
    }
  });
  const lastGroups = new Set();
  const lr = rounds[rounds.length - 1];
  if (lr) for (const m of lr.matches) lastGroups.add(groupKey([...m.teamA, ...m.teamB]));
  return { partner, opp, played, last, lastGroups, types, typeCount };
}

// 이번 라운드 코트 유형들을 지금까지의 경기에 더했을 때 목표 비율과의 차이 (feasible 유형끼리만 비교)
function ratioCost(roundTypes, ctx) {
  const share = ctx.share;
  if (!share) return 0;
  const c = { ...ctx.typeCount };
  for (const t of roundTypes) if (t in c) c[t]++;
  let n = 0;
  for (const t in share) n += c[t];
  let pen = 0;
  // 절댓값(1차)이라 비율을 못 맞추는 인원 구성에서도 경기 하나당 비용이 2×ratio를 넘지 않는다(성별 불균형 코트보다 작게)
  for (const t in share) pen += Math.abs(c[t] - share[t] * n);
  return WEIGHTS.ratio * pen;
}

const SPLITS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

// 4명 그룹의 최적 팀 분할(3가지 전수 비교)과 비용
function bestSplit(g, ctx) {
  const W = WEIGHTS;
  const sc = g.map((id) => ctx.score.get(id));
  const spread = Math.max(...sc) - Math.min(...sc);
  const same = ctx.lastGroups.has(groupKey(g)) ? W.sameGroup : 0;
  let best = null;
  for (const [i, j, k, l] of SPLITS) {
    const p1 = cnt(ctx.partner, g[i], g[j]);
    const p2 = cnt(ctx.partner, g[k], g[l]);
    const o = cnt(ctx.opp, g[i], g[k]) + cnt(ctx.opp, g[i], g[l]) +
              cnt(ctx.opp, g[j], g[k]) + cnt(ctx.opp, g[j], g[l]);
    const diff = Math.abs(sc[i] + sc[j] - sc[k] - sc[l]);
    const a = [g[i], g[j]], b = [g[k], g[l]];
    // 남복 vs 여복은 절대 만들지 않는다. 남2·여2 그룹이면 혼복 vs 혼복 분할이 항상 있어 대신 그쪽을 고른다.
    if (isMenVsWomen(a, b, ctx.gender)) continue;
    const type = matchType(a, b, ctx.gender);
    let gpen = 0;
    if (type === '기타') gpen += W.uneven;
    for (const id of g) {
      const gd = ctx.gender.get(id);
      if (!gd) continue;
      const tc = ctx.types.get(id) || {};
      if (type && type !== '기타') {
        // 본인이 할 수 있는 유형(남복·혼복 / 여복·혼복)을 목표 비율로 나눈 값 중 가장 작은 것 대비 얼마나 더 했는지
        const own = gd === 'M' ? '남복' : '여복';
        const norm = (t) => (tc[t] || 0) / TYPE_RATIO[t];
        if (type === own || type === '혼복') gpen += W.typeRepeat * (norm(type) - Math.min(norm(own), norm('혼복')));
      }
    }
    const cost = W.partner * (p1 * p1 + p2 * p2) + W.opponent * o +
                 W.teamDiff * diff + W.spread * spread + same + gpen;
    if (!best || cost < best.cost) best = { cost, a, b, type };
  }
  return best;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const slice4 = (arr, c) => arr.slice(c * 4, c * 4 + 4);

// 선발된 인원을 코트로 나누고 두 사람 맞교환으로 총비용을 줄인다
// extras(휴식 후보)는 경기 수(eff)가 같은 출전자와만 맞바꾼다. 최종 휴식자 목록으로 extras를 제자리 갱신한다.
function arrange(selected, extras, effOf, ctx, rng) {
  const nC = selected.length / 4;
  let bestTotal = Infinity, bestArr = null, bestEx = extras.slice();
  for (let r = 0; r < RESTARTS; r++) {
    const arr = shuffle(selected.slice(), rng);
    const ex = extras.slice();
    const costs = [], types = [];
    for (let c = 0; c < nC; c++) { const s = bestSplit(slice4(arr, c), ctx); costs[c] = s.cost; types[c] = s.type; }
    let g = ratioCost(types, ctx); // 라운드 전체 유형 비율 비용
    let improved = true, guard = 0;
    while (improved && guard++ < 20) {
      improved = false;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const ci = i >> 2, cj = j >> 2;
          if (ci === cj) continue;
          [arr[i], arr[j]] = [arr[j], arr[i]];
          const si = bestSplit(slice4(arr, ci), ctx);
          const sj = bestSplit(slice4(arr, cj), ctx);
          const ti = types[ci], tj = types[cj];
          types[ci] = si.type; types[cj] = sj.type;
          const ng = ratioCost(types, ctx);
          if (si.cost + sj.cost + ng < costs[ci] + costs[cj] + g - 1e-9) {
            costs[ci] = si.cost; costs[cj] = sj.cost; g = ng; improved = true;
          } else {
            types[ci] = ti; types[cj] = tj;
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
        }
        // 출전자 i ↔ 휴식 후보 k 맞바꾸기 (경기 수가 같을 때만)
        const ci = i >> 2;
        for (let k = 0; k < ex.length; k++) {
          if (effOf.get(ex[k]) !== effOf.get(arr[i])) continue;
          [arr[i], ex[k]] = [ex[k], arr[i]];
          const si = bestSplit(slice4(arr, ci), ctx);
          const ti = types[ci];
          types[ci] = si.type;
          const ng = ratioCost(types, ctx);
          if (si.cost + ng < costs[ci] + g - 1e-9) {
            costs[ci] = si.cost; g = ng; improved = true;
          } else {
            types[ci] = ti;
            [arr[i], ex[k]] = [ex[k], arr[i]];
          }
        }
      }
    }
    const total = costs.reduce((s, x) => s + x, 0) + g;
    if (total < bestTotal) { bestTotal = total; bestArr = arr.slice(); bestEx = ex.slice(); }
    if (total === 0) break;
  }
  extras.length = 0;
  extras.push(...bestEx);
  return bestArr;
}

// 참가 중인 성비로 가능한 유형만 남겨 목표 비율을 0~1 비중으로 바꾼다. 비교할 유형이 2개 미만이면 null.
function typeShare(active) {
  const m = active.filter((p) => p.gender === 'M').length;
  const f = active.filter((p) => p.gender === 'F').length;
  const ok = { '남복': m >= 4, '여복': f >= 4, '혼복': m >= 2 && f >= 2 };
  const keys = Object.keys(TYPE_RATIO).filter((t) => ok[t] && TYPE_RATIO[t] > 0);
  if (keys.length < 2) return null;
  const sum = keys.reduce((s, t) => s + TYPE_RATIO[t], 0);
  return Object.fromEntries(keys.map((t) => [t, TYPE_RATIO[t] / sum]));
}

/**
 * @param {{players:Array, rounds:Array, courts:number, rng?:Function}} opts
 * @returns {{round:{no:number, matches:Array, resting:number[]}} | {error:string}}
 */
export function generateRound({ players, rounds, courts, rng = Math.random }) {
  const active = players.filter((p) => p.active);
  if (active.length < 4) return { error: '참가 중인 인원이 4명 이상 필요해요.' };

  const slots = Math.min(courts * 4, Math.floor(active.length / 4) * 4);
  const gender = new Map(players.map((p) => [p.id, p.gender || null]));
  const h = buildHistory(rounds, gender);

  // 지각자/복귀자 보정: 우선순위용 경기 수는 현재 평균(내림) 이상으로 취급
  const avg = active.reduce((s, p) => s + (h.played.get(p.id) || 0), 0) / active.length;
  const base = Math.floor(avg);
  const info = active.map((p) => {
    const played = h.played.get(p.id) || 0;
    const lastIdx = h.last.has(p.id) ? h.last.get(p.id) : -1;
    return { id: p.id, eff: Math.max(played, base), streak: rounds.length - 1 - lastIdx, r: rng() };
  });
  info.sort((a, b) => (a.eff - b.eff) || (b.streak - a.streak) || (a.r - b.r));

  const selected = info.slice(0, slots).map((x) => x.id);
  const resting = info.slice(slots).map((x) => x.id);

  const ctx = {
    score: new Map(players.map((p) => [p.id, LEVEL_SCORE[p.level] || 3])),
    partner: h.partner, opp: h.opp, lastGroups: h.lastGroups,
    gender, types: h.types, typeCount: h.typeCount,
    share: typeShare(active),
  };

  // 경기 수가 같은 휴식 후보는 출전자와 맞바꿀 수 있다(공정성 유지, 성별 구성만 조정)
  const effOf = new Map(info.map((x) => [x.id, x.eff]));
  const extras = resting.slice();
  const arr = arrange(selected, extras, effOf, ctx, rng);
  resting.length = 0;
  resting.push(...extras);
  const matches = [];
  for (let c = 0; c < slots / 4; c++) {
    const s = bestSplit(slice4(arr, c), ctx);
    const total = slice4(arr, c).reduce((sum, id) => sum + ctx.score.get(id), 0);
    matches.push({ total, teamA: s.a, teamB: s.b, type: s.type, winner: null });
  }
  // 실력이 높은 코트부터 1코트
  matches.sort((a, b) => b.total - a.total);
  matches.forEach((m, i) => { m.court = i + 1; delete m.total; });

  return { round: { no: rounds.length + 1, matches, resting } };
}
