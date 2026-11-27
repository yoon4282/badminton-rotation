// 렌더링 (상태를 읽어 HTML 생성)
import { state } from './state.js';
import { computeStats, ranking, fmtRate } from './stats.js';
import { WISH_SIZE } from './matcher.js';
import { WISH_LABEL } from './wishes.js';

// 같이 치기 요청을 만드는 중인 선택 (이 기기 화면에만, 저장하지 않음)
export const wishDraft = { kind: 'team', fixed: false, ids: [] };
const WISH_GUIDE = {
  team: '한 팀이 될 2명을 고르세요.',
  court: '같은 코트에서 칠 2명을 고르세요. (같은 편이든 상대든)',
  group: '한 코트에서 같이 칠 4명을 고르세요. 팀은 돌아가며 바뀌어요.',
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LV_CLASS = { A: 'a', B: 'b', C: 'c', D: 'd', '초심': 'n' };
const lvBadge = (lv) => `<i class="lv lv-${LV_CLASS[lv] || 'c'}">${esc(lv)}</i>`;
const GD = { M: ['m', '남'], F: ['f', '여'] };
const gdBadge = (g) => (GD[g] ? `<i class="gd gd-${GD[g][0]}">${GD[g][1]}</i>` : '');
const TYPE_CLASS = { '남복': 't-m', '여복': 't-f', '혼복': 't-mix' };
const byId = (id) => state.players.find((p) => p.id === id);
const chip = (id) => {
  const p = byId(id);
  return p ? `<div class="pl">${esc(p.name)}${gdBadge(p.gender)}${lvBadge(p.level)}</div>` : '<div class="pl">?</div>';
};

// 실제로 다른 탭으로 바뀔 때만 맨 위로 (결과 입력 등 같은 탭 안의 다시 그리기는 스크롤 유지)
export function showTab(tab) {
  const changed = $('#tab-' + tab).hidden;
  state.tab = tab;
  for (const name of ['players', 'round', 'rank']) {
    $('#tab-' + name).hidden = name !== tab;
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (changed) window.scrollTo(0, 0);
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export function renderPlayers() {
  const active = state.players.filter((p) => p.active).length;
  $('#court-count').textContent = state.courts;
  const usable = Math.min(state.courts, Math.floor(active / 4));
  $('#court-hint').textContent = active >= 4
    ? `참가 ${active}명 → ${usable}코트 사용 (${Math.max(0, active - usable * 4)}명 휴식)`
    : '4명 이상 필요해요';
  $('#player-summary').textContent = `참가 ${active} / 전체 ${state.players.length}`;

  const stats = computeStats(state);
  $('#player-list').innerHTML = state.players.length
    ? state.players.map((p) => {
      const s = stats.get(p.id);
      return `<li class="prow ${p.active ? '' : 'off'}">
        <button type="button" class="lvbtn lv-${LV_CLASS[p.level]}" data-action="cycle-level" data-id="${p.id}" aria-label="급수 변경">${esc(p.level)}</button>
        <button type="button" class="gdbtn gd-${GD[p.gender] ? GD[p.gender][0] : 'n'}" data-action="cycle-gender" data-id="${p.id}" aria-label="성별 변경">${GD[p.gender] ? GD[p.gender][1] : '?'}</button>
        <div class="pname">${esc(p.name)}<small>${s.games}경기 ${s.wins}승 ${s.losses}패${p.active ? '' : ' · 휴식 중'}</small></div>
        <label class="switch"><input type="checkbox" data-action="toggle" data-id="${p.id}" ${p.active ? 'checked' : ''} aria-label="${esc(p.name)} 참가 여부"><span></span></label>
        <button type="button" class="icon-btn" data-action="remove" data-id="${p.id}" aria-label="삭제">✕</button>
      </li>`;
    }).join('')
    : '<li class="hint" style="padding:12px 0">아직 참가자가 없어요. 위에서 추가해 주세요.</li>';
  renderWishes();
}

const wishNames = (w) => w.ids.map((id) => { const p = byId(id); return p ? esc(p.name) : '?'; }).join(w.kind === 'team' ? ' & ' : ' · ');

function renderWishes() {
  const n = WISH_SIZE[wishDraft.kind];
  // 지워졌거나 휴식 중인 사람은 고른 목록에서 뺀다
  wishDraft.ids = wishDraft.ids.filter((id) => byId(id)?.active);
  $('#wish-summary').textContent = state.wishes.length ? `${state.wishes.length}건` : '';
  $('#wish-list').innerHTML = state.wishes.length
    ? state.wishes.map((w) => {
      const resting = w.ids.some((id) => !byId(id)?.active);
      return `<li class="wrow">
        <span class="wkind wk-${w.kind}">${WISH_LABEL[w.kind]}</span>
        <div class="wname">${wishNames(w)}${resting ? '<small>휴식 중인 사람이 있어 지금은 반영 안 돼요</small>' : ''}</div>
        <button type="button" class="wmode ${w.fixed ? 'fixed' : ''}" data-action="wish-fix" data-id="${w.id}" data-fixed="${w.fixed ? 1 : 0}" aria-label="한 번/계속 바꾸기">${w.fixed ? '🔁 계속' : '1️⃣ 한 번'}</button>
        <button type="button" class="icon-btn" data-action="wish-del" data-id="${w.id}" aria-label="요청 삭제">✕</button>
      </li>`;
    }).join('')
    : '<li class="hint" style="padding:6px 0">아직 요청이 없어요.</li>';

  document.querySelectorAll('#wish-kind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === wishDraft.kind)));
  document.querySelectorAll('#wish-mode button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.fixed === '1') === wishDraft.fixed)));
  $('#wish-guide').textContent = WISH_GUIDE[wishDraft.kind] + (wishDraft.fixed ? ' 매 라운드 같이 넣어요.' : ' 다음 라운드에 한 번 들어주고 사라져요.');
  const active = state.players.filter((p) => p.active);
  $('#wish-pick').innerHTML = active.length
    ? active.map((p) => {
      const on = wishDraft.ids.includes(p.id);
      return `<button type="button" class="wpick ${on ? 'on' : ''}" data-action="wish-pick" data-id="${p.id}" aria-pressed="${on}">${esc(p.name)}${gdBadge(p.gender)}</button>`;
    }).join('')
    : '<span class="hint">참가 중인 사람이 없어요.</span>';
  const btn = $('#wish-add');
  btn.disabled = wishDraft.ids.length !== n;
  btn.textContent = wishDraft.ids.length === n ? `🔗 ${WISH_LABEL[wishDraft.kind]} 요청 추가` : `${n}명을 골라 주세요 (${wishDraft.ids.length}/${n})`;
}

function matchCard(m, ri) {
  const mi = state.rounds[ri].matches.indexOf(m);
  const won = (t) => (m.winner === t ? 'won' : '');
  const on = (t) => (m.winner === t ? 'on' : '');
  return `<article class="match">
    <header>${m.court}코트${m.wish ? '<span class="mtype t-wish">🔗 같이</span>' : ''}${m.type ? `<span class="mtype ${TYPE_CLASS[m.type] || ''}">${m.type}</span>` : ''}</header>
    <div class="teams">
      <div class="team a ${won('A')}"><span class="tag">A팀${m.winner === 'A' ? ' 🏆' : ''}</span>${m.teamA.map(chip).join('')}</div>
      <div class="vs">VS</div>
      <div class="team b ${won('B')}"><span class="tag">B팀${m.winner === 'B' ? ' 🏆' : ''}</span>${m.teamB.map(chip).join('')}</div>
    </div>
    <div class="win-btns">
      <button type="button" class="win a ${on('A')}" data-action="win" data-r="${ri}" data-m="${mi}" data-team="A">A팀 승</button>
      <button type="button" class="win b ${on('B')}" data-action="win" data-r="${ri}" data-m="${mi}" data-team="B">B팀 승</button>
    </div>
  </article>`;
}

// 아직 못 들어준 한 번 요청 (다음 라운드에 다시 시도)
function waitingWishes() {
  const list = state.wishes.filter((w) => !w.fixed);
  if (!list.length) return '';
  return `<div class="resting wish-wait">🔗 다음 판에 같이 넣을 요청: ${list.map((w) => `${wishNames(w)}(${WISH_LABEL[w.kind]})`).join(', ')}</div>`;
}

const doneCount = (r) => r.matches.filter((m) => m.winner).length;

export function renderRound() {
  const badge = $('#round-badge');
  const n = state.rounds.length;
  badge.hidden = n === 0;
  badge.textContent = `${n}라운드`;

  const view = $('#round-view');
  if (!n) {
    const active = state.players.filter((p) => p.active).length;
    view.innerHTML = `<div class="card empty">
      <p>참가 ${active}명 · 코트 ${state.courts}개</p>
      <button type="button" class="btn primary big" data-action="gen-round" ${active < 4 ? 'disabled' : ''}>1라운드 대진 만들기</button>
      ${active < 4 ? '<p class="hint">참가자 탭에서 4명 이상 추가해 주세요.</p>' : ''}
    </div>`;
    return;
  }
  const ri = n - 1;
  const cur = state.rounds[ri];
  // 다시 그려도 펼쳐 둔 지난 라운드는 계속 펼쳐 둔다
  const openPast = new Set([...view.querySelectorAll('.past details[open]')].map((d) => d.dataset.r));
  const past = state.rounds.slice(0, -1).map((r, i) => ({ r, i })).reverse();
  view.innerHTML = `
    <div class="round-head"><h2>${cur.no}라운드</h2><span>결과 ${doneCount(cur)}/${cur.matches.length}</span></div>
    <div class="mgrid" data-n="${cur.matches.length}">${cur.matches.map((m) => matchCard(m, ri)).join('')}</div>
    ${cur.resting.length ? `<div class="resting">💤 휴식: ${cur.resting.map((id) => { const p = byId(id); return p ? esc(p.name) : '?'; }).join(', ')}</div>` : ''}
    ${waitingWishes()}
    <div class="actions">
      <button type="button" class="btn primary big full" data-action="next-round">다음 라운드 만들기 →</button>
      <button type="button" class="btn kakao full" data-action="share-round">💬 카톡으로 배정표 공유</button>
      <button type="button" class="btn" data-action="regen">🔀 다시 짜기</button>
      <button type="button" class="btn" data-action="copy-round">📋 배정표 복사</button>
    </div>
    ${past.length ? `<div class="past"><div class="hint" style="margin-bottom:8px">지난 라운드 (결과 수정 가능)</div>
      ${past.map(({ r, i }) => `<details data-r="${i}"${openPast.has(String(i)) ? ' open' : ''}><summary>${r.no}라운드 · 결과 ${doneCount(r)}/${r.matches.length}</summary><div class="mgrid" data-n="${r.matches.length}">${r.matches.map((m) => matchCard(m, i)).join('')}</div></details>`).join('')}</div>` : ''}`;
}

export function renderRank() {
  const rows = ranking(state);
  const view = $('#rank-view');
  if (!rows.some((r) => r.games > 0)) {
    view.innerHTML = `<div class="card empty"><p>아직 입력된 경기 결과가 없어요.<br>대진 탭에서 A팀 승 / B팀 승을 눌러 주세요.</p></div>`;
    return;
  }
  view.innerHTML = `<div class="card">
    <table class="rank"><thead><tr><th>순위</th><th style="text-align:left">이름</th><th>경기</th><th>승</th><th>패</th><th>승률</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.player.active ? '' : 'off'} ${r.rank && r.rank <= 3 ? 'top' : ''}">
      <td class="rk">${r.rank ?? '-'}</td>
      <td class="nm">${esc(r.player.name)}${lvBadge(r.player.level)}</td>
      <td>${r.games}</td><td>${r.wins}</td><td>${r.losses}</td><td class="rt">${fmtRate(r)}</td></tr>`).join('')}
    </tbody></table>
    <button type="button" class="btn kakao big" data-action="share-rank">💬 카톡으로 순위표 공유</button>
    <button type="button" class="btn big" data-action="copy-rank">📋 순위표 복사</button>
  </div>`;
}

export function renderAll() {
  renderPlayers();
  renderRound();
  renderRank();
  showTab(state.tab);
}
