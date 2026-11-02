# Builds dist\ETBR-Mapper-Setup.exe on the PC: packages the Electron editor, the extractor, UE4SS + loader.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\JackPC\ETBRMapper'
$dist = Join-Path $root 'dist'; $stage = Join-Path $dist 'stage'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

# 0) fresh self-contained extractor
& "$env:USERPROFILE\.dotnet10\dotnet.exe" publish "$root\extractor\Extractor.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$root\extractor\pub" -v q

# 1) editor = Electron runtime + our app in resources\app
Copy-Item -Recurse "$root\editor\node_modules\electron\dist\*" $stage
Rename-Item (Join-Path $stage 'electron.exe') 'ETBR Mapper.exe'
Remove-Item (Join-Path $stage 'resources\default_app.asar') -ErrorAction SilentlyContinue
$app = Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Force "$app\node_modules" | Out-Null
foreach ($f in 'main.js', 'preload.js', 'package.json') { Copy-Item "$root\editor\$f" $app }
Copy-Item -Recurse "$root\editor\renderer" $app
Copy-Item -Recurse "$root\editor\node_modules\three" "$app\node_modules\three"
# 2) extractor (self-contained, builds the object library from the player's own game)
New-Item -ItemType Directory -Force "$stage\resources\extractor" | Out-Null
Copy-Item "$root\extractor\pub\Extractor.exe" "$stage\resources\extractor\Extractor.exe"
# 3) game mod payload
New-Item -ItemType Directory -Force "$stage\mod" | Out-Null
Copy-Item "$root\payload\UE4SS_*.zip" "$stage\mod"
Copy-Item -Recurse "$root\loader\ETBRLoader" "$stage\mod\ETBRLoader"
Remove-Item -Recurse -Force "$stage\mod\ETBRLoader\maps", "$stage\mod\ETBRLoader\dev.enable", "$stage\mod\ETBRLoader\cache", "$stage\mod\ETBRLoader\io", "$stage\mod\ETBRLoader\live.json", "$stage\mod\ETBRLoader\devcmd.txt" -ErrorAction SilentlyContinue
Copy-Item "$root\installer\install-mod.ps1" "$stage\mod"

Remove-Item (Join-Path $dist 'payload.zip') -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath (Join-Path $dist 'payload.zip') -CompressionLevel Optimal
"payload: {0:N0} MB" -f ((Get-Item (Join-Path $dist 'payload.zip')).Length / 1MB)

& "$env:USERPROFILE\.dotnet10\dotnet.exe" publish "$root\installer\Setup\Setup.csproj" -c Release -o $dist -v q
Get-Item (Join-Path $dist 'ETBR-Mapper-Setup.exe') | ForEach-Object { "setup: {0}  {1:N0} MB" -f $_.FullName, ($_.Length / 1MB) }
