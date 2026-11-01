#!/usr/bin/env python3
# Builds a test .etbrObject (1 m textured cube, Unreal units) and a map that places it: tools/make_test_asset.py <outdir>
import base64, json, struct, sys, zlib, os
out = sys.argv[1] if len(sys.argv) > 1 else '.'

def png(w, h, px):  # px(x,y)->(r,g,b)
    raw = b''.join(b'\x00' + b''.join(bytes(px(x, y)) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

tex = png(64, 64, lambda x, y: (220, 60, 60) if ((x // 8) + (y // 8)) % 2 else (240, 230, 200))

# cube 100 cm, centred on X/Y, sitting on Z=0. Unreal: clockwise front faces seen from outside.
s = 50.0
faces = [  # (normal, 4 corners in CCW order seen from outside in a right-handed view -> we emit CW for UE)
    ((0, 0, 1), [(-s, -s, 100), (s, -s, 100), (s, s, 100), (-s, s, 100)]),
    ((0, 0, -1), [(-s, s, 0), (s, s, 0), (s, -s, 0), (-s, -s, 0)]),
    ((1, 0, 0), [(s, -s, 0), (s, s, 0), (s, s, 100), (s, -s, 100)]),
    ((-1, 0, 0), [(-s, s, 0), (-s, -s, 0), (-s, -s, 100), (-s, s, 100)]),
    ((0, 1, 0), [(s, s, 0), (-s, s, 0), (-s, s, 100), (s, s, 100)]),
    ((0, -1, 0), [(-s, -s, 0), (s, -s, 0), (s, -s, 100), (-s, -s, 100)]),
]
V, N, UV, I = [], [], [], []
for n, quad in faces:
    b = len(V) // 3
    for (x, y, z), (u, v) in zip(quad, [(0, 1), (1, 1), (1, 0), (0, 0)]):
        V += [x, y, z]; N += list(n); UV += [u, v]
    # UE is left-handed: a quad wound CCW in right-handed math is CW in UE -> use (0,2,1),(0,3,2)
    I += [b, b + 2, b + 1, b, b + 3, b + 2]
f32 = lambda a: base64.b64encode(struct.pack('<%df' % len(a), *a)).decode()
u32 = lambda a: base64.b64encode(struct.pack('<%dI' % len(a), *a)).decode()
asset = {
    'format': 'etbr-asset', 'version': 1, 'kind': 'object', 'id': 'testcube01', 'name': 'Test Cube', 'author': 'AttackStudioYT',
    'description': 'Loader test asset', 'icon': '',
    'meshes': {'body': {'sections': [{'v': f32(V), 'n': f32(N), 'uv': f32(UV), 'i': u32(I), 'tex': 'checker', 'color': '#ffffff', 'emissive': 0}],
                        'bounds': {'o': [0, 0, 50], 'e': [50, 50, 50]}}},
    'textures': {'checker': base64.b64encode(tex).decode()}, 'sounds': {}, 'scripts': {},
    'object': {'mesh': 'body', 'collision': True},
}
json.dump(asset, open(os.path.join(out, 'TestCube.etbrObject'), 'w'))
floor = '/Game/Backrooms/Meshes/SM_Floor_4m.SM_Floor_4m'
objs = [{'id': 'f%d' % i, 'asset': floor, 'kind': 'mesh', 'pos': [x, y, 0], 'rot': [0, 0, 0], 'scale': [1, 1, 1]} for i, (x, y) in enumerate([(0, 0), (400, 0), (0, 400), (400, 400)])]
objs += [{'id': 'c1', 'asset': 'testcube01', 'kind': 'custom', 'pos': [250, 0, 0], 'rot': [0, 30, 0], 'scale': [1, 1, 1]},
         {'id': 'c2', 'asset': 'testcube01', 'kind': 'custom', 'pos': [250, 200, 0], 'rot': [0, 0, 0], 'scale': [1, 1, 2]},
         {'id': 'l1', 'asset': '/Script/Engine.PointLight', 'kind': 'actor', 'pos': [200, 100, 300], 'rot': [0, 0, 0], 'scale': [1, 1, 1], 'props': {'intensity': 8000, 'radius': 1500}}]
m = {'format': 'etbrmap', 'version': 1, 'meta': {'name': 'ETBRCustom'},
     'settings': {'spawn': {'pos': [0, 0, 100], 'yaw': 0}, 'offset': [0, 0, 200000], 'killZ': -3000, 'lighting': 'realistic'},
     'objects': objs, 'logic': [], 'customAssets': {'testcube01': asset}}
json.dump(m, open(os.path.join(out, 'ETBRCustom.etbrmap'), 'w'))
print('wrote TestCube.etbrObject + ETBRCustom.etbrmap')
