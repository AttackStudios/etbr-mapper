# Capture the primary screen to C:\Users\JackPC\ETBRMapper\screen.png (runs in the interactive session via a scheduled task)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$small = New-Object System.Drawing.Bitmap $bmp, ([int]($b.Width / 2)), ([int]($b.Height / 2))
$small.Save('C:\Users\JackPC\ETBRMapper\screen.png', [System.Drawing.Imaging.ImageFormat]::Png)
