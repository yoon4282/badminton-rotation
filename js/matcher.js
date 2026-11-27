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
  wish: 40,      // 같이 치기 요청을 들어준 만큼 비용을 깎는다 (같은 편 1건 = wish×1.5, 같은 코트 1건 = wish, 4명 묶음 = wish/2 × 6쌍)
};
// 같이 치기 요청 종류별 인원: 같은 편(2명) / 같은 코트(2명, 편·상대 상관없음) / 4명 한 코트
export const WISH_SIZE = { team: 2, court: 2, group: 4 };
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
      // 같이 치기 요청으로 모인 코트는 유형을 고를 수 없어 전체 비율 계산에서 뺀다
      if (t in typeCount && !m.wish) typeCount[t]++;
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
  const gk = groupKey(g);
  const same = ctx.lastGroups.has(gk) && !ctx.wishGroups.has(gk) ? W.sameGroup : 0;
  // 4명 묶음 요청 코트는 파트너 반복을 분할끼리 상대 비교만 한다(반복이 쌓여도 묶음이 깨지지 않게, 파트너는 돌아가며)
  const pMin = ctx.wishGroups.has(gk) ? Math.min(...SPLITS.map(([i, j, k, l]) =>
    (ctx.partner.get(pairKey(g[i], g[j])) || 0) + (ctx.partner.get(pairKey(g[k], g[l])) || 0))) : 0;
  // 같이 치기: 요청한 사람끼리 한 코트에 모인 만큼 보너스 (분할과 무관)
  // 요청으로 모인 사람은 유형 쏠림 벌점에서 뺀다(같은 사람끼리 계속 치면 유형이 한쪽으로 쏠릴 수밖에 없어서)
  let bonus = 0;
  const inWish = new Set();
  if (ctx.wishPair.size) {
    for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) {
      const v = ctx.wishPair.get(pairKey(g[x], g[y]));
      if (v) { bonus += v; inWish.add(g[x]); inWish.add(g[y]); }
    }
  }
  const wishGroup = ctx.wishGroups.has(gk);
  // 파트너 반복: 같은 편 요청은 벌점 없음, 같은 코트·묶음 요청끼리는 1차(반복돼도 묶음이 깨지지 않게)
  const pc = (x, y) => {
    const k = pairKey(x, y);
    if (ctx.wishTeam.has(k)) return 0;
    const c = ctx.partner.get(k) || 0;
    return ctx.wishPair.has(k) ? c : c * c;
  };
  // 상대 반복: 같이 치자고 한 사이끼리는 세지 않는다
  const oc = (x, y) => (ctx.wishPair.has(pairKey(x, y)) ? 0 : cnt(ctx.opp, x, y));
  let best = null;
  for (const [i, j, k, l] of SPLITS) {
    const p = wishGroup
      ? (ctx.partner.get(pairKey(g[i], g[j])) || 0) + (ctx.partner.get(pairKey(g[k], g[l])) || 0) - pMin
      : pc(g[i], g[j]) + pc(g[k], g[l]);
    const o = oc(g[i], g[k]) + oc(g[i], g[l]) + oc(g[j], g[k]) + oc(g[j], g[l]);
    const tb = (ctx.wishTeam.has(pairKey(g[i], g[j])) ? W.wish : 0) + (ctx.wishTeam.has(pairKey(g[k], g[l])) ? W.wish : 0);
    const diff = Math.abs(sc[i] + sc[j] - sc[k] - sc[l]);
    const a = [g[i], g[j]], b = [g[k], g[l]];
    // 남복 vs 여복은 절대 만들지 않는다. 남2·여2 그룹이면 혼복 vs 혼복 분할이 항상 있어 대신 그쪽을 고른다.
    if (isMenVsWomen(a, b, ctx.gender)) continue;
    const type = matchType(a, b, ctx.gender);
    let gpen = 0;
    if (type === '기타') gpen += W.uneven;
    for (const id of g) {
      const gd = ctx.gender.get(id);
      if (!gd || inWish.has(id)) continue;
      const tc = ctx.types.get(id) || {};
      if (type && type !== '기타') {
        // 본인이 할 수 있는 유형(남복·혼복 / 여복·혼복)을 목표 비율로 나눈 값 중 가장 작은 것 대비 얼마나 더 했는지
        const own = gd === 'M' ? '남복' : '여복';
        const norm = (t) => (tc[t] || 0) / TYPE_RATIO[t];
        if (type === own || type === '혼복') gpen += W.typeRepeat * (norm(type) - Math.min(norm(own), norm('혼복')));
      }
    }
    const cost = W.partner * p + W.opponent * o +
                 W.teamDiff * diff + W.spread * spread + same + gpen - bonus - tb;
    // rtype: 전체 비율 계산용 유형 (요청으로 모인 코트는 null)
    if (!best || cost < best.cost) best = { cost, a, b, type, rtype: bonus || tb ? null : type };
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
    // 첫 시도는 같이 치기 요청끼리 한 코트에 미리 모아 두고 시작
    const arr = r === 0 && ctx.wishList.length ? seedOrder(selected, ctx.wishList, nC, rng) : shuffle(selected.slice(), rng);
    const ex = extras.slice();
    const costs = [], types = [];
    for (let c = 0; c < nC; c++) { const s = bestSplit(slice4(arr, c), ctx); costs[c] = s.cost; types[c] = s.rtype; }
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
          types[ci] = si.rtype; types[cj] = sj.rtype;
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
          types[ci] = si.rtype;
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
    if (total === 0 && !ctx.wishList.length) break;
  }
  extras.length = 0;
  extras.push(...bestEx);
  return bestArr;
}

