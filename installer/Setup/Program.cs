// ETBR Mapper Setup — one .exe for friends: installs the editor + the in-game loader (UE4SS + ETBRLoader).
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;

static class Setup
{
    static int Main()
    {
        Console.Title = "ETBR Mapper Setup";
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("  ETBR Mapper — level editor for Escape the Backrooms");
        Console.ResetColor();
        Console.WriteLine("  by AttackStudioYT · not affiliated with Fancy Games\n");
        try
        {
            if (Process.GetProcessesByName("Backrooms-Win64-Shipping").Length > 0)
            {
                Console.WriteLine("  Please close Escape the Backrooms first, then run Setup again.");
                return Pause(1);
            }
            var dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "ETBR Mapper");
            foreach (var p in Process.GetProcessesByName("ETBR Mapper")) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
            Console.WriteLine("  [1/3] Unpacking the editor…");
            if (Directory.Exists(dest)) Directory.Delete(dest, true);
            Directory.CreateDirectory(dest);
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")!)
            using (var zip = new ZipArchive(s)) zip.ExtractToDirectory(dest, true);

            Console.WriteLine("  [2/3] Adding the ETBR loader to Escape the Backrooms…");
            var ps = new ProcessStartInfo("powershell.exe",
                $"-NoProfile -ExecutionPolicy Bypass -File \"{Path.Combine(dest, "mod", "install-mod.ps1")}\" -Payload \"{Path.Combine(dest, "mod")}\"")
            { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            var proc = Process.Start(ps)!;
            var outp = proc.StandardOutput.ReadToEnd(); var err = proc.StandardError.ReadToEnd(); proc.WaitForExit();
            foreach (var l in outp.Split('\n')) if (l.Trim().Length > 0) Console.WriteLine("        " + l.Trim());
            if (proc.ExitCode != 0)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("        Could not install the game mod: " + err.Trim());
                Console.ResetColor();
                Console.WriteLine("        The editor still works; run Setup again after installing Escape the Backrooms.");
            }

            Console.WriteLine("  [3/3] Creating shortcuts…");
            var exe = Path.Combine(dest, "ETBR Mapper.exe");
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ETBR Mapper.lnk");
            Shortcut(Path.Combine(desktop, "ETBR Mapper.lnk"), exe, dest);
            Shortcut(startMenu, exe, dest);

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("\n  Done! ETBR Mapper is on your desktop.");
            Console.ResetColor();
            Console.WriteLine("  The first launch builds the object library from your copy of the game (a few minutes, once).");
            Console.WriteLine("  In game: F7 loads/live-tests a level, F6 goes to its spawn, F8 removes it.");
            Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = dest });
            return Pause(0);
        }
        catch (Exception e)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("\n  Setup failed: " + e.Message);
            Console.ResetColor();
            return Pause(1);
        }
    }

    static void Shortcut(string lnk, string target, string dir)
    {
        var script = $"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk.Replace("'", "''")}');$s.TargetPath='{target.Replace("'", "''")}';$s.WorkingDirectory='{dir.Replace("'", "''")}';$s.Save()";
        var p = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"" + script + "\"") { UseShellExecute = false, CreateNoWindow = true })!;
        p.WaitForExit();
    }
    static int Pause(int code) { Console.WriteLine("\n  Press any key to close."); try { Console.ReadKey(true); } catch { } return code; }
}
