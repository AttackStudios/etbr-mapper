// ETBR Mapper asset extractor — runs on the player's own PC against their own copy of the game.
//   Extractor scan    <gameDir> <outDir>            → scan.json (every package + export classes)
//   Extractor library <gameDir> <libDir> [--force]  → catalog.json + m/*.glb + t/*.png
//   Extractor probe   <gameDir> <outDir> <asset>    → debug one asset
// Progress lines: "PROGRESS <done>/<total> <label>"
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;

static class P
{
    const int CATALOG_VERSION = 1;
    static readonly JsonSerializerOptions J = new() { WriteIndented = false };

    static DefaultFileProvider Open(string gameDir)
    {
        var paks = Path.Combine(gameDir, "EscapeTheBackrooms", "Content", "Paks");
        var prov = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE4_27));
        prov.Initialize();
        prov.SubmitKey(new FGuid(), new FAesKey("0x0000000000000000000000000000000000000000000000000000000000000000"));
        prov.PostMount();
        Console.WriteLine($"mounted {prov.Files.Count} files");
        return prov;
    }

    static int Main(string[] a)
    {
        if (a.Length < 3) { Console.WriteLine("usage: Extractor scan|library|probe <gameDir> <outDir> [...]"); return 1; }
        var prov = Open(a[1]);
        Directory.CreateDirectory(a[2]);
        return a[0] switch
        {
            "scan" => Scan(prov, a[2]),
            "library" => Library(prov, a[1], a[2], a.Contains("--force"), a.SkipWhile(x => x != "--only").Skip(1).FirstOrDefault()),
            "probe" => Probe(prov, a[3], a.Length > 4 ? a[4] : null),
            _ => 1,
        };
    }

    // ------------------------------------------------------------------ scan
    static int Scan(DefaultFileProvider prov, string outDir)
    {
        var rows = new List<object>();
        int n = 0, fail = 0;
        foreach (var (path, file) in prov.Files)
        {
            if (!path.EndsWith(".uasset") && !path.EndsWith(".umap")) continue;
            n++;
            try
            {
                var pkg = prov.LoadPackage(file);
                rows.Add(new { path, exports = pkg.GetExports().Select(e => (e.ExportType ?? "?") + ":" + e.Name).ToList() });
            }
            catch (Exception ex) { fail++; rows.Add(new { path, err = ex.Message }); }
        }
        File.WriteAllText(Path.Combine(outDir, "scan.json"), JsonSerializer.Serialize(rows));
        Console.WriteLine($"scanned {n} packages, {fail} failed");
        return 0;
    }

    // ------------------------------------------------------------------ helpers
    static string ObjPath(string filePath)
    {
        // EscapeTheBackrooms/Content/A/B/X.uasset -> /Game/A/B/X.X ; Plugins/.../Content/... -> /<Plugin>/...
        var p = filePath.Replace('\\', '/');
        p = p[..p.LastIndexOf('.')];
        var name = p[(p.LastIndexOf('/') + 1)..];
        string pkg;
        var ci = p.IndexOf("/Content/");
        if (p.StartsWith("EscapeTheBackrooms/Content/")) pkg = "/Game/" + p["EscapeTheBackrooms/Content/".Length..];
        else if (ci > 0) { var plug = p[..ci]; plug = plug[(plug.LastIndexOf('/') + 1)..]; pkg = "/" + plug + "/" + p[(ci + 9)..]; }
        else pkg = "/" + p;
        return pkg + "." + name;
    }
    static string Hash(string s) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(s)))[..16].ToLowerInvariant();
    static string Pretty(string n)
    {
        foreach (var pre in new[] { "SM_", "S_", "BP_", "B_", "SK_" }) if (n.StartsWith(pre)) { n = n[pre.Length..]; break; }
        if (n.EndsWith("_C")) n = n[..^2];
        n = n.Replace('_', ' ');
        var sb = new StringBuilder();
        for (int i = 0; i < n.Length; i++)
        {
            if (i > 0 && char.IsUpper(n[i]) && char.IsLower(n[i - 1])) sb.Append(' ');
            sb.Append(n[i]);
        }
        return System.Text.RegularExpressions.Regex.Replace(sb.ToString(), " +", " ").Trim();
    }
    static string Folder(string objPath)
    {
        var parts = objPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 2 ? parts[1] : "Misc";
    }
    static float[] V(FVector v) => new[] { v.X, v.Y, v.Z };
    static float[] R(FRotator r) => new[] { r.Pitch, r.Yaw, r.Roll };

    // ------------------------------------------------------------------ level usage
    static Dictionary<string, HashSet<string>> LevelUsage(DefaultFileProvider prov)
    {
        var usage = new ConcurrentDictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var maps = prov.Files.Where(f => f.Key.EndsWith(".umap") && f.Key.Contains("/Content/Maps/")).ToList();
        int done = 0;
        Parallel.ForEach(maps, new ParallelOptions { MaxDegreeOfParallelism = 4 }, kv =>
        {
            var p = kv.Key;
            var after = p[(p.IndexOf("/Content/Maps/") + 14)..];
            var level = after.Contains('/') ? after[..after.IndexOf('/')] : Path.GetFileNameWithoutExtension(after);
            try
            {
                if (prov.LoadPackage(kv.Value) is Package pkg)
                    foreach (var imp in pkg.ImportMap)
                    {
                        var cls = imp.ClassName.Text;
                        if (cls != "StaticMesh" && cls != "BlueprintGeneratedClass") continue;
                        var outer = imp.OuterIndex.IsImport ? pkg.ImportMap[-imp.OuterIndex.Index - 1].ObjectName.Text : null;
                        if (outer == null) continue;
                        var id = outer + "." + imp.ObjectName.Text;
                        var set = usage.GetOrAdd(id, _ => new HashSet<string>());
                        lock (set) set.Add(level);
                    }
            }
            catch { }
            var d = Interlocked.Increment(ref done);
            if (d % 10 == 0) Console.WriteLine($"PROGRESS {d}/{maps.Count} Reading levels");
        });
        return usage.ToDictionary(k => k.Key, k => k.Value, StringComparer.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------ textures
    static readonly ConcurrentDictionary<string, string> texDone = new();
    static string Hex(FLinearColor c)
    {
        int h(float v) => Math.Clamp((int)Math.Round(Math.Pow(Math.Clamp(v, 0, 1), 1 / 2.2) * 255), 0, 255);
        return $"#{h(c.R):x2}{h(c.G):x2}{h(c.B):x2}";
    }
    static string ExportDiffuse(UMaterialInterface mat, string libDir, out string tint)
    {
        tint = null;
        if (mat == null) return null;
        try
        {
            var prm = new CMaterialParams2();
            mat.GetParams(prm, EMaterialDepth.AllLayers);
            foreach (var names in CMaterialParams2.DiffuseColors)
                if (prm.TryGetLinearColor(out var lc, names)) { tint = Hex(lc); break; }
            if (tint == null) foreach (var (k, c) in prm.Colors) if (k.Contains("Color", StringComparison.OrdinalIgnoreCase) || k.Contains("Tint", StringComparison.OrdinalIgnoreCase)) { tint = Hex(c); break; }
            UTexture tex = null;
            foreach (var k in new[] { CMaterialParams2.FallbackDiffuse }.Concat(CMaterialParams2.Diffuse[0]))
                if (prm.TryGetTexture2d(out var t, k)) { tex = t; break; }
            if (tex == null && prm.Textures.Count > 0) tex = prm.Textures.Values.OfType<UTexture2D>().FirstOrDefault(t => !t.Name.Contains("Norm") && !t.Name.EndsWith("_N"));
            if (tex is not UTexture2D t2) return null;
            var key = t2.GetPathName();
            return texDone.GetOrAdd(key, _ =>
            {
                var file = "t/" + Hash(key) + ".png";
                var full = Path.Combine(libDir, file);
                if (File.Exists(full)) return file;
                var ct = t2.Decode(512);
                if (ct == null) return null;
                using var sk = ct.ToSkBitmap();
                using (var img = SKImage.FromBitmap(sk))
                using (var data = img.Encode(SKEncodedImageFormat.Png, 90))
                using (var fs = File.Create(full)) data.SaveTo(fs);
                return file;
            });
        }
        catch { return null; }
    }

    // ------------------------------------------------------------------ library
    record Part(string mesh, float[] pos, float[] rot, float[] scale);

    static int Library(DefaultFileProvider prov, string gameDir, string libDir, bool force, string only)
    {
        var catPath = Path.Combine(libDir, "catalog.json");
        var pakFile = Directory.GetFiles(Path.Combine(gameDir, "EscapeTheBackrooms", "Content", "Paks"), "*.pak").First();
        var build = Hash(new FileInfo(pakFile).Length + "|" + File.GetLastWriteTimeUtc(pakFile).Ticks + "|" + CATALOG_VERSION);
        if (!force && only == null && File.Exists(catPath))
        {
            try { using var d = JsonDocument.Parse(File.ReadAllText(catPath)); if (d.RootElement.GetProperty("build").GetString() == build) { Console.WriteLine("library up to date"); return 0; } } catch { }
        }
        Directory.CreateDirectory(Path.Combine(libDir, "m"));
        Directory.CreateDirectory(Path.Combine(libDir, "t"));

        Console.WriteLine("PROGRESS 0/1 Reading levels");
        var usage = LevelUsage(prov);

        var meshFiles = new List<string>();
        var bpFiles = new List<string>();
        foreach (var (path, file) in prov.Files)
        {
            if (!path.EndsWith(".uasset")) continue;
            if (only != null && !path.Contains(only, StringComparison.OrdinalIgnoreCase)) continue;
            // cheap filter on name avoids loading 30k packages twice: rely on the scan heuristics
            meshFiles.Add(path);
        }

        var items = new ConcurrentBag<Dictionary<string, object>>();
        int done = 0, total = meshFiles.Count, meshN = 0, bpN = 0, err = 0;
        var bpPending = new ConcurrentBag<(string path, UClass cls)>();

        Parallel.ForEach(meshFiles, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount / 2) }, path =>
        {
            var d = Interlocked.Increment(ref done);
            if (d % 200 == 0) Console.WriteLine($"PROGRESS {d}/{total} Exporting meshes");
            try
            {
                var pkg = prov.LoadPackage(path);
                foreach (var exp in pkg.GetExports())
                {
                    if (exp is UStaticMesh sm)
                    {
                        var id = ObjPath(path);
                        var glbRel = "m/" + Hash(id) + ".glb";
                        var glbFull = Path.Combine(libDir, glbRel);
                        var it = new Dictionary<string, object> { ["id"] = id, ["kind"] = "mesh", ["name"] = Pretty(sm.Name), ["folder"] = Folder(id), ["glb"] = glbRel };
                        if (!File.Exists(glbFull) || force)
                        {
                            var glb = Glb.FromStaticMesh(sm);
                            if (glb == null) { Interlocked.Increment(ref err); continue; }
                            File.WriteAllBytes(glbFull, glb);
                        }
                        var b = sm.RenderData?.Bounds;
                        if (b != null) it["bounds"] = new { o = V(b.Origin), e = V(b.BoxExtent) };
                        var tex = new List<string>(); var tints = new List<string>();
                        if (sm.StaticMaterials != null)
                            foreach (var m in sm.StaticMaterials) { UMaterialInterface mi = null; try { mi = m.MaterialInterface?.Load<UMaterialInterface>(); } catch { } tex.Add(ExportDiffuse(mi, libDir, out var tn)); tints.Add(tn); }
                        it["tex"] = tex;
                        if (tints.Any(x => x != null)) it["tint"] = tints;
                        if (usage.TryGetValue(id, out var lv)) it["levels"] = lv.OrderBy(x => x).ToList();
                        items.Add(it); Interlocked.Increment(ref meshN);
                    }
                    else if (exp is UClass bgc && exp.ExportType == "BlueprintGeneratedClass")
                    {
                        bpPending.Add((path, bgc));
                    }
                }
            }
            catch (Exception e) { Interlocked.Increment(ref err); if (err < 30) Console.WriteLine("ERR " + path + " " + e.Message); }
        });

        // blueprints (after meshes, so parts can reference mesh ids)
        var meshIds = new HashSet<string>(items.Where(i => (string)i["kind"] == "mesh").Select(i => (string)i["id"]), StringComparer.OrdinalIgnoreCase);
        int bd = 0, bt = bpPending.Count;
        foreach (var (path, bgc) in bpPending)
        {
            if (++bd % 50 == 0) Console.WriteLine($"PROGRESS {bd}/{bt} Reading blueprints");
            try
            {
                var chain = new List<string>();
                UStruct s = bgc;
                for (int g = 0; g < 30 && s != null; g++)
                {
                    chain.Add(s.Name);
                    var sup = s.SuperStruct;
                    if (sup == null || sup.IsNull) break;
                    UStruct next = null;
                    try { next = sup.Load<UStruct>(); } catch { }
                    if (next == null) { chain.Add(sup.Name); break; } // native /Script class: keep its name
                    s = next;
                }
                var native = chain.LastOrDefault() ?? "";
                if (!IsPlaceable(chain)) continue;
                var id = ObjPath(path)[..^0];
                id = id[..id.LastIndexOf('.')] + "." + bgc.Name; // /Game/X/BP_Foo.BP_Foo_C
                var it = new Dictionary<string, object> { ["id"] = id, ["kind"] = "actor", ["name"] = Pretty(bgc.Name), ["folder"] = Folder(id), ["base"] = native, ["chain"] = chain.Take(6).ToList() };
                var parts = BlueprintParts(bgc, meshIds);
                if (parts.Count > 0) it["parts"] = parts;
                if (usage.TryGetValue(id, out var lv)) it["levels"] = lv.OrderBy(x => x).ToList();
                items.Add(it); bpN++;
            }
            catch (Exception e) { err++; if (err < 60) Console.WriteLine("ERR bp " + path + " " + e.Message); }
        }

        var cat = new Dictionary<string, object>
        {
            ["format"] = "etbr-catalog", ["version"] = CATALOG_VERSION, ["build"] = build,
            ["generated"] = DateTime.UtcNow.ToString("o"),
            ["items"] = items.OrderBy(i => (string)i["id"]).ToList(),
        };
        if (only == null) File.WriteAllText(catPath, JsonSerializer.Serialize(cat, J));
        else File.WriteAllText(Path.Combine(libDir, "catalog.partial.json"), JsonSerializer.Serialize(cat, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"PROGRESS 1/1 Done");
        Console.WriteLine($"library: {meshN} meshes, {bpN} actors, {err} errors");
        return 0;
    }

    static readonly string[] Reject = { "GameModeBase", "GameStateBase", "PlayerState", "PlayerController", "HUD", "UserWidget", "ActorComponent", "AnimInstance", "Info", "WorldSettings", "LevelScriptActor", "CameraShakeBase", "MatineeCameraShake", "PlayerCameraManager", "AIController", "FunctionLibrary", "BlueprintFunctionLibrary", "Object", "SaveGame", "GameInstance", "DamageType" };
    static bool IsPlaceable(List<string> chain)
    {
        // chain = [BP_X_C, Parent_C, ..., NativeBase]; must derive from Actor, must not be a framework/UI class
        foreach (var c in chain) if (Reject.Contains(c)) return false;
        var native = chain.Last();
        string[] bad = { "GameMode", "GameState", "PlayerState", "Controller", "HUD", "Widget", "Component", "Anim", "SaveGame", "GameInstance", "CameraShake", "Library", "Subsystem", "Interface", "Notify", "DataAsset", "Object", "BTTask", "BTDecorator", "BTService", "EnvQuery", "UserFlow", "Sequence", "Blockout" };
        if (native != "Actor" && bad.Any(b => native.Contains(b))) return false;
        return true;
    }

    // All StaticMeshComponents a blueprint ends up with: cooked packages serialise every component of the
    // class default object (incl. inherited+overridden ones) plus SCS "_GEN_VARIABLE" templates.
    // Missing ones fall back to the parent blueprint.
    static int dbg = 0;
    static List<Part> BlueprintParts(UClass bgc, HashSet<string> meshIds, int depth = 0)
    {
        var parts = new List<Part>();
        var seen = new HashSet<string>();
        try
        {
            var pkg = bgc.Owner;
            var exports = pkg.GetExports().ToList();
            // SCS parent links for templates: child template -> parent template
            var scsParent = new Dictionary<UObject, UObject>();
            foreach (var n in exports.Where(e => e.ExportType == "SCS_Node"))
            {
                if (!n.TryGetValue(out FPackageIndex pt, "ComponentTemplate")) continue;
                var parentTpl = pt.Load();
                if (n.TryGetValue(out FPackageIndex[] kids, "ChildNodes"))
                    foreach (var k in kids)
                    {
                        var kn = k.Load();
                        if (kn != null && kn.TryGetValue(out FPackageIndex kt, "ComponentTemplate")) { var ko = kt.Load(); if (ko != null && parentTpl != null) scsParent[ko] = parentTpl; }
                    }
            }
            foreach (var c in exports)
            {
                if (c.ExportType == null || !c.ExportType.EndsWith("StaticMeshComponent") || c.ExportType.Contains("Instanced")) continue;
                var key = c.Name.Replace("_GEN_VARIABLE", "");
                if (!seen.Add(key)) continue;
                if (!c.TryGetValue(out FPackageIndex meshIdx, "StaticMesh") || meshIdx.IsNull) continue;
                var mesh = meshIdx.ResolvedObject?.GetPathName();
                if (mesh != null && !meshIds.Contains(mesh))
                {
                    var alt = mesh.StartsWith("EscapeTheBackrooms/Content/") ? "/Game/" + mesh["EscapeTheBackrooms/Content/".Length..] : mesh;
                    if (alt.Contains('.') == false) alt = alt + "." + alt[(alt.LastIndexOf('/') + 1)..];
                    if (meshIds.Contains(alt)) mesh = alt;
                    else if (dbg++ < 15) Console.WriteLine("DBG mesh path " + mesh + " | " + alt);
                }
                if (mesh == null || !meshIds.Contains(mesh)) continue;
                var pos = new List<float[]>(); var rot = new List<float[]>(); var scl = new List<float[]>();
                UObject cur = c;
                for (int g = 0; g < 8 && cur != null; g++)
                {
                    pos.Add(cur.TryGetValue(out FVector l, "RelativeLocation") ? V(l) : new float[3]);
                    rot.Add(cur.TryGetValue(out FRotator r, "RelativeRotation") ? R(r) : new float[3]);
                    scl.Add(cur.TryGetValue(out FVector sc, "RelativeScale3D") ? V(sc) : new[] { 1f, 1f, 1f });
                    UObject next = null;
                    if (cur.TryGetValue(out FPackageIndex ap, "AttachParent") && !ap.IsNull) { try { next = ap.Load(); } catch { } }
                    if (next == null) scsParent.TryGetValue(cur, out next);
                    cur = next;
                }
                pos.Reverse(); rot.Reverse(); scl.Reverse();
                parts.Add(new Part(mesh, pos.SelectMany(x => x).ToArray(), rot.SelectMany(x => x).ToArray(), scl.SelectMany(x => x).ToArray()));
                if (parts.Count >= 64) return parts;
            }
            // inherit from parent blueprint for components not present here
            if (depth < 6 && bgc.SuperStruct != null && !bgc.SuperStruct.IsNull)
            {
                UClass parent = null; try { parent = bgc.SuperStruct.Load<UClass>(); } catch { }
                if (parent != null && parent.ExportType == "BlueprintGeneratedClass" && parent.Owner != pkg)
                    foreach (var p in BlueprintParts(parent, meshIds, depth + 1))
                        if (parts.Count < 64 && !parts.Any(x => x.mesh == p.mesh && x.pos.SequenceEqual(p.pos))) parts.Add(p);
            }
        }
        catch (Exception e) { Console.WriteLine("ERR parts " + bgc.Name + " " + e.Message); }
        return parts;
    }

    // ------------------------------------------------------------------ probe
    static int Probe(DefaultFileProvider prov, string asset, string filter = null)
    {
        var pkg = prov.LoadPackage(asset);
        foreach (var e in pkg.GetExports())
        {
            if (filter != null && !(e.Name.Contains(filter, StringComparison.OrdinalIgnoreCase) || (e.ExportType ?? "").Contains(filter, StringComparison.OrdinalIgnoreCase))) continue;
            Console.WriteLine($"== {e.ExportType} {e.Name}");
            try { var s = Newtonsoft.Json.JsonConvert.SerializeObject(e, Newtonsoft.Json.Formatting.Indented); Console.WriteLine(filter == null && s.Length > 3000 ? s[..3000] + "…" : s); } catch (Exception ex) { Console.WriteLine("  (json fail " + ex.Message + ")"); }
        }
        if (pkg is Package p) foreach (var i in p.ImportMap.Take(40)) Console.WriteLine($"  imp {i.ClassName} {i.ObjectName} outer={i.OuterIndex.Index}");
        return 0;
    }
}
