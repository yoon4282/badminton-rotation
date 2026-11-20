// 참가자 추가/일괄 파싱/토글 (상태만 변경, 저장·렌더는 호출 측에서)
import { state, LEVELS } from './state.js';

export function addPlayer(name, level, gender) {
  name = String(name || '').trim().slice(0, 12);
  if (!name) return null;
  if (!LEVELS.includes(level)) level = 'C';
  if (gender !== 'M' && gender !== 'F') gender = null;
  const p = { id: state.nextId++, name, level, gender, active: true, joinedRound: state.rounds.length };
  state.players.push(p);
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

// 한 줄에 한 명. 이름 뒤의 성별·급수 토큰은 순서 상관없이 인식
// 예: "김철수 남 B", "이영희/여/A", "박민수(남,C)", "1. 최지우 여 초심", "김철수 B"(성별 생략)
export function parseBulk(text) {
  const entries = [];
  let defaulted = 0, noGender = 0;
  for (let raw of String(text || '').split(/[\n;]+/)) {
    raw = raw.replace(/^\s*(?:\d+\s*[.)]\s*)/, '').trim();
    if (!raw) continue;
    const toks = raw.split(/[\s,/\-:()]+/).filter(Boolean);
    let level = null, gender = null;
    while (toks.length > 1) {
      const t = toks[toks.length - 1];
      const lv = normLevel(t), g = normGender(t);
      if (lv && !level) level = lv;
      else if (g && !gender) gender = g;
      else break;
      toks.pop();
    }
    if (!level) defaulted++;
    if (!gender) noGender++;
    entries.push({ name: toks.join(' '), level: level || 'C', gender });
  }
  return { entries, defaulted, noGender };
}

export function addBulk(text) {
  const { entries, defaulted, noGender } = parseBulk(text);
  const exists = new Set(state.players.map((p) => p.name));
  let added = 0, skipped = 0;
  for (const e of entries) {
    if (exists.has(e.name)) { skipped++; continue; }
    if (addPlayer(e.name, e.level, e.gender)) { exists.add(e.name); added++; }
  }
  return { added, skipped, defaulted, noGender };
}

export function cycleGender(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) p.gender = p.gender === 'M' ? 'F' : p.gender === 'F' ? null : 'M';
}

export function toggleActive(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) p.active = !p.active;
  return p;
}

export function cycleLevel(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) p.level = LEVELS[(LEVELS.indexOf(p.level) + 1) % LEVELS.length];
}

export function hasHistory(id) {
  return state.rounds.some((r) => r.matches.some((m) => m.teamA.includes(id) || m.teamB.includes(id)));
}

export function removePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
}
