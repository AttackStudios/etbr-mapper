# What did Setup.exe actually leave on this PC?
$dest = Join-Path $env:LOCALAPPDATA 'Programs\ETBR Mapper'
$mod = 'C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods\ETBRLoader'
"editor exe: $(Test-Path (Join-Path $dest 'ETBR Mapper.exe'))"
"desktop shortcut: $(Test-Path (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'ETBR Mapper.lnk'))"
"editor running: $(@(Get-Process 'ETBR Mapper' -ErrorAction SilentlyContinue).Count)"
foreach ($f in 'Scripts\main.lua', 'Scripts\custom.lua', 'Scripts\fontglyphs.lua', 'palette.png', 'etbr-helper.ps1') { "$f : $(Test-Path (Join-Path $mod $f))" }
"loader version: " + (Select-String -Path (Join-Path $mod 'Scripts\main.lua') -Pattern "local VERSION = '([^']+)'").Matches[0].Groups[1].Value
foreach ($f in 'main.lua', 'custom.lua') { $a = (Get-FileHash (Join-Path $mod "Scripts\$f")).Hash; $b = (Get-FileHash (Join-Path 'C:\Users\JackPC\ETBRMapper\loader\ETBRLoader\Scripts' $f)).Hash; "$f same as tested: $($a -eq $b)" }
"mods.txt: " + ((Get-Content (Split-Path $mod | Join-Path -ChildPath 'mods.txt')) -match 'ETBRLoader')
"dev files in installer payload: " + @(Get-ChildItem (Join-Path $dest 'mod\ETBRLoader') -Recurse -Include 'dev.enable', 'live.json', 'devcmd.txt' -ErrorAction SilentlyContinue).Count
"saves from today: " + @(Get-ChildItem "$env:LOCALAPPDATA\EscapeTheBackrooms\Saved\SaveGames" -Filter '*GENSAVE*.sav' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).Date }).Count
"settings: " + (Get-Content (Join-Path $env:APPDATA 'ETBR Mapper\settings.json') -Raw).Substring(0, 80).Replace("`n", ' ')
