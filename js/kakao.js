// 카카오톡 공유 (Kakao JavaScript SDK). 누르면 카톡의 채팅방 선택 화면이 바로 열린다.
// SDK는 시작할 때 미리 불러 두고, 버튼을 누르는 순간에는 바로 호출한다(팝업 차단 방지).
import { loadLib } from './p2p.js';
import { KAKAO_JS_KEY } from './config.js';

const SDK_URLS = ['https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js'];
export const KAKAO_TEXT_MAX = 200; // 텍스트 템플릿 본문 최대 길이

let loading = null;

export const kakaoEnabled = () => !!KAKAO_JS_KEY;

export function preloadKakao() {
  if (!KAKAO_JS_KEY) return Promise.resolve(null);
  if (!loading) {
    loading = loadLib('kakao', SDK_URLS, 'Kakao')
      .then((K) => { if (!K.isInitialized()) K.init(KAKAO_JS_KEY); return K; })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function ready() {
  const K = window.Kakao;
  return K && K.isInitialized && K.isInitialized() && K.Share ? K : null;
}

// 성공적으로 카톡 공유를 띄웠으면 true, SDK가 준비 안 됐으면 false
// url: 메시지를 눌렀을 때 열 주소(카카오에 등록한 도메인이어야 함), button: 메시지 아래 버튼 글자
export function sendKakaoText(text, { url = location.origin + location.pathname, button } = {}) {
  const K = ready();
  if (!K) { preloadKakao().catch(() => {}); return false; }
  K.Share.sendDefault({
    objectType: 'text',
    text,
    link: { mobileWebUrl: url, webUrl: url },
    ...(button ? { buttonTitle: button } : {}),
  });
  return true;
}
