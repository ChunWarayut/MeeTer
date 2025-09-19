const statusEl = document.getElementById('status');
const nameInput = document.getElementById('nameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const findBtn = document.getElementById('findBtn');
const leaveBtn = document.getElementById('leaveBtn');
const nextBtn = document.getElementById('nextBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localNameEl = document.getElementById('localName');
const remoteNameEl = document.getElementById('remoteName');
const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const flipBtn = document.getElementById('flipBtn');
const autoNextInput = document.getElementById('autoNextSec');

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let ws = null;

let myId = null;
let partnerId = null;
let role = null; // 'caller' | 'callee'
let pc = null;
let localStream = null;
let isFinding = false;
let autoMode = true;
let shouldFindAfterLeave = false; // set when pressing Next
let reconnectAttempts = 0;
let reconnectTimer = null;
let autoNextTimer = null;
let autoNextSec = 0;
let micOn = true;
let camOn = true;
let facingMode = 'user'; // or 'environment'
let iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
let displayName = '';
let hasNameOk = false;
let nextInFlight = false;

function send(msg) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } catch {}
}

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    setStatus('เชื่อมต่อเซิร์ฟเวอร์แล้ว');
    reconnectAttempts = 0;
  };
  ws.onclose = () => {
    setStatus('ขาดการเชื่อมต่อ กำลังเชื่อมใหม่...');
    const delay = Math.min(5000, 300 * Math.pow(2, reconnectAttempts++));
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connectWS(), delay);
  };
  ws.onmessage = wsOnMessage;
}

const autoToggle = document.getElementById('autoToggle');
autoToggle.addEventListener('change', () => {
  autoMode = autoToggle.checked;
  if (!autoMode) return; // turning on is handled below
  // If turned ON and currently idle, begin finding automatically
  if (!partnerId && !isFinding && hasNameOk) beginFind();
});

function setStatus(text) {
  statusEl.textContent = text;
}

function createPeer() {
  const config = { iceServers };
  const peer = new RTCPeerConnection(config);
  peer.onicecandidate = (e) => {
    if (e.candidate) {
      send({ type: 'signal', payload: { type: 'candidate', candidate: e.candidate } });
    }
  };
  peer.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') setStatus('เชื่อมต่อแล้ว');
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      setStatus('การเชื่อมต่อหลุด');
    }
  };
  return peer;
}

async function ensureMedia() {
  if (localStream) return localStream;
  const constraints = { video: { facingMode }, audio: true };
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  localVideo.srcObject = localStream;
  // apply current mic/cam toggles
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  return localStream;
}

function resetCallState() {
  partnerId = null;
  role = null;
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
  }
  pc = null;
  remoteVideo.srcObject = null;
  if (remoteNameEl) remoteNameEl.textContent = 'คู่สนทนา';
  leaveBtn.disabled = true;
  findBtn.disabled = !hasNameOk;
  isFinding = false;
  nextBtn.disabled = true;
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
}

async function startCaller() {
  setStatus('เริ่มโทรหา...');
  pc = createPeer();
  const stream = await ensureMedia();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'signal', payload: { type: 'offer', sdp: offer.sdp } });
}

async function handleOffer(sdp) {
  setStatus('ได้รับคำเชิญ สนทนา...');
  pc = createPeer();
  const stream = await ensureMedia();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  await pc.setRemoteDescription({ type: 'offer', sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: 'signal', payload: { type: 'answer', sdp: answer.sdp } });
}

async function handleAnswer(sdp) {
  if (!pc) return;
  await pc.setRemoteDescription({ type: 'answer', sdp });
}

async function handleCandidate(candidate) {
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn('Error addIceCandidate', e);
  }
}

async function beginFind() {
  if (!hasNameOk) { setStatus('กรุณาตั้งชื่อก่อนใช้งาน'); return; }
  if (partnerId || isFinding) return;
  try {
    await ensureMedia();
  } catch (e) {
    setStatus('ต้องการสิทธิ์กล้อง/ไมค์');
    return;
  }
  send({ type: 'find' });
  isFinding = true;
  setStatus('กำลังค้นหา...');
  findBtn.disabled = true;
  leaveBtn.disabled = false;
}

