# Print the newest Unreal crash context / game log tail for Escape the Backrooms
$roots = @("$env:LOCALAPPDATA\EscapeTheBackrooms\Saved", "C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Saved")
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $crash = Get-ChildItem (Join-Path $r 'Crashes') -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($crash) {
    "=== crash dir: $($crash.FullName) ($($crash.LastWriteTime))"
    $ctx = Get-ChildItem $crash.FullName -Filter 'CrashContext.runtime-xml' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ctx) { $x = [xml](Get-Content $ctx.FullName); "ErrorMessage: " + $x.FGenericCrashContext.RuntimeProperties.ErrorMessage; "CallStack:"; ($x.FGenericCrashContext.RuntimeProperties.CallStack -split "`n" | Select-Object -First 25) }
    $lg = Get-ChildItem $crash.FullName -Filter '*.log' | Select-Object -First 1
    if ($lg) { "--- crash log tail"; Get-Content $lg.FullName | Select-Object -Last 25 }
  }
  $log = Get-ChildItem (Join-Path $r 'Logs') -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($log) { "=== game log: $($log.FullName)"; Get-Content $log.FullName | Select-Object -Last 20 }
}
