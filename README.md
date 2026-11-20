
🏸 배드민턴 대진표 & 코트 로테이션
백엔드·DB·외부 API 없이 브라우저에서만 동작하는 모바일 웹앱입니다. 모든 데이터는 localStorage에 자동 저장됩니다.

로컬 실행
ES Modules를 쓰므로 file://로는 열리지 않습니다. 간이 서버를 사용하세요.

python -m http.server 8080
→ http://localhost:8080

QR 참가자 등록 (PeerJS)
운영진 화면 📱 QR 초대 코드 열기 → QR 모달. 참가자가 QR을 찍으면 ?join=방ID 화면이 열리고, 이름·성별·급수를 보내면 운영진 명단에 즉시 추가됩니다.
PeerJS(무료 클라우드 브로커)와 qrcodejs는 CDN에서 버튼을 누를 때만 불러옵니다. 로드·연결에 실패해도 직접 입력/일괄 추가에는 영향이 없습니다.
데이터는 서버에 저장되지 않고 브라우저 간에만 전달됩니다. 운영진 창(탭)이 열려 있어야 등록할 수 있습니다.
휴대폰으로 스캔하려면 localhost가 아닌 배포된 주소(https)에서 QR을 열어야 합니다.
카카오톡 바로 공유 설정
💬 카톡으로 공유 버튼을 누르면 카카오톡 채팅방 선택 화면이 바로 열리게 하려면 한 번만 설정하면 됩니다.

https://developers.kakao.com 로그인 → 내 애플리케이션 → 애플리케이션 추가하기
앱 키에서 JavaScript 키 복사 → js/config.js의 KAKAO_JS_KEY에 붙여넣기
플랫폼 → Web → 사이트 도메인에 배포 주소 등록 (예: https://아이디.github.io, 로컬 테스트용 http://localhost:8080)
카톡 텍스트 메시지는 200자까지라, 넘으면 급수·유형을 뺀 짧은 버전으로 보냅니다. 그래도 길면(코트가 많을 때) 휴대폰 공유 창으로 넘어가요. 순위표는 들어가는 만큼만 보내고 "…외 n명"으로 줄입니다.
키를 비워 두거나 SDK를 불러오지 못하면 휴대폰 공유 창 → 복사 순서로 동작합니다.
알고리즘 테스트
npm test
GitHub Pages 배포
이 폴더를 GitHub 저장소에 push
Settings → Pages → Branch: main / / (root) 선택
발급된 URL로 접속
구조
js/matcher.js 대진 생성 (경기 수 우선 → 코트 편성 → 팀 분할, 비용 함수 가중치는 상단 WEIGHTS)
js/stats.js 라운드 기록에서 전적/순위 계산
js/players.js 참가자 추가·일괄 파싱·토글
js/share.js 카카오톡 공유 텍스트·복사
js/ui.js, js/main.js 렌더링과 이벤트
