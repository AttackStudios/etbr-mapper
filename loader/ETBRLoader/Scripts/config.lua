-- ETBR Loader settings (safe to edit)
return {
  serverUrl = 'https://etbr-collab.onrender.com', -- collab server, for `etbr fetch CODE`
  keyLoad = 'F7',      -- load last / newest map
  keyStart = 'F6',     -- teleport to spawn (host: everyone)
  keyUnload = 'F8',    -- remove custom level
  batchSize = 120,     -- objects spawned per tick (lower = smoother, slower)
  batchDelayMs = 30,
  livePollMs = 250,    -- live test: how often to check for edits (ms)
  defaultOffset = { 0, 0, 200000 }, -- levels are built 2 km above the current map
  -- "Boosted" lighting (per-level setting in the editor) — stands in for baked bounce light
  lightBoost = 4,        -- lamp brightness multiplier
  fillIntensity = 900,   -- soft fill light per lamp (lumens-ish, shadowless)
  fillRadius = 900,      -- cm
}
