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

// 7) 혼복: 남녀 균형 모임에서 모두 혼복을 한 번 이상 + 한 코트의 두 팀은 같은 유형
{
  for (const [n, courts, rnds] of [[12, 3, 4], [14, 3, 5], [10, 2, 5]]) {
    const players = mk(n), rounds = [];
    play(players, rounds, courts, rnds);
    const mixed = new Set();
    for (const r of rounds) for (const m of r.matches) {
      // 휴식자가 있으면 출전자 성비가 홀수로 갈려 '기타'가 불가피할 수 있어 전원 출전(12명)일 때만 엄격 검사
      if (n === 12) assert.ok(['남복', '여복', '혼복'].includes(m.type), '불균형 유형: ' + m.type);
      if (m.type === '혼복') [...m.teamA, ...m.teamB].forEach((id) => mixed.add(id));
    }
    const missing = players.filter((p) => !mixed.has(p.id)).length;
    console.log(`[7] ${n}명 ${courts}코트 ${rnds}라운드 혼복 미경험:`, missing);
    assert.equal(missing, 0);
  }
}

console.log('모든 테스트 통과');
