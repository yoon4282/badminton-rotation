// 점수판 규칙 (순수 함수, DOM 의존 없음)
// 랠리 포인트: 목표 점수(15/21/25) 먼저, 듀스면 2점 차, 최대 점수(목표+9, 최대 30)에 먼저 닿으면 승리.
// score = { first:'A'|'B', log:['A','B',...], v:버전, done:결과 보냈는지 }
export const SCORE_TO = [15, 21, 25];
export const capOf = (to) => Math.min(to + 9, 30);

export const emptyScore = (first = 'A') => ({ first, log: [], v: 0, done: false });

export function gameState(score, to = 21) {
  const log = (score && score.log) || [];
  let a = 0, b = 0;
  for (const t of log) { if (t === 'A') a++; else b++; }
  const hi = Math.max(a, b), cap = capOf(to);
  const over = (hi >= to && Math.abs(a - b) >= 2) || hi >= cap;
  const winner = over ? (a > b ? 'A' : 'B') : null;
  // 서브: 마지막 랠리를 딴 팀 (첫 랠리 전에는 먼저 서브하는 팀). 서브 팀 점수가 짝수면 오른쪽, 홀수면 왼쪽.
  const server = log.length ? log[log.length - 1] : ((score && score.first) || 'A');
  const own = server === 'A' ? a : b;
  // 게임 포인트·매치 포인트: 한 점만 더 따면 이기는 팀
  const point = !over && (((a + 1 >= to && a + 1 - b >= 2) || a + 1 >= cap) ? 'A' : ((b + 1 >= to && b + 1 - a >= 2) || b + 1 >= cap) ? 'B' : null);
  return { a, b, over, winner, server, side: own % 2 === 0 ? 'right' : 'left', point, deuce: !over && a === b && a >= to - 1 };
}

// 점수판 조작 (score를 직접 바꾸고 true/false 반환). 호스트(메인 관리자)에서만 실행된다.
export function applyScoreOp(score, op, args, to) {
  const st = gameState(score, to);
  if (op === 'serve') {
    if (score.log.length || score.done) return false;
    score.first = args.team === 'B' ? 'B' : 'A';
  } else if (op === 'point') {
    if (st.over || score.done) return false;
    if (args.team !== 'A' && args.team !== 'B') return false;
    if (score.log.length >= 80) return false;
    score.log.push(args.team);
  } else if (op === 'undo') {
    if (score.done) score.done = false; // 결과 보낸 뒤 되돌리기 = 결과 취소
    else if (score.log.length) score.log.pop();
    else return false;
  } else if (op === 'finish') {
    if (!st.over || score.done) return false;
    score.done = true;
  } else {
    return false;
  }
  score.v++;
  return true;
}
