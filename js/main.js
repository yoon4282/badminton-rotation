import { state, load, save, setCourts, resetRounds, resetAll, LEVELS, setPersist, snapshot, applySnapshot } from './state.js';
import { addPlayer, addBulk, addEntries, toggleActive, cycleLevel, cycleGender, removePlayer, hasHistory } from './players.js';
import { generateRound } from './matcher.js';
import { renderAll, showTab, toast, wishDraft } from './ui.js';
import { addWish, removeWish, setWishFixed, dropPlayerWishes, consumeGranted, wishesWithRestored, WISH_LABEL } from './wishes.js';
import { WISH_SIZE } from './matcher.js';
import { roundText, rankText, copyText, shareText, roundTextKakao, rankTextKakao } from './share.js';
import { kakaoEnabled, preloadKakao, sendKakaoText, KAKAO_TEXT_MAX } from './kakao.js';
import { initInvite } from './invite.js';
import { rememberAll, lookup, exportMembers, useMembers } from './roster.js';
import { initOcr } from './ocr.js';
import { initAdminHost, broadcastState } from './admin.js';
import { createAdminClient, setHostHandlers, broadcastRefs } from './p2p.js';
import { initRefHost, openRefModal, renderRefModal, checkRefKey } from './referee-host.js';
import { emptyScore, gameState, applyScoreOp, SCORE_TO, capOf } from './score.js';

// ?admin=방ID&key=비밀키 로 열면 부 관리자 화면: 메인 관리자의 상태를 받아 보고, 조작은 메인에 요청한다
const params = new URLSearchParams(location.search);
const SUB = params.get('admin') ? { hostId: params.get('admin').trim(), key: params.get('key') || '' } : null;
let sub = null; // 부 관리자 연결 (SUB 모드에서만)

let newLevel = 'C';
let newGender = null; // 추가할 때마다 직접 선택하도록 시작은 미선택

function commit() {
  save();
  renderAll();
  if (!SUB) { broadcastState(); broadcastRefs(); renderRefModal(); }
}

const bulkMsg = ({ added, skipped, defaulted, noGender, recalled }) =>
  `${added}명 추가` + (recalled ? ` · 기억된 회원 ${recalled}명 자동 입력` : '') + (skipped ? ` · 중복 ${skipped}명 제외` : '') +
  (defaulted ? ` · 급수 없는 ${defaulted}명은 C` : '') + (noGender ? ` · 성별 미지정 ${noGender}명(목록에서 ?를 눌러 지정)` : '');

const findP = (id) => state.players.find((p) => p.id === id);
const int = (v) => (Number.isInteger(v) ? v : parseInt(v, 10));

