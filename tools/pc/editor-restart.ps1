# Restart the dev editor: kill every electron.exe that runs from the ETBRMapper editor folder, then relaunch via the interactive task.
$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
"before: " + ($procs | ForEach-Object { "$($_.ProcessId) $($_.CreationDate)" }) -join '; '
$procs | Where-Object { $_.CommandLine -like '*ETBRMapper*' -or $_.ExecutablePath -like '*ETBRMapper*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
"left: " + (@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'").Count)
schtasks /Run /TN ETBRMapperRun | Out-Null
"relaunched"
