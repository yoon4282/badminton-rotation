import assert from 'node:assert/strict';
import { generateRound } from '../js/matcher.js';
import { parseBulk } from '../js/players.js';
import { LEVELS } from '../js/state.js';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + (i + 1), level: LEVELS[i % 5], gender: i % 2 ? 'F' : 'M', active: true }));

function play(players, rounds, courts, n) {
  for (let i = 0; i < n; i++) {
    const r = generateRound({ players, rounds, courts });
    assert.ok(!r.error, r.error);
    rounds.push(r.round);
  }
}
const gamesOf = (rounds) => {
  const g = new Map();
  for (const r of rounds) for (const m of r.matches) for (const id of [...m.teamA, ...m.teamB]) g.set(id, (g.get(id) || 0) + 1);
  return g;
};
function partnerRepeats(rounds) {
  const c = new Map();
  for (const r of rounds) for (const m of r.matches) for (const t of [m.teamA, m.teamB]) {
    const k = [...t].sort().join('-'); c.set(k, (c.get(k) || 0) + 1);
  }
  return Math.max(...c.values());
}

// 1) 14명 3코트 7라운드: 경기 수 편차 ≤1, 한 라운드 12명 중복 없음
{
  const players = mk(14), rounds = [];
  play(players, rounds, 3, 7);
  for (const r of rounds) {
    const ids = r.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
    assert.equal(ids.length, 12);
    assert.equal(new Set(ids).size, 12);
    assert.equal(r.resting.length, 2);
  }
  const g = gamesOf(rounds), v = players.map((p) => g.get(p.id) || 0);
  assert.ok(Math.max(...v) - Math.min(...v) <= 1, '경기 수 편차: ' + v);
  const pr = partnerRepeats(rounds);
  console.log('[1] 경기 수:', v.join(','), '| 최대 파트너 반복:', pr);
  assert.ok(pr <= 2);
}

// 2) 10명 3코트 → 2코트만 사용
{
  const r = generateRound({ players: mk(10), rounds: [], courts: 3 });
  assert.equal(r.round.matches.length, 2);
  assert.equal(r.round.resting.length, 2);
}

// 3) 4명 미만 오류
assert.ok(generateRound({ players: mk(3), rounds: [], courts: 2 }).error);

// 4) 휴식자는 배정 안 됨 + 지각자는 바로 출전, 몰아주기 없음
{
  const players = mk(14), rounds = [];
  play(players, rounds, 3, 4);
  players[0].active = false;
  players.push({ id: 99, name: '지각', level: 'C', active: true });
  const start = rounds.length;
  play(players, rounds, 3, 3);
  const after = rounds.slice(start);
  assert.ok(after.every((r) => !r.matches.some((m) => [...m.teamA, ...m.teamB].includes(1))), '휴식자 배정됨');
  assert.ok(after[0].matches.some((m) => [...m.teamA, ...m.teamB].includes(99)), '지각자 첫 라운드 미출전');
  const late = gamesOf(after).get(99) || 0;
  console.log('[4] 지각자 3라운드 출전 수:', late);
  assert.ok(late <= 3);
}

// 5) 일괄 붙여넣기 파싱
{
  const { entries, defaulted } = parseBulk('1. 김철수 B\n이영희(A)\n박민수/초심\nBob\n최지우, d');
  assert.deepEqual(entries.map((e) => e.name + ':' + e.level),
    ['김철수:B', '이영희:A', '박민수:초심', 'Bob:C', '최지우:D']);
  assert.equal(defaulted, 1);
}

// 6) 성별 파싱
{
  const { entries, noGender } = parseBulk('김철수 남 B\n이영희/여/A\n박민수(남,초심)\n최지우 C 여\nBob');
  assert.deepEqual(entries.map((e) => `${e.name}:${e.gender}:${e.level}`),
    ['김철수:M:B', '이영희:F:A', '박민수:M:초심', '최지우:F:C', 'Bob:null:C']);
  assert.equal(noGender, 1);
}