// ───── 상태를 바꾸는 작업 (메인 관리자 기기에서만 실행) ─────
// 부 관리자가 보낸 값도 들어오므로 모두 검사한다. 반환: {ok:false, msg} 또는 {msg?}
const ops = {
  courts: ({ n }) => { setCourts(int(n)); },
  bulk: ({ text }) => {
    const r = addBulk(String(text || '').slice(0, 5000));
    if (!r.added && !r.skipped) return { ok: false, msg: '붙여넣은 내용이 없어요.' };
    return { msg: bulkMsg(r) };
  },
  entries: ({ entries }) => {
    const list = (Array.isArray(entries) ? entries : []).slice(0, 100).map((e) => ({
      name: String((e && e.name) || '').trim().slice(0, 12),
      level: LEVELS.includes(e && e.level) ? e.level : 'C',
      gender: e && (e.gender === 'M' || e.gender === 'F') ? e.gender : null,
      levelGiven: !!(e && e.levelGiven),
    })).filter((e) => e.name);
    const { added, recalled, noGender } = addEntries(list);
    return {
      msg: `${added}명 추가` + (recalled ? ` · 기억된 회원 ${recalled}명 자동 입력` : '') +
        (noGender ? ` · 처음 온 ${noGender}명은 목록에서 성별(?)·급수를 지정해 주세요` : ''),
    };
  },
  add: ({ name, level, gender }) => {
    name = String(name || '').trim();
    if (state.players.some((p) => p.name === name)) return { ok: false, msg: '같은 이름이 이미 있어요.' };
    const p = addPlayer(name, level, gender);
    if (!p) return { ok: false, msg: '이름을 입력해 주세요.' };
    return { msg: `${p.name}(${p.gender === 'M' ? '남' : p.gender === 'F' ? '여' : '?'}·${p.level}) 추가` };
  },
  level: ({ id }) => { cycleLevel(int(id)); },
  gender: ({ id }) => { cycleGender(int(id)); },
  remove: ({ id }) => {
    id = int(id);
    if (hasHistory(id)) return { ok: false, msg: '경기 기록이 있어 삭제할 수 없어요. 스위치로 휴식 처리하세요.' };
    removePlayer(id);
    dropPlayerWishes(id);
  },
  // 원하는 상태(active)를 보내서, 두 관리자가 동시에 눌러도 뒤집히지 않게
  toggle: ({ id, active }) => {
    const p = findP(int(id));
    if (!p) return { ok: false, msg: '참가자를 찾지 못했어요.' };
    if (p.active !== !!active) toggleActive(p.id);
    return { msg: `${p.name}: ${p.active ? '참가' : '휴식'} · 다음 라운드부터 반영돼요` };
  },
  // expect: 누른 화면에서 본 라운드 수. 다른 관리자가 먼저 라운드를 만들었으면 거절(라운드 두 번 생성 방지)
  round: ({ replaceLast, expect }) => {
    if (int(expect) !== state.rounds.length) return { ok: false, msg: '다른 관리자가 먼저 라운드를 바꿨어요. 화면을 확인해 주세요.' };
    if (replaceLast && !state.rounds.length) return { ok: false };
    const base = replaceLast ? state.rounds.slice(0, -1) : state.rounds;
    // 다시 짜기면 그 라운드에서 들어준 한 번 요청을 되돌려 놓고 다시 짠다
    const wishes = replaceLast ? wishesWithRestored(state.rounds[state.rounds.length - 1]) : state.wishes;
    const res = generateRound({ players: state.players, rounds: base, courts: state.courts, wishes });
    if (res.error) return { ok: false, msg: res.error };
    state.wishes = wishes;
    if (replaceLast) state.rounds[state.rounds.length - 1] = res.round;
    else state.rounds.push(res.round);
    const nGranted = (res.round.granted || []).length;
    consumeGranted(res.round);
    const waiting = state.wishes.filter((w) => !w.fixed).length;
    const wmsg = (nGranted ? `🔗 같이 치기 ${nGranted}건 반영` : '') + (waiting ? `${nGranted ? ' · ' : '🔗 '}${waiting}건은 다음 판에 다시 시도` : '');
    return { round: true, msg: [replaceLast ? '현재 라운드를 다시 짰어요.' : '', wmsg].filter(Boolean).join(' ') };
  },
  'wish-add': ({ kind, ids, fixed }) => {
    const list = (Array.isArray(ids) ? ids : []).slice(0, 4).map(int);
    const r = addWish(String(kind), list, !!fixed);
    if (!r.ok) return r;
    const names = r.wish.ids.map((id) => findP(id)?.name || '?').join('·');
    return { wishAdded: true, msg: `🔗 ${names} ${WISH_LABEL[r.wish.kind]} (${r.wish.fixed ? '계속' : '다음 판 한 번'}) · 다음 라운드부터 반영돼요` };
  },
  'wish-del': ({ id }) => { if (!removeWish(int(id))) return { ok: false, msg: '이미 지워진 요청이에요.' }; return { msg: '요청을 지웠어요.' }; },
  'wish-fix': ({ id, fixed }) => {
    const w = setWishFixed(int(id), !!fixed);
    if (!w) return { ok: false, msg: '요청을 찾지 못했어요.' };
    return { msg: w.fixed ? '🔗 계속 같이 치기로 바꿨어요.' : '🔗 다음 판 한 번만으로 바꿨어요.' };
  },
  // key: 누른 화면의 대진(팀 구성). 그사이 '다시 짜기'로 바뀌었으면 거절
  win: ({ r, m, key, winner }) => {
    const match = state.rounds[int(r)]?.matches[int(m)];
    if (!match || matchKey(match) !== key) return { ok: false, msg: '대진이 바뀌었어요. 화면을 확인하고 다시 눌러 주세요.' };
    match.winner = winner === 'A' || winner === 'B' ? winner : null;
    // 끝난 점수와 승패가 어긋나면: 직접 입력한 점수는 지우고, 심판 점수는 '결과 보냄'만 풀어 심판이 이어서 기록
    const sc = match.score;
    if (sc && sc.done && sc.log && sc.log.length) {
      const a = sc.log.filter((t) => t === 'A').length, b = sc.log.length - a;
      if (match.winner !== (a > b ? 'A' : 'B')) {
        if (sc.manual) { delete match.score; return { msg: '승패를 바꿔서 입력한 점수를 지웠어요.' }; }
        sc.done = false; sc.v++;
      }
    }
  },
  // 점수판 규칙: to(15/21/25)·deuce(있음/없음) 중 보낸 것만 바꾼다
  // 관리자·부 관리자 점수 직접 입력: 높은 쪽이 승리. a·b를 비우면(null) 점수와 승패를 지운다.
  'set-score': ({ r, m, key, a, b }) => {
    const match = state.rounds[int(r)]?.matches[int(m)];
    if (!match || matchKey(match) !== key) return { ok: false, msg: '대진이 바뀌었어요. 화면을 확인하고 다시 입력해 주세요.' };
    const v = (match.score && match.score.v) || 0;
    if (a === null && b === null) {
      delete match.score;
      match.winner = null;
      return { msg: `${match.court}코트 점수를 지웠어요.` };
    }
    a = int(a); b = int(b);
    if (!(a >= 0 && a <= 50 && b >= 0 && b <= 50)) return { ok: false, msg: '점수는 0~50 사이로 입력해 주세요.' };
    if (a === b) return { ok: false, msg: '동점은 입력할 수 없어요. 이긴 팀 점수가 더 커야 해요.' };
    // 심판 점수판과 같은 형식(log)으로 저장 → 득실·심판 화면에 그대로 쓰인다. v를 올려 심판의 이전 요청은 거절된다.
    match.score = { first: 'A', log: [...Array(a).fill('A'), ...Array(b).fill('B')], v: v + 1, done: true, manual: true };
    match.winner = a > b ? 'A' : 'B';
    return { msg: `${match.court}코트 ${a}:${b} · ${match.winner}팀 승` };
  },
  'score-to': ({ to, deuce }) => {
    if (to !== undefined) {
      to = int(to);
      if (!SCORE_TO.includes(to)) return { ok: false };
      state.scoreTo = to;
    }
    if (deuce !== undefined) state.deuce = !!deuce;
    return { msg: `🧑‍⚖️ 점수판: ${ruleText()}` };
  },
  'reset-rounds': () => { resetRounds(); return { tab: 'players', msg: '새 경기를 시작해요.' }; },
  'reset-all': () => { resetAll(); return { msg: '초기화했어요.' }; },
};
const HOST_ONLY = new Set(['reset-rounds', 'reset-all']);

