param(
    [Parameter(Mandatory = $true)][string]$QuestionFile,
    [switch]$NewSession
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_common.ps1')

$question = [System.IO.File]::ReadAllText($QuestionFile, [System.Text.Encoding]::UTF8)
if (-not $question.Trim()) { Write-Output "ERROR: 问题文件为空"; exit 1 }

$qb = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($question))
$mode = if ($NewSession) { '0' } else { '1' }
$r = $Cfg.remote

$remote = @'
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd @WORKDIR@
printf '%s' '@QB64@' | base64 -d > /tmp/codex_stream_question.txt
printf '%s\n' '@RMODE@' > /tmp/codex_stream_mode.txt
rm -f @LOG@ @ANS@
: > @LOG@
nohup setsid sh -c 'cd @WORKDIR@; export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"; RESUME=$(cat /tmp/codex_stream_mode.txt 2>/dev/null); if [ "$RESUME" = "1" ] && [ -s @SESSION@ ]; then @CODEXBIN@ exec resume "$(cat @SESSION@)" --skip-git-repo-check --output-last-message @ANS@ "$(cat /tmp/codex_stream_question.txt)" </dev/null >> @LOG@ 2>&1; else @CODEXBIN@ exec --skip-git-repo-check --output-last-message @ANS@ "$(cat /tmp/codex_stream_question.txt)" </dev/null >> @LOG@ 2>&1; fi; echo "EXIT=$?" >> @LOG@; grep -o "session id: [0-9a-f-]*" @LOG@ | tail -1 | awk "{print \$3}" > @SESSION@' >/dev/null 2>&1 &
sleep 2
echo "STATUS=STARTED"
if [ -s @SESSION@ ]; then echo "SESSION_REMEMBERED=yes"; else echo "SESSION_REMEMBERED=no"; fi
'@

$remote = $remote.Replace('@QB64@', $qb).
    Replace('@RMODE@', $mode).
    Replace('@WORKDIR@', [string]$r.workdir).
    Replace('@LOG@', [string]$r.streamLog).
    Replace('@ANS@', [string]$r.streamAnswer).
    Replace('@SESSION@', [string]$r.sessionFile).
    Replace('@CODEXBIN@', [string]$Cfg.codex.binPath)

Invoke-RemoteScript -Text $remote | Write-Output
