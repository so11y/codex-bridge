# codex-bridge

一个 OpenCode 技能：把对话**翻译成日文转发给远端 codex 执行**，执行过程在**右侧面板实时直播**（语法高亮、工具输出自动折叠），再把完整结果**翻译回中文**。同时内置一个跨平台桥接（agent / server / CLI），用于把命令送到你自己的电脑上执行。

## 功能

- 默认**续接上一次会话**；说「新会话 / 新任务」才新开
- 流式直播：SSH `tail -F` + 本地网页（仅监听 `127.0.0.1`），带状态栏、进度、语法高亮、工具输出折叠、复制全部
- 直播服务用计划任务自愈（隐藏启动，无窗口），断开自动重连
- 全部服务器信息集中在 `config.json`，技能可整体分发
- 一键安装：`install.cmd`（交互式填服务器信息）

## 安装

1. 把本目录放进 OpenCode 的技能目录：
   - Windows：`%USERPROFILE%\.config\opencode\skills\codex-bridge`
   - macOS / Linux：`~/.config/opencode/skills/codex-bridge`
2. 双击 `install.cmd`（或运行 `install.ps1`），按提示填写：
   - 服务器地址（能 SSH 登录）
   - SSH 用户名 / 密码
3. 完成后在 OpenCode 里使用：`@codex-bridge <你的指令>`

### 依赖

- 本机：Windows PowerShell 5.1+；`ssh`（系统自带 OpenSSH 客户端即可）
- 服务器：一个 Linux 账号 + Node（用于运行 codex）+ codex CLI，路径写在 `config.json` 的 `codex.binPath`

## 配置

复制 `config.example.json` 为 `config.json` 并填写，或直接跑 `install.cmd` 生成。

| 字段 | 说明 |
|---|---|
| `server.host/user/password` | 服务器 SSH 信息 |
| `remote.workdir` | 远端工作目录 |
| `remote.streamLog / streamAnswer / sessionFile` | 远端日志 / 回答 / 会话文件路径 |
| `codex.binPath` | 远端 codex 可执行文件路径 |
| `live.port` | 本机直播页面端口（默认 7721） |

## 目录结构

```
codex-bridge/
├── SKILL.md               # 技能说明
├── install.cmd / install.ps1
├── config.example.json
├── scripts/               # 转发、直播、轮询
│   ├── _common.ps1
│   ├── codex-stream-start.ps1
│   ├── codex-stream-poll.ps1
│   ├── codex-relay.ps1
│   ├── codex-live-server.js
│   └── codex-live-task.ps1
└── bridge/                # 跨平台桥接（实验）
    ├── agent/agent.js     # 客户端 agent（Node，零依赖）
    └── server/            # 服务端 + CLI
```

## 安全提示

- `config.json`、`scripts/codex-live.cmd`、`scripts/codex-live-launch.vbs` 含本机/服务器信息，**已被 `.gitignore` 排除**，不要提交
- 直播页面只监听 `127.0.0.1`，不对外暴露
- 桥接（bridge）目前是 TCP + token，公网使用请自行加 TLS

## English

An OpenCode skill that relays your prompt (translated to Japanese) to a remote codex CLI over SSH, streams the execution live in a local web panel, and translates the full result back to Chinese. Includes a portable bridge (agent / server / CLI) for running commands on your own machines.

## License

MIT
