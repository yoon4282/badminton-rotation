// [📷 투표 캡처로 추가] 카톡 투표 참여자 화면 캡처 → 브라우저 안에서 글자 인식(Tesseract.js) → 이름 후보 확인 → 추가
// 이미지는 서버로 보내지 않는다. 라이브러리·한글 인식 데이터는 처음 쓸 때만 CDN에서 받는다.
import { loadLib } from './p2p.js';
import { extractCandidates, lev } from './ocr-parse.js';
import { memberNames, lookup } from './roster.js';
import { state } from './state.js';

const TESS_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GD = { M: '남', F: '여' };

let worker = null;
let cands = []; // {name, raw, gender, known, likely, checked, inList}
let busy = false;
let onAddRef = null;

function setStatus(msg, state = '') {
  const el = $('ocr-status');
  el.textContent = msg;
  el.dataset.state = state;
}
function setProgress(p) {
  $('ocr-bar-wrap').hidden = p == null;
  if (p != null) $('ocr-bar').style.width = Math.round(p * 100) + '%';
}

async function getWorker() {
  if (worker) return worker;
  setStatus('⏳ 글자 인식 도구를 불러오는 중… (처음 한 번만 몇 초 걸려요)');
  const T = await loadLib('tesseract', TESS_URLS, 'Tesseract');
  const w = await T.createWorker('kor+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') setProgress(m.progress);
      else if (/loading|initializ/.test(m.status)) setProgress(m.progress || 0);
    },
  });
  // 11 = 흩어진 글자 찾기: 프로필 사진·아이콘 옆의 이름을 가장 잘 읽는다
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  worker = w;
  return worker;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

// 폭 약 810px로 맞추고(폰 캡처는 이 크기에서 가장 잘 읽힘) 흑백 변환, 다크 모드면 반전.
// threshold를 주면 완전한 흑/백으로 바꿔 회색 프로필 배경 등을 지운다.
function prepare(img, threshold) {
  let s = Math.min(1.5, 810 / img.width);
  s = Math.min(s, Math.sqrt(12e6 / (img.width * img.height))); // 아주 긴 캡처는 메모리 보호
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height), p = im.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) { const v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000; p[i] = v; sum += v; }
  const dark = sum / (p.length / 4) < 128;
  for (let i = 0; i < p.length; i += 4) {
    let v = dark ? 255 - p[i] : p[i];
    if (threshold) v = v < threshold ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

const sameLen = (a, b) => a.length === b.length;

function knownNames() {
  return [...new Set([...memberNames(), ...state.players.map((p) => p.name)])];
}

function render() {
  const inList = new Set(state.players.map((p) => p.name));
  $('ocr-list').innerHTML = cands.map((c, i) => {
    const mem = lookup(c.name);
    const already = inList.has(c.name);
    const info = already ? '<span class="ocr-tag dup">이미 명단</span>'
      : mem ? `<span class="ocr-tag ok">${mem.gender ? GD[mem.gender] + '·' : '성별?·'}${esc(mem.level || 'C')} 기억됨</span>`
        : '<span class="ocr-tag new">처음 · 확인</span>';
    return `<li class="ocr-row${already ? ' off' : ''}">
      <input type="checkbox" data-i="${i}" ${c.checked && !already ? 'checked' : ''} ${already ? 'disabled' : ''} aria-label="${esc(c.name)} 추가">
      <div class="ocr-name"><input type="text" data-i="${i}" value="${esc(c.name)}" maxlength="12" aria-label="이름 고치기">
        ${c.raw ? `<small>인식: ${esc(c.raw)} → 회원 이름으로 고침</small>` : ''}</div>
      ${info}
    </li>`;
  }).join('');
  const n = cands.filter((c, i) => c.checked && !inList.has(c.name)).length;
  $('ocr-add').disabled = !n || busy;
  $('ocr-add').textContent = n ? `선택한 ${n}명 추가` : '추가할 사람을 선택하세요';
  $('ocr-hint').textContent = cands.length
    ? '이름이 틀리면 눌러서 고치고, 이름이 아닌 건 체크를 풀어 주세요. 처음 온 사람은 추가 후 목록에서 성별·급수를 지정하면 다음부터 기억해요.'
    : '';
}

async function runFiles(files) {
  if (!files.length || busy) return;
  busy = true;
  render();
  try {
    const w = await getWorker();
    let found = 0;
    for (let i = 0; i < files.length; i++) {
      const img = await loadImage(files[i]);
      // 회색조 / 흑백 두 번 읽어 합친다. 신뢰도가 높은 쪽을 먼저 넣고,
      // 다른 쪽에서 나온 비슷한 글자(한두 글자만 다른 같은 길이 이름)는 잘못 읽은 것으로 보고 버린다.
      const passes = [];
      for (const thr of [150, 0]) {
        setStatus(`🔍 캡처 ${files.length > 1 ? `${i + 1}/${files.length} ` : ''}글자 읽는 중… (${passes.length + 1}/2)`);
        setProgress(0);
        const { data } = await w.recognize(prepare(img, thr));
        passes.push(data);
      }
      passes.sort((a, b) => b.confidence - a.confidence);
      const known = knownNames();
      passes.forEach((data, pi) => {
        for (const c of extractCandidates(data.text, known)) {
          if (cands.some((x) => x.name === c.name)) continue;
          if (pi > 0 && !c.known && cands.some((x) => sameLen(x.name, c.name) && lev(x.name, c.name) <= 2)) continue;
          cands.push({ ...c, checked: c.likely });
          found++;
        }
      });
    }
    setStatus(cands.length ? `✅ 이름 후보 ${cands.length}명 (이번에 ${found}명 찾음)` : '이름을 찾지 못했어요. 참여자 이름이 크게 보이게 캡처해 주세요.', cands.length ? '' : 'error');
  } catch (e) {
    setStatus('⚠️ 글자 인식 도구를 불러오지 못했어요. 인터넷 연결을 확인하거나, 붙여넣기로 추가해 주세요.', 'error');
  } finally {
    busy = false;
    setProgress(null);
    render();
  }
}

function open() {
  $('ocr-modal').hidden = false;
  document.body.classList.add('modal-open');
}
function close() {
  $('ocr-modal').hidden = true;
  document.body.classList.remove('modal-open');
  if (!busy) cands = [];
}

export function initOcr({ onAdd }) {
  onAddRef = onAdd;
  const file = $('ocr-file');
  const pick = () => { file.value = ''; file.click(); };
  $('ocr-open').addEventListener('click', pick);
  $('ocr-more').addEventListener('click', pick);
  file.addEventListener('change', () => {
    const files = [...file.files];
    if (!files.length) return;
    if ($('ocr-modal').hidden) { cands = []; open(); }
    runFiles(files);
  });
  $('ocr-close').addEventListener('click', close);
  $('ocr-modal').addEventListener('click', (e) => { if (e.target.id === 'ocr-modal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ocr-modal').hidden) close(); });

  $('ocr-list').addEventListener('change', (e) => {
    const c = cands[+e.target.dataset.i];
    if (!c) return;
    if (e.target.type === 'checkbox') c.checked = e.target.checked;
    else { c.name = e.target.value.trim(); c.raw = null; c.checked = !!c.name; }
    render();
  });

  $('ocr-add').addEventListener('click', () => {
    const inList = new Set(state.players.map((p) => p.name));
    const picked = cands.filter((c) => c.checked && c.name && !inList.has(c.name));
    if (!picked.length) return;
    onAddRef(picked.map((c) => ({ name: c.name, gender: c.gender, level: 'C', levelGiven: false })));
    cands = [];
    close();
  });
}
