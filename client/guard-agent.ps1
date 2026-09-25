# Bridge 客户端守卫：维持 agent 进程（连接 127.0.0.1:9443 -> SSH 转发 -> 服务器 bridge-server）
# 由计划任务每分钟调用；agent 已在运行则立即退出（防止重复）。
$ErrorActionPreference = 'Continue'

$root = Split-Path $PSScriptRoot -Parent
$agentJs = Join-Path $root 'bridge\agent\agent.js'
$agentCfg = Join-Path $root 'bridge\agent\agent.config.json'

if (-not (Test-Path $agentJs)) { exit 1 }
if (-not (Test-Path $agentCfg)) { exit 1 }

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent.js*' }
if ($running) { exit 0 }

$env:BRIDGE_AGENT_CONFIG = $agentCfg
$log = Join-Path $env:TEMP 'opencode\bridge-agent.log'

# 前台等待（任务保持 Running；agent 自带断线重连，进程退出后由任务自愈）
Start-Process -FilePath (Get-Command node).Source -ArgumentList $agentJs -WindowStyle Hidden -Wait `
    -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
