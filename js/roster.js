// 회원 기억: 한 번 등록한 사람의 성별·급수를 이름으로 기억해 두었다가 다음 모임에 자동으로 채운다.
// '전체 초기화'를 해도 지워지지 않는다(명단·기록과 별도 저장).
const KEY = 'badminton-members-v1';
let cache = null;

function read() {
  if (cache) return cache;
  cache = {};
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (d && typeof d === 'object') cache = d;
  } catch (e) { /* localStorage 없음(테스트) 또는 손상 */ }
  return cache;
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* 무시 */ }
}

// 성별은 알 때만 덮어쓴다(미지정으로 바꿔도 예전 정보는 유지)
export function remember(p) {
  if (!p || !p.name) return;
  const r = read();
  const prev = r[p.name] || {};
  r[p.name] = { gender: p.gender || prev.gender || null, level: p.level || prev.level || 'C', at: Date.now() };
  write();
}

export function rememberAll(players) {
  const r = read();
  for (const p of players) {
    if (!p.name) continue;
    const prev = r[p.name] || {};
    r[p.name] = { gender: p.gender || prev.gender || null, level: p.level || prev.level || 'C', at: prev.at || Date.now() };
  }
  write();
}

export function lookup(name) {
  return read()[name] || null;
}

export function memberCount() {
  return Object.keys(read()).length;
}

export function clearMembers() {
  cache = {};
  write();
}
