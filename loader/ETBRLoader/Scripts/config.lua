-- ETBR Loader settings (safe to edit)
return {
  serverUrl = 'https://etbr-collab.onrender.com', -- collab server, for `etbr fetch CODE`
  keyLoad = 'F7',      -- load last / newest map
  keyStart = 'F6',     -- teleport to spawn (host: everyone)
  keyUnload = 'F8',    -- remove custom level
  batchSize = 120,     -- objects spawned per tick (lower = smoother, slower)
  batchDelayMs = 30,
  defaultOffset = { 0, 0, 200000 }, -- levels are built 2 km above the current map
}