// 요청 묶음을 코트(4칸)에 먼저 채우고 나머지는 무작위로
function seedOrder(selected, list, nC, rng) {
  const courts = Array.from({ length: nC }, () => []);
  const sel = new Set(selected), placed = new Set();
  const units = list.filter((w) => w.ids.every((id) => sel.has(id))).sort((a, b) => b.ids.length - a.ids.length);
  for (const w of units) {
    if (w.ids.some((id) => placed.has(id))) continue;
    const c = courts.find((c) => c.length + w.ids.length <= 4);
    if (!c) continue;
    c.push(...w.ids);
    w.ids.forEach((id) => placed.add(id));
  }
  const rest = shuffle(selected.filter((id) => !placed.has(id)), rng);
  for (const c of courts) while (c.length < 4) c.push(rest.pop());
  return courts.flat();
}

// 참가 중인 사람만 남긴 요청 목록. 한 번 요청이 고정 요청보다 먼저, 오래된 요청부터.
function prepWishes(wishes, activeIds) {
  const list = [];
  for (const w of Array.isArray(wishes) ? wishes : []) {
    if (!w || !WISH_SIZE[w.kind] || !Array.isArray(w.ids)) continue;
    const ids = [...new Set(w.ids)].filter((id) => activeIds.has(id));
    if (ids.length < 2 || (w.kind === 'team' && ids.length !== 2)) continue;
    list.push({ id: w.id, kind: w.kind, fixed: !!w.fixed, ids, all: ids.length === w.ids.length });
  }
  list.sort((a, b) => (a.fixed - b.fixed) || (a.id - b.id));
  return list;
}