// ───── 코트 심판 (메인 관리자 기기에서만 실행) ─────
// 심판은 연결할 때 정한 코트의 경기만 조작한다. 라운드는 고를 수 있고(미리 짜 둔 라운드·지난 라운드),
// 기본은 그 코트에서 아직 결과가 없는 가장 앞 라운드. key(라운드+대진)와 v(점수 버전)가 다르면 거절.
const ruleText = () => `${state.scoreTo}점 · ${state.deuce ? `듀스 있음(최대 ${capOf(state.scoreTo, true)}점)` : '듀스 없음'}`;
const refKey = (ri, m) => `${ri}:${matchKey(m)}`;
const pinfo = (id) => { const p = findP(id); return p ? { name: p.name, level: p.level, gender: p.gender || null } : { name: '?' }; };

function refView(court) {
  const rounds = [];
  state.rounds.forEach((r, ri) => {
    const m = r.matches.find((x) => x.court === court);
    if (!m) return;
    rounds.push({
      ri, no: r.no, key: refKey(ri, m), type: m.type || null, winner: m.winner,
      teamA: m.teamA.map(pinfo), teamB: m.teamB.map(pinfo), score: m.score || emptyScore(),
    });
  });
  // 자동: 결과가 없는 가장 앞 라운드, 다 끝났으면 마지막 라운드
  const next = rounds.find((x) => !x.winner) || rounds[rounds.length - 1];
  return { court, scoreTo: state.scoreTo, deuce: state.deuce, total: state.rounds.length, auto: next ? next.ri : null, rounds };
}

