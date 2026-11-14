import Phaser from 'phaser';
import { call, beacon, pack, unpack, SignalError } from './signal.js';

// One multiplayer game, kept across level restarts (doors, character switches). The host's browser is the
// hub: every joiner opens a WebRTC data channel to it, sends where it is ~15 times a second, and gets back
// everyone's latest state. net.php is only used to find the host and swap the connection handshake.
//   await net.host({ name, level })         opens a room; net.room is the code to share
//   await net.join({ name, room })          joins one (throws a SignalError with a readable message)
//   await net.quick({ name, level, room })  joins `room`, or opens it if nobody has (the local test server)
//   net.setLocal({ name, char, level, x, y, anim, flip })   this player, every frame
//   net.players                             everyone else: { id: that same state }
//   events: 'players' (someone came, went, or the game started/ended), 'ended' (reason)

const SEND_MS = 66;          // state updates, ~15 a second
const HOST_POLL_MS = 1000;   // how often the host checks for new joiners (and keeps its room open)
const JOIN_POLL_MS = 400;
const CONNECT_MS = 15000;
const GATHER_MS = 3000;      // longest wait for ICE candidates before sending a handshake
const QUIET_MS = 4000;       // a player not heard from in this long is hidden (a backgrounded tab)
const LOST_MS = 6000;        // a connection 'disconnected' this long is given up

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One handshake message carries every ICE candidate, so the server only relays one offer and one answer.
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => { if (pc.iceGatheringState === 'complete') resolve(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, GATHER_MS);
  });
}

function opened(channel, pc, ms, message) {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fail = () => reject(new SignalError(message, 'unreachable'));
    const timer = setTimeout(fail, ms);
    channel.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') { clearTimeout(timer); fail(); }
    });
  });
}

class NetSession extends Phaser.Events.EventEmitter {
  constructor() {
    super();
    this.clear();
    addEventListener('pagehide', () => this.leave());
  }

  clear() {
    this.role = null;        // 'host' | 'client' | null (solo)
    this.room = this.id = this.key = null;
    this.name = '';
    this.ice = [];
    this.peers = new Map();  // host: joiner id → { pc, channel }; client: 'h' → the host
    this.players = {};
    this.local = null;
    this.timers = [];
    this.sent = 0;           // sequence numbers: unreliable channels can deliver out of order
    this.heard = 0;
    this.rosterKey = '';
  }

  get active() { return this.role !== null; }
  get count() { return 1 + Object.keys(this.players).length; }

  setLocal(state) { this.local = state; }

  every(ms, fn) { this.timers.push(setInterval(fn, ms)); }

  begin(role, reply, name) {
    Object.assign(this, { role, room: reply.room, id: reply.peer, key: reply.key, ice: reply.ice, name });
    this.roster(true);
  }

  // ---- host ----------------------------------------------------------------------------------------

  async host({ name, level, room }) {
    const reply = await call('host', { name, level, room });
    this.begin('host', reply, name);
    this.every(HOST_POLL_MS, () => this.hostPoll());
    this.every(SEND_MS, () => this.hostSend());
    this.hostPoll();
    return this;
  }

