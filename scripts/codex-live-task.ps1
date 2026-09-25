param(
    [int]$Port = 0
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_common.ps1')

if ($Port -le 0) { $Port = [int]$Cfg.live.port }

# 1. 停掉旧的直播服务
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*codex-live-server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot 'codex-live-server.js'
$taskName = 'CodexLiveServer'

# 2. 守卫脚本（隐藏运行）：端口在监听就退出，否则前台跑 node（日志落盘）
$guard = Join-Path $PSScriptRoot 'codex-live.cmd'
$guardLines = @(
    '@echo off',
    "netstat -ano | findstr /C:`":$Port`" | findstr /C:`"LISTENING`" >nul 2>&1",
    'if not errorlevel 1 exit /b 0',
    ('"' + $node + '" "' + $script + '" --port ' + $Port +
        ' --host ' + $Cfg.server.host +
        ' --user ' + $Cfg.server.user +
        ' --password ' + $Cfg.server.password +
        ' --file ' + $Cfg.remote.streamLog +
        ' --title codex-live >> "%TEMP%\opencode\codex-live.node.log" 2>&1')
)
Set-Content -Path $guard -Value $guardLines -Encoding Ascii

# 3. VBS 隐藏启动器（窗口样式 0 = 完全隐藏）
$vbs = Join-Path $PSScriptRoot 'codex-live-launch.vbs'
$vbsLines = @(
    'Set sh = CreateObject("WScript.Shell")',
    ('sh.Run "cmd /c ' + $guard + '", 0, False')
)
Set-Content -Path $vbs -Value $vbsLines -Encoding Ascii

# 4. 任务：每分钟自愈检查（隐藏启动，无窗口）
$tmpCmd = Join-Path $env:TEMP 'opencode\live-task.cmd'
New-Item -ItemType Directory -Force -Path (Split-Path $tmpCmd -Parent) | Out-Null
$cmdLines = @(
    '@echo off',
    "schtasks /Delete /TN $taskName /F >nul 2>&1",
    "schtasks /Create /TN $taskName /SC ONCE /ST 00:00 /RI 1 /DU 9999:59 /F /TR `"wscript.exe //B //Nologo $vbs`"",
    "schtasks /Run /TN $taskName"
)
Set-Content -Path $tmpCmd -Value $cmdLines -Encoding Ascii

$taskOut = & cmd /c $tmpCmd 2>&1
"---- schtasks 输出 ----"
$taskOut | Out-String | Write-Output

# 5. 等就绪
& node --check $script
if ($LASTEXITCODE -ne 0) { "ERROR: 服务脚本语法错误"; exit 1 }

$url = "http://127.0.0.1:$Port/"
$ok = $false
for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri "${url}status" -TimeoutSec 3 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}

"TASK=$taskName"
"URL=$url"
"OK=$ok"
