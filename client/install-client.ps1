param(
    [string]$Token,
    [string]$ClientId = '',
    [switch]$ViaSshForward
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path $PSScriptRoot -Parent
$cfgPath = Join-Path $root 'config.json'
if (-not (Test-Path $cfgPath)) { throw "缺少 $cfgPath（先跑 install.cmd）" }
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $ClientId) { $ClientId = $env:COMPUTERNAME.ToLower() }
if (-not $Token) {
    $tokenFile = Join-Path $env:TEMP 'opencode\bridge-token.txt'
    if (Test-Path $tokenFile) { $Token = (Get-Content $tokenFile -Raw).Trim() }
}
if (-not $Token) { throw "缺少 bridge token（用 -Token 传入，或放到 %TEMP%\opencode\bridge-token.txt）" }

$agentDir = Join-Path $root 'bridge\agent'
$caPath = Join-Path $agentDir 'bridge-ca.pem'

# 1. 取服务器自签证书作为 CA（经 SSH）
if (-not (Test-Path $caPath)) {
    Write-Host "正在从服务器获取 bridge 证书 ..."
    . (Join-Path $root 'scripts\_common.ps1')
    $caB64 = Invoke-RemoteScript -Text 'base64 -w0 ~/bridge/cert.pem'
    if ($caB64 -notmatch 'BEGIN CERTIFICATE') { throw "获取证书失败：$caB64" }
    [System.IO.File]::WriteAllText($caPath, $caB64, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "证书已保存: $caPath"
}

# 2. 写 agent 配置
if ($ViaSshForward) {
    $serverHost = '127.0.0.1'
} else {
    $serverHost = [string]$cfg.server.host
}
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
Write-Host "agent 配置已写入（$serverHost:9443, TLS）"

# 3. 生成 guard 的 VBS 隐藏启动器
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

# 4. 创建/更新自愈任务（wscript 触发，隐藏、无窗口）
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
    $out = & cmd /c $tmpCmd 2>&1
    Write-Host ("---- {0} ----" -f $p.Task)
    $out | Where-Object { $_ -match '成功|SUCCESS|ERROR|错误' } | ForEach-Object { "  $_" }
}

# 5. 自检
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
Write-Host "完成。服务器侧验证： bridge-cli status / exec -- echo ok" -ForegroundColor Green
