import { state, load, save, setCourts, resetRounds, resetAll } from './state.js';
import { addPlayer, addBulk, toggleActive, cycleLevel, cycleGender, removePlayer, hasHistory } from './players.js';
import { generateRound } from './matcher.js';
import { renderAll, showTab, toast } from './ui.js';
import { roundText, rankText, copyText, shareText } from './share.js';
import { initInvite } from './invite.js';

let newLevel = 'C';
let newGender = null; // 추가할 때마다 직접 선택하도록 시작은 미선택

function commit() {
  save();
  renderAll();
}

function makeRound(replaceLast) {
  const base = replaceLast ? state.rounds.slice(0, -1) : state.rounds;
  const res = generateRound({ players: state.players, rounds: base, courts: state.courts });
  if (res.error) { toast(res.error); return; }
  if (replaceLast) state.rounds[state.rounds.length - 1] = res.round;
  else state.rounds.push(res.round);
  state.tab = 'round';
  commit();
}

async function copy(text, okMsg) {
  if (!text) { toast('복사할 내용이 없어요.'); return; }
  toast((await copyText(text)) ? okMsg : '복사에 실패했어요. 직접 선택해 복사해 주세요.');
}

async function share(text, what) {
  if (!text) { toast('공유할 내용이 없어요.'); return; }
  const res = await shareText(text);
  if (res === 'copied') toast(`이 기기는 바로 공유가 안 돼서 ${what}를 복사했어요. 카톡에 붙여넣기 하세요!`);
  else if (res === 'fail') toast('공유에 실패했어요. 복사 버튼을 이용해 주세요.');
}

const actions = {
  'court-inc': () => { setCourts(state.courts + 1); commit(); },
  'court-dec': () => { setCourts(state.courts - 1); commit(); },

  'bulk-add': () => {
    const ta = document.getElementById('bulk-input');
    const { added, skipped, defaulted, noGender } = addBulk(ta.value);
    if (!added && !skipped) { toast('붙여넣은 내용이 없어요.'); return; }
    ta.value = '';
    toast(`${added}명 추가` + (skipped ? ` · 중복 ${skipped}명 제외` : '') + (defaulted ? ` · 급수 없는 ${defaulted}명은 C` : '') +
      (noGender ? ` · 성별 미지정 ${noGender}명(목록에서 ?를 눌러 지정)` : ''));
    commit();
  },

  'cycle-level': (el) => { cycleLevel(+el.dataset.id); commit(); },
  'cycle-gender': (el) => { cycleGender(+el.dataset.id); commit(); },

  remove: (el) => {
    const id = +el.dataset.id;
    if (hasHistory(id)) { toast('경기 기록이 있어 삭제할 수 없어요. 스위치로 휴식 처리하세요.'); return; }
    if (confirm('이 참가자를 삭제할까요?')) { removePlayer(id); commit(); }
  },

  'gen-round': () => makeRound(false),

  'next-round': () => {
    const cur = state.rounds[state.rounds.length - 1];
    if (cur && cur.matches.some((m) => !m.winner) && !confirm('결과가 입력되지 않은 코트가 있어요. 그래도 다음 라운드로 갈까요?')) return;
    makeRound(false);
  },

  regen: () => {
    const cur = state.rounds[state.rounds.length - 1];
    if (!cur) return;
    if (cur.matches.some((m) => m.winner) && !confirm('입력한 결과가 지워져요. 다시 짤까요?')) return;
    makeRound(true);
    toast('현재 라운드를 다시 짰어요.');
  },

  win: (el) => {
    const m = state.rounds[+el.dataset.r]?.matches[+el.dataset.m];
    if (!m) return;
    m.winner = m.winner === el.dataset.team ? null : el.dataset.team; // 같은 버튼 다시 누르면 취소
    commit();
  },

  'copy-round': () => copy(roundText(), '배정표를 복사했어요. 카톡에 붙여넣기 하세요!'),
  'copy-rank': () => copy(rankText(), '순위표를 복사했어요. 카톡에 붙여넣기 하세요!'),
  'share-round': () => share(roundText(), '배정표'),
  'share-rank': () => share(rankText(), '순위표'),

  'reset-rounds': () => {
    if (confirm('라운드와 승패 기록을 모두 지울까요? (참가자 명단은 유지)')) { resetRounds(); state.tab = 'players'; commit(); toast('새 경기를 시작해요.'); }
  },
  'reset-all': () => {
    if (confirm('명단과 기록을 전부 삭제할까요?')) { resetAll(); commit(); toast('초기화했어요.'); }
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tabbar button');
  if (tab) { showTab(tab.dataset.tab); save(); return; }

  const lvl = e.target.closest('#level-seg button');
  if (lvl) {
    newLevel = lvl.dataset.level;
    document.querySelectorAll('#level-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === lvl)));
    return;
  }

  const gnd = e.target.closest('#gender-seg button');
  if (gnd) {
    newGender = gnd.dataset.gender;
    document.querySelectorAll('#gender-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === gnd)));
    return;
  }

  const el = e.target.closest('[data-action]');
  if (el && el.type !== 'checkbox' && actions[el.dataset.action]) actions[el.dataset.action](el);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.action === 'toggle') {
    const p = toggleActive(+el.dataset.id);
    commit();
    if (p) toast(`${p.name}: ${p.active ? '참가' : '휴식'} · 다음 라운드부터 반영돼요`);
  }
});

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('name-input');
  if (!newGender) { toast('성별(남/여)을 먼저 선택해 주세요.'); return; }
  const p = addPlayer(input.value, newLevel, newGender);
  if (!p) return;
  input.value = '';
  input.focus();
  commit();
  toast(`${p.name}(${p.gender === 'M' ? '남' : '여'}·${p.level}) 추가`);
});

// QR 초대: 참가자가 보낸 정보를 명단에 추가. addPlayer는 joinedRound=현재 라운드 수, 경기 0회로 등록되고
// matcher의 지각자 규칙(평균 보정 + 오래 쉰 순)에 따라 다음 라운드에서 우선 배정된다.
function handleRemoteJoin({ name, level, gender }) {
  if (state.players.length >= 100) return { ok: false, error: '참가 인원이 가득 찼어요.' };
  if (state.players.some((p) => p.name === name)) {
    return { ok: false, error: '같은 이름이 이미 등록돼 있어요. 이름 뒤에 숫자나 성을 붙여 주세요.' };
  }
  const p = addPlayer(name, level, gender);
  if (!p) return { ok: false, error: '이름을 입력해 주세요.' };
  commit();
  toast(`${p.name}(${p.level})님이 합류했습니다!`);
  return { ok: true, name: p.name, level: p.level };
}

load();
renderAll();
initInvite({ onJoin: handleRemoteJoin, toast, copyText });
