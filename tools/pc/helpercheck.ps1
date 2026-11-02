# Is exactly one helper running, and is anything else being spawned by the game?
$h = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*etbr-helper*' })
"helper processes: $($h.Count)"
$game = Get-Process -Name 'Backrooms-Win64-Shipping' -ErrorAction SilentlyContinue
if ($game) {
  $kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($game.Id)")
  "children of the game: " + (($kids | ForEach-Object { $_.Name }) -join ', ')
}
$mod = 'C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods\ETBRLoader'
"io: " + ((Get-ChildItem (Join-Path $mod 'io') -Name) -join ', ')
"cache: " + ((Get-ChildItem (Join-Path $mod 'cache') -Name) -join ', ')
