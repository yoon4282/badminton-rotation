// 진입점: ?join=방ID 가 있으면 참가자 등록 화면, 없으면 운영진 화면
// 참가자 모드에서는 운영진 코드(main.js)를 불러오지 않아 localStorage도 건드리지 않는다.
const joinId = new URLSearchParams(location.search).get('join');

if (joinId) {
  document.body.classList.add('guest');
  document.getElementById('join-app').hidden = false;
  document.querySelectorAll('.topbar, main, .tabbar').forEach((el) => { el.hidden = true; });
  import('./join.js').then((m) => m.startJoin(joinId.trim()));
} else {
  import('./main.js');
}
