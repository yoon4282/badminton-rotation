// PeerJS 연결 (CDN 지연/실패해도 앱 본체가 영향받지 않도록 필요할 때만 동적 로드)
import { LEVELS } from './state.js';

export const PEERJS_URLS = [
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
];
export const QR_URLS = [
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];

const loading = {};
function loadOne(url, ms = 8000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const t = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, ms);
    s.src = url;
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('load')); };
    document.head.appendChild(s);
  });
}
export async function loadLib(name, urls, globalName) {
  if (window[globalName]) return window[globalName];
  if (!loading[name]) {
    loading[name] = (async () => {
      for (const u of urls) {
        try { await loadOne(u); if (window[globalName]) return window[globalName]; } catch (e) { /* 다음 CDN */ }
      }
      loading[name] = null; // 다음에 다시 시도할 수 있게
      throw new Error(name + ' 로드 실패');
    })();
  }
  return loading[name];
}

const ROOM_KEY = 'bdm-room-id';
const randId = () => 'bdm-' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

function waitOpen(peer, ms) {
  return new Promise((resolve, reject) => {
    if (peer.open) return resolve(peer.id);
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    const onOpen = (id) => { cleanup(); resolve(id); };
    const onErr = (e) => { cleanup(); reject(e); };
    function cleanup() { clearTimeout(t); peer.off('open', onOpen); peer.off('error', onErr); }
    peer.on('open', onOpen);
    peer.on('error', onErr);
  });
}

// ───────── 방장(호스트) ─────────
const host = { peer: null, starting: null };
const replies = new Map(); // reqId → 응답 (재전송 시 중복 등록 방지)
let handlers = { onJoin: null, onStatus: null };

function status(s) { if (handlers.onStatus) handlers.onStatus(s); }

function validate(msg) {
  if (!msg || msg.type !== 'join' || typeof msg.reqId !== 'string' || msg.reqId.length > 64) return null;
  const name = String(msg.name || '').trim().slice(0, 12);
  if (!name) return null;
  return {
    name,
    level: LEVELS.includes(msg.level) ? msg.level : 'C',
    gender: msg.gender === 'M' || msg.gender === 'F' ? msg.gender : null,
  };
}

function handleData(conn, msg) {
  const reqId = msg && msg.reqId;
  if (typeof reqId === 'string' && replies.has(reqId)) { conn.send(replies.get(reqId)); return; }
  const v = validate(msg);
  let res;
  if (!v) res = { ok: false, error: '입력 내용을 확인해 주세요.' };
  else {
    try { res = handlers.onJoin(v); } catch (e) { res = { ok: false, error: '등록 중 오류가 났어요.' }; }
  }
  const reply = { type: 'ack', reqId, ...res };
  if (typeof reqId === 'string') {
    replies.set(reqId, reply);
    if (replies.size > 300) replies.delete(replies.keys().next().value);
  }
  conn.send(reply);
}

function createPeer(id) {
  const peer = id ? new window.Peer(id) : new window.Peer();
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => { try { handleData(conn, msg); } catch (e) { /* 무시 */ } });
  });
  peer.on('disconnected', () => {
    status('reconnecting');
    if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* 무시 */ } }
  });
  peer.on('open', () => status('ready'));
  peer.on('error', (err) => {
    // 연결이 끊긴 뒤 복구 가능한 오류는 'disconnected' 흐름에 맡김
    if (err && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) status('reconnecting');
  });
  return peer;
}

// 이미 열려 있으면 같은 방 ID를 재사용, 끊겼으면 재연결, 죽었으면 새로 생성
export function startHost(h) {
  handlers = h;
  if (host.peer && !host.peer.destroyed) {
    if (host.peer.open) { status('ready'); return Promise.resolve(host.peer.id); }
    if (host.peer.disconnected) { try { host.peer.reconnect(); } catch (e) { /* 아래 대기에서 처리 */ } }
    if (host.starting) return host.starting;
  }
  host.starting = (async () => {
    await loadLib('peerjs', PEERJS_URLS, 'Peer');
    if (host.peer && !host.peer.destroyed && !host.peer.open) { try { host.peer.destroy(); } catch (e) { /* 무시 */ } }
    let saved = null;
    try { saved = sessionStorage.getItem(ROOM_KEY); } catch (e) { /* 무시 */ }
    for (const tryId of [saved, null]) {
      if (host.peer && host.peer.destroyed === false && host.peer.open) break;
      const peer = createPeer(tryId);
      try {
        const id = await waitOpen(peer, 12000);
        host.peer = peer;
        try { sessionStorage.setItem(ROOM_KEY, id); } catch (e) { /* 무시 */ }
        return id;
      } catch (e) {
        try { peer.destroy(); } catch (e2) { /* 무시 */ }
        if (!(tryId && e && e.type === 'unavailable-id')) throw e; // 저장된 ID 충돌일 때만 새 ID로 재시도
      }
    }
    throw new Error('연결 실패');
  })().finally(() => { host.starting = null; });
  return host.starting;
}

export const hostId = () => (host.peer && host.peer.open ? host.peer.id : null);

// ───────── 참가자(게스트) ─────────
export function createGuest(hostPeerId) {
  let peer = null, conn = null;

  async function ensureConn() {
    if (conn && conn.open) return conn;
    await loadLib('peerjs', PEERJS_URLS, 'Peer');
    if (!peer || peer.destroyed) {
      peer = new window.Peer();
      await waitOpen(peer, 12000);
    }
    return new Promise((resolve, reject) => {
      const c = peer.connect(hostPeerId, { reliable: true });
      const t = setTimeout(() => { try { c.close(); } catch (e) { /* 무시 */ } reject(new Error('timeout')); }, 10000);
      c.on('open', () => { clearTimeout(t); conn = c; resolve(c); });
      c.on('error', (e) => { clearTimeout(t); reject(e); });
      peer.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  }

  // 같은 reqId로 재시도하면 방장이 중복 등록 없이 이전 응답을 돌려준다
  async function send(payload, reqId) {
    const c = await ensureConn();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { c.off('data', onData); reject(new Error('timeout')); }, 10000);
      function onData(msg) {
        if (msg && msg.type === 'ack' && msg.reqId === reqId) { clearTimeout(t); c.off('data', onData); resolve(msg); }
      }
      c.on('data', onData);
      c.send({ type: 'join', reqId, ...payload });
    });
  }

  return { send, warm: ensureConn, close: () => { try { peer && peer.destroy(); } catch (e) { /* 무시 */ } } };
}
