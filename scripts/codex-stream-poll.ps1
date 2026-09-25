param(
    [int]$Wait = 0,
    [int]$TailBytes = 6000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '_common.ps1')

if ($Wait -gt 0) { Start-Sleep -Seconds $Wait }

$r = $Cfg.remote

$remote = @'
R=/tmp/codex_stream_poll.txt
: > $R
if [ ! -f @LOG@ ]; then
  echo "NOT_STARTED" >> $R
else
  SIZE=$(wc -c < @LOG@)
  DONE=$(grep -c '^EXIT=' @LOG@)
  echo "SIZE=$SIZE" >> $R
  echo "DONE=$DONE" >> $R
  echo "===== TAIL =====" >> $R
  tail -c @TAIL@ @LOG@ >> $R
  echo "" >> $R
  echo "===== FINAL =====" >> $R
  cat @ANS@ 2>/dev/null >> $R
  echo "" >> $R
fi
echo "===== END =====" >> $R
base64 -w0 $R
'@

$remote = $remote.Replace('@LOG@', [string]$r.streamLog).
    Replace('@ANS@', [string]$r.streamAnswer).
    Replace('@TAIL@', [string]$TailBytes)

$text = Invoke-RemoteScript -Text $remote -AsBase64

# 去掉 ANSI 控制序列
$esc = [char]27
$text = [regex]::Replace($text, [regex]::Escape($esc) + '\[[0-9;?]*[a-zA-Z]', '')
$text = [regex]::Replace($text, [regex]::Escape($esc) + '\][^\x07\x1b]*(?:\x07|\x1b\\)', '')
$text = $text -replace "`r", ""

Write-Output $text
