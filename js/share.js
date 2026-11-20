// 카카오톡 공유용 텍스트 생성 + 클립보드 복사
import { state } from './state.js';
import { ranking, fmtRate } from './stats.js';

const nm = (id) => {
  const p = state.players.find((x) => x.id === id);
  return p ? `${p.name}(${p.level})` : '?';
};

export function roundText() {
  const r = state.rounds[state.rounds.length - 1];
  if (!r) return '';
  const lines = [`🏸 ${r.no}라운드 대진`];
  for (const m of r.matches) {
    lines.push(`[${m.court}코트${m.type ? ' ' + m.type : ''}] ${m.teamA.map(nm).join('·')} vs ${m.teamB.map(nm).join('·')}`);
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