// 7) 한 코트의 두 팀은 같은 유형 (전원 출전 12명은 '기타' 없음)
{
  for (const [n, courts, rnds] of [[12, 3, 6], [14, 3, 5], [10, 2, 5]]) {
    const players = mk(n), rounds = [];
    play(players, rounds, courts, rnds);
    let uneven = 0;
    for (const r of rounds) for (const m of r.matches) {
      // 휴식자가 있으면 출전자 성비가 홀수로 갈려 '기타'가 불가피할 수 있어 전원 출전(12명)일 때만 엄격 검사
      if (n === 12) assert.ok(['남복', '여복', '혼복'].includes(m.type), '불균형 유형: ' + m.type);
      if (m.type === '기타') uneven++;
    }
    console.log(`[7] ${n}명 ${courts}코트 ${rnds}라운드 불균형 경기:`, uneven);
  }
}

// 7-2) 유형 비율 남복:여복:혼복 ≈ 3:2:1 (남12·여8, 4코트, 6라운드, 20회 평균)
{
  const tot = { '남복': 0, '여복': 0, '혼복': 0, '기타': 0 }, SEEDS = 20;
  for (let s = 0; s < SEEDS; s++) {
    const players = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: 'P' + i, level: LEVELS[i % 5], gender: i < 12 ? 'M' : 'F', active: true }));
    const rounds = [];
    play(players, rounds, 4, 6);
    for (const r of rounds) for (const m of r.matches) tot[m.type]++;
  }
  const avg = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, v / SEEDS]));
  console.log('[7-2] 24경기 중 평균 남복/여복/혼복/기타:', avg['남복'], avg['여복'], avg['혼복'], avg['기타'], '(목표 12/8/4)');
  assert.ok(avg['남복'] > avg['여복'] && avg['여복'] > avg['혼복'], '비율 순서가 남복 > 여복 > 혼복이 아님');
  assert.ok(avg['혼복'] <= 6, '혼복이 너무 많음');
}

// 8) 여성이 적은 모임(남8·여6, 3코트, 6라운드)에서도 여복이 고르게 잡힘 (20회 평균)
{
  let missing = 0, uneven = 0, SEEDS = 20;
  for (let s = 0; s < SEEDS; s++) {
    const players = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: 'P' + i, level: 'BCDA'[i % 4], gender: i < 8 ? 'M' : 'F', active: true }));
    const rounds = [];
    play(players, rounds, 3, 6);
    const ff = new Set();
    for (const r of rounds) for (const m of r.matches) {
      if (m.type === '기타') uneven++;
      if (m.type === '여복') [...m.teamA, ...m.teamB].forEach((id) => ff.add(id));
    }
    missing += players.filter((p) => p.gender === 'F' && !ff.has(p.id)).length;
  }
  console.log('[8] 여복 못한 여성 평균:', (missing / SEEDS).toFixed(2), '| 불균형 경기 평균:', (uneven / SEEDS).toFixed(2));
  assert.ok(missing / SEEDS < 1, '여복이 너무 적게 잡힘');
}

// 8-2) 남복 vs 여복은 어떤 인원 구성에서도 나오지 않음 (여복 vs 혼복 같은 '기타'는 허용)
{
  const { isMenVsWomen } = await import('../js/matcher.js');
  let games = 0, other = 0;
  for (let men = 0; men <= 14; men++) for (const women of [2, 3, 5, 6, 7, 9]) {
    for (let s = 0; s < 3; s++) {
      const players = Array.from({ length: men + women }, (_, i) => ({ id: i + 1, name: 'P' + i, level: LEVELS[(i * 7 + s) % 5], gender: i < men ? 'M' : 'F', active: true }));
      if (players.length < 4) continue;
      const gender = new Map(players.map((p) => [p.id, p.gender]));
      const rounds = [];
      play(players, rounds, 4, 5);
      for (const r of rounds) for (const m of r.matches) {
        games++;
        if (m.type === '기타') other++;
        assert.ok(!isMenVsWomen(m.teamA, m.teamB, gender), `남복 vs 여복 발생: 남${men} 여${women}`);
      }
    }
  }
  console.log(`[8-2] ${games}경기 중 남복 vs 여복 0 · 기타(허용된 불균형) ${other}`);
}

