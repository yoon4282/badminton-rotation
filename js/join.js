// 참가자 전용 간편 등록 화면 (?join=방ID)
import { createGuest } from './p2p.js';

const $ = (id) => document.getElementById(id);

export function startJoin(roomId) {
  const guest = createGuest(roomId);
  let level = 'C', gender = null;
  let busy = false;
  let reqId = null; // 같은 입력의 재시도는 같은 reqId → 중복 등록 방지

  const form = $('join-form'), done = $('join-done'), err = $('join-error'), btn = $('join-submit');

  function newReq() { reqId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function showErr(msg) { err.textContent = msg; err.hidden = !msg; }

  document.querySelectorAll('#join-level button').forEach((b) => b.addEventListener('click', () => {
    level = b.dataset.level;
    document.querySelectorAll('#join-level button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('#join-gender button').forEach((b) => b.addEventListener('click', () => {
    gender = b.dataset.gender;
    document.querySelectorAll('#join-gender button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('join-name').addEventListener('input', () => { newReq(); showErr(''); }); // 내용이 바뀌면 새 요청
  document.querySelectorAll('#join-level button, #join-gender button').forEach((b) => b.addEventListener('click', newReq));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // 연타 방지
    const name = $('join-name').value.trim();
    if (!name) { showErr('이름을 입력해 주세요.'); return; }
    if (!gender) { showErr('성별(남/여)을 선택해 주세요.'); return; }
    if (!reqId) newReq();
    busy = true;
    btn.disabled = true;
    btn.textContent = '전송 중…';
    showErr('');
    try {
      const res = await guest.send({ name, level, gender }, reqId);
      if (res.ok) {
        $('join-done-name').textContent = `${res.name}(${res.level})`;
        form.hidden = true;
        done.hidden = false;
      } else {
        showErr(res.error || '등록하지 못했어요.');
      }
    } catch (e2) {
      showErr('운영진 화면과 연결하지 못했어요. 운영진의 QR 창이 열려 있는지 확인하고 다시 눌러 주세요.');
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = '모임 참가하기';
    }
  });

  $('join-more').addEventListener('click', () => {
    $('join-name').value = '';
    gender = null;
    level = 'C';
    document.querySelectorAll('#join-gender button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    document.querySelectorAll('#join-level button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === 'C')));
    reqId = null;
    done.hidden = true;
    form.hidden = false;
    showErr('');
    $('join-name').focus();
  });

  // 화면을 열자마자 미리 연결해 두면 전송이 빠르다 (실패해도 제출 시 다시 시도)
  guest.warm().catch(() => {});
}
