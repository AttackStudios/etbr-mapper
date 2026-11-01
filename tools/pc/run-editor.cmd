@echo off
rem Launch the editor (dev) in Jack's desktop session with a CDP port for automated checks.
cd /d C:\Users\JackPC\ETBRMapper\editor
start "" node_modules\electron\dist\electron.exe . --remote-debugging-port=9333 > C:\Users\JackPC\ETBRMapper\editor.log 2>&1
