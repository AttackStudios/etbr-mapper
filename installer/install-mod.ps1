# Installs UE4SS (ETB community build) + the ETBR Loader mod into Escape the Backrooms.
#   powershell -ExecutionPolicy Bypass -File install-mod.ps1 -Payload <dir with UE4SS_*.zip + ETBRLoader\> [-GameDir <EscapeTheBackrooms>]
param([Parameter(Mandatory)][string]$Payload, [string]$GameDir = '', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

function Find-Game {
  $libs = @()
  foreach ($root in @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam")) {
    $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += $root; (Get-Content $vdf -Raw | Select-String '"path"\s+"([^"]+)"' -AllMatches).Matches | ForEach-Object { $libs += $_.Groups[1].Value -replace '\\\\', '\' } }
  }
  try { $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath; if ($sp) { $libs += ($sp -replace '/', '\') } } catch {}
  foreach ($l in ($libs | Select-Object -Unique)) {
    $d = Join-Path $l 'steamapps\common\EscapeTheBackrooms'
    if (Test-Path (Join-Path $d 'EscapeTheBackrooms\Binaries\Win64\Backrooms-Win64-Shipping.exe')) { return $d }
  }
  return $null
}

if (-not $GameDir) { $GameDir = Find-Game }
if (-not $GameDir -or -not (Test-Path $GameDir)) { throw 'Escape the Backrooms was not found. Install it on Steam first.' }
$win64 = Join-Path $GameDir 'EscapeTheBackrooms\Binaries\Win64'
$mods = Join-Path $win64 'ue4ss\Mods'
Write-Output "Game: $GameDir"

if (Get-Process -Name 'Backrooms-Win64-Shipping' -ErrorAction SilentlyContinue) { throw 'Close Escape the Backrooms first, then run the installer again.' }

if ($Uninstall) {
  Remove-Item -Recurse -Force (Join-Path $mods 'ETBRLoader') -ErrorAction SilentlyContinue
  $mt = Join-Path $mods 'mods.txt'
  if (Test-Path $mt) { (Get-Content $mt) | Where-Object { $_ -notmatch '^\s*ETBRLoader\s*:' } | Set-Content $mt -Encoding ascii }
  Write-Output 'Removed the ETBR Loader (UE4SS left in place for your other mods).'
  exit 0
}

# 1) UE4SS — only if missing, so other people's UE4SS mods/settings are kept
if (-not (Test-Path (Join-Path $win64 'ue4ss\UE4SS.dll'))) {
  $zip = Get-ChildItem $Payload -Filter 'UE4SS_*.zip' | Select-Object -First 1
  if (-not $zip) { throw 'UE4SS zip missing from installer payload' }
  Expand-Archive -Path $zip.FullName -DestinationPath $win64 -Force
  Write-Output "Installed UE4SS ($($zip.Name))"
} else { Write-Output 'UE4SS already installed — keeping it' }

# 2) the loader mod (maps/ and live.json are preserved on update)
$dst = Join-Path $mods 'ETBRLoader'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'Scripts'), (Join-Path $dst 'maps'), (Join-Path $dst 'io'), (Join-Path $dst 'cache') | Out-Null
Copy-Item -Force (Join-Path $Payload 'ETBRLoader\Scripts\*') (Join-Path $dst 'Scripts')
Get-ChildItem (Join-Path $Payload 'ETBRLoader') -File | ForEach-Object { Copy-Item -Force $_.FullName $dst }  # fontatlas.png etc.
Write-Output "Installed ETBR Loader to $dst"

# 3) enable it in mods.txt (above the built-in Keybinds line)
$mt = Join-Path $mods 'mods.txt'
$lines = @(); if (Test-Path $mt) { $lines = @(Get-Content $mt) }
$lines = $lines | Where-Object { $_ -notmatch '^\s*ETBRLoader\s*:' }
$idx = [Array]::FindIndex([string[]]$lines, [Predicate[string]]{ param($l) $l -match '^\s*;\s*Built-in keybinds' })
if ($idx -lt 0) { $lines += 'ETBRLoader : 1' } else { $lines = @($lines[0..($idx - 1)]) + 'ETBRLoader : 1' + @($lines[$idx..($lines.Count - 1)]) }
Set-Content -Path $mt -Value $lines -Encoding ascii
Write-Output 'Enabled ETBRLoader in mods.txt'
Write-Output 'DONE'