function handleRefOp(court, op, args) {
  const ri = int(args.ri);
  const m = Number.isInteger(ri) ? state.rounds[ri]?.matches.find((x) => x.court === court) : null;
  if (!m) return { ok: false, error: '이 라운드에 이 코트 경기가 없어요.' };
  if (args.key !== refKey(ri, m)) return { ok: false, error: '대진이 바뀌었어요. 화면을 확인해 주세요.' };
  if (!m.score) m.score = emptyScore();
  if (int(args.v) !== m.score.v) return { ok: false, error: '점수가 이미 바뀌었어요. 화면을 확인하고 다시 눌러 주세요.' };
  const wasDone = m.score.done;
  if (!applyScoreOp(m.score, op, args, state.scoreTo, state.deuce)) return { ok: false, error: '지금은 할 수 없어요.' };
  const st = gameState(m.score, state.scoreTo, state.deuce);
  if (op === 'finish') {
    m.winner = st.winner;
    toast(`🧑‍⚖️ ${state.rounds[ri].no}라운드 ${court}코트 결과: ${st.winner}팀 승 (${st.a}:${st.b})`);
  } else if (op === 'undo' && wasDone) {
    m.winner = null;
    toast(`🧑‍⚖️ ${state.rounds[ri].no}라운드 ${court}코트 심판이 결과를 취소했어요.`);
  }
  commit();
  return { ok: true };
}
const matchKey = (m) => [...m.teamA, '|', ...m.teamB].join(',');

function applyOp(op, args) {
  const f = ops[op];
  if (!f) return { ok: false, msg: '지원하지 않는 작업이에요.' };
  let r;
  try { r = f(args || {}) || {}; } catch (e) { return { ok: false, msg: '처리 중 오류가 났어요.' }; }
  if (r.ok === false) return r;
  r.ok = true;
  commit();
  return r;
}

// 메인이면 바로 실행, 부 관리자면 메인에 요청하고 결과(메시지)만 받는다. 상태는 메인이 보내 주는 snap으로 갱신된다.
async function run(op, args = {}) {
  let res;
  if (!SUB) res = applyOp(op, args);
  else {
    try { res = await sub.send(op, args); } catch (e) {
      toast('메인 관리자와 연결이 끊겨 반영되지 않았어요. 연결되면 다시 눌러 주세요.');
      renderAll(); // 바꿔 둔 스위치 등을 원래대로
      return null;
    }
    if (res.error && !res.msg) res.msg = res.error;
  }
  if (res.ok && res.tab) state.tab = res.tab;
  if (res.ok && res.round) { state.tab = 'round'; renderAll(); window.scrollTo(0, 0); } // 새 라운드는 맨 위부터
  else if (SUB) renderAll();
  if (res.msg) toast(res.msg);
  return res;
}

// 메인 관리자가 부 관리자의 요청을 받았을 때
function handleSubOp(op, args) {
  if (HOST_ONLY.has(op)) return { ok: false, error: '이 작업은 메인 관리자만 할 수 있어요.' };
  const r = applyOp(op, args);
  if (r.ok && r.msg) toast('👥 ' + r.msg);
  return { ok: r.ok, msg: r.msg || '', round: !!r.round };
}

