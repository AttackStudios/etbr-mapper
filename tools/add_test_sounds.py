#!/usr/bin/env python3
# Adds generated test sounds (idle hum loop + chase/kill alarm) to the entity in a test map: tools/add_test_sounds.py <map>
import json, struct, math, base64, sys
def wav(freq_fn, secs, rate=22050):
    n = int(secs * rate); ph = 0; data = bytearray()
    for i in range(n):
        ph += 2 * math.pi * freq_fn(i / rate) / rate
        data += struct.pack('<h', int(0.35 * 32767 * math.sin(ph) * (0.6 + 0.4 * math.sin(ph * 0.05))))
    hdr = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(data))
    return base64.b64encode(hdr + bytes(data)).decode()
p = sys.argv[1]
m = json.load(open(p))
ent = [a for a in m['customAssets'].values() if a['kind'] == 'entity'][0]
ent['sounds'] = {'hum': wav(lambda t: 70, 2.0), 'alarm': wav(lambda t: 300 + 500 * t, 1.2)}
ent['entity']['behavior']['sounds'] = {'idle': 'hum', 'chase': 'alarm', 'kill': 'alarm'}
ent['entity']['behavior']['kill'] = True
json.dump(m, open(p, 'w'))
print('sounds added')
