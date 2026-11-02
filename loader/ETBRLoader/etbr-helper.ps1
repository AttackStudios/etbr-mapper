# ETBR Loader helper: the ONLY process the mod starts (once, hidden, at game boot). The game talks to it through
# small files in io\, so the game thread never launches a process (that caused stalls and flashing windows).
#   io\sync.url  -> GET -> io\sync.res          live link poll
#   io\fetch.url (url, then target file) -> io\fetch.done (ok|fail)
#   io\*.cmd     lines: play|id|file|volume|loop  vol|id|volume  stop|id
#   io\maps.txt  newest-first list of map names
param([Parameter(Mandatory)][string]$Dir)
$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object Threading.Mutex($false, 'Local\ETBRLoaderHelper')
if (-not $mutex.WaitOne(0)) { exit }
Add-Type -AssemblyName PresentationCore, WindowsBase, System.Net.Http

$io = Join-Path $Dir 'io'; $maps = Join-Path $Dir 'maps'
foreach ($d in $io, $maps, (Join-Path $Dir 'cache')) { New-Item -ItemType Directory -Force $d | Out-Null }
Get-ChildItem $io -File | Remove-Item -Force

$http = [Net.Http.HttpClient]::new(); $http.Timeout = [TimeSpan]::FromSeconds(10)
$long = [Net.Http.HttpClient]::new(); $long.Timeout = [TimeSpan]::FromSeconds(70)
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$name, [string]$text) {
  $tmp = Join-Path $io "$name.tmp"; [IO.File]::WriteAllText($tmp, $text, $utf8)
  Move-Item -Force $tmp (Join-Path $io $name)
}
$sync = $null; $fetch = $null; $fetchFile = $null
$players = @{}; $seq = 0
$dispatcher = [Windows.Threading.Dispatcher]::CurrentDispatcher
$lastMaps = ''; $n = 0; $gone = 0

while ($true) {
  Start-Sleep -Milliseconds 15
  $n++
  $dispatcher.Invoke([Action] {}, [Windows.Threading.DispatcherPriority]::Background)  # keeps audio running

  # ---- stop when the game closes
  if ($n % 130 -eq 0) {
    if (Get-Process -Name 'Backrooms-Win64-Shipping' -ErrorAction SilentlyContinue) { $gone = 0 } else { $gone++ }
    if ($gone -ge 3) { break }
  }

  # ---- live link
  if ($sync) {
    if ($sync.IsCompleted) {
      $body = ''; if (-not $sync.IsFaulted -and -not $sync.IsCanceled) { $body = $sync.Result }
      Put 'sync.res' $body; $sync = $null
    }
  } else {
    $f = Join-Path $io 'sync.url'
    if (Test-Path -LiteralPath $f) {
      $url = (Get-Content -LiteralPath $f -Raw).Trim(); Remove-Item -LiteralPath $f -Force
      if ($url) { $sync = $http.GetStringAsync($url) }
    }
  }

  # ---- shared map download
  if ($fetch) {
    if ($fetch.IsCompleted) {
      if (-not $fetch.IsFaulted -and -not $fetch.IsCanceled) { [IO.File]::WriteAllText($fetchFile, $fetch.Result, $utf8); Put 'fetch.done' 'ok' } else { Put 'fetch.done' 'fail' }
      $fetch = $null
    }
  } else {
    $f = Join-Path $io 'fetch.url'
    if (Test-Path -LiteralPath $f) {
      $lines = Get-Content -LiteralPath $f; Remove-Item -LiteralPath $f -Force
      $fetchFile = $lines[1]; $fetch = $long.GetStringAsync($lines[0])
    }
  }

  # ---- sounds
  foreach ($c in (Get-ChildItem $io -Filter '*.cmd' | Sort-Object Name)) {
    $lines = Get-Content -LiteralPath $c.FullName; Remove-Item -LiteralPath $c.FullName -Force
    foreach ($l in $lines) {
      $p = $l -split '\|'
      switch ($p[0]) {
        'play' {
          if ($players.Count -lt 16) {
            $m = New-Object Windows.Media.MediaPlayer
            $m.Open([Uri]::new($p[2])); $m.Volume = [double]$p[3]; $m.Play()
            $players["$($p[1])"] = @{ m = $m; loop = ($p[4] -eq '1') }
          }
        }
        'vol' { $e = $players["$($p[1])"]; if ($e) { $e.m.Volume = [double]$p[2] } }
        'stop' { $e = $players["$($p[1])"]; if ($e) { $e.m.Stop(); $e.m.Close(); $players.Remove("$($p[1])") } }
      }
    }
  }
  if ($n % 6 -eq 0 -and $players.Count) {
    foreach ($k in @($players.Keys)) {
      $e = $players[$k]; $m = $e.m
      if ($m.NaturalDuration.HasTimeSpan -and $m.Position -ge $m.NaturalDuration.TimeSpan) {
        if ($e.loop) { $m.Position = [TimeSpan]::Zero; $m.Play() } else { $m.Close(); $players.Remove($k) }
      }
    }
  }

  # ---- map list
  if ($n % 130 -eq 5) {
    $list = (Get-ChildItem $maps -Filter '*.etbrmap' | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.BaseName }) -join "`n"
    if ($list -ne $lastMaps) { Put 'maps.txt' $list; $lastMaps = $list }
  }
}
foreach ($e in $players.Values) { $e.m.Close() }
