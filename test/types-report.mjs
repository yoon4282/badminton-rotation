// 인원 구성별 경기 유형 분포 리포트: node test/types-report.mjs
import { generateRound } from '../js/matcher.js';

function run(men, women, courts, rounds, seeds = 20) {
  const tot = { 남복: 0, 여복: 0, 혼복: 0, 기타: 0 };
  let womenNoFF = 0;
  for (let s = 0; s < seeds; s++) {
    const players = [];
    for (let i = 0; i < men; i++) players.push({ id: players.length + 1, level: 'BCDA'[i % 4], gender: 'M', active: true });
    for (let i = 0; i < women; i++) players.push({ id: players.length + 1, level: 'BCDA'[i % 4], gender: 'F', active: true });
    const rs = [];
    for (let r = 0; r < rounds; r++) rs.push(generateRound({ players, rounds: rs, courts }).round);
    const ff = new Set();
    for (const r of rs) for (const m of r.matches) {
      tot[m.type] = (tot[m.type] || 0) + 1;
      if (m.type === '여복') [...m.teamA, ...m.teamB].forEach((id) => ff.add(id));
    }
    womenNoFF += players.filter((p) => p.gender === 'F' && !ff.has(p.id)).length;
  }
  const n = Object.values(tot).reduce((a, b) => a + b, 0);
  const pct = (k) => ((tot[k] / n) * 100).toFixed(0) + '%';
  console.log(`남${men} 여${women} ${courts}코트 ${rounds}R | 남복 ${pct('남복')} 여복 ${pct('여복')} 혼복 ${pct('혼복')} 기타 ${pct('기타')} | 여복 못한 여성 평균 ${(womenNoFF / seeds).toFixed(1)}명`);
}

run(6, 6, 3, 6);
run(8, 6, 3, 6);
run(8, 4, 3, 6);
run(10, 6, 4, 6);
run(7, 5, 3, 6);
run(4, 8, 3, 6);
