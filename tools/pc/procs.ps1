# What console-ish processes are running right now (and who started them)?
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cmd|powershell|pwsh|curl|conhost|electron|Backrooms-Win64-Shipping|ETBR Mapper)\.exe$' } |
  ForEach-Object {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue
    "{0,-28} pid={1,-6} parent={2,-28} started={3}  {4}" -f $_.Name, $_.ProcessId, $parent.Name, $_.CreationDate, ($_.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(110, ($_.CommandLine + '').Length))
  }
Get-ScheduledTask | Where-Object { $_.TaskName -like 'ETBR*' } | ForEach-Object { "task {0} state={1}" -f $_.TaskName, $_.State }
