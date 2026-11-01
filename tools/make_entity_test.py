#!/usr/bin/env python3
# Test map for custom entities + items: tools/make_entity_test.py <entity.json> <cube.json> <out.etbrmap>
import json, sys, copy
ent = json.load(open(sys.argv[1])); cube = json.load(open(sys.argv[2]))
b = ent['entity']['behavior']
b.update(mode='chase', walkSpeed=120, runSpeed=150, sight=3000, loseSight=4000, kill=True, killRange=110, capsule=[45, 55])
item = copy.deepcopy(cube); item['kind'] = 'item'; item['id'] = 'testlamp01'; item['name'] = 'Test Lamp'
item.pop('object', None)
item['item'] = {'ground': {'mesh': 'body'}, 'hand': {'mesh': 'body', 'pos': [60, 25, -30], 'rot': [0, 0, 0], 'scale': [0.2, 0.2, 0.2]},
                'use': {'type': 'light', 'light': {'intensity': 5000, 'color': '#fff4d6', 'angle': 30, 'range': 2000}, 'amount': 25, 'consume': False},
                'pickupText': 'Test Lamp'}
item['scripts'] = {'main.lua': "function onPickup() etbr.log('picked up the lamp') end\n"}
floor = '/Game/Backrooms/Meshes/SM_Floor_4m.SM_Floor_4m'
objs = []
for i in range(-1, 4):
    for j in range(-1, 2):
        objs.append({'id': f'f{i}_{j}', 'asset': floor, 'kind': 'mesh', 'pos': [i * 400, j * 400, 0], 'rot': [0, 0, 0], 'scale': [1, 1, 1]})
objs += [
    {'id': 'L1', 'asset': '/Script/Engine.PointLight', 'kind': 'actor', 'pos': [500, 0, 350], 'rot': [0, 0, 0], 'scale': [1, 1, 1], 'props': {'intensity': 9000, 'radius': 2500}},
    {'id': 'E1', 'asset': ent['id'], 'kind': 'custom', 'pos': [1000, 0, 0], 'rot': [0, 180, 0], 'scale': [1, 1, 1]},
    {'id': 'I1', 'asset': 'testlamp01', 'kind': 'custom', 'pos': [150, 0, 0], 'rot': [0, 0, 0], 'scale': [0.3, 0.3, 0.3]},
]
import base64, struct
# walk grid over the floor tiles (x -200..1800, y -600..600 cm), all floor at z=0
cell = 50; x0, y0 = -200 // cell, -600 // cell; w, h = 2000 // cell, 1200 // cell
nav = {'cell': cell, 'x0': x0, 'y0': y0, 'w': w, 'h': h, 'floors': base64.b64encode(struct.pack('<%dh' % (w * h), *([0] * (w * h)))).decode()}
m = {'format': 'etbrmap', 'version': 1, 'meta': {'name': 'ETBREntityTest'},
     'settings': {'spawn': {'pos': [0, 0, 100], 'yaw': 0}, 'offset': [0, 0, 200000], 'killZ': -3000, 'lighting': 'realistic', 'nav': nav},
     'objects': objs, 'logic': [], 'customAssets': {ent['id']: ent, 'testlamp01': item}}
json.dump(m, open(sys.argv[3], 'w'))
print('entity', ent['name'], 'parts', len(ent['entity']['parts']), 'anims', list(ent['entity']['anims']))