async function copy(text, okMsg) {
  if (!text) { toast('복사할 내용이 없어요.'); return; }
  toast((await copyText(text)) ? okMsg : '복사에 실패했어요. 직접 선택해 복사해 주세요.');
}

// ① 카카오 SDK로 채팅방 선택 바로 열기 → ② 휴대폰 공유 창 → ③ 복사
async function share(text, kakaoText, what) {
  if (!text) { toast('공유할 내용이 없어요.'); return; }
  if (kakaoEnabled()) {
    if (kakaoText) {
      try { if (sendKakaoText(kakaoText)) return; } catch (e) { /* 아래 대체 방식 */ }
    } else {
      toast(`${what}가 길어 카톡 바로 공유(200자)가 안 돼요. 공유 창에서 카카오톡을 골라 주세요.`);
    }
  }
  const res = await shareText(text);
  if (res === 'copied') toast(`이 기기는 바로 공유가 안 돼서 ${what}를 복사했어요. 카톡에 붙여넣기 하세요!`);
  else if (res === 'fail') toast('공유에 실패했어요. 복사 버튼을 이용해 주세요.');
}

const actions = {
  'court-inc': () => run('courts', { n: state.courts + 1 }),
  'court-dec': () => run('courts', { n: state.courts - 1 }),

  'bulk-add': async () => {
    const ta = document.getElementById('bulk-input');
    if (!ta.value.trim()) { toast('붙여넣은 내용이 없어요.'); return; }
    const res = await run('bulk', { text: ta.value });
    if (res && res.ok) ta.value = '';
  },

  'cycle-level': (el) => run('level', { id: +el.dataset.id }),
  'ref-qr': (el) => openRefModal(+el.dataset.court),

  // 같이 치기 요청 만들기 (고르는 중인 상태는 이 기기 화면에만)
  'wish-kind': (el) => {
    wishDraft.kind = el.dataset.kind;
    wishDraft.ids = wishDraft.ids.slice(0, WISH_SIZE[wishDraft.kind]);
    renderAll();
  },
  'wish-mode': (el) => { wishDraft.fixed = el.dataset.fixed === '1'; renderAll(); },
  'wish-pick': (el) => {
    const id = +el.dataset.id, n = WISH_SIZE[wishDraft.kind];
    if (wishDraft.ids.includes(id)) wishDraft.ids = wishDraft.ids.filter((x) => x !== id);
    else if (wishDraft.ids.length < n) wishDraft.ids.push(id);
    else { toast(`${n}명까지 고를 수 있어요. 고른 사람을 다시 누르면 빠져요.`); return; }
    renderAll();
  },
  'wish-add': async () => {
    const res = await run('wish-add', { kind: wishDraft.kind, ids: wishDraft.ids, fixed: wishDraft.fixed });
    if (res && res.ok) { wishDraft.ids = []; renderAll(); }
  },
  'wish-del': (el) => run('wish-del', { id: +el.dataset.id }),
  'wish-fix': (el) => run('wish-fix', { id: +el.dataset.id, fixed: el.dataset.fixed !== '1' }),
  'cycle-gender': (el) => run('gender', { id: +el.dataset.id }),

  remove: (el) => {
    const id = +el.dataset.id;
    if (hasHistory(id)) { toast('경기 기록이 있어 삭제할 수 없어요. 스위치로 휴식 처리하세요.'); return; }
    if (confirm('이 참가자를 삭제할까요?')) run('remove', { id });
  },

  'gen-round': () => run('round', { expect: state.rounds.length }),

  'next-round': () => {
    const cur = state.rounds[state.rounds.length - 1];
    if (cur && cur.matches.some((m) => !m.winner) && !confirm('결과가 입력되지 않은 코트가 있어요. 그래도 다음 라운드로 갈까요?')) return;
    run('round', { expect: state.rounds.length });
  },

  regen: () => {
    const cur = state.rounds[state.rounds.length - 1];
    if (!cur) return;
    if (cur.matches.some((m) => m.winner) && !confirm('입력한 결과가 지워져요. 다시 짤까요?')) return;
    run('round', { replaceLast: true, expect: state.rounds.length });
  },

  'score-edit': (el) => openScore(+el.dataset.r, +el.dataset.m),

  win: (el) => {
    const r = +el.dataset.r, mi = +el.dataset.m;
    const m = state.rounds[r]?.matches[mi];
    if (!m) return;
    // 같은 버튼 다시 누르면 취소
    run('win', { r, m: mi, key: matchKey(m), winner: m.winner === el.dataset.team ? null : el.dataset.team });
  },

  'copy-round': () => copy(roundText(), '배정표를 복사했어요. 카톡에 붙여넣기 하세요!'),
  'copy-rank': () => copy(rankText(), '순위표를 복사했어요. 카톡에 붙여넣기 하세요!'),
  'share-round': () => share(roundText(), roundTextKakao(KAKAO_TEXT_MAX), '배정표'),
  'share-rank': () => share(rankText(), rankTextKakao(KAKAO_TEXT_MAX), '순위표'),

  'reset-rounds': () => {
    if (SUB) { toast('새 경기 시작은 메인 관리자만 할 수 있어요.'); return; }
    if (confirm('라운드와 승패 기록을 모두 지울까요? (참가자 명단은 유지)')) run('reset-rounds');
  },
  'reset-all': () => {
    if (SUB) { toast('전체 초기화는 메인 관리자만 할 수 있어요.'); return; }
    if (confirm('명단과 기록을 전부 삭제할까요?')) run('reset-all');
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
  if (el.dataset && el.dataset.action === 'toggle') run('toggle', { id: +el.dataset.id, active: el.checked });
});

