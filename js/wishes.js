// 같이 치기 요청 (같은 편 / 같은 코트 / 4명 한 코트) × (이번 한 번 / 계속 고정)
// 한 번 요청은 대진에서 들어주면 목록에서 빠지고 그 라운드의 usedWishes에 보관된다(다시 짜기 하면 되돌림).
import { state } from './state.js';
import { WISH_SIZE } from './matcher.js';

export const WISH_LABEL = { team: '같은 편', court: '같은 코트', group: '4명 한 코트' };
const MAX_WISHES = 50;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function addWish(kind, ids, fixed) {
  if (!WISH_SIZE[kind]) return { ok: false, msg: '요청 종류를 골라 주세요.' };
  ids = [...new Set(ids)].filter((id) => state.players.some((p) => p.id === id));
  if (ids.length !== WISH_SIZE[kind]) return { ok: false, msg: `${WISH_SIZE[kind]}명을 골라 주세요.` };
  if (state.wishes.length >= MAX_WISHES) return { ok: false, msg: '요청이 너무 많아요. 지난 요청을 지워 주세요.' };
  if (state.wishes.some((w) => w.kind === kind && sameSet(w.ids, ids))) return { ok: false, msg: '이미 있는 요청이에요.' };
  const w = { id: state.nextWishId++, kind, ids, fixed: !!fixed };
  state.wishes.push(w);
  return { ok: true, wish: w };
}

export function removeWish(id) {
  const n = state.wishes.length;
  state.wishes = state.wishes.filter((w) => w.id !== id);
  return state.wishes.length !== n;
}

export function setWishFixed(id, fixed) {
  const w = state.wishes.find((x) => x.id === id);
  if (w) w.fixed = !!fixed;
  return w;
}

// 참가자가 삭제되면 그 사람이 들어간 요청도 지운다
export function dropPlayerWishes(pid) {
  state.wishes = state.wishes.filter((w) => !w.ids.includes(pid));
}

// 새 라운드를 만든 뒤: 들어준 한 번 요청을 목록에서 빼서 라운드에 보관
export function consumeGranted(round) {
  const granted = new Set(round.granted || []);
  const used = state.wishes.filter((w) => !w.fixed && granted.has(w.id));
  if (used.length) {
    round.usedWishes = used;
    state.wishes = state.wishes.filter((w) => !used.includes(w));
  }
  return used.length;
}

// 다시 짜기 전: 그 라운드에서 쓴 한 번 요청을 목록에 되돌린 목록 (상태는 바꾸지 않음)
export function wishesWithRestored(round) {
  const back = (round && round.usedWishes) || [];
  const list = state.wishes.concat(back.filter((w) => !state.wishes.some((x) => x.id === w.id)));
  return list.sort((a, b) => a.id - b.id);
}
