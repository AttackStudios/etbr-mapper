# Recent application crash events for the game (Windows Error Reporting / Application Error)
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddMinutes(-20) } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'Backrooms' } | Select-Object -First 4 |
  ForEach-Object { "{0} id={1} {2}" -f $_.TimeCreated, $_.Id, (($_.Message -split "`n" | Select-Object -First 8) -join ' | ') }
