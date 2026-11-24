// [👥 부 관리자 초대] (메인 관리자 화면)
// 부 관리자 링크 = ?admin=방ID&key=비밀키. 비밀키가 맞는 연결만 조작할 수 있다.
// 상태의 주인은 메인 관리자 기기: 부 관리자의 조작을 받아 반영한 뒤 전체 상태를 모두에게 다시 보낸다.
import { startHost, hostId, kickAdmins, broadcastAdmins, adminCount } from './p2p.js';
import { snapshot } from './state.js';
import { renderQr } from './invite.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'bdm-admin-key';
const ON_STORE = 'bdm-admin-on'; // 한 번 켜면 다음에 열 때 자동으로 연결 (부 관리자가 다시 붙을 수 있게)

let opts = null;
let url = '';

const randKey = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
function getKey() {
  let k = null;
  try { k = localStorage.getItem(KEY_STORE); } catch (e) { /* 무시 */ }
  if (!k) { k = randKey(); try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* 무시 */ } }
  return k;
}

const STATUS_TEXT = {
  connecting: '⏳ 연결 중이에요… (최대 12초)',
  ready: '✅ 대기 중 · 부 관리자가 링크를 열면 바로 연결돼요',
  reconnecting: '🔄 연결이 끊겨 다시 연결하는 중… 잠시만요',
  error: '⚠️ 연결에 실패했어요. 잠시 후 다시 시도해 주세요.',
};
function setStatus(key) {
  const el = $('admin-status');
  el.textContent = STATUS_TEXT[key] || key;
  el.dataset.state = key;
  $('admin-retry').hidden = key !== 'error';
}

function updateCount(n = adminCount()) {
  $('admin-count').textContent = n ? `연결된 부 관리자 ${n}명` : '아직 연결된 부 관리자가 없어요';
  const b = $('link-badge');
  b.hidden = !n;
  b.dataset.state = 'ready';
  b.textContent = `👥 부 관리자 ${n}명`;
}

export function broadcastState() {
  if (adminCount()) broadcastAdmins({ type: 'snap', s: snapshot() });
}

let memo = null;
function hostHandlers() {
  return memo || (memo = {
    onJoin: opts.onJoin,
    onOp: opts.onOp,
    checkAdmin: (k) => typeof k === 'string' && k === getKey(),
    snapshot: opts.snapshot,
    onAdmins: (n) => {
      const before = Number($('admin-count').dataset.n || 0);
      $('admin-count').dataset.n = n;
      updateCount(n);
      if (n > before) opts.toast('👥 부 관리자가 연결됐어요.');
    },
    onStatus: (s) => { if (!$('admin-modal').hidden) setStatus(s); },
  });
}

async function connect() {
  $('admin-box').innerHTML = '';
  $('admin-url').hidden = true;
  $('admin-copy').disabled = true;
  setStatus('connecting');
  try {
    const id = await startHost(hostHandlers());
    try { localStorage.setItem(ON_STORE, '1'); } catch (e) { /* 무시 */ }
    url = location.origin + location.pathname + '?admin=' + encodeURIComponent(id) + '&key=' + encodeURIComponent(getKey());
    $('admin-url').value = url;
    $('admin-url').hidden = false;
    $('admin-copy').disabled = false;
    setStatus('ready');
    updateCount();
    await renderQr(url, $('admin-box'));
  } catch (e) {
    setStatus('error');
  }
}

function open() {
  $('admin-modal').hidden = false;
  document.body.classList.add('modal-open');
  updateCount();
  connect(); // 이미 연결돼 있으면 같은 방 ID를 그대로 돌려준다
}
function close() {
  $('admin-modal').hidden = true; // 연결은 유지
  document.body.classList.remove('modal-open');
}

export function initAdminHost(o) {
  opts = o;
  $('admin-open').addEventListener('click', open);
  $('admin-close').addEventListener('click', close);
  $('admin-retry').addEventListener('click', connect);
  $('admin-modal').addEventListener('click', (e) => { if (e.target.id === 'admin-modal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('admin-modal').hidden) close(); });
  $('admin-copy').addEventListener('click', async () => {
    opts.toast((await opts.copyText(url)) ? '부 관리자 링크를 복사했어요. 운영진에게만 보내 주세요!' : '복사에 실패했어요. 링크를 길게 눌러 복사해 주세요.');
  });
  $('admin-renew').addEventListener('click', () => {
    if (!confirm('지금 연결된 부 관리자는 모두 끊기고, 예전 링크는 더 이상 쓸 수 없어요. 새 링크를 만들까요?')) return;
    try { localStorage.setItem(KEY_STORE, randKey()); } catch (e) { /* 무시 */ }
    kickAdmins();
    connect();
    opts.toast('새 부 관리자 링크를 만들었어요.');
  });

  // 전에 부 관리자를 켜 둔 기기면, 새로고침·재접속 후에도 조용히 다시 연결해 부 관리자가 이어서 쓸 수 있게
  let on = false;
  try { on = localStorage.getItem(ON_STORE) === '1'; } catch (e) { /* 무시 */ }
  if (on && !hostId()) startHost(hostHandlers()).catch(() => { /* 모달에서 다시 시도 */ });
}
