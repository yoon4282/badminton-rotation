// 카톡 투표 참여자 캡처의 OCR 글자에서 이름 후보를 뽑는다 (순수 함수, DOM 의존 없음)
import { parseBulk } from './players.js';

// 투표 화면·카톡 화면에 흔히 보이는 글자 (이름이 아님)
const STOP = new Set(('투표 투표하기 다시투표 참여 참여자 참여함 참여하기 미참여 투표자 투표함 명 마감 종료 진행중 익명 복수 선택 항목 결과 보기 결과보기 ' +
  '전체 오전 오후 친구 확인 닫기 공유 취소 참석 불참 미정 참가 가능 불가 다시 채팅 채팅방 메뉴 공지 오늘 내일 어제 ' +
  '월요일 화요일 수요일 목요일 금요일 토요일 일요일 운동 배드민턴 모임 정모 번개 시간 장소 관리 추가 삭제 수정 알림 설정 ' +
  '프로필 대화 메시지 사진 동영상 검색 더보기 이전 다음 완료 저장 회원 방장 부방장 톡게시판 게시판 일정 남자 여자').split(' '));

const HANGUL = /^[가-힣]{2,5}$/;
const LATIN = /^[A-Za-z]{2,}$/;

export function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

// 인식이 한 글자 틀린 이름을 기억된 회원 이름으로 고친다 (후보가 딱 하나일 때만)
function nearest(name, known) {
  if (!HANGUL.test(name)) return null;
  const hits = known.filter((k) => k.length === name.length && lev(k, name) === 1);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param {string} text OCR 결과 전체 글자
 * @param {string[]} known 기억된 회원 이름 + 현재 명단 이름
 * @returns {{name, raw, gender, level, levelGiven, known, likely}[]}
 */
export function extractCandidates(text, known = []) {
  const knownSet = new Set(known);
  const out = [];
  const seen = new Set();
  for (let line of String(text || '').split(/\n+/)) {
    // 글자·숫자·공백만 남기고, 한 글자 잡음·숫자(시간, 인원 수)·화면 문구는 버린다.
    // 단, 이름 뒤의 '남/여'는 성별 표시로 남긴다. (한 글자 A~D는 OCR 잡음이 많아 급수로 쓰지 않음)
    const toks = line.replace(/[^가-힣A-Za-z0-9\s]/g, ' ').split(/\s+/)
      .map((t) => t.replace(/님$/, ''))
      .filter((t) => (t === '남' || t === '여' || HANGUL.test(t) || LATIN.test(t)) && !STOP.has(t));
    if (!toks.length) continue;
    for (const e of parseBulk(toks.join(' ')).entries) {
      let name = e.name, raw = null;
      if (!HANGUL.test(name) && !/^[A-Za-z ]{2,12}$/.test(name)) continue;
      if (!knownSet.has(name)) {
        const fix = nearest(name, known);
        if (fix) { raw = name; name = fix; }
      }
      if (seen.has(name)) continue;
      seen.add(name);
      const isKnown = knownSet.has(name);
      out.push({
        name, raw, gender: e.gender, level: 'C', levelGiven: false,
        known: isKnown,
        likely: isKnown || /^[가-힣]{3}$/.test(name), // 기억된 회원이거나 흔한 3글자 한글 이름이면 미리 체크
      });
    }
  }
  return out;
}
