@echo off
rem Dev: close the game, reinstall the loader from payload.tgz, drop the test map + dev.enable.
set MODS=C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods\ETBRLoader
taskkill /f /im Backrooms-Win64-Shipping.exe >nul 2>&1
timeout /t 3 /nobreak >nul
cd /d C:\Users\JackPC\ETBRMapper
rmdir /s /q payload 2>nul
tar -xzf payload.tgz
powershell -NoProfile -ExecutionPolicy Bypass -File payload\install-mod.ps1 -Payload C:\Users\JackPC\ETBRMapper\payload
copy /y ETBRTest.etbrmap "%MODS%\maps\ETBRTest.etbrmap" >nul
echo dev> "%MODS%\dev.enable"
echo redeployed
