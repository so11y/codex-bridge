param(
    [string]$Token,
    [string]$ClientId = '',
    [switch]$ViaSshForward,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path $PSScriptRoot -Parent
$cfgPath = Join-Path $root 'config.json'
if (-not (Test-Path $cfgPath)) { throw "缺少 $cfgPath（先跑 install.ps1）" }
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $ClientId) { $ClientId = $env:COMPUTERNAME.ToLower() }
$tokenFile = Join-Path $env:TEMP 'opencode\bridge-token.txt'

# 1. 决定 token：参数 > 本地已保存 > 自动注册（生成 + 在服务器登记）
if (-not $Token -and (Test-Path $tokenFile) -and -not $Force) {
    $Token = (Get-Content $tokenFile -Raw).Trim()
}
if (-not $Token) {
    $Token = -join ((1..48) | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })
    Write-Host "未提供 token，正在向服务器自动注册客户端「$ClientId」..." -ForegroundColor Cyan

    # 机器指纹（主板 UUID，稳定；异常时退回 MAC，再退回随机 GUID）
    $machineId = ''
    try { $machineId = [string](Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID } catch { }
    if (-not $machineId -or $machineId -match '^0+$') {
        try {
            $machineId = (Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
                Where-Object { $_.MACAddress } | Select-Object -First 1).MACAddress
        } catch { }
    }
    if (-not $machineId) { $machineId = [guid]::NewGuid().ToString() }
    $machineId = $machineId.ToLower()

    . (Join-Path $root 'scripts\_common.ps1')
    $remote = @'
N=/home/so11y/.local/node/bin/node
C=/home/so11y/bridge/bridge-cli.js
$N $C register --id IDVAL --machine MACHVAL --token TOKVAL
'@
    $remote = $remote.Replace('IDVAL', $ClientId).Replace('MACHVAL', $machineId).Replace('TOKVAL', $Token)
    $out = Invoke-RemoteScript -Text $remote
    Write-Host ($out | Out-String)
    $assigned = ($out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Last 1)
    if (-not $assigned) { throw "自动注册失败（检查服务器 SSH / bridge-server）" }
    if ($assigned -ne $ClientId) {
        Write-Host "检测到重名，服务器分配了新 id：$assigned" -ForegroundColor Yellow
        $ClientId = $assigned
    }
    Set-Content -Path $tokenFile -Value $Token -Encoding Ascii -NoNewline
    Write-Host "已注册（客户端 id: $ClientId）" -ForegroundColor Green
}

$agentDir = Join-Path $root 'bridge\agent'
$caPath = Join-Path $agentDir 'bridge-ca.pem'

# 2. 取服务器自签证书作为 CA（经 SSH）
if ($Force -or -not (Test-Path $caPath)) {
    Write-Host "正在从服务器获取 bridge 证书 ..."
    . (Join-Path $root 'scripts\_common.ps1')
    $caB64 = Invoke-RemoteScript -Text 'base64 -w0 ~/bridge/cert.pem'
    if ($caB64 -notmatch 'BEGIN CERTIFICATE') { throw "获取证书失败：$caB64" }
    [System.IO.File]::WriteAllText($caPath, $caB64, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "证书已保存: $caPath"
}

# 3. 写 agent 配置
if ($ViaSshForward) { $serverHost = '127.0.0.1' } else { $serverHost = [string]$cfg.server.host }
$agentConfig = [pscustomobject]@{
    server      = $serverHost
    port        = 9443
    client      = $ClientId
    token       = $Token
    shell       = 'auto'
    reconnectMs = 2000
    defaultCwd  = ''
    tls         = $true
    caFile      = 'bridge-ca.pem'
    tlsServername = 'bridge'
}
[System.IO.File]::WriteAllText((Join-Path $agentDir 'agent.config.json'), ($agentConfig | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "agent 配置已写入（${serverHost}:9443, TLS）"

# 4. 生成 guard 的 VBS 隐藏启动器
$pairs = @(
    @{ Task = 'BridgeAgent'; Guard = (Join-Path $PSScriptRoot 'guard-agent.ps1'); Vbs = (Join-Path $PSScriptRoot 'launch-agent.vbs') }
)
if ($ViaSshForward) {
    $pairs += @{ Task = 'BridgeSshForward'; Guard = (Join-Path $PSScriptRoot 'guard-ssh-forward.ps1'); Vbs = (Join-Path $PSScriptRoot 'launch-ssh-forward.vbs') }
}
foreach ($p in $pairs) {
    $vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$($p.Guard)""", 0, False
"@
    [System.IO.File]::WriteAllText($p.Vbs, $vbs, [System.Text.Encoding]::ASCII)
}

# 5. 先停掉旧 agent（确保新配置生效），再创建/更新自愈任务
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

foreach ($p in $pairs) {
    $tmpCmd = Join-Path $env:TEMP ("opencode\" + $p.Task + ".cmd")
    New-Item -ItemType Directory -Force -Path (Split-Path $tmpCmd -Parent) | Out-Null
    $tr = "wscript.exe //B //Nologo $($p.Vbs)"
    Set-Content -Path $tmpCmd -Encoding Ascii -Value @(
        '@echo off',
        "schtasks /Delete /TN $($p.Task) /F >nul 2>&1",
        "schtasks /Create /TN $($p.Task) /SC ONCE /ST 00:00 /RI 1 /DU 9999:59 /F /TR `"$tr`"",
        "schtasks /Run /TN $($p.Task)"
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & cmd /c $tmpCmd 2>&1
    $ErrorActionPreference = $prevEap
    Write-Host ("---- {0} ----" -f $p.Task)
    $out | Where-Object { $_ -match '成功|SUCCESS|ERROR|错误' } | ForEach-Object { "  $_" }}

# 6. 自检
Start-Sleep -Seconds 8
$agentProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent.js*' }
Write-Host ("agent 进程: " + $(if ($agentProc) { '运行中' } else { '未运行' }))
if (-not $ViaSshForward) {
    $tlsOk = $false
    try {
        $t = New-Object System.Net.Sockets.TcpClient
        $t.Connect($serverHost, 9443)
        $t.Close()
        $tlsOk = $true
    } catch { }
    Write-Host ("直连 $serverHost`:9443 TCP: " + $(if ($tlsOk) { '可连' } else { '连不上（检查安全组）' }))
}
Write-Host ""
Write-Host "完成。服务器侧验证： node ~/bridge/bridge-cli.js status" -ForegroundColor Green
