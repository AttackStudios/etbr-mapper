-- ETBR Loader settings (safe to edit)
return {
  serverUrl = 'https://etbr-collab.onrender.com', -- collab server, for `etbr fetch CODE`
  keyLoad = 'F7',      -- load last / newest map
  keyStart = 'F6',     -- teleport to spawn (host: everyone)
  keyUnload = 'F8',    -- remove custom level
  experimentalEntities = true, -- custom .etbrEntity creatures
  keyPickup = 'E',     -- pick up a custom item (same key as the game's interact)
  keyUse = 'G',        -- use the custom item in your hand
  keyDrop = 'X',       -- drop it
  batchSize = 40,      -- objects spawned per tick, about 30 ticks a second (lower = smoother, slower)
  livePollMs = 250,    -- live test: how often to check for edits (ms)
  defaultOffset = { 0, 0, 200000 }, -- levels are built 2 km above the current map
  -- "Boosted" lighting (per-level setting in the editor) — stands in for baked bounce light
  lightBoost = 4,        -- lamp brightness multiplier
  fillIntensity = 900,   -- soft fill light per lamp (lumens-ish, shadowless)
  fillRadius = 900,      -- cm
}
