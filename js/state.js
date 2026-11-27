// 전역 상태 + localStorage 저장/복원
export const LEVELS = ['A', 'B', 'C', 'D', '초심'];
// 균등 간격 급수 점수
export const LEVEL_SCORE = { A: 5, B: 4, C: 3, D: 2, '초심': 1 };

const KEY = 'badminton-rotation-v1';

export const state = {
  version: 1,
  courts: 2,
  nextId: 1,
  tab: 'players',
  players: [], // {id, name, level, active, joinedRound}
  rounds: [],  // {no, matches:[{court, teamA:[id,id], teamB:[id,id], winner:null|'A'|'B', wish?}], resting:[id], granted?, usedWishes?}
  wishes: [],  // 같이 치기 요청 {id, kind:'team'|'court'|'group', ids:[id...], fixed}
  nextWishId: 1,
};

// 같이 치기 요청 검사 (저장된 값·부 관리자에게 받은 값)
const WISH_N = { team: 2, court: 2, group: 4 };
function cleanWishes(list) {
  return (Array.isArray(list) ? list : []).filter((w) =>
    w && Number.isInteger(w.id) && WISH_N[w.kind] && Array.isArray(w.ids) && w.ids.length === WISH_N[w.kind] && w.ids.every(Number.isInteger),
  ).map((w) => ({ id: w.id, kind: w.kind, ids: w.ids.slice(), fixed: !!w.fixed }));
}
const nextWish = (wishes, n) => Math.max(Number.isInteger(n) ? n : 1, wishes.reduce((m, w) => Math.max(m, w.id), 0) + 1);

function clampCourts(n) {
  n = parseInt(n, 10);
  return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 2;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || d.version !== 1) return;
    state.courts = clampCourts(d.courts);
    state.players = Array.isArray(d.players) ? d.players : [];
    state.rounds = Array.isArray(d.rounds) ? d.rounds : [];
    state.tab = ['players', 'round', 'rank'].includes(d.tab) ? d.tab : 'players';
    state.wishes = cleanWishes(d.wishes);
    state.nextWishId = nextWish(state.wishes, d.nextWishId);
    const maxId = state.players.reduce((m, p) => Math.max(m, p.id), 0);
    state.nextId = Math.max(Number.isInteger(d.nextId) ? d.nextId : 1, maxId + 1);
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다.', e);
  }
}

// 부 관리자 화면은 메인 관리자의 상태를 받아 보여만 주므로 이 기기에 저장하지 않는다
let persist = true;
export function setPersist(on) { persist = on; }

// 메인 → 부 관리자로 보내는 상태 (탭 위치는 기기마다 따로)
export function snapshot() {
  return { courts: state.courts, nextId: state.nextId, players: state.players, rounds: state.rounds, wishes: state.wishes, nextWishId: state.nextWishId };
}
export function applySnapshot(s) {
  if (!s || typeof s !== 'object') return;
  state.courts = clampCourts(s.courts);
  state.players = Array.isArray(s.players) ? s.players : [];
  state.rounds = Array.isArray(s.rounds) ? s.rounds : [];
  state.nextId = Number.isInteger(s.nextId) ? s.nextId : 1;
  state.wishes = cleanWishes(s.wishes);
  state.nextWishId = nextWish(state.wishes, s.nextWishId);
}

export function save() {
  if (!persist) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}

export function setCourts(n) {
  state.courts = clampCourts(n);
}

export function resetRounds() {
  state.rounds = [];
}

export function resetAll() {
  state.courts = 2;
  state.nextId = 1;
  state.players = [];
  state.rounds = [];
  state.wishes = [];
  state.nextWishId = 1;
  state.tab = 'players';
}
