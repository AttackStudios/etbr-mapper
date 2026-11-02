# Remove my automated-test leftovers from Jack's editor + game install (his own levels and assets are untouched).
$user = 'C:\Users\JackPC\AppData\Roaming\ETBR Mapper'
$s = Join-Path $user 'settings.json'
if (Test-Path $s) {
  $j = (Get-Content $s -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
  $j.PSObject.Properties.Remove('lastRoom')
  # a test run replaced the display name with a generated one: put his back
  if (-not $j.name -or $j.name -like 'Builder*') { $j | Add-Member -Force NoteProperty name 'AttackStudioYT' }
  [IO.File]::WriteAllText($s, ($j | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))  # no BOM
  "settings: name=$($j.name), lastRoom cleared"
}
$mine = 'Wizard Object', 'Wizard Item', 'Box Walker', 'Test Lamp', 'Cube A', 'Cube B', 'Test Cube', 'testcube'
Get-ChildItem (Join-Path $user 'custom') -File -ErrorAction SilentlyContinue | ForEach-Object {
  $n = ''
  try { $n = (Get-Content $_.FullName -Raw | ConvertFrom-Json).name } catch {}
  if ($mine -contains $n) { "removed test asset: $n"; Remove-Item $_.FullName -Force } else { "kept asset: $n" }
}
$mod = 'C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods\ETBRLoader'
foreach ($f in 'live.json', 'devcmd.txt', 'fontatlas.png') { Remove-Item (Join-Path $mod $f) -Force -ErrorAction SilentlyContinue }
foreach ($m in 'ETBRHere', 'ETBRCustom', 'ETBRTest', 'NavTest', 'MockTest', 'Winding') { Remove-Item (Join-Path $mod "maps\$m.etbrmap") -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $mod 'cache\*') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $mod 'io\*') -Force -ErrorAction SilentlyContinue
'game: stale live link, cache and test maps removed'
