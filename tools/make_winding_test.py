#!/usr/bin/env python3
# Which triangle winding does ProceduralMeshComponent show? Two cubes (A = as made by make_test_asset, B = reversed),
# a 3D text sign and a lamp item: tools/make_winding_test.py <cube.json> <out.etbrmap>
import json, sys, copy, base64, struct
cube = json.load(open(sys.argv[1]))
A = copy.deepcopy(cube); A['id'] = 'cubeA0001'; A['name'] = 'Cube A'
B = copy.deepcopy(cube); B['id'] = 'cubeB0001'; B['name'] = 'Cube B'
sec = B['meshes']['body']['sections'][0]
raw = base64.b64decode(sec['i']); idx = list(struct.unpack('<%dI' % (len(raw) // 4), raw))
for t in range(0, len(idx), 3): idx[t + 1], idx[t + 2] = idx[t + 2], idx[t + 1]
sec['i'] = base64.b64encode(struct.pack('<%dI' % len(idx), *idx)).decode()
item = copy.deepcopy(cube); item['kind'] = 'item'; item['id'] = 'testlamp01'; item['name'] = 'Test Lamp'; item.pop('object', None)
item['item'] = {'ground': {'mesh': 'body'}, 'hand': {'mesh': 'body', 'pos': [60, 25, -30], 'rot': [0, 0, 0], 'scale': [0.2, 0.2, 0.2]},
                'use': {'type': 'light', 'light': {'intensity': 6000, 'color': '#fff4d6', 'angle': 30, 'range': 2000}, 'amount': 25, 'consume': False}, 'pickupText': 'Test Lamp'}
item['scripts'] = {'main.lua': "function onPickup() etbr.log('picked up the lamp') end\n"}
floor = '/Game/Backrooms/Meshes/SM_Floor_4m.SM_Floor_4m'
objs = [{'id': f'f{i}_{j}', 'asset': floor, 'kind': 'mesh', 'pos': [i * 400, j * 400, 0], 'rot': [0, 0, 0], 'scale': [1, 1, 1]} for i in range(-1, 3) for j in range(-1, 2)]
objs += [
  {'id': 'L1', 'asset': '/Script/Engine.PointLight', 'kind': 'actor', 'pos': [300, 0, 350], 'rot': [0, 0, 0], 'scale': [1, 1, 1], 'props': {'intensity': 9000, 'radius': 2500}},
  {'id': 'A', 'asset': 'cubeA0001', 'kind': 'custom', 'pos': [450, -150, 0], 'rot': [0, 25, 0], 'scale': [1, 1, 1]},
  {'id': 'B', 'asset': 'cubeB0001', 'kind': 'custom', 'pos': [450, 150, 0], 'rot': [0, 25, 0], 'scale': [1, 1, 1]},
  {'id': 'T', 'kind': 'text', 'asset': 'text', 'pos': [700, 0, 200], 'rot': [0, 180, 0], 'scale': [1, 1, 1], 'props': {'text': 'Welcome to ETBR Mapper', 'size': 40, 'color': '#fff3c4'}},
  {'id': 'I1', 'asset': 'testlamp01', 'kind': 'custom', 'pos': [180, 0, 0], 'rot': [0, 0, 0], 'scale': [0.3, 0.3, 0.3]},
]
m = {'format': 'etbrmap', 'version': 1, 'meta': {'name': 'WindingTest'}, 'settings': {'spawn': {'pos': [0, 0, 100], 'yaw': 0}, 'offset': [0, 0, 200000], 'killZ': -3000, 'lighting': 'realistic'},
     'objects': objs, 'logic': [{'id': 'Z', 'type': 'message', 'pos': [0, 500, 100], 'size': [150, 150, 300], 'text': 'The message zone works and this sentence stays long enough to read it'}],
     'customAssets': {'cubeA0001': A, 'cubeB0001': B, 'testlamp01': item}}
json.dump(m, open(sys.argv[2], 'w')); print('ok')
