# 公共库：读取技能配置、生成 askpass、远程执行（被 scripts/*.ps1 引用）
# 注意：不要在这里设置 $ErrorActionPreference（点源会传染给调用者）

$script:SkillRoot = Split-Path -Parent $PSScriptRoot
$script:CfgPath = Join-Path $script:SkillRoot 'config.json'
if (-not (Test-Path $script:CfgPath)) {
    throw "缺少配置文件：$script:CfgPath（运行 install.cmd 生成，或复制 config.example.json 后修改）"
}
$script:Cfg = (Get-Content $script:CfgPath -Raw -Encoding UTF8 | ConvertFrom-Json)

function Get-SkillConfig { return $script:Cfg }

function Ensure-Askpass {
    $ap = Join-Path $env:TEMP 'opencode\askpass.cmd'
    New-Item -ItemType Directory -Force -Path (Split-Path $ap -Parent) | Out-Null
    $pw = [string]$script:Cfg.server.password
    Set-Content -Path $ap -Value "@echo off`r`necho $pw" -Encoding Ascii
    return $ap
}

function Invoke-RemoteScript {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [switch]$AsBase64
    )
    $ap = Ensure-Askpass
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
    $cmd = "echo '$payload' | base64 -d | sh"

    $target = "$($script:Cfg.server.user)@$($script:Cfg.server.host)"
    $sshArgs = @(
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=NUL',
        '-o', 'PreferredAuthentications=password',
        '-o', 'PubkeyAuthentication=no',
        '-o', 'LogLevel=ERROR',
        '-o', 'ConnectTimeout=20',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=120'
    )

    $env:SSH_ASKPASS = $ap
    $env:SSH_ASKPASS_REQUIRE = 'force'
    $out = ssh @sshArgs $target $cmd 2>$null
    $sshExit = $LASTEXITCODE
    Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
    Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue

    $result = ($out | Out-String).Trim()
    if ($AsBase64) {
        if (-not $result) { return "ERROR: 远端无输出（SSH exit=$sshExit）" }
        try { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($result)) }
        catch { return "ERROR: base64 解码失败`n$result" }
    }
    return $result
}
