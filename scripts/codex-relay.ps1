param(
    [Parameter(Mandatory = $true)][string]$QuestionFile,
    [switch]$NewSession,
    [string]$RemoteCwd
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_common.ps1')

$question = [System.IO.File]::ReadAllText($QuestionFile, [System.Text.Encoding]::UTF8)
if (-not $question.Trim()) { Write-Output "ERROR: 问题文件为空"; exit 1 }

$qb = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($question))
$mode = if ($NewSession) { '0' } else { '1' }
$r = $Cfg.remote

$workdir = [string]$r.workdir
if ($RemoteCwd) { $workdir = $RemoteCwd }

$remote = @'
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd @WORKDIR@
printf '%s' '@QB64@' | base64 -d > /tmp/codex_relay_question.txt
printf '%s\n' '@RMODE@' > /tmp/codex_relay_mode.txt
R=/tmp/codex_relay_out.txt
: > $R
rm -f /tmp/codex_relay_ans.txt
RESUME=$(cat /tmp/codex_relay_mode.txt 2>/dev/null)
if [ "$RESUME" = "1" ] && [ -s @SESSION@ ]; then
  @CODEXBIN@ exec resume "$(cat @SESSION@)" --skip-git-repo-check --output-last-message /tmp/codex_relay_ans.txt "$(cat /tmp/codex_relay_question.txt)" </dev/null > /tmp/codex_relay_full.txt 2>&1
else
  @CODEXBIN@ exec --skip-git-repo-check --output-last-message /tmp/codex_relay_ans.txt "$(cat /tmp/codex_relay_question.txt)" </dev/null > /tmp/codex_relay_full.txt 2>&1
fi
echo "EXIT=$?" >> $R
cat /tmp/codex_relay_full.txt >> $R
echo "" >> $R
echo "===== FINAL_MESSAGE =====" >> $R
cat /tmp/codex_relay_ans.txt >> $R 2>/dev/null
echo "" >> $R
grep -o "session id: [0-9a-f-]*" /tmp/codex_relay_full.txt | tail -1 | awk '{print $3}' > @SESSION@
base64 -w0 $R
'@

$remote = $remote.Replace('@QB64@', $qb).
    Replace('@RMODE@', $mode).
    Replace('@WORKDIR@', $workdir).
    Replace('@SESSION@', [string]$r.sessionFile).
    Replace('@CODEXBIN@', [string]$Cfg.codex.binPath)

Invoke-RemoteScript -Text $remote -AsBase64 | Write-Output
