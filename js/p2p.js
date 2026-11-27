// PeerJS 연결 (CDN 지연/실패해도 앱 본체가 영향받지 않도록 필요할 때만 동적 로드)
import { LEVELS } from './state.js';
import { ICE_SERVERS } from './config.js';

// 직접 연결이 막히면 TURN 중계 서버를 거친다 (config.js)
const PEER_OPTS = ICE_SERVERS.length ? { config: { iceServers: ICE_SERVERS } } : {};

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
// onJoin: 참가자 등록 / onOp·checkAdmin·snapshot·onAdmins: 부 관리자 연동
// checkRef·onRefOp·refView·onRefs: 코트 심판 연동
const handlers = { onJoin: null, onOp: null, checkAdmin: null, snapshot: null, onAdmins: null, checkRef: null, onRefOp: null, refView: null, onRefs: null };
const statusListeners = new Set();
const admins = new Set(); // 인증된 부 관리자 연결
const refs = new Map(); // 인증된 심판 연결 → 코트 번호
let lastStatus = null;

function status(s) { lastStatus = s; statusListeners.forEach((f) => { try { f(s); } catch (e) { /* 무시 */ } }); }
const notifyAdmins = () => { if (handlers.onAdmins) handlers.onAdmins(admins.size); };

export function adminCount() { return admins.size; }
const notifyRefs = () => { if (handlers.onRefs) handlers.onRefs(refCounts()); };

// 코트별 연결된 심판 수 {코트: 명}
export function refCounts() {
  const c = {};
  for (const [conn, court] of refs) if (conn.open) c[court] = (c[court] || 0) + 1;
  return c;
}

// 상태가 바뀔 때마다 심판마다 자기 코트 화면 정보를 보낸다
export function broadcastRefs() {
  if (!handlers.refView) return;
  for (const [c, court] of refs) {
    if (!c.open) { refs.delete(c); continue; }
    try { c.send({ type: 'snap', s: handlers.refView(court) }); } catch (e) { /* 무시 */ }
  }
}

// 심판 링크를 새로 만들면 기존 심판은 끊는다
export function kickRefs() {
  for (const [c] of refs) {
    try { c.send({ type: 'denied' }); } catch (e) { /* 무시 */ }
    setTimeout(() => { try { c.close(); } catch (e) { /* 무시 */ } }, 500);
  }
  refs.clear();
  notifyRefs();
}

function cacheReply(conn, reqId, res) {
  const reply = { type: 'ack', reqId, ...res };
  replies.set(reqId, reply);
  if (replies.size > 300) replies.delete(replies.keys().next().value);
  conn.send(reply);
}

function handleRef(conn, msg) {
  if (msg.type === 'ref-hello') {
    const court = parseInt(msg.court, 10);
    if (!handlers.checkRef || !handlers.checkRef(msg.key) || !(court >= 1 && court <= 8)) {
      conn.send({ type: 'denied' });
      setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 500);
      return;
    }
    if (!refs.has(conn)) {
      const drop = () => { if (refs.delete(conn)) notifyRefs(); };
      conn.on('close', drop);
      conn.on('error', drop);
    }
    refs.set(conn, court);
    conn.send({ type: 'snap', s: handlers.refView(court), full: true });
    notifyRefs();
    return;
  }
  // msg.type === 'ref-op': 코트는 연결할 때 정해진 것만 쓴다
  const reqId = msg.reqId;
  if (typeof reqId !== 'string' || reqId.length > 64) return;
  if (!refs.has(conn)) { conn.send({ type: 'ack', reqId, ok: false, error: '심판 권한이 없어요.' }); return; }
  if (replies.has(reqId)) { conn.send(replies.get(reqId)); return; }
  let res;
  try { res = handlers.onRefOp(refs.get(conn), String(msg.op || ''), msg.args && typeof msg.args === 'object' ? msg.args : {}); } catch (e) { res = { ok: false, error: '처리 중 오류가 났어요.' }; }
  cacheReply(conn, reqId, res);
}