// ───── 점수 직접 입력 창 ─────
let scoreEdit = null; // {r, m, key}
const nameList = (ids) => ids.map((id) => findP(id)?.name || '?').join(' · ');
function openScore(r, mi) {
  const m = state.rounds[r]?.matches[mi];
  if (!m) return;
  scoreEdit = { r, m: mi, key: matchKey(m) };
  let a = '', b = '';
  if (m.score && m.score.log && m.score.log.length) {
    a = m.score.log.filter((t) => t === 'A').length;
    b = m.score.log.length - a;
  }
  const $ = (id) => document.getElementById(id);
  $('score-title').textContent = `${state.rounds[r].no}라운드 ${m.court}코트 점수`;
  $('score-a-names').textContent = nameList(m.teamA);
  $('score-b-names').textContent = nameList(m.teamB);
  $('score-a').value = a;
  $('score-b').value = b;
  $('score-clear').hidden = a === '';
  $('score-note').textContent = m.score && !m.score.manual && !m.score.done && m.score.log.length
    ? '🧑‍⚖️ 심판이 기록 중인 경기예요. 저장하면 심판 점수판도 이 점수로 바뀌어요.' : '';
  $('score-modal').hidden = false;
  document.body.classList.add('modal-open');
  setTimeout(() => $('score-a').focus(), 50);
}
function closeScore() {
  document.getElementById('score-modal').hidden = true;
  document.body.classList.remove('modal-open');
  scoreEdit = null;
}
async function saveScore(clear) {
  if (!scoreEdit) return;
  const $ = (id) => document.getElementById(id);
  const a = $('score-a').value.trim(), b = $('score-b').value.trim();
  if (!clear) {
    if (a === '' || b === '') { toast('두 팀 점수를 모두 입력해 주세요.'); return; }
    if (+a === +b) { toast('동점은 입력할 수 없어요.'); return; }
  } else if (!confirm('이 경기의 점수와 승패를 지울까요?')) return;
  const res = await run('set-score', { ...scoreEdit, a: clear ? null : +a, b: clear ? null : +b });
  if (res && res.ok) closeScore();
}
document.getElementById('score-form').addEventListener('submit', (e) => { e.preventDefault(); saveScore(false); });
document.getElementById('score-clear').addEventListener('click', () => saveScore(true));
document.getElementById('score-cancel').addEventListener('click', closeScore);
document.getElementById('score-modal').addEventListener('click', (e) => { if (e.target.id === 'score-modal') closeScore(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('score-modal').hidden) closeScore(); });

