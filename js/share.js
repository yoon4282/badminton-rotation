// 카카오톡 공유용 텍스트 생성 + 클립보드 복사
import { state } from './state.js';
import { ranking, fmtRate } from './stats.js';

const nm = (id) => {
  const p = state.players.find((x) => x.id === id);
  return p ? `${p.name}(${p.level})` : '?';
};

// 심판이 결과를 보낸 경기는 최종 점수를 붙인다
const finalScore = (m) => {
  if (!m.score || !m.score.done || !m.winner) return '';
  let a = 0, b = 0;
  for (const t of m.score.log) { if (t === 'A') a++; else b++; }
  return ` (${a}:${b})`;
};

export function roundText() {
  const r = state.rounds[state.rounds.length - 1];
  if (!r) return '';
  const lines = [`🏸 ${r.no}라운드 대진`];
  for (const m of r.matches) {
    lines.push(`[${m.court}코트${m.type ? ' ' + m.type : ''}] ${m.teamA.map(nm).join('·')} vs ${m.teamB.map(nm).join('·')}${finalScore(m)}`);
  }
  if (r.resting.length) lines.push(`💤 휴식: ${r.resting.map((id) => nm(id)).join(', ')}`);
  return lines.join('\n');
}

export function rankText() {
  const rows = ranking(state).filter((r) => r.games > 0);
  if (!rows.length) return '';
  const medal = ['🥇', '🥈', '🥉'];
  const lines = ['🏆 현재 순위'];
  for (const r of rows) {
    const mark = r.rank <= 3 ? medal[r.rank - 1] : `${r.rank}위`;
    lines.push(`${mark} ${r.player.name} ${r.wins}승 ${r.losses}패 (${fmtRate(r)}) · ${r.games}경기`);
  }
  return lines.join('\n');
}

// ── 카톡 바로 공유용 짧은 텍스트 (최대 max자) ──
const nameOnly = (id) => {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : '?';
};
const fits = (lines, max) => lines.join('\n').length <= max;

// 배정표: 전체 → 급수·유형 뺀 축약본 순으로 시도. 그래도 넘치면 null(잘린 대진표는 보내지 않음)
export function roundTextKakao(max) {
  const full = roundText();
  if (!full || full.length <= max) return full || null;
  const r = state.rounds[state.rounds.length - 1];
  const lines = [`🏸 ${r.no}라운드`];
  for (const m of r.matches) {
    lines.push(`${m.court}코트 ${m.teamA.map(nameOnly).join('·')} vs ${m.teamB.map(nameOnly).join('·')}`);
  }
  if (r.resting.length) lines.push(`💤 ${r.resting.map(nameOnly).join(',')}`);
  return fits(lines, max) ? lines.join('\n') : null;
}

// 순위표: 축약 형식으로 들어가는 만큼 넣고 나머지는 "…외 n명"
export function rankTextKakao(max) {
  const full = rankText();
  if (!full || full.length <= max) return full || null;
  const rows = ranking(state).filter((r) => r.games > 0);
  const lines = ['🏆 현재 순위'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = `${r.rank}. ${r.player.name} ${r.wins}승${r.losses}패`;
    const rest = rows.length - i - 1;
    const tail = rest ? [`…외 ${rest}명`] : [];
    if (!fits([...lines, line, ...tail], max)) { lines.push(`…외 ${rows.length - i}명`); break; }
    lines.push(line);
  }
  return lines.join('\n');
}

// 휴대폰 공유 시트(카카오톡 등)로 바로 보내기. 지원하지 않으면 클립보드 복사로 대체.
// 반환: 'shared' | 'cancel' | 'copied' | 'fail'
export async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel'; // 사용자가 공유 시트를 닫음
      // NotAllowedError 등 → 복사로 대체
    }
  }
  return (await copyText(text)) ? 'copied' : 'fail';
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 아래 대체 방식 사용 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