// 메인 상태가 바뀔 때마다 부 관리자 화면에 전체 상태를 보낸다
export function broadcastAdmins(msg) {
  for (const c of admins) {
    if (!c.open) { admins.delete(c); continue; }
    try { c.send(msg); } catch (e) { /* 무시 */ }
  }
}

// 링크를 새로 만들면 기존 부 관리자는 끊는다
export function kickAdmins() {
  for (const c of admins) {
    try { c.send({ type: 'denied' }); } catch (e) { /* 무시 */ }
    setTimeout(() => { try { c.close(); } catch (e) { /* 무시 */ } }, 500);
  }
  admins.clear();
  notifyAdmins();
}

function handleAdmin(conn, msg) {
  if (msg.type === 'admin-hello') {
    if (!handlers.checkAdmin || !handlers.checkAdmin(msg.key)) {
      conn.send({ type: 'denied' });
      setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 500);
      return;
    }
    if (!admins.has(conn)) {
      admins.add(conn);
      const drop = () => { if (admins.delete(conn)) notifyAdmins(); };
      conn.on('close', drop);
      conn.on('error', drop);
    }
    conn.send({ type: 'snap', s: handlers.snapshot(), full: true });
    notifyAdmins();
    return;
  }
  // msg.type === 'op'
  const reqId = msg.reqId;
  if (typeof reqId !== 'string' || reqId.length > 64) return;
  if (!admins.has(conn)) { conn.send({ type: 'ack', reqId, ok: false, error: '부 관리자 권한이 없어요.' }); return; }
  if (replies.has(reqId)) { conn.send(replies.get(reqId)); return; }
  let res;
  try { res = handlers.onOp(String(msg.op || ''), msg.args && typeof msg.args === 'object' ? msg.args : {}); } catch (e) { res = { ok: false, error: '처리 중 오류가 났어요.' }; }
  const reply = { type: 'ack', reqId, ...res };
  replies.set(reqId, reply);
  if (replies.size > 300) replies.delete(replies.keys().next().value);
  conn.send(reply);
}

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
  if (msg && (msg.type === 'admin-hello' || msg.type === 'op')) { handleAdmin(conn, msg); return; }
  if (msg && (msg.type === 'ref-hello' || msg.type === 'ref-op')) { handleRef(conn, msg); return; }
  if (!handlers.onJoin) return;
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
  const peer = id ? new window.Peer(id, PEER_OPTS) : new window.Peer(PEER_OPTS);
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

// 연결을 시작하지 않고 핸들러만 등록 (어느 버튼으로 연결을 켜든 심판·부 관리자를 받을 수 있게)
export function setHostHandlers(h = {}) {
  for (const k of Object.keys(handlers)) if (h[k]) handlers[k] = h[k];
}