// 선발 단계: 요청 묶음이 일부만 뽑혔으면, 경기 수(eff)가 같은 사람과 맞바꿔 다 같이 뛰거나 다 같이 쉬게 한다.
// 경기 수 공평은 그대로(같은 eff끼리만 교환), 지난 라운드에 쉰 사람을 또 쉬게 하지 않는다.
// 다 같이 쉬게 된 묶음은 다음 라운드에 경기 수가 적어 함께 우선 선발된다.
function fitWishes(info, slots, list, nRounds) {
  const sel = new Set(info.slice(0, slots).map((x) => x.id));
  const by = new Map(info.map((x) => [x.id, x]));
  const locked = new Set();
  const restedLast = (x) => nRounds > 0 && x.streak > 0;
  // movers를 반대편 사람과 하나씩 맞바꾼다. 모두 짝을 찾을 때만 반영
  const swapAll = (movers, w, toSel, pick) => {
    const used = new Set(), pairs = [];
    for (const id of movers) {
      const x = by.get(id);
      const cands = info.filter((y) => sel.has(y.id) === toSel && !w.ids.includes(y.id) && !locked.has(y.id) &&
        !used.has(y.id) && y.eff === x.eff);
      const y = pick(cands);
      if (!y) return false;
      used.add(y.id);
      pairs.push([id, y.id]);
    }
    for (const [a, b] of pairs) {
      if (toSel) { sel.add(a); sel.delete(b); } else { sel.delete(a); sel.add(b); }
    }
    return true;
  };
  for (const w of list) {
    if (w.ids.some((id) => locked.has(id))) continue;
    const inS = w.ids.filter((id) => sel.has(id)), out = w.ids.filter((id) => !sel.has(id));
    let ok = !inS.length || !out.length;
    // ① 쉬는 사람을 데려온다: 대신 쉴 사람은 지난 라운드에 뛴 사람 중 가장 최근까지 뛴 사람
    if (!ok) ok = swapAll(out, w, true, (c) => c.filter((y) => !restedLast(y)).sort((a, b) => a.streak - b.streak)[0]);
    // ② 안 되면 다 같이 쉰다: 뽑힌 사람이 지난 라운드에 쉬었으면 안 됨, 대신 뛸 사람은 오래 쉰 사람
    if (!ok && !inS.some((id) => restedLast(by.get(id)))) ok = swapAll(inS, w, false, (c) => c.sort((a, b) => b.streak - a.streak)[0]);
    if (ok) w.ids.forEach((id) => locked.add(id));
  }
  return { selected: info.filter((x) => sel.has(x.id)).map((x) => x.id), resting: info.filter((x) => !sel.has(x.id)).map((x) => x.id) };
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
 * @param {{players:Array, rounds:Array, courts:number, wishes?:Array, rng?:Function}} opts
 *   wishes: 같이 치기 요청 [{id, kind:'team'|'court'|'group', ids:[...], fixed}]
 * @returns {{round:{no:number, matches:Array, resting:number[], granted?:number[]}} | {error:string}}
 *   granted: 이번 라운드에 들어준 요청 id (요청한 사람이 모두 참가 중이고 조건대로 모였을 때)
 */
export function generateRound({ players, rounds, courts, wishes = [], rng = Math.random }) {
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

  const wishList = prepWishes(wishes, new Set(active.map((p) => p.id)));
  const { selected, resting } = fitWishes(info, slots, wishList, rounds.length);

  const wishPair = new Map(), wishTeam = new Set(), wishGroups = new Set();
  const addPair = (a, b, v) => { const k = pairKey(a, b); wishPair.set(k, (wishPair.get(k) || 0) + v); };
  for (const w of wishList) {
    if (w.kind === 'team') { addPair(w.ids[0], w.ids[1], WEIGHTS.wish / 2); wishTeam.add(pairKey(w.ids[0], w.ids[1])); }
    else {
      const v = w.kind === 'court' ? WEIGHTS.wish : WEIGHTS.wish / 2;
      for (let i = 0; i < w.ids.length; i++) for (let j = i + 1; j < w.ids.length; j++) addPair(w.ids[i], w.ids[j], v);
      if (w.ids.length === 4) wishGroups.add(groupKey(w.ids));
    }
  }

  const ctx = {
    score: new Map(players.map((p) => [p.id, LEVEL_SCORE[p.level] || 3])),
    partner: h.partner, opp: h.opp, lastGroups: h.lastGroups,
    gender, types: h.types, typeCount: h.typeCount,
    share: typeShare(active),
    wishList, wishPair, wishTeam, wishGroups,
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
  // 들어준 요청 표시: 요청한 사람이 한 코트에 모였는지(같은 편 요청은 한 팀인지)
  const granted = [];
  for (const w of wishList) {
    const m = matches.find((x) => w.ids.every((id) => x.teamA.includes(id) || x.teamB.includes(id)));
    if (!m) continue;
    if (w.kind === 'team' && !(w.ids.every((id) => m.teamA.includes(id)) || w.ids.every((id) => m.teamB.includes(id)))) continue;
    m.wish = true;
    if (w.all) granted.push(w.id);
  }
  // 실력이 높은 코트부터 1코트
  matches.sort((a, b) => b.total - a.total);
  matches.forEach((m, i) => { m.court = i + 1; delete m.total; });

  const round = { no: rounds.length + 1, matches, resting };
  if (wishList.length) round.granted = granted;
  return { round };
}
