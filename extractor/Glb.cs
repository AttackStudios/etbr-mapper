// Minimal GLB writer for UStaticMesh LOD0.
// Converts Unreal (cm, Z-up, left-handed) to Three.js/glTF (m, Y-up, right-handed):
//   gl = (ue.X, ue.Z, ue.Y) / 100   — an axis swap (reflection): UE clockwise fronts become CCW, which is glTF front-facing, so indices are kept as-is.
// One glTF node per material section, named "mi<MaterialIndex>", so the editor can texture each section.
using System.Text;
using System.Text.Json;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;

static class Glb
{
    public static byte[] FromStaticMesh(UStaticMesh sm)
    {
        var lod = sm.RenderData?.LODs?.FirstOrDefault(l => l?.PositionVertexBuffer?.Verts?.Length > 0 && l.IndexBuffer?.Length > 0);
        if (lod == null) return null;
        var verts = lod.PositionVertexBuffer.Verts;
        var uvItems = lod.VertexBuffer?.UV;
        int nv = verts.Length;

        var bin = new MemoryStream();
        var bw = new BinaryWriter(bin);
        float[] mn = { float.MaxValue, float.MaxValue, float.MaxValue }, mx = { float.MinValue, float.MinValue, float.MinValue };
        foreach (var v in verts)
        {
            float x = v.X / 100f, y = v.Z / 100f, z = v.Y / 100f;
            bw.Write(x); bw.Write(y); bw.Write(z);
            mn[0] = Math.Min(mn[0], x); mn[1] = Math.Min(mn[1], y); mn[2] = Math.Min(mn[2], z);
            mx[0] = Math.Max(mx[0], x); mx[1] = Math.Max(mx[1], y); mx[2] = Math.Max(mx[2], z);
        }
        int posLen = (int)bin.Length;
        bool hasUv = uvItems != null && uvItems.Length == nv;
        int uvOff = (int)bin.Length;
        if (hasUv) foreach (var u in uvItems) { var uv = u.UV.Length > 0 ? u.UV[0] : default; bw.Write(uv.U); bw.Write(uv.V); }
        int uvLen = (int)bin.Length - uvOff;

        var bufferViews = new List<object> { new { buffer = 0, byteOffset = 0, byteLength = posLen, target = 34962 } };
        var accessors = new List<object> { new { bufferView = 0, componentType = 5126, count = nv, type = "VEC3", min = mn, max = mx } };
        if (hasUv)
        {
            bufferViews.Add(new { buffer = 0, byteOffset = uvOff, byteLength = uvLen, target = 34962 });
            accessors.Add(new { bufferView = 1, componentType = 5126, count = nv, type = "VEC2" });
        }
        var meshes = new List<object>();
        var nodes = new List<object>();
        var ib = lod.IndexBuffer;
        foreach (var sec in lod.Sections)
        {
            if (sec.NumTriangles <= 0) continue;
            int off = (int)bin.Length;
            for (int t = 0; t < sec.NumTriangles; t++)
            {
                int i = sec.FirstIndex + t * 3;
                bw.Write((uint)ib[i]); bw.Write((uint)ib[i + 1]); bw.Write((uint)ib[i + 2]); // UE clockwise front faces become CCW after the axis swap = glTF front faces
            }
            bufferViews.Add(new { buffer = 0, byteOffset = off, byteLength = sec.NumTriangles * 12, target = 34963 });
            accessors.Add(new { bufferView = bufferViews.Count - 1, componentType = 5125, count = sec.NumTriangles * 3, type = "SCALAR" });
            var attrs = new Dictionary<string, int> { ["POSITION"] = 0 };
            if (hasUv) attrs["TEXCOORD_0"] = 1;
            meshes.Add(new { primitives = new[] { new { attributes = attrs, indices = accessors.Count - 1 } } });
            nodes.Add(new { name = "mi" + sec.MaterialIndex, mesh = meshes.Count - 1 });
        }
        if (meshes.Count == 0) return null;
        while (bin.Length % 4 != 0) bw.Write((byte)0);
        var gltf = new
        {
            asset = new { version = "2.0", generator = "ETBR Mapper extractor" },
            scene = 0,
            scenes = new[] { new { nodes = Enumerable.Range(0, nodes.Count).ToArray() } },
            nodes, meshes, accessors, bufferViews,
            buffers = new[] { new { byteLength = (int)bin.Length } },
        };
        var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(gltf));
        int jsonPad = (4 - json.Length % 4) % 4;
        var outS = new MemoryStream();
        var o = new BinaryWriter(outS);
        int total = 12 + 8 + json.Length + jsonPad + 8 + (int)bin.Length;
        o.Write(0x46546C67u); o.Write(2u); o.Write((uint)total);
        o.Write((uint)(json.Length + jsonPad)); o.Write(0x4E4F534Au); o.Write(json); for (int i = 0; i < jsonPad; i++) o.Write((byte)0x20);
        o.Write((uint)bin.Length); o.Write(0x004E4942u); o.Write(bin.ToArray());
        return outS.ToArray();
    }
}