// 9) 카톡 투표 참여자 옮겨 적기: 한 줄에 여러 명 + 표시가 섞인 경우
{
  const pick = (t) => parseBulk(t).entries.map((e) => `${e.name}:${e.gender}:${e.levelGiven ? e.level : '-'}`);
  assert.deepEqual(pick('김철수, 이영희, 박민수'), ['김철수:null:-', '이영희:null:-', '박민수:null:-']);
  assert.deepEqual(pick('김철수 이영희 박민수'), ['김철수:null:-', '이영희:null:-', '박민수:null:-']);
  assert.deepEqual(pick('김철수B·이영희 여 A, 박민수님'), ['김철수:null:B', '이영희:F:A', '박민수:null:-']);
  assert.deepEqual(pick('김철수 남 B 이영희 여 C'), ['김철수:M:B', '이영희:F:C']);
  assert.deepEqual(pick('Bob Smith, 최지우'), ['Bob Smith:null:-', '최지우:null:-']);
}

// 10) 회원 기억: 한 번 등록한 사람은 이름만 적어도 성별·급수 자동 입력
{
  const { state } = await import('../js/state.js');
  const { addBulk, addPlayer } = await import('../js/players.js');
  state.players = []; state.rounds = []; state.nextId = 1;
  addPlayer('김철수', 'A', 'M');
  addBulk('이영희 여 B');
  state.players = []; state.nextId = 1; // 다음 모임
  const res = addBulk('김철수, 이영희, 새사람');
  const by = Object.fromEntries(state.players.map((p) => [p.name, `${p.gender}:${p.level}`]));
  assert.deepEqual(by, { '김철수': 'M:A', '이영희': 'F:B', '새사람': 'null:C' });
  assert.equal(res.recalled, 2);
  assert.equal(res.noGender, 1);
  assert.equal(res.defaulted, 1);
  // 직접 적은 값이 기억보다 우선
  state.players = [];
  addBulk('김철수 C');
  assert.equal(state.players[0].level, 'C');
  assert.equal(state.players[0].gender, 'M');
}

// 11) 투표 캡처 OCR 글자에서 이름 후보 뽑기 (화면 문구·시간·잡음 제거, 한 글자 틀린 회원 이름 보정)
{
  const { extractCandidates } = await import('../js/ocr-parse.js');
  const ocr = `오후 3:42  ▼ 88%
< 투표 참여자 7명
토요일 정모 참석
| 김철수
ㅣ 이영희님
박민스
최지우 여
Bob
불참
정우성
2명 · 마감`;
  const c = extractCandidates(ocr, ['김철수', '박민수', '이영희']);
  const names = c.map((x) => x.name);
  console.log('[11] 후보:', c.map((x) => `${x.name}${x.raw ? '(' + x.raw + ')' : ''}${x.likely ? '✓' : ''}`).join(', '));
  assert.deepEqual(names, ['김철수', '이영희', '박민수', '최지우', 'Bob', '정우성']);
  assert.equal(c.find((x) => x.name === '박민수').raw, '박민스');
  assert.equal(c.find((x) => x.name === '최지우').gender, 'F');
  assert.equal(c.find((x) => x.name === 'Bob').likely, false);
}

