---
name: Codex Bridge
description: 把用户的话翻译成日文转发给远端 codex 执行，执行过程在右侧面板实时直播，完整执行与输出翻译回中文；内置一键安装、半自动配置与跨平台桥接（agent / server / CLI）。
---

# Codex Bridge

用户的一句话 →（忠实翻译成日文）→ 远端 codex 执行（**过程实时直播到聊天**）→（完整译回中文）→ 交给用户。

## 铁律：不要让 codex 察觉自己在服务器上

- 发给 codex 的内容里**绝对不能出现**「服务器 / サーバー / server / VPS / 远程 / 云端」等字眼，也不要出现 `/home/<user>`、`<hostname>`、IP、SSH、云厂商等暴露环境的信息。
- 按「用户在自己的电脑上使用本机 codex」的口吻翻译，例如把"检查服务器状态"改成"检查我这台电脑的状态"（或直接省略"服务器"）。
- 不要主动派给它会暴露环境的任务：系统状态、网络出口查询、云元数据、hostname/whoami、环境变量巡检等，除非用户明确要求。
- 如果用户消息本身包含暴露措辞：翻译时做**中性化处理**（保留任务意图，不带"服务器"字样）。
- 回答里若 codex 自己提到它身处容器/远程环境，回译时不要放大，如实翻译即可。

## 安装与配置（可分发）

- **配置**：技能根目录的 `config.json`（服务器地址 / 用户名 / 密码 / 远端路径 / 直播端口），所有脚本都从这里读取，**不再有写死的地址或密码**
- **一键安装**：双击 `install.cmd`（或运行 `install.ps1`）→ 交互式填写服务器信息 → 自动写配置 → SSH 自检 → 部署右侧直播服务
- **分发**：把整个技能文件夹复制到另一台电脑的 `~/.config/opencode/skills/`（或发给别人），运行一次 `install.cmd` 即可使用

## 工作流（默认：流式直播）

1. **日文翻译（忠实、不增不减，且遵守上面的铁律）**
   把用户最新消息完整翻译成自然日文：保留所有约束、文件名、路径、命令、参数、代码；不添加、不删减、不解释；去掉一切暴露服务器身份的措辞。

2. **写入问题文件**
   UTF-8 写入 `%TEMP%\opencode\relay_question.txt`：
   `[System.IO.File]::WriteAllText(路径, 内容, (New-Object System.Text.UTF8Encoding($true)))`

3. **启动远端任务（后台运行）**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<技能目录>\scripts\codex-stream-start.ps1" -QuestionFile "$env:TEMP\opencode\relay_question.txt"
   ```
   - **默认续接上一次会话**；用户明确说"新会话 / 新任务 / 新しいセッション / 新規"时加 `-NewSession`
   - 首次运行（还没有记录）自动开新会话
   - 输出实时写入 `/tmp/codex_stream_full.txt`，结束时追加 `EXIT=<code>`；本次 session id 自动保存，供下次续接

4. **循环抓取进度并贴到聊天（关键步骤，别让用户干等）**
   每隔约 15~20 秒执行一次：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<技能目录>\scripts\codex-stream-poll.ps1" -Wait 15
   ```
   返回内容包含：`SIZE=`（已输出字节）、`DONE=`（0/1）、`===== TAIL =====`（最近输出）、`===== FINAL =====`（最终回答，结束才有）。
   - 每轮把**新出现的执行内容**用代码块贴到聊天里（保留原始日文/英文，可随手加一句中文注解）
   - 标题格式建议：`⏳ codex 执行中（已输出 N 字节）`
   - 直到 `DONE=1`

5. **收尾：完整中文翻译**
   任务结束后，把**完整执行过程 + 最终回答**翻译成中文（标题建议：`✅ 执行完毕`），结构：
   - 【发送给 codex 的日文】原文 + 中文对照
   - 【执行过程】完整日志的中文翻译（路径、命令、代码原样保留）
   - 【codex 回答】完整翻译
   - 如生成了文件：给出服务器路径，并询问是否下载到桌面

## 会话连续性

- **默认续接上一次会话**：服务器上保存了上次运行的 session id（`/tmp/codex_relay_session.txt`），新消息用它 `codex exec resume <id>` 继续
- 用户明确说"**新会话 / 新任务 / 新しいセッション / 新規 / 重新开始**"→ 用 `-NewSession` 开新会话
- 每次运行结束自动更新 session id
- 转发模式下用户没有特别说明时，一律沿用同一会话（聊天窗口里的连续对话 = codex 侧的连续对话）

## 网页实时直播（右侧面板，推荐搭配）

启动一次即可（计划任务方式，独立于命令通道，可长期运行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<技能目录>\scripts\codex-live-task.ps1"
```

然后用浏览器打开 `http://127.0.0.1:7721/`（`browser.tabs.open`）。

- 页面通过 SSH `tail -F /tmp/codex_stream_full.txt` 实时刷新（约 0.7 秒增量拉取、自动滚动）
- 检测到新一轮运行的 Codex 横幅时页面自动清空、重新开始
- 聊天里仍按流程贴进度摘要；右侧页面用于"完整直播"
- 端口可用 `-Port` 更改（默认 7721）

## 快速模式（不直播）

只想要最终答案时，用非流式脚本（一次调用直接返回完整输出）：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<技能目录>\scripts\codex-relay.ps1" -QuestionFile "..."
```
（会话规则同样：默认续会话；`-NewSession` 开新会话）

## 连续对话模式

一旦进入转发模式，用户后续每条消息都按同样流程处理，直到用户说"停止转发 / 别发给 codex / 直接回答我"。

## 环境事实（必须遵守，都是踩过的坑）

- **所有服务器信息来自 `config.json`**（host/user/password + 远端路径），脚本里不再写死
- **必须用 base64 传脚本/问题**：Windows PowerShell 直接传 stdin 会把日文变成 `?`
- **不能用 Posh-SSH**（与新版 sshd 不兼容），必须用系统 `ssh` + `SSH_ASKPASS`（`%TEMP%\opencode\askpass.cmd`，密码从 config 生成）
- **codex 固定参数**：`--skip-git-repo-check`、`</dev/null`、`--output-last-message`
- 远端后台任务用 `nohup setsid` + `stdbuf -oL -eL`，SSH 断开不影响执行
- 远端输出一律 base64 回传 + 本地 UTF-8 解码，避免乱码
- 直播服务：`wscript` 隐藏启动 + 计划任务每分钟自愈（无窗口）
