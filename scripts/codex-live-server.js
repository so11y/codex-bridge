// codex-live-server.js
// 通过 SSH tail -F 实时拉取远端 codex 输出日志，并在本机 http://127.0.0.1:<port> 实时展示。
// 仅监听 127.0.0.1，不对外暴露。零依赖。
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.on('uncaughtException', (e) => {
  try { console.error('[live] uncaught: ' + ((e && e.stack) || e)); } catch (_) {}
});
process.on('unhandledRejection', (e) => {
  try { console.error('[live] unhandledRejection: ' + ((e && e.stack) || e)); } catch (_) {}
});

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
}

const HOST = arg('host', '');
const USER = arg('user', '');
const PASSWORD = arg('password', '');
const FILE = arg('file', '/tmp/codex_stream_full.txt');
const PORT = parseInt(arg('port', '7721'), 10);
const TITLE = arg('title', 'codex live');

const ANSI_RE = [
  /\x1b\[[0-9;?]*[a-zA-Z]/g,
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
  /\x1b[=>]/g
];
function stripAnsi(s) {
  for (const r of ANSI_RE) s = s.replace(r, '');
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

let buf = '';
let done = false;
let sshInfo = 'connecting...';

function push(s) {
  s = stripAnsi(s);
  const marker = 'OpenAI Codex v';
  const idx = s.indexOf(marker);
  if (idx >= 0) { buf = s.slice(idx); return; }
  buf += s;
  if (buf.length > 8 * 1024 * 1024) buf = buf.slice(buf.length - 4 * 1024 * 1024);
}

const askpass = path.join(os.tmpdir(), 'opencode', 'askpass.cmd');
try {
  fs.mkdirSync(path.dirname(askpass), { recursive: true });
  if (!fs.existsSync(askpass)) fs.writeFileSync(askpass, '@echo off\r\necho ' + PASSWORD + '\r\n', 'ascii');
} catch (e) { sshInfo = 'askpass setup failed: ' + e.message; }

(function () {
  let stopping = false;
  function connect() {
    const child = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      '-o', 'PreferredAuthentications=password',
      '-o', 'PubkeyAuthentication=no',
      '-o', 'LogLevel=ERROR',
      '-o', 'ConnectTimeout=20',
      USER + '@' + HOST,
      'tail -n +1 -F ' + FILE
    ], {
      env: Object.assign({}, process.env, { SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force' }),
      windowsHide: true
    });
    child.on('spawn', () => { sshInfo = 'streaming ' + FILE; push('[live] connected, streaming ' + FILE + '\n'); });
    child.stdout.on('data', (d) => push(d.toString('utf8')));
    child.stderr.on('data', (d) => { const t = d.toString('utf8').trim(); if (t) push('[stderr] ' + t + '\n'); });
    child.on('close', (code) => {
      sshInfo = 'disconnected, retrying...';
      push('\n[live] stream closed (exit=' + code + '), reconnecting in 2s...\n');
      if (!stopping) setTimeout(connect, 2000);
    });
    child.on('error', (e) => {
      sshInfo = 'error: ' + e.message;
      push('[live] ssh error: ' + e.message + '\n');
      if (!stopping) setTimeout(connect, 3000);
    });
    return child;
  }
  connect();
  process.on('SIGINT', () => { stopping = true; process.exit(0); });
  process.on('SIGTERM', () => { stopping = true; process.exit(0); });
})();

const PAGE = [
'<!doctype html>',
'<html lang="zh-CN">',
'<head>',
'<meta charset="utf-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1">',
'<title>' + TITLE + '</title>',
'<style>',
'  :root { color-scheme: dark; --bg:#0b0f14; --bg2:#11161d; --line:#1f2630; --fg:#cbd5e1; --dim:#64748b; --accent:#38bdf8; }',
'  * { box-sizing: border-box; }',
'  body { margin:0; background:var(--bg); color:var(--fg); font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; display:flex; flex-direction:column; height:100vh; }',
'  header { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:10px; padding:10px 14px; background:linear-gradient(180deg,#131a24,#0f141b); border-bottom:1px solid var(--line); flex-wrap:wrap; }',
'  header .title { font-weight:600; letter-spacing:.3px; }',
'  .pill { display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:999px; font-size:11.5px; background:#1a2230; border:1px solid var(--line); color:var(--dim); }',
'  .pill.run { border-color:#0ea5e9; color:#7dd3fc; background:#0c4a6e33; }',
'  .pill.done { border-color:#059669; color:#6ee7b7; background:#064e3b33; }',
'  .pill.err { border-color:#dc2626; color:#fca5a5; background:#7f1d1d33; }',
'  .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }',
'  .pill.run .dot { animation:pulse 1.1s ease-in-out infinite; }',
'  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.7)} }',
'  .meta { color:var(--dim); font-size:11.5px; }',
'  .spacer { flex:1; }',
'  .btn { cursor:pointer; user-select:none; font-size:11.5px; color:var(--fg); background:#1a2230; border:1px solid var(--line); border-radius:8px; padding:4px 10px; }',
'  .btn:hover { border-color:#334155; background:#202a38; }',
'  label { user-select:none; cursor:pointer; font-size:11.5px; color:var(--dim); }',
'  #progress { height:2px; background:#0ea5e9; width:0%; transition:width .4s ease; box-shadow:0 0 8px #0ea5e9; }',
'  #log { flex:1; overflow:auto; padding:10px 14px 45vh 14px; }',
'  .l { white-space:pre-wrap; word-break:break-word; border-left:2px solid transparent; padding-left:8px; }',
'  .cmd { color:#7dd3fc; border-left-color:#0ea5e9; }',
'  .sec { color:#94a3b8; font-weight:600; margin-top:6px; }',
'  .err { color:#fca5a5; border-left-color:#dc2626; background:#7f1d1d22; }',
'  .ok { color:#6ee7b7; border-left-color:#059669; }',
'  .ws { color:#c084fc; }',
'  .mcp { color:#fbbf24; }',
'  .add { color:#6ee7b7; }',
'  .del { color:#fca5a5; }',
'  .meta-line { color:#94a3b8; }',
'  .live-note { color:#475569; font-style:italic; }',
'  .block { border-left:2px solid #334155; margin:3px 0 3px 2px; padding-left:6px; }',
'  .block-head { display:flex; align-items:center; gap:8px; }',
'  .tag { font-size:11px; padding:0 6px; border-radius:6px; border:1px solid var(--line); color:#7dd3fc; background:#0c4a6e22; }',
'  .tag.mcp { color:#fbbf24; background:#78350f22; border-color:#78350f; }',
'  .tag.ws { color:#c084fc; background:#4c1d9522; border-color:#4c1d95; }',
'  .toggle { cursor:pointer; user-select:none; font-size:11px; color:#94a3b8; border:1px solid var(--line); border-radius:6px; padding:0 6px; }',
'  .toggle:hover { background:#1a2230; color:#cbd5e1; }',
'  .body { display:block; }',
'  .body.hidden { display:none; }',
'  .tk-c { color:#64748b; font-style:italic; }',
'  .tk-s { color:#86efac; }',
'  .tk-k { color:#c084fc; }',
'  .tk-n { color:#fbbf24; }',
'  .tk-p { color:#64748b; }',
'  footer { padding:6px 14px; border-top:1px solid var(--line); color:var(--dim); font-size:11px; background:#0f141b; }',
'</style>',
'</head>',
'<body>',
'<header>',
'  <span class="title">' + TITLE + '</span>',
'  <span class="pill" id="status"><span class="dot"></span><span id="statusText">connecting</span></span>',
'  <span class="meta" id="meta"></span>',
'  <span class="spacer"></span>',
'  <span class="btn" id="collapseAll">折叠工具输出</span>',
'  <span class="btn" id="expandAll">展开全部</span>',
'  <label><input type="checkbox" id="follow" checked> 自动滚动</label>',
'  <span class="btn" id="copy">复制全部</span>',
'</header>',
'<div id="progress"></div>',
'<div id="log"></div>',
'<footer>监听 127.0.0.1 · 数据源：远端 <code>tail -F</code> · 每次运行自动清空重来 · 工具输出超过 20 行自动折叠</footer>',
'<script>',
'(function () {',
'  var pos = 0, raw = "", pending = "", pendingEl = null;',
'  var statusEl = document.getElementById("status"), statusText = document.getElementById("statusText");',
'  var metaEl = document.getElementById("meta"), logEl = document.getElementById("log");',
'  var followEl = document.getElementById("follow"), progressEl = document.getElementById("progress");',
'  var block = null;',
'  var blocks = [];',
'',
'  function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
'',
'  var TOKEN = /(\\/\\/[^\\n]*|#![^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')|\\b(const|let|var|function|return|if|else|for|while|switch|case|break|class|new|await|async|import|export|from|try|catch|finally|throw|typeof|instanceof|this|null|undefined|true|false)\\b|\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b/g;',
'',
'  function highlight(s) {',
'    return esc(s).replace(TOKEN, function (m, c, st, kw, num) {',
'      if (c) return "<span class=tk-c>" + c + "</span>";',
'      if (st) return "<span class=tk-s>" + st + "</span>";',
'      if (kw) return "<span class=tk-k>" + kw + "</span>";',
'      if (num) return "<span class=tk-n>" + num + "</span>";',
'      return m;',
'    });',
'  }',
'',
'  function lineClass(s) {',
'    if (/^\\[live\\]/.test(s)) return "live-note";',
'    if (/^(exec|\\/bin\\/sh|\\$ )/.test(s)) return "cmd";',
'    if (/^=====/.test(s)) return "sec";',
'    if (/^(ERROR|error=|failed|spawn error)/i.test(s) || / ERROR /.test(s)) return "err";',
'    if (/^EXIT=0/.test(s)) return "ok";',
'    if (/^EXIT=/.test(s)) return "err";',
'    if (/^web search:/.test(s)) return "ws";',
'    if (/^mcp:/.test(s)) return "mcp";',
'    if (/^\\+/.test(s)) return "add";',
'    if (/^-{1}[^-]/.test(s)) return "del";',
'    if (/^(OpenAI Codex|model:|provider:|session id:|workdir:|approval:|sandbox:|reasoning)/.test(s)) return "meta-line";',
'    return "";',
'  }',
'',
'  function makeLine(s) {',
'    var d = document.createElement("div");',
'    var cls = lineClass(s);',
'    d.className = "l" + (cls ? " " + cls : "");',
'    d.innerHTML = highlight(s);',
'    return d;',
'  }',
'',
'  function isBlockStart(line) {',
'    return /^exec\\s*$/.test(line) || /^mcp:/.test(line) || /^web search:/.test(line) || /^codex\\s*$/.test(line) || /^user\\s*$/.test(line);',
'  }',
'  function blockKind(line) {',
'    if (/^exec\\s*$/.test(line)) return "exec";',
'    if (/^mcp:/.test(line)) return "mcp";',
'    if (/^web search:/.test(line)) return "ws";',
'    if (/^codex\\s*$/.test(line)) return "codex";',
'    return "user";',
'  }',
'  function headerCount(kind) { return kind === "exec" ? 3 : 1; }',
'',
'  function startBlock(line) {',
'    var kind = blockKind(line);',
'    var el = document.createElement("div");',
'    el.className = "block";',
'    var head = document.createElement("div");',
'    head.className = "block-head";',
'    var tag = document.createElement("span");',
'    tag.className = "tag" + (kind === "mcp" ? " mcp" : (kind === "ws" ? " ws" : ""));',
'    tag.textContent = kind;',
'    head.appendChild(tag);',
'    el.appendChild(head);',
'    logEl.appendChild(el);',
'    block = { kind: kind, el: el, head: head, lines: [], body: null, collapsed: false, toggle: null };',
'    blocks.push(block);',
'    addToBlock(line);',
'  }',
'',
'  function addToBlock(line) {',
'    var d = makeLine(line);',
'    block.lines.push(d);',
'    if (block.collapsed && block.body) block.body.appendChild(d);',
'    else block.el.appendChild(d);',
'    maybeAutoCollapse();',
'  }',
'',
'  function maybeAutoCollapse() {',
'    if (!block || block.collapsed) return;',
'    var hc = headerCount(block.kind);',
'    if (block.lines.length > hc + 20) collapseBlock(block);',
'  }',
'',
'  function collapseBlock(b) {',
'    if (b.collapsed) return;',
'    var hc = headerCount(b.kind);',
'    b.body = document.createElement("div");',
'    b.body.className = "body hidden";',
'    for (var i = hc; i < b.lines.length; i++) b.body.appendChild(b.lines[i]);',
'    b.el.appendChild(b.body);',
'    b.collapsed = true;',
'    b.toggle = document.createElement("span");',
'    b.toggle.className = "toggle";',
'    b.toggle.textContent = "▸ 展开 " + Math.max(0, b.lines.length - hc) + " 行";',
'    b.toggle.addEventListener("click", function () {',
'      var hidden = b.body.classList.toggle("hidden");',
'      b.toggle.textContent = hidden ? "▸ 展开 " + Math.max(0, b.lines.length - headerCount(b.kind)) + " 行" : "▾ 收起";',
'    });',
'    b.head.appendChild(b.toggle);',
'  }',
'',
'  function expandBlock(b) {',
'    if (!b.collapsed || !b.body) return;',
'    b.body.classList.remove("hidden");',
'    if (b.toggle) b.toggle.textContent = "▾ 收起";',
'  }',
'',
'  function endBlock() {',
'    if (!block) return;',
'    maybeAutoCollapse();',
'    if (block.collapsed && block.toggle) {',
'      block.toggle.textContent = "▸ 展开 " + Math.max(0, block.lines.length - headerCount(block.kind)) + " 行";',
'    }',
'    block = null;',
'  }',
'',
'  function appendLine(line) {',
'    if (isBlockStart(line)) { endBlock(); startBlock(line); return; }',
'    if (block) addToBlock(line);',
'    else logEl.appendChild(makeLine(line));',
'  }',
'',
'  function appendChunk(chunk) {',
'    raw += chunk;',
'    var text = pending + chunk;',
'    var parts = text.split("\\n");',
'    pending = parts.pop();',
'    for (var i = 0; i < parts.length; i++) appendLine(parts[i]);',
'    if (pendingEl) { pendingEl.remove(); pendingEl = null; }',
'    if (pending) {',
'      pendingEl = makeLine(pending);',
'      if (block && block.collapsed && block.body) block.body.appendChild(pendingEl);',
'      else if (block) block.el.appendChild(pendingEl);',
'      else logEl.appendChild(pendingEl);',
'    }',
'  }',
'',
'  function resetView() {',
'    raw = ""; pending = ""; pendingEl = null; block = null; blocks = [];',
'    logEl.innerHTML = "";',
'  }',
'',
'  function setStatus(s) {',
'    statusEl.className = "pill " + s;',
'    statusText.textContent = s === "streaming" ? "streaming" : (s === "done" ? "done" : "error");',
'  }',
'  function nearBottom() { return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 140); }',
'',
'  async function tick() {',
'    try {',
'      var r = await fetch("/data?pos=" + pos, { cache: "no-store" });',
'      var j = await r.json();',
'      if (j.reset) resetView();',
'      if (j.chunk) {',
'        var stick = followEl.checked && nearBottom();',
'        appendChunk(j.chunk);',
'        pos = j.pos;',
'        if (stick) window.scrollTo(0, document.body.scrollHeight);',
'      } else { pos = j.pos; }',
'      var pct = j.bytes ? Math.min(100, Math.round((j.bytes / (1024 * 1024)) * 100)) : 0;',
'      progressEl.style.width = pct + "%";',
'      metaEl.textContent = (j.bytes >= 1024 ? (j.bytes / 1024).toFixed(1) + " KB" : j.bytes + " B") + " · " + (j.info || "");',
'      setStatus(j.done ? "done" : "streaming");',
'      setTimeout(tick, j.done ? 1200 : 600);',
'    } catch (e) {',
'      setStatus("error");',
'      metaEl.textContent = String(e);',
'      setTimeout(tick, 1500);',
'    }',
'  }',
'',
'  document.getElementById("collapseAll").addEventListener("click", function () {',
'    for (var i = 0; i < blocks.length; i++) if (!blocks[i].collapsed) collapseBlock(blocks[i]);',
'  });',
'  document.getElementById("expandAll").addEventListener("click", function () {',
'    for (var i = 0; i < blocks.length; i++) expandBlock(blocks[i]);',
'  });',
'  document.getElementById("copy").addEventListener("click", function () {',
'    navigator.clipboard.writeText(raw).then(function () {',
'      var b = document.getElementById("copy"); b.textContent = "已复制 ✓";',
'      setTimeout(function () { b.textContent = "复制全部"; }, 1200);',
'    }).catch(function () {});',
'  });',
'',
'  tick();',
'})();',
'</script>',
'</body>',
'</html>'
].join('\n');

const server = http.createServer((req, res) => {
  res.on('error', () => {});
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/data') {
    let pos = parseInt(u.searchParams.get('pos') || '0', 10);
    if (isNaN(pos)) pos = 0;
    let reset = false;
    if (pos > buf.length) { reset = true; pos = 0; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ pos: buf.length, chunk: buf.slice(pos), done: done, bytes: buf.length, reset: reset, info: sshInfo }));
    return;
  }
  if (u.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ done: done, bytes: buf.length, info: sshInfo }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});
server.on('clientError', (err, socket) => { try { socket.destroy(); } catch (_) {} });
server.listen(PORT, '127.0.0.1', () => {
  console.log('LISTENING http://127.0.0.1:' + PORT + '/');
});