// 12) 같이 치기 요청: 같은 편 / 같은 코트 / 4명 묶음, 고정 요청은 매 라운드, 경기 수 공평 유지
{
  const sameCourt = (m, ids) => ids.every((id) => m.teamA.includes(id) || m.teamB.includes(id));
  const sameTeam = (m, ids) => ids.every((id) => m.teamA.includes(id)) || ids.every((id) => m.teamB.includes(id));
  const SEEDS = 20;
  let hit = { team: 0, court: 0, group: 0 }, tries = { team: 0, court: 0, group: 0 }, spread = 0;
  for (let s = 0; s < SEEDS; s++) {
    // 14명 3코트(2명 휴식), 고정 요청 3개: 같은 편(남1·여1), 같은 코트(남2), 4명 묶음(남2·여2)
    const players = mk(14), rounds = [];
    const wishes = [
      { id: 1, kind: 'team', ids: [1, 2], fixed: true },
      { id: 2, kind: 'court', ids: [3, 5], fixed: true },
      { id: 3, kind: 'group', ids: [7, 8, 9, 10], fixed: true },
    ];
    for (let i = 0; i < 7; i++) {
      const r = generateRound({ players, rounds, courts: 3, wishes });
      assert.ok(!r.error, r.error);
      rounds.push(r.round);
      for (const w of wishes) {
        const playing = w.ids.filter((id) => !r.round.resting.includes(id));
        if (playing.length !== w.ids.length) continue; // 쉬는 차례
        tries[w.kind]++;
        const m = r.round.matches.find((x) => sameCourt(x, w.ids));
        const ok = m && (w.kind !== 'team' || sameTeam(m, w.ids));
        if (ok) { hit[w.kind]++; assert.ok(r.round.granted.includes(w.id)); assert.ok(m.wish); }
      }
    }
    const g = gamesOf(rounds), v = players.map((p) => g.get(p.id) || 0);
    assert.ok(Math.max(...v) - Math.min(...v) <= 1, '요청이 있어도 경기 수 편차 ≤1: ' + v);
    spread = Math.max(spread, Math.max(...v) - Math.min(...v));
    // 남복 vs 여복 금지는 그대로
    for (const r of rounds) for (const m of r.matches) {
      const kind = (t) => { const a = players[t[0] - 1].gender, b = players[t[1] - 1].gender; return a === b ? a : 'X'; };
      const ka = kind(m.teamA), kb = kind(m.teamB);
      assert.ok(!((ka === 'M' && kb === 'F') || (ka === 'F' && kb === 'M')), '남복 vs 여복');
    }
  }
  const rate = (k) => hit[k] / tries[k];
  console.log(`[12] 함께 뛴 라운드에서 요청 반영률: 같은 편 ${(rate('team') * 100).toFixed(0)}% · 같은 코트 ${(rate('court') * 100).toFixed(0)}% · 4명 ${(rate('group') * 100).toFixed(0)}% | 경기 수 최대 편차 ${spread}`);
  assert.ok(rate('team') >= 0.95 && rate('court') >= 0.95 && rate('group') >= 0.95);
}

// 12-2) 요청한 사람이 함께 뛰는 비율: 일부만 쉬는 일이 거의 없다 (14명 3코트, 같은 편 고정)
{
  let together = 0, total = 0;
  for (let s = 0; s < 20; s++) {
    const players = mk(14), rounds = [];
    const wishes = [{ id: 1, kind: 'team', ids: [1, 6], fixed: true }];
    for (let i = 0; i < 7; i++) {
      const r = generateRound({ players, rounds, courts: 3, wishes });
      rounds.push(r.round);
      const rest = [1, 6].filter((id) => r.round.resting.includes(id)).length;
      total++;
      if (rest !== 1) together++;
    }
  }
  console.log(`[12-2] 같은 편 요청 둘이 같이 뛰거나 같이 쉰 라운드: ${together}/${total}`);
  assert.ok(together / total >= 0.85);
}

// 12-3) 한 번 요청은 들어주면 granted에 들어가고, 쉬는 사람이 있는 요청은 반영하지 않는다
{
  const players = mk(12);
  const r = generateRound({ players, rounds: [], courts: 3, wishes: [{ id: 5, kind: 'court', ids: [1, 12], fixed: false }] });
  assert.deepEqual(r.round.granted, [5]);
  players[11].active = false;
  const r2 = generateRound({ players, rounds: [], courts: 2, wishes: [{ id: 5, kind: 'court', ids: [1, 12], fixed: false }] });
  assert.ok(!r2.round.granted);
  // 요청이 없으면 granted 자체가 없다 (기존 기록 형식 유지)
  assert.equal(generateRound({ players: mk(8), rounds: [], courts: 2 }).round.granted, undefined);
}

