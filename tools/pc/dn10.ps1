$ProgressPreference='SilentlyContinue'
Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile "$env:TEMP\dotnet-install.ps1"
& "$env:TEMP\dotnet-install.ps1" -Channel 10.0 -InstallDir "$env:USERPROFILE\.dotnet10" | Select -Last 2
& "$env:USERPROFILE\.dotnet10\dotnet.exe" --list-sdks
