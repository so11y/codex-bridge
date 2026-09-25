#!/usr/bin/env node
// bridge agent —— 运行在用户电脑上，主动反向连接 bridge 服务器，执行命令并流式回传。
// 跨平台（Windows / macOS / Linux），零第三方依赖。
const net = require('net');
const tls = require('tls');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const cfgPath = process.env.BRIDGE_AGENT_CONFIG || path.join(__dirname, 'agent.config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
  console.error('[agent] cannot read config: ' + cfgPath + ' -> ' + e.message);
  process.exit(1);
}

const HOST = String(cfg.server || '127.0.0.1');
const PORT = Number(cfg.port || 9443);
const CLIENT = String(cfg.client || os.hostname());
const TOKEN = String(cfg.token || '');
const RECONNECT = Number(cfg.reconnectMs || 3000);
const DEFAULT_CWD = cfg.defaultCwd ? String(cfg.defaultCwd) : os.homedir();

function log() { console.error('[' + new Date().toISOString() + '][agent]', ...arguments); }

function pickShell() {
  const pref = String(cfg.shell || 'auto');
  if (pref && pref !== 'auto') return pref;
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(gitBash)) return gitBash;
    return process.env.ComSpec || 'cmd.exe';
  }
  return 'bash';
}
const SHELL = pickShell();

function shellInvocation(cmd) {
  const base = path.basename(SHELL).toLowerCase();
  if (base === 'cmd.exe' || base === 'cmd') {
    return { file: SHELL, args: ['/d', '/s', '/c', cmd] };
  }
  return { file: SHELL, args: ['-lc', cmd] };
}

let sock = null;
let buf = '';
let authed = false;

function send(obj) {
  if (sock && !sock.destroyed) sock.write(JSON.stringify(obj) + '\n');
}

function handle(msg) {
  switch (msg.op) {
    case 'hello': {
      const mac = crypto.createHmac('sha256', TOKEN).update(String(msg.nonce)).digest('hex');
      send({ op: 'auth', client: CLIENT, mac, host: os.hostname(), platform: process.platform, shell: SHELL });
      return;
    }
    case 'ready': authed = true; log('connected as ' + CLIENT); return;
    case 'deny': log('DENIED: ' + (msg.reason || '')); try { sock.destroy(); } catch (e) {} return;
    case 'pong': return;
    case 'exec': return doExec(msg);
    case 'read': return doRead(msg);
    case 'write': return doWrite(msg);
    case 'list': return doList(msg);
    default: return;
  }
}

function doExec(msg) {
  const id = msg.id;
  const cmd = String(msg.cmd || '');
  let cwd = DEFAULT_CWD;
  if (msg.cwd && fs.existsSync(String(msg.cwd))) cwd = String(msg.cwd);
  const inv = shellInvocation(cmd);
  const t0 = Date.now();
  let child;
  try {
    child = spawn(inv.file, inv.args, { cwd, env: process.env, windowsHide: true });
  } catch (e) {
    send({ id, ev: 'exit', code: -1, error: String((e && e.message) || e), durationMs: 0 });
    return;
  }
  child.stdout.on('data', (d) => send({ id, ev: 'out', stream: 'stdout', data: d.toString('utf8') }));
  child.stderr.on('data', (d) => send({ id, ev: 'out', stream: 'stderr', data: d.toString('utf8') }));
  child.on('error', (e) => send({ id, ev: 'out', stream: 'stderr', data: 'spawn error: ' + e.message + '\n' }));
  child.on('close', (code) => send({ id, ev: 'exit', code: code === null ? -1 : code, durationMs: Date.now() - t0 }));
}

function doRead(msg) {
  try {
    const b = fs.readFileSync(String(msg.path));
    send({ id: msg.id, ev: 'data', b64: b.toString('base64'), bytes: b.length });
  } catch (e) { send({ id: msg.id, ev: 'error', error: String(e.message) }); }
}
function doWrite(msg) {
  try {
    const b = Buffer.from(String(msg.b64 || ''), 'base64');
    const p = String(msg.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, b);
    send({ id: msg.id, ev: 'ok', bytes: b.length });
  } catch (e) { send({ id: msg.id, ev: 'error', error: String(e.message) }); }
}
function doList(msg) {
  try {
    const items = fs.readdirSync(String(msg.path), { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }));
    send({ id: msg.id, ev: 'list', items });
  } catch (e) { send({ id: msg.id, ev: 'error', error: String(e.message) }); }
}

function connect() {
  buf = ''; authed = false;
  const onConnected = () => log('connecting -> ' + HOST + ':' + PORT + (cfg.tls ? ' (TLS)' : ''));
  if (cfg.tls) {
    const tlsOpts = {
      host: HOST,
      port: PORT,
      servername: cfg.tlsServername || 'bridge',
      checkServerIdentity: () => undefined,
    };
    if (cfg.caFile) {
      const caPath = path.isAbsolute(cfg.caFile) ? cfg.caFile : path.join(__dirname, cfg.caFile);
      try { tlsOpts.ca = [fs.readFileSync(caPath, 'utf8')]; } catch (e) { log('cannot read caFile: ' + e.message); }
    }
    sock = tls.connect(tlsOpts, onConnected);
  } else {
    sock = net.connect({ host: HOST, port: PORT }, onConnected);
  }
  sock.setKeepAlive(true, 15000);
  sock.setNoDelay(true);
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      try { handle(msg); } catch (e) { log('handle error: ' + e.message); }
    }
  });
  sock.on('error', (e) => log('socket error: ' + e.message));
  sock.on('close', () => {
    authed = false;
    log('disconnected, retry in ' + RECONNECT + 'ms');
    setTimeout(connect, RECONNECT);
  });
}

setInterval(() => { if (authed) send({ op: 'ping' }); }, 20000);
connect();