// 이미 열려 있으면 같은 방 ID를 재사용, 끊겼으면 재연결, 죽었으면 새로 생성
export function startHost(h = {}) {
  setHostHandlers(h);
  if (h.onStatus) { statusListeners.add(h.onStatus); }
  if (host.peer && !host.peer.destroyed) {
    if (host.peer.open) { status('ready'); return Promise.resolve(host.peer.id); }
    if (host.peer.disconnected) { try { host.peer.reconnect(); } catch (e) { /* 아래 대기에서 처리 */ } }
    if (host.starting) return host.starting;
  }
  host.starting = (async () => {
    await loadLib('peerjs', PEERJS_URLS, 'Peer');
    if (host.peer && !host.peer.destroyed && !host.peer.open) { try { host.peer.destroy(); } catch (e) { /* 무시 */ } }
    let saved = null;
    // 창을 닫았다 열어도 같은 방 ID → 부 관리자 링크·QR이 그대로 유효
    try { saved = localStorage.getItem(ROOM_KEY) || sessionStorage.getItem(ROOM_KEY); } catch (e) { /* 무시 */ }
    for (const tryId of [saved, null]) {
      if (host.peer && host.peer.destroyed === false && host.peer.open) break;
      const peer = createPeer(tryId);
      try {
        const id = await waitOpen(peer, 12000);
        host.peer = peer;
        try { localStorage.setItem(ROOM_KEY, id); } catch (e) { /* 무시 */ }
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
export const hostStatus = () => lastStatus;

// ───────── 부 관리자·심판(메인 관리자 화면에 붙어 상태를 받아 보고 조작 요청) ─────────
// 메인 관리자가 상태의 주인이다. 클라이언트는 조작 요청(op)만 보내고, 메인이 반영한 상태(snap)를 받아 그린다.
// hello: 연결 직후 보내는 인사 (부 관리자 {type:'admin-hello', key} / 심판 {type:'ref-hello', key, court})
// opType: 조작 요청 메시지 종류 (부 관리자 'op' / 심판 'ref-op')
export function createAdminClient(hostPeerId, hello, { onSnap, onStatus, onDenied }, opType = 'op') {
  let peer = null, conn = null, stopped = false, timer = null, connecting = false;
  const pending = new Map(); // reqId → {resolve, reject, t}

  const schedule = (ms = 3000) => { clearTimeout(timer); if (!stopped) timer = setTimeout(connect, ms); };

  function lost(c) {
    if (conn !== c) return;
    conn = null;
    for (const [, p] of pending) { clearTimeout(p.t); p.reject(new Error('offline')); }
    pending.clear();
    if (stopped) return;
    onStatus('reconnecting');
    schedule();
  }

  function onData(msg) {
    if (!msg) return;
    if (msg.type === 'snap') { onSnap(msg.s, !!msg.full); onStatus('ready'); }
    else if (msg.type === 'ack') {
      const p = pending.get(msg.reqId);
      if (p) { clearTimeout(p.t); pending.delete(msg.reqId); p.resolve(msg); }
    } else if (msg.type === 'denied') {
      stopped = true;
      clearTimeout(timer);
      onDenied();
    }
  }

  async function connect() {
    if (stopped || connecting || (conn && conn.open)) return;
    connecting = true;
    onStatus(conn === null && !peer ? 'connecting' : 'reconnecting');
    try {
      await loadLib('peerjs', PEERJS_URLS, 'Peer');
      if (!peer || peer.destroyed) {
        peer = new window.Peer(PEER_OPTS);
        peer.on('disconnected', () => { if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* 무시 */ } } });
      }
      await waitOpen(peer, 12000);
      const c = peer.connect(hostPeerId, { reliable: true });
      await new Promise((resolve, reject) => {
        const done = (fn, v) => { clearTimeout(t); peer.off('error', onErr); fn(v); };
        const onErr = (e) => done(reject, e);
        const t = setTimeout(() => { try { c.close(); } catch (e) { /* 무시 */ } done(reject, new Error('timeout')); }, 10000);
        c.on('open', () => done(resolve));
        c.on('error', onErr);
        peer.on('error', onErr);
      });
      conn = c;
      c.on('data', onData);
      c.on('close', () => lost(c));
      c.on('error', () => lost(c));
      c.send(hello);
    } catch (e) {
      if (!stopped) { onStatus('reconnecting'); schedule(); }
    } finally {
      connecting = false;
    }
  }

  // 휴대폰 화면이 꺼졌다 켜지면 끊겨 있는 경우가 많아 바로 다시 붙는다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !(conn && conn.open)) { clearTimeout(timer); connect(); }
  });

  function send(op, args) {
    const c = conn;
    if (!c || !c.open) return Promise.reject(new Error('offline'));
    const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(reqId); reject(new Error('timeout')); lost(c); }, 10000);
      pending.set(reqId, { resolve, reject, t });
      try { c.send({ type: opType, reqId, op, args }); } catch (e) { clearTimeout(t); pending.delete(reqId); reject(e); }
    });
  }

  connect();
  return { send, isOpen: () => !!(conn && conn.open) };
}

// ───────── 참가자(게스트) ─────────
export function createGuest(hostPeerId) {
  let peer = null, conn = null;

  async function ensureConn() {
    if (conn && conn.open) return conn;
    await loadLib('peerjs', PEERJS_URLS, 'Peer');
    if (!peer || peer.destroyed) {
      peer = new window.Peer(PEER_OPTS);
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
