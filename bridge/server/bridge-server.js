#!/usr/bin/env node
// bridge server —— 运行在服务器上：接受多个 agent 的反向连接，并向本地 CLI 提供控制接口。
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfgPath = process.env.BRIDGE_SERVER_CONFIG || path.join(__dirname, 'config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {
  console.error('[bridge] cannot read config: ' + cfgPath + ' -> ' + e.message);
  process.exit(1);
}

const PORT = Number(cfg.port || 9443);
const CONTROL_PORT = Number(cfg.controlPort || PORT + 1);
const CLIENTS = cfg.clients || {};

const agents = new Map(); // clientId -> { sock, host, platform, shell }
const waiters = new Map(); // reqId -> { onMsg }

function log() { console.error('[' + new Date().toISOString() + '][bridge]', ...arguments); }

function onAgent(sock) {
  let clientId = null;
  let buf = '';
  const nonce = crypto.randomBytes(16).toString('hex');
  sock.write(JSON.stringify({ op: 'hello', nonce }) + '\n');

  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }

      if (msg.op === 'auth') {
        const token = CLIENTS[msg.client];
        const expect = token ? crypto.createHmac('sha256', token).update(nonce).digest('hex') : '';
        if (token && msg.mac === expect) {
          clientId = String(msg.client);
          const prev = agents.get(clientId);
          if (prev && prev.sock !== sock) { try { prev.sock.destroy(); } catch (e) {} }
          agents.set(clientId, { sock, host: msg.host, platform: msg.platform, shell: msg.shell, since: Date.now() });
          sock.write(JSON.stringify({ op: 'ready', client: clientId }) + '\n');
          log('agent connected: ' + clientId + ' (' + msg.host + ', ' + msg.platform + ', ' + msg.shell + ')');
        } else {
          sock.write(JSON.stringify({ op: 'deny', reason: 'auth failed' }) + '\n');
          log('agent DENIED: ' + (msg.client || '(none)'));
          try { sock.end(); } catch (e) {}
        }
        continue;
      }

      if (msg.op === 'ping') { sock.write(JSON.stringify({ op: 'pong' }) + '\n'); continue; }

      const w = waiters.get(msg.id);
      if (w) w.onMsg(msg);
    }
  });

  sock.on('close', () => {
    if (clientId && agents.get(clientId) && agents.get(clientId).sock === sock) {
      agents.delete(clientId);
      log('agent disconnected: ' + clientId);
    }
  });
  sock.on('error', () => {});
}

const BIND = String(cfg.bind || '0.0.0.0');
let agentServer;
if (cfg.tls) {
  agentServer = tls.createServer({
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
  }, onAgent);
} else {
  agentServer = net.createServer(onAgent);
}
agentServer.listen(PORT, BIND, () => log('listening for agents on ' + BIND + ':' + PORT + (cfg.tls ? ' (TLS)' : '')));

let reqSeq = 0;
const controlServer = net.createServer((cliSock) => {
  let buf = '';
  cliSock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let req; try { req = JSON.parse(line); } catch (e) { continue; }
      routeControl(cliSock, req);
    }
  });
  cliSock.on('error', () => {});
});

function reply(cliSock, obj) { try { cliSock.write(JSON.stringify(obj) + '\n'); } catch (e) {} }

function routeControl(cliSock, req) {
  if (req.op === 'status') {
    reply(cliSock, {
      ev: 'status',
      clients: Array.from(agents.entries()).map(([id, a]) => ({ id, host: a.host, platform: a.platform, shell: a.shell, since: a.since }))
    });
    try { cliSock.end(); } catch (e) {}
    return;
  }

  const clientId = req.client || cfg.defaultClient;
  const agent = agents.get(clientId);
  if (!agent) {
    reply(cliSock, { ev: 'exit', code: 127, error: 'client not connected: ' + clientId });
    try { cliSock.end(); } catch (e) {}
    return;
  }

  const id = 'r' + (++reqSeq);
  waiters.set(id, {
    onMsg: (msg) => {
      reply(cliSock, msg);
      if (msg.ev === 'exit' || msg.ev === 'error' || msg.ev === 'ok' || msg.ev === 'data' || msg.ev === 'list') {
        waiters.delete(id);
        try { cliSock.end(); } catch (e) {}
      }
    }
  });
  agent.sock.write(JSON.stringify(Object.assign({}, req, { id })) + '\n');
}
controlServer.listen(CONTROL_PORT, '127.0.0.1', () => log('control (local only) on 127.0.0.1:' + CONTROL_PORT));
