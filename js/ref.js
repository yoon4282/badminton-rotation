// 코트 심판 점수판 화면 (?ref=방ID&court=코트&key=심판키)
// 메인 관리자 기기가 점수의 주인: 점수 버튼은 요청만 보내고, 메인이 반영한 화면 정보(snap)를 받아 다시 그린다.
// 링크가 코트에 묶여 있어서 라운드가 바뀌면 같은 코트의 다음 경기가 자동으로 뜬다.
import { createAdminClient } from './p2p.js';
import { gameState } from './score.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GD = { M: ['m', '남'], F: ['f', '여'] };
const SWAP_STORE = 'bdm-ref-swap';

let view = null;      // 메인이 보내 준 내 코트 정보
let client = null;
let busy = false;
let link = 'connecting';
let swapped = false;  // 화면 좌우 바꾸기 (이 기기에서만)
let lastKey = null;
let msgTimer = null;

const LINK_TEXT = {
  connecting: '⏳ 연결 중…',
  reconnecting: '🔄 다시 연결 중… (메인 관리자 화면이 열려 있어야 해요)',
  ready: '🟢 연결됨',
};

function flash(msg) {
  const el = $('ref-msg');
  el.textContent = msg;
  el.hidden = !msg;
  clearTimeout(msgTimer);
  if (msg) msgTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

const names = (team) => team.map((p) => `<span class="rname">${esc(p.name)}${GD[p.gender] ? `<i class="gd gd-${GD[p.gender][0]}">${GD[p.gender][1]}</i>` : ''}</span>`).join('');

function side(t, m, st) {
  const isA = t === 'A';
  const pts = isA ? st.a : st.b;
  const serving = st.server === t && !st.over && !m.score.done;
  const won = (m.score.done || st.over) && st.winner === t;
  return `<button type="button" class="rside ${isA ? 'a' : 'b'}${serving ? ' serving' : ''}${won ? ' won' : ''}" data-ref="point" data-team="${t}"
      ${st.over || m.score.done || busy ? 'disabled' : ''} aria-label="${t}팀 1점">
    <span class="rtag">${t}팀${won ? ' 🏆' : ''}</span>
    <span class="rnames">${names(isA ? m.teamA : m.teamB)}</span>
    <span class="rpts">${pts}</span>
    <span class="rsrv">${serving ? `🏸 서브 · ${st.side === 'right' ? '오른쪽' : '왼쪽'}` : st.point === t ? '게임 포인트' : '&nbsp;'}</span>
  </button>`;
}

function render() {
  const badge = $('ref-link');
  badge.textContent = LINK_TEXT[link] || link;
  badge.dataset.state = link;
  document.body.classList.toggle('sub-offline', link !== 'ready');
  const body = $('ref-body');
  if (!view) {
    $('ref-title').textContent = '🧑‍⚖️ 심판 점수판';
    body.innerHTML = '<p class="rwait">메인 관리자 화면에 연결하는 중이에요…</p>';
    return;
  }
  $('ref-title').textContent = `🧑‍⚖️ ${view.court}코트 심판`;
  const m = view.match;
  if (!m) {
    body.innerHTML = `<p class="rwait">${view.round ? `${view.round}라운드에는 ${view.court}코트 경기가 없어요.` : '아직 대진이 없어요.'}<br>대진이 나오면 이 화면에 자동으로 떠요.</p>`;
    return;
  }
  const st = gameState(m.score, view.scoreTo);
  const sides = swapped ? ['B', 'A'] : ['A', 'B'];
  const fresh = !m.score.log.length && !m.score.done;
  let banner = '';
  if (m.score.done) {
    banner = `<div class="rbanner done">✅ 결과를 보냈어요 · ${st.winner}팀 승 ${st.a}:${st.b}<small>다음 라운드 대진이 나오면 자동으로 넘어가요</small></div>`;
  } else if (st.over) {
    banner = `<button type="button" class="btn primary big full rfinish" data-ref="finish" ${busy ? 'disabled' : ''}>🏆 ${st.winner}팀 승리 ${st.a}:${st.b} · 결과 보내기</button>`;
  } else if (m.winner) {
    banner = `<div class="rbanner">관리자가 ${m.winner}팀 승으로 입력했어요. 점수는 계속 기록할 수 있어요.</div>`;
  } else if (st.deuce) {
    banner = '<div class="rbanner deuce">듀스! 2점 먼저 앞서면 승리</div>';
  }
  body.innerHTML = `
    <div class="rmeta">${view.round}라운드${m.type ? ` · ${esc(m.type)}` : ''} · ${view.scoreTo}점 경기</div>
    ${fresh ? `<div class="rfirst"><span>먼저 서브할 팀</span>
      <div class="seg two">${['A', 'B'].map((t) => `<button type="button" data-ref="serve" data-team="${t}" aria-pressed="${m.score.first === t}" ${busy ? 'disabled' : ''}>${t}팀</button>`).join('')}</div></div>` : ''}
    <div class="rboard">${sides.map((t) => side(t, m, st)).join('')}</div>
    ${banner}
    <div class="rctl">
      <button type="button" class="btn" data-ref="undo" ${busy || (fresh && !m.score.done) ? 'disabled' : ''}>↩ ${m.score.done ? '결과 취소' : '되돌리기'}</button>
      <button type="button" class="btn" data-ref="swap">⇄ 좌우 바꾸기</button>
    </div>
    <p class="hint rhint">점수를 딴 팀 쪽을 누르세요. ${view.scoreTo}점 먼저(듀스면 2점 차, 최대 ${Math.min(view.scoreTo + 9, 30)}점) 따면 끝나요.</p>`;
}

async function send(op, args = {}) {
  if (busy || !view || !view.match) return;
  busy = true;
  render();
  try {
    const res = await client.send(op, { ...args, key: view.match.key, v: view.match.score.v });
    if (!res.ok) flash(res.error || '반영하지 못했어요.');
    else if (op === 'point' && navigator.vibrate) navigator.vibrate(25);
  } catch (e) {
    flash('메인 관리자와 연결이 끊겨 반영되지 않았어요. 연결되면 다시 눌러 주세요.');
  } finally {
    busy = false;
    render();
  }
}

// 점수판을 보는 동안 화면이 꺼지지 않게 (지원하는 브라우저만)
let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* 무시 */ }
}

