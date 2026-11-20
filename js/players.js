// 참가자 추가/일괄 파싱/토글 (상태만 변경, 저장·렌더는 호출 측에서)
import { state, LEVELS } from './state.js';
import { remember, lookup } from './roster.js';

export function addPlayer(name, level, gender) {
  name = String(name || '').trim().slice(0, 12);
  if (!name) return null;
  if (!LEVELS.includes(level)) level = 'C';
  if (gender !== 'M' && gender !== 'F') gender = null;
  const p = { id: state.nextId++, name, level, gender, active: true, joinedRound: state.rounds.length };
  state.players.push(p);
  remember(p);
  return p;
}

function normLevel(tok) {
  const t = tok.replace(/급$/, '').toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(t)) return t;
  if (['초심', '초보', '초'].includes(t)) return '초심';
  return null;
}

function normGender(tok) {
  const t = tok.toUpperCase();
  if (['남', '남자', 'M'].includes(t)) return 'M';
  if (['여', '여자', 'F'].includes(t)) return 'F';
  return null;
}

const HANGUL_NAME = /^[가-힣]{2,4}$/;

// 토큰 정리: "김철수B" → "김철수","B" / "김철수님" → "김철수"
function splitTokens(seg) {
  const out = [];
  for (let t of seg.split(/[\s,/\-:()[\]]+/).filter(Boolean)) {
    t = t.replace(/^([가-힣]{2,4})님$/, '$1');
    const m = t.match(/^([가-힣]{2,4})([A-Da-d]|초심)$/);
    if (m) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

// 한 줄에 한 명은 물론, 한 줄에 여러 명도 인식. 이름 뒤의 성별·급수 토큰은 순서 상관없이 인식
// 예: "김철수 남 B", "이영희/여/A", "박민수(남,C)", "1. 최지우 여 초심", "김철수 B"(성별 생략)
//     "김철수, 이영희, 박민수" / "김철수 이영희 박민수" / "김철수B·이영희A" (카톡 투표 참여자 옮겨 적기)
export function parseBulk(text) {
  const entries = [];
  for (let line of String(text || '').split(/[\n;]+/)) {
    line = line.replace(/^\s*(?:\d+\s*[.)]\s*)/, '').trim();
    if (!line) continue;
    const lineEntries = [];
    // 괄호 밖의 쉼표·가운뎃점·、 로 사람 구분 ("박민수(남,C)"의 쉼표는 유지)
    for (const seg of line.split(/[,·、](?![^()]*\))/)) {
      let cur = null; // 이 구간에서 만들고 있는 사람
      for (const t of splitTokens(seg)) {
        const lv = normLevel(t), g = normGender(t);
        const target = cur || lineEntries[lineEntries.length - 1]; // "최지우, d"처럼 표시만 따로 오면 앞사람 것
        if (target && lv && !target.level) { target.level = lv; target.marked = true; continue; }
        if (target && g && !target.gender) { target.gender = g; target.marked = true; continue; }
        // 이름 토큰: 한글 이름이 연달아 오거나 앞사람 표시가 끝났으면 새 사람, 아니면 이름에 이어 붙임(영문 이름 등)
        if (cur && !cur.marked && !(HANGUL_NAME.test(t) && HANGUL_NAME.test(cur.name))) {
          cur.name += ' ' + t;
        } else {
          cur = { name: t, level: null, gender: null, marked: false };
          lineEntries.push(cur);
        }
      }
    }
    entries.push(...lineEntries);
  }
  let defaulted = 0, noGender = 0;
  const out = entries.map((e) => {
    if (!e.level) defaulted++;
    if (!e.gender) noGender++;
    return { name: e.name.slice(0, 12), level: e.level || 'C', gender: e.gender, levelGiven: !!e.level };
  });
  return { entries: out, defaulted, noGender };
}

// 붙여넣기 일괄 추가. 성별·급수를 안 적은 사람은 기억된 회원 정보로 채운다.
export function addBulk(text) {
  return addEntries(parseBulk(text).entries);
}

// entries: [{name, level, gender, levelGiven}] (캡처 인식 결과도 이 형식으로 추가)
export function addEntries(entries) {
  const exists = new Set(state.players.map((p) => p.name));
  let added = 0, skipped = 0, defaulted = 0, noGender = 0, recalled = 0;
  for (const e of entries) {
    if (exists.has(e.name)) { skipped++; continue; }
    const mem = lookup(e.name);
    let level = e.level, gender = e.gender, used = false;
    if (mem && !e.levelGiven && mem.level) { level = mem.level; used = true; }
    if (mem && !gender && mem.gender) { gender = mem.gender; used = true; }
    if (addPlayer(e.name, level, gender)) {
      exists.add(e.name); added++;
      if (used) recalled++;
      if (!e.levelGiven && !(mem && mem.level)) defaulted++;
      if (!gender) noGender++;
    }
  }
  return { added, skipped, defaulted, noGender, recalled };
}

export function cycleGender(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) { p.gender = p.gender === 'M' ? 'F' : p.gender === 'F' ? null : 'M'; remember(p); }
}

export function toggleActive(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) p.active = !p.active;
  return p;
}

export function cycleLevel(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) { p.level = LEVELS[(LEVELS.indexOf(p.level) + 1) % LEVELS.length]; remember(p); }
}

export function hasHistory(id) {
  return state.rounds.some((r) => r.matches.some((m) => m.teamA.includes(id) || m.teamB.includes(id)));
}

export function removePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
}
