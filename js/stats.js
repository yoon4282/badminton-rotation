// 라운드 기록에서 개인별 전적/순위를 매번 계산 (저장하지 않음)
export function computeStats(state) {
  const map = new Map();
  for (const p of state.players) map.set(p.id, { games: 0, wins: 0, losses: 0 });
  for (const r of state.rounds) {
    for (const m of r.matches) {
      if (m.winner !== 'A' && m.winner !== 'B') continue;
      const win = m.winner === 'A' ? m.teamA : m.teamB;
      const lose = m.winner === 'A' ? m.teamB : m.teamA;
      for (const id of win) { const s = map.get(id); if (s) { s.games++; s.wins++; } }
      for (const id of lose) { const s = map.get(id); if (s) { s.games++; s.losses++; } }
    }
  }
  return map;
}

// 승률 → 승수 → 경기 수 → 이름순. 경기 없는 사람은 맨 아래(순위 없음).
export function ranking(state) {
  const stats = computeStats(state);
  const rows = state.players.map((p) => {
    const s = stats.get(p.id);
    return { player: p, ...s, rate: s.games ? s.wins / s.games : null, rank: null };
  });
  rows.sort((a, b) => {
    if ((a.games > 0) !== (b.games > 0)) return a.games > 0 ? -1 : 1;
    if (a.games === 0) return a.player.name.localeCompare(b.player.name, 'ko');
    return (b.rate - a.rate) || (b.wins - a.wins) || (b.games - a.games) ||
      a.player.name.localeCompare(b.player.name, 'ko');
  });
  let prev = null;
  rows.forEach((r, i) => {
    if (r.games === 0) return;
    const same = prev && prev.rate === r.rate && prev.wins === r.wins && prev.games === r.games;
    r.rank = same ? prev.rank : i + 1;
    prev = r;
  });
  return rows;
}

export function fmtRate(r) {
  return r.rate === null ? '-' : Math.round(r.rate * 100) + '%';
}