async function wsOnMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === 'welcome') {
    myId = msg.id;
    // If we already have a saved name, send it to server
    if (displayName) send({ type: 'set-name', name: displayName });
    return;
  }
  if (msg.type === 'name-ok') {
    hasNameOk = true;
    if (displayName !== msg.name) {
      displayName = msg.name;
      nameInput.value = displayName;
    }
    if (localNameEl) localNameEl.textContent = displayName;
    localStorage.setItem('displayName', displayName);
    findBtn.disabled = false;
    if (autoMode || isFinding || shouldFindAfterLeave) beginFind();
    return;
  }
  if (msg.type === 'name-error') {
    hasNameOk = false;
    setStatus('ชื่อไม่ถูกต้อง ลองใหม่');
    return;
  }
  if (msg.type === 'need-name') {
    hasNameOk = false;
    setStatus('กรุณาตั้งชื่อก่อนใช้งาน');
    findBtn.disabled = true;
    return;
  }
  if (msg.type === 'waiting') {
    setStatus('กำลังรอคู่สนทนา...');
    findBtn.disabled = true;
    leaveBtn.disabled = false;
    isFinding = true;
    return;
  }
  if (msg.type === 'matched') {
    partnerId = msg.partnerId;
    role = msg.role;
    const partnerName = msg.partnerName || 'ไม่ระบุ';
    setStatus('จับคู่กับ: ' + partnerName + ' (' + role + ')');
    if (remoteNameEl) remoteNameEl.textContent = partnerName;
    findBtn.disabled = true;
    leaveBtn.disabled = false;
    nextBtn.disabled = false;
    isFinding = false;
    if (role === 'caller') {
      await startCaller();
    }
    // schedule auto next
    if (autoNextSec > 0) {
      if (autoNextTimer) clearTimeout(autoNextTimer);
      autoNextTimer = setTimeout(() => {
        if (partnerId) nextBtn.click();
      }, autoNextSec * 1000);
    }
    return;
  }
  if (msg.type === 'signal') {
    const p = msg.payload;
    if (p.type === 'offer') return handleOffer(p.sdp);
    if (p.type === 'answer') return handleAnswer(p.sdp);
    if (p.type === 'candidate') return handleCandidate(p.candidate);
    return;
  }
  if (msg.type === 'peer-left') {
    setStatus('คู่สนทนาออกแล้ว');
    resetCallState();
    if (autoMode) {
      // Auto find next partner
      beginFind();
    }
    return;
  }
  if (msg.type === 'left') {
    setStatus('ออกจากห้องแล้ว');
    resetCallState();
    if (nextInFlight) {
      // Server will immediately attempt to match us; don't double-send find
      nextInFlight = false;
    } else if (shouldFindAfterLeave) {
      shouldFindAfterLeave = false;
      beginFind();
    } else if (autoMode) {
      beginFind();
    }
    return;
  }
}

findBtn.onclick = async () => {
  beginFind();
};

leaveBtn.onclick = () => {
  send({ type: 'leave' });
  resetCallState();
};

nextBtn.onclick = () => {
  // Leave current and immediately look for a new partner
  nextInFlight = true;
  setStatus('กำลังหาคู่ถัดไป...');
  // Immediately tear down local call so we "leave" right away in UI
  resetCallState();
  send({ type: 'next' });
};

window.addEventListener('beforeunload', () => {
  try { send({ type: 'leave' }); } catch {}
});

// Start WebSocket connection
connectWS();

// Load ICE servers config
fetch('/config').then(r => r.json()).then(cfg => {
  if (Array.isArray(cfg.iceServers)) iceServers = cfg.iceServers;
}).catch(() => {});

// Media controls
micBtn?.addEventListener('click', async () => {
  micOn = !micOn;
  micBtn.textContent = micOn ? 'ปิดไมค์' : 'เปิดไมค์';
  const stream = await ensureMedia();
  stream.getAudioTracks().forEach(t => t.enabled = micOn);
});

camBtn?.addEventListener('click', async () => {
  camOn = !camOn;
  camBtn.textContent = camOn ? 'ปิดกล้อง' : 'เปิดกล้อง';
  const stream = await ensureMedia();
  stream.getVideoTracks().forEach(t => t.enabled = camOn);
});

async function replaceVideoTrack(newTrack) {
  if (pc) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
  }
}

flipBtn?.addEventListener('click', async () => {
  facingMode = (facingMode === 'user') ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
    const old = localStream;
    localStream = new MediaStream();
    // keep audio from old if exists
    const audio = (old && old.getAudioTracks()[0]) || newStream.getAudioTracks()[0];
    if (audio) localStream.addTrack(audio);
    const video = newStream.getVideoTracks()[0];
    if (video) localStream.addTrack(video);
    localVideo.srcObject = localStream;
    localStream.getAudioTracks().forEach(t => t.enabled = micOn);
    localStream.getVideoTracks().forEach(t => t.enabled = camOn);
    if (video) await replaceVideoTrack(video);
    // stop old video tracks
    if (old) old.getVideoTracks().forEach(t => t.stop());
  } catch (e) {
    console.warn('flip camera failed', e);
  }
});

// Auto next config
autoNextInput?.addEventListener('change', () => {
  const v = Number(autoNextInput.value || 0);
  autoNextSec = isNaN(v) ? 0 : Math.max(0, v);
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
  if (partnerId && autoNextSec > 0) {
    autoNextTimer = setTimeout(() => { if (partnerId) nextBtn.click(); }, autoNextSec * 1000);
  }
});

// Load saved name and hook save button
displayName = localStorage.getItem('displayName') || '';
if (displayName) {
  nameInput.value = displayName;
  if (localNameEl) localNameEl.textContent = displayName;
}
// Initially disable find until name confirmed by server
findBtn.disabled = true;

saveNameBtn.addEventListener('click', () => {
  const n = (nameInput.value || '').trim();
  if (!n) { setStatus('กรุณาใส่ชื่อ'); return; }
  displayName = n.slice(0, 32);
  send({ type: 'set-name', name: displayName });
  if (localNameEl) localNameEl.textContent = displayName;
});
