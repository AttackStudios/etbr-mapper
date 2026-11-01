param([int]$n = 40, [string]$match = '')
$log = 'C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\UE4SS.log'
$lines = Get-Content -LiteralPath $log
if ($match) { $lines = $lines | Select-String -Pattern $match | ForEach-Object { $_.Line } }
$lines | Select-Object -Last $n