function selectSeg(segId, attr, value) {
  document.querySelectorAll(`#${segId} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}

// 직접 입력: 기억된 회원 이름을 치면 성별·급수를 자동으로 골라 둔다
document.getElementById('name-input').addEventListener('input', (e) => {
  const mem = lookup(e.target.value.trim());
  if (!mem) return;
  if (mem.gender) { newGender = mem.gender; selectSeg('gender-seg', 'gender', mem.gender); }
  if (mem.level) { newLevel = mem.level; selectSeg('level-seg', 'level', mem.level); }
});

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('name-input');
  if (!newGender) { toast('성별(남/여)을 먼저 선택해 주세요.'); return; }
  const res = await run('add', { name: input.value, level: newLevel, gender: newGender });
  if (!res || !res.ok) return;
  input.value = '';
  input.focus();
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

// ───── 부 관리자 화면 ─────
const LINK_TEXT = {
  connecting: '⏳ 메인 관리자에 연결 중…',
  reconnecting: '🔄 다시 연결 중… (메인 관리자 화면이 열려 있어야 해요)',
  ready: '👥 부 관리자 · 연결됨',
};
function setLinkStatus(s) {
  const b = document.getElementById('link-badge');
  b.hidden = false;
  b.textContent = LINK_TEXT[s] || s;
  b.dataset.state = s;
  document.body.classList.toggle('sub-offline', s !== 'ready');
}

function startSub() {
  setPersist(false); // 이 기기의 저장 데이터(자기 모임 기록)는 건드리지 않는다
  document.body.classList.add('sub');
  state.players = []; state.rounds = [];
  renderAll();
  setLinkStatus('connecting');
  let first = true;
  sub = createAdminClient(SUB.hostId, { type: 'admin-hello', key: SUB.key }, {
    onSnap: (s, full) => {
      if (s && s.members) useMembers(s.members);
      applySnapshot(s);
      renderAll();
      if (first && full) { first = false; toast('메인 관리자 화면과 연결됐어요.'); }
    },
    onStatus: setLinkStatus,
    onDenied: () => {
      const b = document.getElementById('link-badge');
      b.hidden = false;
      b.dataset.state = 'error';
      b.textContent = '⛔ 링크가 만료됐어요';
      document.body.classList.add('sub-offline');
      alert('부 관리자 링크가 바뀌었거나 올바르지 않아요.\n메인 관리자에게 새 링크를 받아 주세요.');
    },
  });
}

if (SUB) {
  startSub();
  initInvite({ onJoin: null, toast, copyText, fixedId: SUB.hostId }); // 참가자 QR은 메인 관리자 방으로
} else {
  load();
  rememberAll(state.players); // 이미 있는 명단도 회원으로 기억
  renderAll();
  initInvite({ onJoin: handleRemoteJoin, toast, copyText });
  let lastRefs = {};
  setHostHandlers({
    checkRef: checkRefKey,
    onRefOp: handleRefOp,
    refView,
    onRefs: (counts) => {
      for (const c of Object.keys(counts)) if (counts[c] > (lastRefs[c] || 0)) toast(`🧑‍⚖️ ${c}코트 심판이 연결됐어요.`);
      lastRefs = counts;
      renderAll();
      renderRefModal(counts);
    },
  });
  initRefHost({ toast, copyText, handlers: () => ({}), setRule: (rule) => run('score-to', rule) });
  initAdminHost({
    toast, copyText,
    onOp: handleSubOp,
    snapshot: () => ({ ...snapshot(), members: exportMembers() }),
    onJoin: handleRemoteJoin,
  });
}
initOcr({ onAdd: (entries) => run('entries', { entries }) });
preloadKakao().catch(() => { /* SDK 로드 실패 시 공유 창/복사로 대체 */ });