// 13) 심판 점수판 규칙: 21점·듀스 2점 차·최대 31점(15점 경기는 21점)·듀스 없음, 서브 위치, 되돌리기/결과 보내기
{
  const { gameState, applyScoreOp, emptyScore } = await import('../js/score.js');
  const play = (seq, to = 21, deuce = true) => { const sc = emptyScore(); for (const t of seq) applyScoreOp(sc, 'point', { team: t }, to, deuce); return sc; };
  const rep = (t, n) => Array(n).fill(t);
  let st = gameState(play([...rep('A', 21), ...rep('B', 19)]));
  assert.ok(st.over && st.winner === 'A');
  const alt = (n) => Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 'B' : 'A')); // A·B 번갈아 n점씩
  st = gameState(play([...alt(20), 'A']));
  assert.ok(!st.over, '21:20은 아직');
  st = gameState(play([...alt(20), 'A', 'A']));
  assert.ok(st.over && st.winner === 'A', '22:20 승');
  st = gameState(play([...alt(29), 'B']));
  assert.ok(!st.over, '30:29는 아직 (최대 31점)');
  st = gameState(play([...alt(30), 'B']));
  assert.ok(st.over && st.winner === 'B' && st.b === 31 && st.cap === 31, '21점 경기 최대 31점');
  st = gameState(play([...alt(30), 'B'], 25), 25);
  assert.ok(st.over && st.b === 31 && st.cap === 31, '25점 경기 최대 31점');
  st = gameState(play([...alt(24), 'A'], 25), 25);
  assert.ok(!st.over && st.point === 'A', '25:24 게임 포인트');
  // 15점 경기: 14:14 듀스, 최대 21점
  assert.ok(gameState(play(rep('A', 15), 15), 15).over, '15점 경기');
  st = gameState(play([...alt(14), 'A'], 15), 15);
  assert.ok(!st.over, '15:14는 아직');
  st = gameState(play([...alt(20), 'A'], 15), 15);
  assert.ok(st.over && st.a === 21 && st.cap === 21, '15점 경기 최대 21점');
  // 듀스 없음: 목표 점수에 먼저 닿으면 끝
  for (const to of [15, 21, 25]) {
    st = gameState(play([...alt(to - 1), 'B'], to, false), to, false);
    assert.ok(st.over && st.winner === 'B' && st.b === to && st.cap === to, `듀스 없음 ${to}점`);
    assert.ok(!gameState(play(alt(to - 1), to, false), to, false).deuce, '듀스 없음이면 듀스 표시 없음');
    assert.equal(gameState(play(alt(to - 1), to, false), to, false).point, 'AB', '듀스 없음 동점이면 두 팀 다 게임 포인트');
  }
  assert.ok(gameState(play(alt(20)), 21, true).deuce, '20:20 듀스 표시');
  assert.equal(gameState(play(alt(30)), 21, true).point, 'AB', '30:30이면 두 팀 다 게임 포인트');
  // 서브: 처음엔 first, 이후 마지막 랠리 이긴 팀. 서브 팀 점수 짝수=오른쪽
  const sc = emptyScore('B');
  assert.equal(gameState(sc).server, 'B');
  assert.ok(applyScoreOp(sc, 'serve', { team: 'A' }, 21));
  applyScoreOp(sc, 'point', { team: 'A' }, 21);
  st = gameState(sc);
  assert.equal(st.server, 'A'); assert.equal(st.side, 'left');
  assert.ok(!applyScoreOp(sc, 'serve', { team: 'B' }, 21), '첫 랠리 뒤에는 서브 팀 못 바꿈');
  // 끝나기 전 결과 보내기 불가, 끝난 뒤 점수 추가 불가
  assert.ok(!applyScoreOp(sc, 'finish', {}, 21));
  const done = play(rep('B', 21));
  assert.ok(!applyScoreOp(done, 'point', { team: 'A' }, 21));
  const v = done.v;
  assert.ok(applyScoreOp(done, 'finish', {}, 21) && done.done && done.v === v + 1);
  assert.ok(applyScoreOp(done, 'undo', {}, 21) && !done.done && done.log.length === 21, '결과 취소는 점수 유지');
  assert.ok(applyScoreOp(done, 'undo', {}, 21) && done.log.length === 20);
  assert.ok(gameState(play([...rep('A', 20)])).point === 'A', '게임 포인트');
  console.log('[13] 점수판 규칙 OK');
}

console.log('모든 테스트 통과');
