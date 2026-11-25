// 카카오 Developers → 내 애플리케이션 → 앱 키 → "JavaScript 키"를 붙여넣으세요.
// (JavaScript 키는 웹에 공개되는 용도의 키라 코드에 넣어도 됩니다. 등록한 도메인에서만 동작해요.)
// 비워 두면 카톡 바로 공유 대신 휴대폰 공유 창 → 복사 순서로 동작합니다.
export const KAKAO_JS_KEY = 'b40c19703d793f7e0309cf377b1bce2f'; // 비우면('') 휴대폰 공유 창 방식으로 동작

// QR 등록·부 관리자 연결용 TURN 중계 서버 (Metered Open Relay 무료 플랜, 월 20GB)
// 학교 와이파이·핫스팟처럼 기기끼리 직접 연결이 막힐 때 이 서버를 거쳐 주고받는다.
// 443(TLS) 포트도 있어 방화벽을 대부분 통과한다. 웹에 공개되는 값이라 사용량은 Metered 대시보드에서 가끔 확인.
// 비워 두면([]) 직접 연결만 시도한다.
const TURN_USER = 'fb3d9ec4034b6fe988592e01';
const TURN_PASS = '2EK4bQLn1uaEIZq+';
const TURN_HOST = 'standard.relay.metered.ca';
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: `stun:stun.relay.metered.ca:80` },
  { urls: `turn:${TURN_HOST}:80`, username: TURN_USER, credential: TURN_PASS },
  { urls: `turn:${TURN_HOST}:80?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
  { urls: `turn:${TURN_HOST}:443`, username: TURN_USER, credential: TURN_PASS },
  { urls: `turns:${TURN_HOST}:443?transport=tcp`, username: TURN_USER, credential: TURN_PASS },
];
