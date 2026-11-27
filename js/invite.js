// 운영진 화면의 [QR 초대 코드] 모달. 연결/QR 라이브러리가 실패해도 다른 기능에는 영향이 없다.
import { startHost, hostId, loadLib, QR_URLS } from './p2p.js';
import { kakaoEnabled, sendKakaoText } from './kakao.js';
import { shareText } from './share.js';

const JOIN_TEXT = '🏸 배드민턴 모임 참가 등록\n아래 버튼을 눌러 이름·성별·급수를 입력하면 명단에 바로 올라가요!';

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

let fixedIdRef = null; // 부 관리자 화면: 내 연결 없이 메인 관리자 방의 QR을 보여 준다

export async function renderQr(url, box = $('qr-box')) {
  box.innerHTML = '';
  try {
    const QRCode = await loadLib('qrcode', QR_URLS, 'QRCode');
    new QRCode(box, { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    box.innerHTML = '<p class="hint">QR 이미지를 불러오지 못했어요.<br>아래 링크를 복사해서 공유해 주세요.</p>';
  }
}

const qrStatus = (s) => { if (!$('qr-modal').hidden) setStatus(s); };

async function connect() {
  $('qr-box').innerHTML = '';
  $('qr-url').hidden = true;
  $('qr-copy').disabled = true; $('qr-kakao').disabled = true;
  setStatus('connecting');
  try {
    const id = await startHost({
      onJoin: (v) => {
        const res = onJoinRef(v);
        if (res && res.ok) { joinedCount++; $('qr-count').textContent = `이번에 합류한 사람 ${joinedCount}명`; }
        return res;
      },
      onStatus: qrStatus,
    });
    currentUrl = joinUrl(id);
    $('qr-url').value = currentUrl;
    $('qr-url').hidden = false;
    $('qr-copy').disabled = false; $('qr-kakao').disabled = false;
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
  const id = fixedIdRef || hostId();
  if (id) {
    currentUrl = joinUrl(id);
    $('qr-url').value = currentUrl;
    $('qr-url').hidden = false;
    $('qr-copy').disabled = false; $('qr-kakao').disabled = false;
    setStatus(fixedIdRef ? '✅ 참가자가 QR을 찍으면 메인 관리자 명단에 바로 추가돼요' : 'ready');
    renderQr(currentUrl);
  } else {
    connect();
  }
}

function close() {
  $('qr-modal').hidden = true; // 연결은 유지 (모달만 닫음)
  document.body.classList.remove('modal-open');
}

export function initInvite({ onJoin, toast, copyText, fixedId = null }) {
  onJoinRef = onJoin;
  fixedIdRef = fixedId;
  $('qr-open').addEventListener('click', open);
  $('qr-close').addEventListener('click', close);
  $('qr-retry').addEventListener('click', connect);
  $('qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('qr-modal').hidden) close(); });
  // ① 카톡 채팅방 선택이 바로 열림(메시지의 [참가 등록하기] 버튼 → 참가 화면) → ② 휴대폰 공유 창 → ③ 복사
  $('qr-kakao').addEventListener('click', async () => {
    if (!currentUrl) return;
    if (kakaoEnabled()) {
      try { if (sendKakaoText(JOIN_TEXT, { url: currentUrl, button: '참가 등록하기' })) return; } catch (e) { /* 아래 대체 방식 */ }
    }
    const res = await shareText(JOIN_TEXT + '\n' + currentUrl);
    if (res === 'copied') toast('이 기기는 바로 공유가 안 돼서 참가 링크를 복사했어요. 카톡에 붙여넣기 하세요!');
    else if (res === 'fail') toast('공유에 실패했어요. 링크 복사 버튼을 이용해 주세요.');
  });
  $('qr-copy').addEventListener('click', async () => {
    toast((await copyText(currentUrl)) ? '참가 링크를 복사했어요.' : '복사에 실패했어요. 링크를 길게 눌러 복사해 주세요.');
  });
}