export function startRef(hostId, court, key) {
  document.body.classList.add('refmode');
  $('ref-app').hidden = false;
  try { swapped = localStorage.getItem(SWAP_STORE) === '1'; } catch (e) { /* 무시 */ }
  render();
  client = createAdminClient(hostId, { type: 'ref-hello', key, court }, {
    onSnap: (s) => {
      const k = s && s.match ? s.match.key : null;
      if (lastKey !== null && k && k !== lastKey) {
        flash(`새 경기! ${s.round}라운드 ${s.court}코트`);
        if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
      }
      lastKey = k;
      view = s;
      render();
    },
    onStatus: (s) => { link = s; render(); },
    onDenied: () => {
      link = 'error';
      $('ref-link').textContent = '⛔ 링크가 만료됐어요';
      $('ref-body').innerHTML = '<p class="rwait">심판 링크가 바뀌었거나 올바르지 않아요.<br>메인 관리자에게 새 QR을 받아 주세요.</p>';
    },
  }, 'ref-op');

  $('ref-app').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (!b || b.disabled) return;
    keepAwake();
    const act = b.dataset.ref;
    if (act === 'swap') {
      swapped = !swapped;
      try { localStorage.setItem(SWAP_STORE, swapped ? '1' : '0'); } catch (e2) { /* 무시 */ }
      render();
    } else if (act === 'point' || act === 'serve') send(act, { team: b.dataset.team });
    else if (act === 'finish') send('finish');
    else if (act === 'undo') {
      if (view && view.match && view.match.score.done && !confirm('보낸 결과를 취소할까요?')) return;
      send('undo');
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wake = null; keepAwake(); } });
}
