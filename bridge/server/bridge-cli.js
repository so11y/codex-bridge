#!/usr/bin/env node
// bridge CLI —— 在服务器本地使用：向 bridge-server 的控制端口发请求，操作远端 agent。
const net = require('net');
const fs = require('fs');
const path = require('path');

const cfgPath = process.env.BRIDGE_SERVER_CONFIG || path.join(__dirname, 'config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {
  console.error('[cli] cannot read config: ' + cfgPath + ' -> ' + e.message);
  process.exit(1);
}
const PORT = Number(cfg.controlPort || Number(cfg.port || 9443) + 1);

const argv = process.argv.slice(2);
const sub = argv.shift();

function usage() {
  console.log([
    'usage:',
    '  bridge-cli status',
    '  bridge-cli exec [--client ID] [--cwd DIR] -- <command...>',
    '  bridge-cli read [--client ID] --path <remote path> [--out <local file>]',
    '  bridge-cli write [--client ID] --path <remote path> --file <local file>',
    '  bridge-cli list [--client ID] --path <remote dir>'
  ].join('\n'));
}

if (!sub || sub === 'help' || sub === '-h' || sub === '--help') { usage(); process.exit(0); }

const flags = { client: cfg.defaultClient || null, cwd: null, path: null, file: null, out: null };
while (argv.length && argv[0].startsWith('--')) {
  if (argv[0] === '--') { argv.shift(); break; }
  const k = argv.shift().slice(2);
  if (k === 'client') flags.client = argv.shift();
  else if (k === 'cwd') flags.cwd = argv.shift();
  else if (k === 'path') flags.path = argv.shift();
  else if (k === 'file') flags.file = argv.shift();
  else if (k === 'out') flags.out = argv.shift();
  else { console.error('[cli] unknown flag: --' + k); process.exit(1); }
}
if (argv[0] === '--') argv.shift();
const rest = argv;

function connect(onLine, onError) {
  const sock = net.connect({ host: '127.0.0.1', port: PORT }, () => {
    sock.write(JSON.stringify(Object.assign({ op: sub }, flags, buildPayload())) + '\n');
  });
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      onLine(msg);
    }
  });
  sock.on('error', (e) => { onError(e); process.exit(2); });
}

function buildPayload() {
  if (sub === 'exec') return { cmd: rest.join(' ') };
  if (sub === 'write') {
    const data = fs.readFileSync(flags.file);
    return { path: flags.path, b64: data.toString('base64') };
  }
  return { path: flags.path };
}

let exitCode = 0;
connect((msg) => {
  if (sub === 'status') {
    if (msg.ev === 'status') {
      if (!msg.clients.length) console.log('(没有已连接的客户端)');
      else for (const c of msg.clients) console.log(c.id + '\t' + c.platform + '\t' + c.host + '\t' + c.shell);
    }
    return;
  }
  if (sub === 'exec') {
    if (msg.ev === 'out') process[msg.stream === 'stderr' ? 'stderr' : 'stdout'].write(msg.data);
    else if (msg.ev === 'exit') {
      exitCode = typeof msg.code === 'number' ? msg.code : 1;
      if (msg.error) console.error('[cli] error: ' + msg.error);
      process.exitCode = exitCode;
      process.exit(exitCode);
    }
    return;
  }
  if (sub === 'read') {
    if (msg.ev === 'data') {
      const buf = Buffer.from(msg.b64, 'base64');
      if (flags.out) { fs.writeFileSync(flags.out, buf); console.error('[cli] saved ' + buf.length + ' bytes -> ' + flags.out); }
      else process.stdout.write(buf);
    } else if (msg.ev === 'error') { console.error('[cli] ' + msg.error); process.exitCode = 1; }
    return;
  }
  if (sub === 'write') {
    if (msg.ev === 'ok') console.log('[cli] wrote ' + msg.bytes + ' bytes');
    else if (msg.ev === 'error') { console.error('[cli] ' + msg.error); process.exitCode = 1; }
    return;
  }
  if (sub === 'list') {
    if (msg.ev === 'list') for (const it of msg.items) console.log((it.dir ? 'd ' : '- ') + it.name);
    else if (msg.ev === 'error') { console.error('[cli] ' + msg.error); process.exitCode = 1; }
    return;
  }
  if (msg.ev === 'error') { console.error('[cli] ' + msg.error); process.exitCode = 1; }
}, (e) => console.error('[cli] connect failed: ' + e.message));
