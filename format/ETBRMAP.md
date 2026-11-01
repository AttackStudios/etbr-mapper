# .etbrmap — Escape The Backrooms MAP format (v1)

A `.etbrmap` file is UTF-8 JSON. Editor units are **metres, Y-up, right-handed**
(Three.js). Everything stored in the file is already in **Unreal units**
(centimetres, Z-up, left-handed) so loaders never convert:

```
UE.X =  x * 100      (forward)
UE.Y =  z * 100      (right)
UE.Z =  y * 100      (up)
rot  =  [pitch, yaw, roll] degrees (Unreal FRotator)
```

```jsonc
{
  "format": "etbrmap",
  "version": 1,
  "meta": {
    "name": "My Level", "author": "AttackStudioYT", "description": "",
    "created": "ISO", "modified": "ISO",
    "collaborators": ["friend1"],
    "editor": "ETBR Mapper 1.0.0",
    "catalog": "<catalog build id the map was made against>"
  },
  "settings": {
    "spawn": { "pos": [0, 0, 100], "yaw": 0 },   // UE cm
    "offset": [0, 0, 200000],                    // where in the host world the level is built (far above the normal level)
    "fog":   { "density": 0.02, "color": "#c9b77a" },
    "light": { "intensity": 3, "color": "#fff3c4" },
    "killZ": -3000                               // relative to offset
  },
  "objects": [
    {
      "id": "o_8f3k2",                            // unique within map
      "asset": "/Game/Path/SM_Wall.SM_Wall",      // catalog id
      "kind": "mesh",                             // "mesh" = StaticMeshActor + mesh, "actor" = spawn BP class
      "pos": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1],
      "layer": "Default",
      "props": {}                                 // per-object overrides (light colour/intensity, text, ...)
    }
  ],
  "logic": [
    { "id": "l_1", "type": "exit",       "pos": [0,0,0], "size": [200,200,200], "text": "You escaped!" },
    { "id": "l_2", "type": "kill",       "pos": [0,0,0], "size": [200,200,200] },
    { "id": "l_3", "type": "message",    "pos": [0,0,0], "size": [200,200,200], "text": "Don't look back" },
    { "id": "l_4", "type": "teleport",   "pos": [0,0,0], "size": [200,200,200], "to": [0,0,0] },
    { "id": "l_5", "type": "checkpoint", "pos": [0,0,0], "size": [200,200,200] }
  ]
}
```

Rules
- Unknown fields must be preserved by tools and ignored by loaders.
- Unresolvable `asset` ids are skipped + logged, never fatal.
- Max 20 000 objects; loaders spawn in batches.
