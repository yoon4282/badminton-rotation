// 운영진 화면의 [QR 초대 코드] 모달. 연결/QR 라이브러리가 실패해도 다른 기능에는 영향이 없다.
import { startHost, hostId, loadLib, QR_URLS } from './p2p.js';

const $ = (id) => document.getElementById(id);
let joinedCount = 0;
let onJoinRef = null;
let currentUrl = '';

const STATUS_TEXT = {
  connecting: '⏳ 연결 중이에요… (최대 12초)',
  ready: '✅ 대기 중 · 참가자가 QR을 찍으면 바로 추가돼요',
  reconnecting: '🔄 연결이 끊겨 다시 연결하는 중… 잠시만요',
  error: '⚠️ 연결에 실패했어요. 직접 입력·일괄 추가는 그대로 쓸 수 있어요.',
};

function setStatus(key) {
  const el = $('qr-status');
  el.textContent = STATUS_TEXT[key] || key;
  el.dataset.state = key;
  $('qr-retry').hidden = key !== 'error';
}

function joinUrl(id) {
  return location.origin + location.pathname + '?join=' + encodeURIComponent(id);
}

async function renderQr(url) {
  const box = $('qr-box');
  box.innerHTML = '';
  try {
    const QRCode = await loadLib('qrcode', QR_URLS, 'QRCode');
    new QRCode(box, { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    box.innerHTML = '<p class="hint">QR 이미지를 불러오지 못했어요.<br>아래 링크를 복사해서 공유해 주세요.</p>';
  }
}

async function connect() {
  $('qr-box').innerHTML = '';
  $('qr-url').hidden = true;
  $('qr-copy').disabled = true;
  setStatus('connecting');
  try {
    const id = await startHost({
      onJoin: (v) => {
        const res = onJoinRef(v);
        if (res && res.ok) { joinedCount++; $('qr-count').textContent = `이번에 합류한 사람 ${joinedCount}명`; }
        return res;
      },
      onStatus: (s) => { if (!$('qr-modal').hidden) setStatus(s); },
    });
    currentUrl = joinUrl(id);
    $('qr-url').value = currentUrl;
    $('qr-url').hidden = false;
    $('qr-copy').disabled = false;
    setStatus('ready');
    await renderQr(currentUrl);
  } catch (e) {
    setStatus('error');
  }
}

function open() {
  $('qr-modal').hidden = false;
  document.body.classList.add('modal-open');
  // 이미 연결돼 있으면 같은 방 ID/QR을 그대로 다시 보여준다
  const id = hostId();
  if (id) {
    currentUrl = joinUrl(id);
    $('qr-url').value = currentUrl;
    $('qr-url').hidden = false;
    $('qr-copy').disabled = false;
    setStatus('ready');
    renderQr(currentUrl);
  } else {
    connect();
  }
}

function close() {
  $('qr-modal').hidden = true; // 연결은 유지 (모달만 닫음)
  document.body.classList.remove('modal-open');
}

export function initInvite({ onJoin, toast, copyText }) {
  onJoinRef = onJoin;
  $('qr-open').addEventListener('click', open);
  $('qr-close').addEventListener('click', close);
  $('qr-retry').addEventListener('click', connect);
  $('qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('qr-modal').hidden) close(); });
  $('qr-copy').addEventListener('click', async () => {
    toast((await copyText(currentUrl)) ? '참가 링크를 복사했어요.' : '복사에 실패했어요. 링크를 길게 눌러 복사해 주세요.');
  });
}
