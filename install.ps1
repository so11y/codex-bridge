param(
    [string]$ServerHost,
    [string]$ServerUser,
    [string]$ServerPassword,
    [switch]$SkipLiveSetup
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
$cfgPath = Join-Path $root 'config.json'

function Read-WithDefault([string]$Label, [string]$Default) {
    if ($Default) {
        $t = Read-Host ("$Label [" + $Default + "]")
        if ($t) { return $t }
        return $Default
    }
    return (Read-Host $Label)
}

Write-Host "=== codex-jp-relay 安装 ===" -ForegroundColor Cyan
Write-Host "（直接回车使用默认值）"
Write-Host ""

# 读取现有配置作为默认值
$cfg = $null
if (Test-Path $cfgPath) {
    try { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $cfg = $null }
}

$dHost = if ($cfg) { $cfg.server.host } else { '' }
$dUser = if ($cfg) { $cfg.server.user } else { '' }
$dPass = if ($cfg) { $cfg.server.password } else { '' }

if (-not $ServerHost) { $ServerHost = Read-WithDefault '服务器地址（IP 或域名）' $dHost }
if (-not $ServerUser) { $ServerUser = Read-WithDefault 'SSH 用户名' $dUser }
if (-not $ServerPassword) { $ServerPassword = Read-WithDefault 'SSH 密码' $dPass }

if (-not $ServerHost -or -not $ServerUser -or -not $ServerPassword) {
    Write-Host "错误：服务器地址 / 用户名 / 密码都不能为空" -ForegroundColor Red
    exit 1
}

# 构造（或更新）配置
if (-not $cfg) {
    $cfg = [pscustomobject]@{
        server = [pscustomobject]@{ host = ''; user = ''; password = '' }
        remote = [pscustomobject]@{
            workdir      = '/home/' + $ServerUser
            streamLog    = '/tmp/codex_stream_full.txt'
            streamAnswer = '/tmp/codex_stream_ans.txt'
            sessionFile  = '/tmp/codex_relay_session.txt'
        }
        codex  = [pscustomobject]@{ binPath = '/home/' + $ServerUser + '/.local/node/bin/codex' }
        live   = [pscustomobject]@{ port = 7721 }
    }
}
$cfg.server.host = $ServerHost
$cfg.server.user = $ServerUser
$cfg.server.password = $ServerPassword

$json = $cfg | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding($true)))
Write-Host ("配置已写入: " + $cfgPath) -ForegroundColor Green

# SSH 自检
Write-Host ""
Write-Host "正在做 SSH 自检 ..."
. (Join-Path $root 'scripts\_common.ps1')
$test = Invoke-RemoteScript -Text 'echo INSTALL_OK; date "+%Y-%m-%dT%H:%M:%S%z"; test -x ' + [string]$cfg.codex.binPath + ' && echo CODEX_OK || echo CODEX_MISSING'
Write-Host $test

if ($test -notmatch 'INSTALL_OK') {
    Write-Host "SSH 自检失败，请检查地址/账号/密码与服务器可达性。" -ForegroundColor Red
    exit 1
}

# 直播服务（隐藏 + 自愈）
if (-not $SkipLiveSetup) {
    Write-Host ""
    Write-Host "正在部署右侧直播服务 ..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\codex-live-task.ps1')
}

Write-Host ""
Write-Host "安装完成 ✓" -ForegroundColor Green
Write-Host "用法：在 opencode 里 @codex-jp-relay 加上你的指令即可（默认续上次会话，说「新会话」则新开）。"
Write-Host "右侧直播：安装脚本输出的 URL（默认 http://127.0.0.1:7721/）"
