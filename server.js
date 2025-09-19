import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3030;
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 60000);
const SIGNAL_LIMIT = Number(process.env.SIGNAL_LIMIT || 120);
const SIGNAL_WINDOW_MS = Number(process.env.SIGNAL_WINDOW_MS || 10000);

app.use(express.static('public'));

// Health and runtime config
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

function buildIceServers() {
  if (process.env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.ICE_SERVERS);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    list.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  }
  return list;
}

app.get('/config', (_req, res) => res.json({ iceServers: buildIceServers() }));

// In-memory matchmaking and peer mapping
const waitingQueue = []; // items: { id, ws, waitingSince }
const peers = new Map(); // id -> { ws, partnerId, name }
const lastPartner = new Map(); // id -> last partnerId to avoid immediate rematch
const history = new Map(); // id -> Map(partnerId -> lastMatchedAt)

// Basic metrics
let metrics = {
  startedAt: Date.now(),
  totalConnections: 0,
  totalFind: 0,
  totalMatches: 0,
  totalLeaves: 0,
  queueWaitCount: 0,
  queueWaitTotalMs: 0,
};

function recordMatch(aId, bId, queuedEntry) {
  metrics.totalMatches += 1;
  const now = Date.now();
  if (queuedEntry && queuedEntry.waitingSince) {
    metrics.queueWaitCount += 1;
    metrics.queueWaitTotalMs += now - queuedEntry.waitingSince;
  }
  if (!history.has(aId)) history.set(aId, new Map());
  if (!history.has(bId)) history.set(bId, new Map());
  history.get(aId).set(bId, now);
  history.get(bId).set(aId, now);
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function safeSend(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function isQueued(id) {
  return waitingQueue.some((e) => e.id === id);
}

function attemptFind(id, ws) {
  const entry0 = peers.get(id);
  if (!entry0 || !entry0.name) {
    safeSend(ws, { type: 'need-name' });
    return;
  }
  // If already paired, ignore
  const entry = peers.get(id);
  if (entry && entry.partnerId) return;

  // Prefer candidate not within cooldown; fall back if none
  const now = Date.now();
  const myHist = history.get(id) || new Map();
  let bestIdx = -1;
  let fallbackIdx = -1;
  for (let i = 0; i < waitingQueue.length; i++) {
    const candidate = waitingQueue[i];
    if (candidate.id === id) continue;
    const candEntry = peers.get(candidate.id);
    if (!candEntry || candEntry.partnerId) continue;
    const candHist = history.get(candidate.id) || new Map();
    const lastWithA = myHist.get(candidate.id) || 0;
    const lastWithB = candHist.get(id) || 0;
    const withinCooldown = (now - Math.max(lastWithA, lastWithB)) < COOLDOWN_MS;
    if (!withinCooldown) { bestIdx = i; break; }
    if (fallbackIdx === -1) fallbackIdx = i;
  }

  const chosenIdx = bestIdx !== -1 ? bestIdx : fallbackIdx;
  if (chosenIdx !== -1) {
    const [opponent] = waitingQueue.splice(chosenIdx, 1);
    pairClients({ id, ws }, opponent);
    recordMatch(id, opponent.id, opponent);
  } else {
    if (!isQueued(id)) waitingQueue.push({ id, ws, waitingSince: Date.now() });
    safeSend(ws, { type: 'waiting' });
  }
}

function pairClients(a, b) {
  const aPrev = peers.get(a.id) || { name: null };
  const bPrev = peers.get(b.id) || { name: null };
  peers.set(a.id, { ws: a.ws, partnerId: b.id, name: aPrev.name || null });
  peers.set(b.id, { ws: b.ws, partnerId: a.id, name: bPrev.name || null });
  safeSend(a.ws, { type: 'matched', partnerId: b.id, partnerName: bPrev.name || 'ไม่ระบุ', role: 'caller' });
  safeSend(b.ws, { type: 'matched', partnerId: a.id, partnerName: aPrev.name || 'ไม่ระบุ', role: 'callee' });
  lastPartner.set(a.id, b.id);
  lastPartner.set(b.id, a.id);
}

function cleanupClient(id, opts = {}) {
  const { keepSelf = false } = opts;
  const entry = peers.get(id);
  if (entry) {
    const partnerId = entry.partnerId;
    // remember last partner for both sides to avoid immediate rematch
    if (partnerId) {
      lastPartner.set(id, partnerId);
      lastPartner.set(partnerId, id);
    }
    if (keepSelf) {
      // Keep this client in peers but clear pairing
      peers.set(id, { ws: entry.ws, partnerId: null, name: entry.name || null });
    } else {
      peers.delete(id);
    }
    if (partnerId && peers.has(partnerId)) {
      const partner = peers.get(partnerId);
      peers.set(partnerId, { ws: partner.ws, partnerId: null, name: partner.name || null });
      safeSend(partner.ws, { type: 'peer-left' });
    }
  }
  // Remove all occurrences from waiting queue if present
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    if (waitingQueue[i].id === id) waitingQueue.splice(i, 1);
  }
}

wss.on('connection', (ws) => {
  // Heartbeat for stale connection cleanup
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  metrics.totalConnections += 1;
  const id = genId();
  peers.set(id, { ws, partnerId: null, name: null });
  safeSend(ws, { type: 'welcome', id });

  // Rate limiting state per socket
  let rateWindowStart = Date.now();
  let rateCount = 0;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    if (msg.type === 'set-name') {
      const raw = (msg.name || '').toString().trim();
      const name = raw.slice(0, 32);
      if (!name) {
        safeSend(ws, { type: 'name-error', reason: 'invalid' });
        return;
      }
      const entry = peers.get(id);
      if (!entry) return;
      peers.set(id, { ws: entry.ws, partnerId: entry.partnerId, name });
      safeSend(ws, { type: 'name-ok', name });
      return;
    }

    if (msg.type === 'find') {
      metrics.totalFind += 1;
      attemptFind(id, ws);
      return;
    }

    if (msg.type === 'signal') {
      const now = Date.now();
      if (now - rateWindowStart > SIGNAL_WINDOW_MS) {
        rateWindowStart = now;
        rateCount = 0;
      }
      rateCount += 1;
      if (rateCount > SIGNAL_LIMIT) return;
      // Forward signaling payload to partner
      const entry = peers.get(id);
      if (!entry || !entry.partnerId) return;
      const partner = peers.get(entry.partnerId);
      if (!partner) return;
      safeSend(partner.ws, { type: 'signal', from: id, payload: msg.payload });
      return;
    }

    if (msg.type === 'leave') {
      metrics.totalLeaves += 1;
      cleanupClient(id, { keepSelf: true });
      safeSend(ws, { type: 'left' });
      return;
    }

    if (msg.type === 'next') {
      // Atomic: leave current, then immediately try to find a new partner
      metrics.totalLeaves += 1;
      cleanupClient(id, { keepSelf: true });
      safeSend(ws, { type: 'left' });
      attemptFind(id, ws);
      return;
    }
  });

  ws.on('close', () => {
    cleanupClient(id, { keepSelf: false });
  });
});

// Periodic heartbeat to terminate dead sockets and trigger cleanup
const HEARTBEAT_INTERVAL = 30000; // 30s
const hb = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(hb));

// Basic metrics endpoint
app.get('/metrics', (_req, res) => {
  const uptimeSec = Math.floor((Date.now() - metrics.startedAt) / 1000);
  const avgWaitMs = metrics.queueWaitCount ? Math.round(metrics.queueWaitTotalMs / metrics.queueWaitCount) : 0;
  res.json({
    uptimeSec,
    queueLength: waitingQueue.length,
    avgQueueWaitMs: avgWaitMs,
    ...metrics,
  });
});

server.listen(PORT, () => {
  console.log(`MVP Meeter listening on http://localhost:${PORT}`);
});
