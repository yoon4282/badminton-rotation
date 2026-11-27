// [🧑‍⚖️ 코트 심판 QR] (메인 관리자 화면)
// 심판 링크 = ?ref=방ID&court=코트&key=심판키. 심판키는 부 관리자 키와 따로라 심판은 자기 코트 점수판만 조작할 수 있다.
// 링크는 코트에 묶여 있어서 라운드가 바뀌면 같은 코트의 다음 경기로 자동으로 넘어간다.
import { startHost, hostId, kickRefs, refCounts } from './p2p.js';
import { state } from './state.js';
import { renderQr } from './invite.js';
import { capOf } from './score.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'bdm-ref-key';
const ON_STORE = 'bdm-ref-on'; // 한 번 켜면 새로고침 후에도 자동 연결 (심판이 다시 붙을 수 있게)

let opts = null;
let court = 1;
let url = '';

const randKey = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
function getKey() {
  let k = null;
  try { k = localStorage.getItem(KEY_STORE); } catch (e) { /* 무시 */ }
  if (!k) { k = randKey(); try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* 무시 */ } }
  return k;
}
export const checkRefKey = (k) => typeof k === 'string' && k === getKey();

const STATUS_TEXT = {
  connecting: '⏳ 연결 중이에요… (최대 12초)',
  ready: '✅ 대기 중 · 심판이 QR을 찍으면 이 코트 점수판이 열려요',
  reconnecting: '🔄 연결이 끊겨 다시 연결하는 중… 잠시만요',
  error: '⚠️ 연결에 실패했어요. 잠시 후 다시 시도해 주세요.',
};
function setStatus(key) {
  const el = $('ref-status');
  el.textContent = STATUS_TEXT[key] || key;
  el.dataset.state = key;
  $('ref-retry').hidden = key !== 'error';
}

// 코트 버튼 + 코트별 연결된 심판 수
export function renderRefModal(counts = refCounts()) {
  if (!opts || $('ref-modal').hidden) return;
  const cur = state.rounds[state.rounds.length - 1];
  const n = Math.max(state.courts, cur ? cur.matches.length : 0);
  if (court > n) court = 1;
  $('ref-courts').innerHTML = Array.from({ length: n }, (_, i) => i + 1).map((c) =>
    `<button type="button" data-court="${c}" aria-pressed="${c === court}">${c}코트${counts[c] ? ' 🧑‍⚖️' : ''}</button>`).join('');
  document.querySelectorAll('#ref-to button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.to === state.scoreTo)));
  document.querySelectorAll('#ref-deuce button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.deuce === '1') === state.deuce)));
  $('ref-rule').textContent = state.deuce
    ? `${state.scoreTo}점 먼저 · ${state.scoreTo - 1}:${state.scoreTo - 1}부터 듀스(2점 차) · 최대 ${capOf(state.scoreTo, true)}점`
    : `${state.scoreTo}점에 먼저 닿으면 끝 (듀스 없음)`;
  const m = cur && cur.matches.find((x) => x.court === court);
  $('ref-count').textContent = (counts[court] ? `${court}코트 심판 연결됨 (${counts[court]}명)` : `${court}코트 심판이 아직 없어요`) +
    (cur ? (m ? '' : ` · 이번 라운드에 ${court}코트 경기는 없어요`) : ' · 대진을 만들면 점수판에 경기가 떠요');
}

function showUrl() {
  const id = hostId();
  if (!id) return false;
  url = location.origin + location.pathname + '?ref=' + encodeURIComponent(id) + '&court=' + court + '&key=' + encodeURIComponent(getKey());
  $('ref-url').value = url;
  $('ref-url').hidden = false;
  $('ref-copy').disabled = false;
  renderQr(url, $('ref-box'));
  return true;
}

async function connect() {
  $('ref-box').innerHTML = '';
  $('ref-url').hidden = true;
  $('ref-copy').disabled = true;
  setStatus('connecting');
  try {
    await startHost(opts.handlers());
    try { localStorage.setItem(ON_STORE, '1'); } catch (e) { /* 무시 */ }
    setStatus('ready');
    showUrl();
    renderRefModal();
  } catch (e) {
    setStatus('error');
  }
}

export function openRefModal(c) {
  if (c) court = c;
  $('ref-modal').hidden = false;
  document.body.classList.add('modal-open');
  renderRefModal();
  connect(); // 이미 연결돼 있으면 같은 방 ID를 그대로 돌려준다
}
function close() {
  $('ref-modal').hidden = true; // 연결은 유지
  document.body.classList.remove('modal-open');
}

// handlers: startHost에 넘길 심판 핸들러를 돌려주는 함수, setRule: 점수 규칙 변경 {to} 또는 {deuce} (op)
export function initRefHost(o) {
  opts = o;
  $('ref-close').addEventListener('click', close);
  $('ref-retry').addEventListener('click', connect);
  $('ref-modal').addEventListener('click', (e) => {
    if (e.target.id === 'ref-modal') { close(); return; }
    const cb = e.target.closest('#ref-courts button');
    if (cb) { court = +cb.dataset.court; renderRefModal(); if (hostId()) showUrl(); return; }
    const tb = e.target.closest('#ref-to button');
    if (tb) { opts.setRule({ to: +tb.dataset.to }); return; }
    const db = e.target.closest('#ref-deuce button');
    if (db) opts.setRule({ deuce: db.dataset.deuce === '1' });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ref-modal').hidden) close(); });
  $('ref-copy').addEventListener('click', async () => {
    opts.toast((await opts.copyText(url)) ? `${court}코트 심판 링크를 복사했어요.` : '복사에 실패했어요. 링크를 길게 눌러 복사해 주세요.');
  });
  $('ref-renew').addEventListener('click', () => {
    if (!confirm('지금 연결된 심판은 모두 끊기고, 예전 심판 링크·QR은 더 이상 쓸 수 없어요. 새로 만들까요?')) return;
    try { localStorage.setItem(KEY_STORE, randKey()); } catch (e) { /* 무시 */ }
    kickRefs();
    connect();
    opts.toast('새 심판 링크를 만들었어요. 심판에게 QR을 다시 보여 주세요.');
  });

  let on = false;
  try { on = localStorage.getItem(ON_STORE) === '1'; } catch (e) { /* 무시 */ }
  if (on && !hostId()) startHost(opts.handlers()).catch(() => { /* 모달에서 다시 시도 */ });
}
