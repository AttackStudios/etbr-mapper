# Custom assets — .etbrObject / .etbrEntity / .etbrItem (v1)

One self-contained UTF-8 JSON file. Everything the asset needs travels **inside** it:
models (pre-converted to Unreal units), textures (PNG), sounds, scripts and a thumbnail.
The three extensions share this layout; `kind` says which one it is.

```jsonc
{
  "format": "etbr-asset", "version": 1,
  "kind": "object" | "entity" | "item",
  "id": "a1b2c3d4e5",                 // stable unique id (letters, digits, - _)
  "name": "Rusty Locker", "author": "AttackStudioYT", "description": "",
  "icon": "data:image/png;base64,…",  // 160×160 thumbnail

  // Meshes are in Unreal space already: centimetres, Z-up, left-handed. Arrays are base64 little-endian:
  //   v  = float32 xyz positions     n = float32 xyz normals     uv = float32 uv (0,0 = top-left)
  //   i  = uint32 triangle indices (Unreal clockwise front faces)
  "meshes": {
    "body": { "sections": [ { "v": "…", "n": "…", "uv": "…", "i": "…", "tex": "skin", "color": "#ffffff", "emissive": 0 } ],
              "bounds": { "o": [0,0,90], "e": [40,40,90] } }
  },
  "textures": { "skin": "base64 PNG" },
  "sounds":   { "growl": "base64 (ogg/mp3/wav)" },
  "scripts":  { "main.lua": "-- sandboxed Lua, see API below" },

  // ---- kind-specific ----
  "object": { "mesh": "body", "collision": true },

  "entity": {
    "parts": [ { "name": "torso", "mesh": "body", "parent": null, "pos": [0,0,0], "rot": [0,0,0], "scale": [1,1,1] } ],
    "anims": {                              // rigid part animation (no skeletons)
      "idle":   { "length": 2.0, "loop": true, "tracks": [ { "part": "torso", "keys": [ [0, [0,0,0], [0,0,0]], [1, [0,0,4], [0,0,0]] ] } ] },
      "walk": {}, "run": {}, "attack": {}
    },
    "behavior": {
      "mode": "chase",                      // chase | wander | stalk (only moves when not looked at) | static
      "walkSpeed": 250, "runSpeed": 520,    // cm/s
      "sight": 2500, "loseSight": 3500,     // cm
      "kill": true, "killRange": 130,       // touching = death
      "capsule": [40, 90],                  // radius, half-height (cm)
      "sounds": { "idle": "growl", "chase": "", "kill": "" }
    }
  },

  "item": {
    "ground": { "mesh": "body" },
    "hand":   { "mesh": "body", "pos": [30, 15, -20], "rot": [0, 0, 0], "scale": [1,1,1] },
    "use": {
      "type": "none",                       // none | light | sanity | stamina | script
      "light": { "intensity": 3000, "color": "#fff4d6", "angle": 30, "range": 1500 },
      "amount": 25, "consume": false
    },
    "pickupText": "Rusty Key"
  }
}
```

## Script sandbox (runs inside the in-game loader)
No `io`, `os`, `require`, `debug`, `load`, `dofile` — scripts cannot touch files or run programs.
Available: `math`, `string`, `table`, plus an `etbr` table:
`etbr.log(s)`, `etbr.message(s)`, `etbr.self()` (this actor's position/state), `etbr.players()`,
`etbr.nearestPlayer()`, `etbr.moveTo(x,y,z)`, `etbr.play(anim)`, `etbr.sound(name)`, `etbr.kill(player)`,
`etbr.sanity(player, delta)`, `etbr.after(seconds, fn)`.
Hooks a script may define: `onSpawn()`, `onTick(dt)`, `onSeePlayer(p)`, `onTouch(p)`, `onUse(p)` (items), `onPickup(p)`.
