# Bridge 客户端守卫：维持到服务器的 SSH 本地转发（127.0.0.1:9443 -> 服务器 127.0.0.1:9443）
# 由计划任务每分钟调用；已在线则立即退出（防止重复）。
$ErrorActionPreference = 'Continue'

$root = Split-Path $PSScriptRoot -Parent
$cfg = Get-Content (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# 已在监听则退出
$online = $false
try {
    $t = New-Object System.Net.Sockets.TcpClient
    $t.Connect('127.0.0.1', 9443)
    $t.Close()
    $online = $true
} catch { }
if ($online) { exit 0 }

# prepare askpass（密码来自技能配置）
$ap = Join-Path $env:TEMP 'opencode\askpass.cmd'
New-Item -ItemType Directory -Force -Path (Split-Path $ap -Parent) | Out-Null
Set-Content -Path $ap -Value "@echo off`r`necho $($cfg.server.password)" -Encoding Ascii

$env:SSH_ASKPASS = $ap
$env:SSH_ASKPASS_REQUIRE = 'force'

$log = Join-Path $env:TEMP 'opencode\bridge-ssh-forward.log'
$sshArgs = @(
    '-N',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL',
    '-o', 'PreferredAuthentications=password',
    '-o', 'PubkeyAuthentication=no',
    '-o', 'LogLevel=ERROR',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-L', '9443:127.0.0.1:9443',
    ("$($cfg.server.user)@$($cfg.server.host)")
)

# 前台等待（任务因此保持 Running，下一分钟不会重复拉起；断开后由任务自愈）
Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -WindowStyle Hidden -Wait `
    -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