  async hostPoll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const { messages } = await call('poll', { room: this.room, peer: this.id, key: this.key, players: this.count });
      for (const m of messages) {
        const msg = unpack(m.data);
        if (msg.type === 'offer' && this.role === 'host') this.accept(m.from, msg.sdp).catch((e) => console.warn('[net] accept', e));
      }
    } catch (e) {
      if (e.code === 'no-room') this.end('The game server closed this room.');
      else console.warn('[net]', e.message);
    } finally {
      this.polling = false;
    }
  }

  async accept(from, sdp) {
    this.peers.get(from)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer = { pc, channel: null };
    this.peers.set(from, peer);
    pc.ondatachannel = ({ channel }) => {
      peer.channel = channel;
      channel.onmessage = (e) => this.fromClient(from, e.data);
    };
    this.watch(pc, () => this.drop(from));
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await call('send', { room: this.room, peer: this.id, key: this.key, to: from,
                         data: pack({ type: 'answer', sdp: pc.localDescription.sdp }) });
  }

  fromClient(from, text) {
    const msg = JSON.parse(text);
    if (msg.type !== 'me' || !this.peers.has(from)) return;
    const last = this.players[from];
    if (last && msg.p.n <= last.n) return;
    this.players[from] = { ...msg.p, heard: performance.now() };
  }

  drop(id) {
    this.peers.get(id)?.pc.close();
    this.peers.delete(id);
    delete this.players[id];
    this.roster();
  }

  hostSend() {
    const now = performance.now(), players = {};
    for (const [id, p] of Object.entries(this.players)) {
      if (now - p.heard > QUIET_MS) delete this.players[id];
      else players[id] = { ...p, heard: undefined };
    }
    if (this.local) players[this.id] = { ...this.local, n: ++this.sent };
    const text = JSON.stringify({ type: 'snap', n: this.sent, players });
    for (const { channel } of this.peers.values()) {
      if (channel?.readyState === 'open') try { channel.send(text); } catch { /* closing */ }
    }
    this.roster();
  }

  // ---- client --------------------------------------------------------------------------------------

  async join({ name, room }) {
    const reply = await call('join', { room, name });
    const auth = { room: reply.room, peer: reply.peer, key: reply.key };
    const pc = new RTCPeerConnection({ iceServers: reply.ice });
    const channel = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      await call('send', { ...auth, to: 'h', data: pack({ type: 'offer', sdp: pc.localDescription.sdp }) });
      const deadline = performance.now() + CONNECT_MS;
      for (let answered = false; !answered;) {
        if (performance.now() > deadline) throw new SignalError(`${reply.host} didn't answer. Their game may have just closed.`, 'timeout');
        await sleep(JOIN_POLL_MS);
        for (const m of (await call('poll', auth)).messages) {
          const msg = unpack(m.data);
          if (msg.type === 'answer' && !answered) {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            answered = true;
          }
        }
      }
      await opened(channel, pc, Math.max(2000, deadline - performance.now()),
                   `Couldn't connect to ${reply.host}'s game. This network may block direct connections between devices.`);
    } catch (e) {
      pc.close();
      call('leave', auth).catch(() => {});
      throw e;
    }
    this.begin('client', reply, name);
    this.peers.set('h', { pc, channel });
    channel.onmessage = (e) => this.fromHost(e.data);
    channel.onclose = () => this.end('The host left the game.');
    this.watch(pc, () => this.end('Lost the connection to the host.'));
    this.every(SEND_MS, () => this.clientSend());
    return this;
  }

  fromHost(text) {
    const msg = JSON.parse(text);
    if (msg.type !== 'snap' || msg.n <= this.heard) return;
    this.heard = msg.n;
    delete msg.players[this.id];
    this.players = msg.players;
    this.roster();
  }

  clientSend() {
    const { channel } = this.peers.get('h') ?? {};
    if (this.local && channel?.readyState === 'open') {
      try { channel.send(JSON.stringify({ type: 'me', p: { ...this.local, n: ++this.sent } })); } catch { /* closing */ }
    }
  }

  // ---- both ----------------------------------------------------------------------------------------

  async quick({ name, level, room }) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try { return await this.join({ name, room }); } catch (e) { if (!['no-room', 'timeout', 'unreachable'].includes(e.code)) throw e; }
      try { return await this.host({ name, level, room }); } catch (e) { if (e.code !== 'taken') throw e; }
      await sleep(500 + Math.random() * 1500);   // two tabs raced for the room; one of them has it now
    }
    throw new SignalError(`Couldn't join or open room ${room}.`, 'busy');
  }

  // Calls `lost` when the connection fails, or stays 'disconnected' (a dropped network) for LOST_MS.
  watch(pc, lost) {
    let timer = null;
    pc.addEventListener('connectionstatechange', () => {
      clearTimeout(timer);
      if (pc.connectionState === 'failed') lost();
      else if (pc.connectionState === 'disconnected') timer = setTimeout(lost, LOST_MS);
    });
  }

  roster(force = false) {
    const key = Object.entries(this.players).map(([id, p]) => `${id}:${p.name}:${p.char}:${p.level}`).sort().join('|');
    if (force || key !== this.rosterKey) {
      this.rosterKey = key;
      this.emit('players', this);
    }
  }

  end(reason) {
    if (!this.active) return;
    const auth = { room: this.room, peer: this.id, key: this.key };
    for (const t of this.timers) clearInterval(t);
    for (const { pc } of this.peers.values()) pc.close();
    if (this.role === 'host') call('leave', auth).catch(() => {});
    this.clear();
    this.roster(true);
    this.emit('ended', reason);
  }

  // The page is closing: tell the server (a host's room closes) and the other players.
  leave() {
    if (!this.active) return;
    beacon('leave', { room: this.room, peer: this.id, key: this.key });
    for (const { pc } of this.peers.values()) pc.close();
  }
}

export const net = new NetSession();
window.brockNet = net;   // for the console (and the multiplayer tests), on the live site too
