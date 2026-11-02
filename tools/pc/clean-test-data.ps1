# Remove my automated-test leftovers from Jack's editor + game install (his own levels are untouched).
$user = 'C:\Users\JackPC\AppData\Roaming\ETBR Mapper'
$s = Join-Path $user 'settings.json'
if (Test-Path $s) { $j = Get-Content $s -Raw | ConvertFrom-Json; $j.PSObject.Properties.Remove('lastRoom'); $j | ConvertTo-Json -Depth 5 | Set-Content $s -Encoding UTF8; 'settings: lastRoom removed' }
Get-ChildItem (Join-Path $user 'custom') -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { "removed test asset $($_.Name)"; Remove-Item $_.FullName -Force }
$mod = 'C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods\ETBRLoader'
Remove-Item (Join-Path $mod 'live.json') -Force -ErrorAction SilentlyContinue
foreach ($m in 'ETBRHere', 'ETBRCustom', 'NavTest', 'MockTest') { Remove-Item (Join-Path $mod "maps\$m.etbrmap") -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $mod 'cache\*') -Force -ErrorAction SilentlyContinue
'game: stale live link + cache removed'
