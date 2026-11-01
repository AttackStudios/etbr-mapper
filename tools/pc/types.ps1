$base = "$env:USERPROFILE\.nuget\packages"
$dlls = @("$base\cue4parse-conversion\1.2.2.202611\lib\net10.0\CUE4Parse-Conversion.dll", "$base\cue4parse\1.2.2.202611\lib\net10.0\CUE4Parse.dll")
foreach ($d in $dlls) {
  $bytes = [IO.File]::ReadAllBytes($d)
  # metadata-only load (net10 assemblies can't load into PS5's CLR) -> fall back to string scan of type names
  $s = [Text.Encoding]::ASCII.GetString($bytes)
  [regex]::Matches($s, '(CUE4Parse[_A-Za-z0-9.]*\.(Meshes|Textures|Materials|Exports\.Material|Exports\.Engine|Objects\.Engine|Exports\.StaticMesh))') | % { $_.Value } | Sort -Unique
}
