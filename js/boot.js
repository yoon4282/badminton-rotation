// 진입점: ?join=방ID 가 있으면 참가자 등록 화면, ?ref=… 면 심판 점수판, 없으면 운영진 화면
// 참가자 모드에서는 운영진 코드(main.js)를 불러오지 않아 localStorage도 건드리지 않는다.
// ?ref=방ID&court=코트&key=심판키 면 코트 심판 점수판 (운영진 코드·저장 데이터 안 씀)
const params = new URLSearchParams(location.search);
const joinId = params.get('join');
const refId = params.get('ref');

if (refId) {
  document.querySelectorAll('.topbar, main, .tabbar').forEach((el) => { el.hidden = true; });
  import('./ref.js').then((m) => m.startRef(refId.trim(), parseInt(params.get('court'), 10) || 1, params.get('key') || ''));
} else if (joinId) {
  document.body.classList.add('guest');
  document.getElementById('join-app').hidden = false;
  document.querySelectorAll('.topbar, main, .tabbar').forEach((el) => { el.hidden = true; });
  import('./join.js').then((m) => m.startJoin(joinId.trim()));
} else {
  import('./main.js');
}
