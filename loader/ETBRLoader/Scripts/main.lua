-- ETBR Loader — loads .etbrmap custom levels into Escape the Backrooms (UE4SS Lua)
-- by AttackStudioYT
--
-- Console (` / ~):
--   etbr list                 list maps in the maps folder
--   etbr load <name>          build the level from a file (EVERY player runs this)
--   etbr live [CODE]          LIVE TEST: build the level from a collab room and keep it in sync
--                             while people edit it; your position shows up in their editors.
--                             With no code it uses the room the editor's "Test in game" set up.
--   etbr start                host: teleport everyone to the spawn  |  client: teleport yourself
--   etbr fetch <CODE>         download a shared map by code, then load it
--   etbr unload               remove the custom level (also stops live)
--   etbr tp                   teleport yourself back to the spawn
--   etbr lowfx on|off         optional: lower shadows/post-processing if your PC struggles
-- Hotkeys: F7 load (live if the editor set it up) · F6 start · F8 unload
local json = require('json')
local cfg = require('config')
local custom = require('custom')

local VERSION = '1.2.0'
math.randomseed(os.time())
local SCRIPT_DIR = debug.getinfo(1, 'S').source:match('^@(.*[\\/])') or './'
local MOD_DIR = SCRIPT_DIR:gsub('[\\/]Scripts[\\/]$', '\\')
local MAPS_DIR = MOD_DIR .. 'maps\\'
local LIVE_FILE = MOD_DIR .. 'live.json'

local state = {
  map = nil, name = nil, byId = {}, loading = false,
  offset = { 0, 0, 200000 }, checkpoints = {}, triggered = {}, logicLoop = false,
  live = nil, -- { room, server, name, color, rev, busy }
  clock = 0, spawners = {}, spawnedEntities = {},
}

local function log(s) print('[ETBR] ' .. tostring(s) .. '\n') end

-- ---------- engine helpers ----------
local GS, KSL
local function statics()
  if not GS or not GS:IsValid() then GS = StaticFindObject('/Script/Engine.Default__GameplayStatics') end
  return GS
end
local function ksl()
  if not KSL or not KSL:IsValid() then KSL = StaticFindObject('/Script/Engine.Default__KismetSystemLibrary') end
  return KSL
end
-- local player the same way the ETB community mods do (correct in co-op, unlike FindFirstOf)
local okHelpers, UEHelpers = pcall(require, 'UEHelpers')
local function localPC()
  if okHelpers then
    local ok, pc = pcall(function() return UEHelpers.GetGameInstance().LocalPlayers[1].PlayerController end)
    if ok and pc and pc:IsValid() then return pc end
  end
  local ok, pc = pcall(function() return statics():GetPlayerController(FindFirstOf('GameStateBase') or FindFirstOf('World'), 0) end)
  if ok and pc and pc:IsValid() then return pc end
  return FindFirstOf('PlayerController')
end
local function worldCtx()
  local pc = localPC()
  if pc and pc:IsValid() then return pc end
  return FindFirstOf('World')
end
local function isHost()
  local gm = FindFirstOf('GameModeBase')
  return gm ~= nil and gm:IsValid()
end
local function vec(x, y, z) return { X = x, Y = y, Z = z } end
local function W(p) return vec(p[1] + state.offset[1], p[2] + state.offset[2], p[3] + state.offset[3]) end
local function say(out, s) log(s); if out then pcall(function() out:Log('[ETBR] ' .. s) end) end end
local function console(cmd) pcall(function() ksl():ExecuteConsoleCommand(worldCtx(), cmd, localPC()) end) end

local classCache, assetCache = {}, {}
local function findObj(cache, path)
  if cache[path] ~= nil then return cache[path] or nil end
  local a = StaticFindObject(path)
  if (not a or not a:IsValid()) and LoadAsset then pcall(function() a = LoadAsset(path) end) end
  if a and not a:IsValid() then a = nil end
  cache[path] = a or false
  return a
end

-- UE4SS's own UWorld:SpawnActor wrapper (calling BeginDeferredActorSpawnFromClass from Lua with a nil
-- owner crashed the game with an access violation — found in the first real in-game test)
local function currentWorld()
  local pc = localPC()
  local ok, w = pcall(function() return pc:GetWorld() end)
  if ok and w and w:IsValid() then return w end
  return FindFirstOf('World')
end
local function spawn(cls, loc)
  if not cls then return nil end
  local world = currentWorld()
  if not world or not world:IsValid() then return nil end
  local a = world:SpawnActor(cls, loc, { Pitch = 0, Yaw = 0, Roll = 0 })
  if not a or not a:IsValid() then return nil end
  return a
end

local function place(a, o)
  pcall(function() a:K2_SetActorLocation(W(o.pos or { 0, 0, 0 }), false, {}, true) end)
  local r = o.rot or { 0, 0, 0 }
  a:K2_SetActorRotation({ Pitch = r[1], Yaw = r[2], Roll = r[3] }, false)
  local s = o.scale or { 1, 1, 1 }
  a:SetActorScale3D(vec(s[1], s[2], s[3]))
end

local function hexColor(h, a)
  h = (h or '#ffffff'):gsub('#', '')
  return { R = tonumber(h:sub(1, 2), 16) / 255, G = tonumber(h:sub(3, 4), 16) / 255, B = tonumber(h:sub(5, 6), 16) / 255, A = a or 1 }
end

local SMA_CLASS = '/Script/Engine.StaticMeshActor'
local TEXT_CLASS = '/Script/Engine.TextRenderActor'
custom.init({
  spawn = function(c, l) return spawn(c, l) end,
  findClass = function(p) return findObj(classCache, p) end,
  findObj = function(p) return findObj(assetCache, p) end,
  world = function() return currentWorld() end,
  log = function(m) log(m) end,
  CACHE_DIR = MOD_DIR .. 'cache\\',
  -- the rest are filled in further down once those helpers exist
})

-- Lights spawned at runtime must be Movable: Static/Stationary lights rely on baked lighting and render
-- nothing when spawned in a running game (found in-game: a built Level 0 room was pitch black).
local function componentsOf(a, cls)
  local out = {}
  local arr = a:K2_GetComponentsByClass(cls)
  if type(arr) == 'table' then
    for i = 1, #arr do local c = arr[i]; if type(c) ~= 'nil' and c.get then c = c:get() end; out[#out + 1] = c end
  elseif arr and arr.ForEach then
    arr:ForEach(function(_, c) out[#out + 1] = c:get() end)
  end
  return out
end
local LIGHT_CLASS
state.fills = {}
local function lightingMode() return ((state.map and state.map.settings) or {}).lighting or 'boosted' end
local function makeLightsDynamic(a, id)
  if not LIGHT_CLASS or not LIGHT_CLASS:IsValid() then LIGHT_CLASS = StaticFindObject('/Script/Engine.LightComponent') end
  if not LIGHT_CLASS then return 0 end
  local boosted = lightingMode() == 'boosted'
  local boost = tonumber(((state.map or {}).settings or {}).lightBoost) or cfg.lightBoost
  local n = 0
  pcall(function()
    -- this UE4SS build returns a plain Lua table here (not a TArray with :ForEach)
    for _, c in ipairs(componentsOf(a, LIGHT_CLASS)) do
      pcall(function() c:SetMobility(2); n = n + 1 end)
      if boosted then
        pcall(function() c:SetIntensity((c.Intensity or 100) * boost) end)
        pcall(function() c:SetAttenuationRadius((c.AttenuationRadius or 1000) * 1.6) end)
      end
    end
  end)
  -- Boosted: one soft, shadowless warm fill light per lamp stands in for the bounce light Unreal can't bake at runtime
  if boosted and n > 0 and id then
    pcall(function()
      local p = a:K2_GetActorLocation()
      local f = spawn(findObj(classCache, '/Script/Engine.PointLight'), vec(p.X, p.Y, p.Z - 160))
      if f then
        local lc = f.LightComponent
        lc:SetMobility(2); lc:SetCastShadows(false)
        lc:SetIntensity(cfg.fillIntensity); lc:SetAttenuationRadius(cfg.fillRadius)
        lc:SetLightColor({ R = 1, G = 0.93, B = 0.72, A = 1 }, true)
        state.fills[id] = f
      end
    end)
  end
  return n
end

local function applyProps(a, o)
  local p = o.props or {}
  if o.kind == 'mesh' then pcall(function() a:SetActorEnableCollision(not p.noCollision) end) end
  -- text objects are glyph meshes (FText crashes this UE4SS build); props are applied when built
  local okL, lc = pcall(function() return a.LightComponent end)
  local isComp = okL and lc and type(lc) ~= 'function' and pcall(function() return lc:IsValid() end) and lc:IsValid()
  if isComp then
    if p.intensity then pcall(function() lc:SetIntensity(p.intensity) end) end
    if p.color then pcall(function() lc:SetLightColor(hexColor(p.color), true) end) end
    if p.radius then pcall(function() lc:SetAttenuationRadius(p.radius) end) end
  end
end

local function spawnObject(o)
  local loc = W(o.pos or { 0, 0, 0 })
  local a
  if o.kind == 'mesh' then
    local mesh = findObj(assetCache, o.asset)
    if not mesh then return nil, 'mesh not found' end
    a = spawn(findObj(classCache, SMA_CLASS), loc)
    if not a then return nil, 'spawn failed' end
    local c = a.StaticMeshComponent
    c:SetMobility(2) -- Movable, so SetStaticMesh works at runtime (and live edits can move it)
    c:SetStaticMesh(mesh)
  elseif o.kind == 'text' then
    local p = o.props or {}
    a = custom.textActor(loc, p.text or 'Text', p.size or 40, p.color)
    if not a then return nil, 'text failed' end
  elseif o.kind == 'custom' then
    local asset = state.map and state.map.customAssets and state.map.customAssets[o.asset]
    if not asset then return nil, 'custom asset not in map' end
    local err
    if asset.kind == 'object' then a, err = custom.spawnObject(asset, loc)
    elseif asset.kind == 'entity' then
      if not cfg.experimentalEntities then return nil, 'custom entities are switched off (config.lua: experimentalEntities)' end
      a, err = custom.spawnEntity(asset, loc, (o.rot or {})[2])
    elseif asset.kind == 'item' then a, err = custom.spawnItem(asset, loc)
    else return nil, 'unknown custom kind ' .. tostring(asset.kind) end
    if not a then return nil, err end
    if asset.kind == 'entity' then return a end -- the entity places itself (capsule height, yaw)
  else
    local cls = findObj(classCache, o.asset)
    if not cls then return nil, 'class not found' end
    a = spawn(cls, loc)
    if not a then return nil, 'spawn failed' end
    -- replicated gameplay actors only live on the host (they replicate to clients)
    if not isHost() and a.bReplicates then a:K2_DestroyActor(); return nil, 'host-only' end
  end
  place(a, o); applyProps(a, o)
  if o.kind ~= 'mesh' then makeLightsDynamic(a, o.id) end
  return a
end

local function destroyId(id)
  local f = state.fills and state.fills[id]
  if f then pcall(function() if f:IsValid() then f:K2_DestroyActor() end end); state.fills[id] = nil end
  local a = state.byId[id]
  if a then pcall(function() if a:IsValid() then a:K2_DestroyActor() end end) end
  state.byId[id] = nil
end

-- ---------- load / unload ----------
local logicTick
local playerPawns, teleport -- defined further down
local function unload(out, keepLive)
  -- bring players back to where they were before the custom level started (else they fall through the void)
  if state.returnPos and out ~= false then
    pcall(function()
      for _, pp in ipairs(playerPawns()) do
        local rp = state.returnPos[pp.pc:GetFullName()]
        if rp then teleport(pp, rp, pp.pc:GetControlRotation()) end
      end
    end)
    state.returnPos = nil
  end
  local n = 0
  for id in pairs(state.byId) do destroyId(id); n = n + 1 end
  for _, a in ipairs(state.spawnedEntities) do pcall(function() if a:IsValid() then a:K2_DestroyActor() end end) end
  state.spawnedEntities, state.spawners = {}, {}
  state.byId, state.map, state.triggered, state.checkpoints = {}, nil, {}, {}
  if not keepLive then state.live = nil end
  if out ~= false then say(out, 'unloaded ' .. n .. ' actors') end
end

local function readFile(p)
  local f = io.open(p, 'rb'); if not f then return nil end
  local s = f:read('a'); f:close(); return s
end

local function startLogic()
  if state.logicLoop then return end
  state.logicLoop = true
  LoopAsync(200, function() ExecuteInGameThread(function() pcall(logicTick) end); return false end)
end

-- build a map table (from a file or the live server). Spawns in batches.
local function worldName()
  local ok, n = pcall(function() return currentWorld():GetFullName() end)
  return ok and n or ''
end
local function worldId()
  local ok, id = pcall(function() local w = currentWorld(); return w:GetFullName() .. '@' .. tostring(w:GetAddress()) end)
  return ok and id or ''
end
local popups = {}
-- The world changed under us (level travel / "open"): Unreal already destroyed our actors, so drop the
-- references WITHOUT touching them (touching dead actors crashed the game in the first in-game test).
local function forgetWorld(reason)
  -- assets we resolved earlier may have been garbage-collected during travel: re-resolve everything
  -- (a stale cached StaticMesh crashed the game when building inside Level 0)
  for k in pairs(classCache) do classCache[k] = nil end
  for k in pairs(assetCache) do assetCache[k] = nil end
  GS, KSL = nil, nil
  custom.forgetWorld()
  state.byId, state.spawnedEntities, state.spawners, state.fills = {}, {}, {}, {}
  state.triggered, state.checkpoints, state.loading = {}, {}, false
  popups = {}
  state.worldId = nil
  if state.live then
    state.live.rev = -1; state.live.started = false
    log('level changed — rebuilding the live level in the new world…')
  else
    state.map = nil
    log('level changed (' .. tostring(reason) .. ') — custom level removed; load it again here if you want it')
  end
end
local function checkWorld()
  if state.worldId and worldId() ~= state.worldId then forgetWorld(worldName()); return false end
  return true
end
local function buildMap(map, label, out, onDone)
  if state.loading then return say(out, 'already loading…') end
  if worldName():find('SplashScreen') then return say(out, 'the game is still starting — wait for the main menu or a level, then try again') end
  checkWorld()
  if state.worldId ~= worldId() then
    for k in pairs(classCache) do classCache[k] = nil end
    for k in pairs(assetCache) do assetCache[k] = nil end
  end
  unload(false, true)
  state.worldId = worldId()
  state.map, state.name, state.loading = map, label, true
  state.offset = (map.settings or {}).offset or cfg.defaultOffset
  pcall(custom.setNav, (map.settings or {}).nav)
  local objs = map.objects or {}
  local i, okN, failN, fails = 0, 0, 0, {}
  say(out, ('building "%s" — %d objects…'):format((map.meta and map.meta.name) or label, #objs))
  LoopAsync(cfg.batchDelayMs, function()
    local done = false
    ExecuteInGameThread(function()
      for _ = 1, cfg.batchSize do
        i = i + 1
        local o = objs[i]
        if not o then done = true; break end
        local ok2, a, err = pcall(spawnObject, o)
        if ok2 and a then okN = okN + 1; state.byId[o.id] = a
        else
          failN = failN + 1
          local why = ok2 and err or a
          if why ~= 'host-only' and #fails < 20 then fails[#fails + 1] = (o.asset or '?') .. ' -> ' .. tostring(why) end
        end
      end
    end)
    if done or i > #objs then
      state.loading = false
      say(out, ('loaded: %d spawned, %d skipped'):format(okN, failN))
      for _, f in ipairs(fails) do log('  skip ' .. f) end
      startLogic()
      if onDone then onDone() end
      return true
    end
    return false
  end)
end

local function resolveMap(name)
  if not name or name == '' then return nil end
  local p = name:find('[\\/]') and name or (MAPS_DIR .. name)
  if not p:lower():find('%.etbrmap$') then p = p .. '.etbrmap' end
  return p
end
local function listMaps()
  local t = {}
  local h = io.popen('dir /b /o-d "' .. MAPS_DIR .. '*.etbrmap" 2>nul')
  if h then for l in h:lines() do t[#t + 1] = (l:gsub('%.etbrmap$', '')) end; h:close() end
  return t
end
local function loadFile(name, out)
  local path = resolveMap(name)
  local txt = path and readFile(path)
  if not txt then return say(out, 'map not found: ' .. tostring(path) .. '  (try: etbr list)') end
  local ok, map = pcall(json.decode, txt)
  if not ok or type(map) ~= 'table' or map.format ~= 'etbrmap' then return say(out, 'not a valid .etbrmap: ' .. tostring(map)) end
  state.live = nil
  buildMap(map, name, out, function()
    say(out, isHost() and 'host: type  etbr start  (or F6) when everyone has loaded' or 'waiting for host to start (or F6 to go now)')
  end)
end

-- ---------- players / teleport ----------
playerPawns = function()
  local t = {}
  for _, pc in ipairs(FindAllOf('PlayerController') or {}) do
    if pc:IsValid() then
      local p = pc.Pawn
      if p and p:IsValid() then t[#t + 1] = { pc = pc, pawn = p } end
    end
  end
  return t
end
local function spawnPoint(i)
  local sp = (state.map.settings or {}).spawn or { pos = { 0, 0, 100 }, yaw = 0 }
  local p = sp.pos
  local dx = (i and i > 0) and math.cos(i) * 90 or 0
  local dy = (i and i > 0) and math.sin(i) * 90 or 0
  return W({ p[1] + dx, p[2] + dy, p[3] }), { Pitch = 0, Yaw = sp.yaw or 0, Roll = 0 }
end
teleport = function(pp, loc, rot)
  -- proven in ETBCommandsMod setpos: sweep off, teleport physics on
  local ok = pcall(function() pp.pawn:K2_SetActorLocation(loc, false, {}, true) end)
  if not ok then pcall(function() pp.pawn:K2_TeleportTo(loc, rot) end) end
  pcall(function() pp.pc:SetControlRotation(rot) end)
end
local popup -- defined below (forward declaration so the custom helpers can use it)
-- remaining custom-content helpers (need playerPawns/teleport/popup from above)
do
  local env = custom._env or {}
  local function rotToQuat(r)
    local p, y, ro = math.rad(r[1] or 0) / 2, math.rad(r[2] or 0) / 2, math.rad(r[3] or 0) / 2
    local SP, CP, SY, CY, SR, CR = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(ro), math.cos(ro)
    return { X = CR * SP * SY - SR * CP * CY, Y = -CR * SP * CY - SR * CP * SY, Z = CR * CP * SY - SR * SP * CY, W = CR * CP * CY + SR * SP * SY }
  end
  custom.init({
    spawn = function(c, l) return spawn(c, l) end,
    findClass = function(p) return findObj(classCache, p) end,
    findObj = function(p) return findObj(assetCache, p) end,
    world = function() return currentWorld() end,
    log = function(m) log(m) end,
    CACHE_DIR = MOD_DIR .. 'cache\\',
    MOD_DIR = MOD_DIR,
    offset = function() return state.offset end,
    rotToQuat = rotToQuat,
    players = function()
      local me = localPC(); local t = {}
      for _, pp in ipairs(playerPawns()) do pp.key = pp.pc:GetFullName(); pp.isLocal = me and pp.pc:GetAddress() == me:GetAddress(); t[#t + 1] = pp end
      return t
    end,
    localPawn = function() local pc = localPC(); return pc and pc.Pawn and pc.Pawn:IsValid() and pc.Pawn or nil end,
    localPlayer = function() local pc = localPC(); return { pc = pc, pawn = pc.Pawn, isLocal = true } end,
    message = function(text) local pc = localPC(); if pc then pcall(popup, pc, text) end end,
    -- the game's own death (same path its monsters use): server RPC first, native fallback
    kill = function(pp)
      -- signatures read in-game: KillServer(bool bResetInteractable), KillPlayer(bool bResetInteractable)
      local ok = pcall(function() pp.pawn:KillServer(false) end)
      if not ok then ok = pcall(function() pp.pawn:KillPlayer(false) end) end
      log(ok and 'entity killed a player' or 'entity kill: game kill function not callable')
    end,
    addSanity = function(pp, d) pcall(function() local ps = pp.pc.PlayerState; ps.Sanity = math.max(0, math.min(100, (ps.Sanity or 100) + d)) end) end,
  })
end
LoopAsync(50, function()
  ExecuteInGameThread(function()
    if state.map and not state.loading and checkWorld() then pcall(custom.tickEntities, 0.05) end
    pcall(custom.tickTimers)
  end)
  return false
end)
LoopAsync(100, function() pcall(custom.drainSounds); return false end)
RegisterKeyBind(Key[cfg.keyPickup], function() ExecuteInGameThread(function() pcall(custom.tryPickup) end) end)
RegisterKeyBind(Key[cfg.keyUse], function() ExecuteInGameThread(function() pcall(custom.useHand) end) end)
RegisterKeyBind(Key[cfg.keyDrop], function() ExecuteInGameThread(function() pcall(custom.dropHand) end) end)

local function start(out)
  if not state.map then return say(out, 'no map loaded — etbr load <name> or etbr live first') end
  state.returnPos = state.returnPos or {}
  for _, pp in ipairs(playerPawns()) do
    pcall(function() local key = pp.pc:GetFullName(); if not state.returnPos[key] then local p = pp.pawn:K2_GetActorLocation(); state.returnPos[key] = { X = p.X, Y = p.Y, Z = p.Z } end end)
  end
  if isHost() then
    for i, pp in ipairs(playerPawns()) do local l, r = spawnPoint(i - 1); teleport(pp, l, r) end
    say(out, 'started — everyone teleported to the spawn')
  else
    local pc = localPC()
    if pc and pc.Pawn and pc.Pawn:IsValid() then local l, r = spawnPoint(0); teleport({ pc = pc, pawn = pc.Pawn }, l, r) end
    say(out, 'teleported to spawn (the host should run  etbr start)')
  end
end

-- ---------- logic volumes ----------
local function inside(p, l)
  local c, s = W(l.pos), l.size or { 200, 200, 200 }
  return math.abs(p.X - c.X) <= s[1] / 2 and math.abs(p.Y - c.Y) <= s[2] / 2 and math.abs(p.Z - c.Z) <= s[3] / 2
end
popup = function(pc, text)
  local pawn = pc.Pawn; if not pawn or not pawn:IsValid() then return end
  local loc = pawn:K2_GetActorLocation()
  local rot = pc:GetControlRotation()
  local yaw = math.rad(rot.Yaw)
  local a = custom.textActor(vec(loc.X + math.cos(yaw) * 220, loc.Y + math.sin(yaw) * 220, loc.Z + 40), text, 14, '#fff3c4')
  if not a then return end
  a:K2_SetActorRotation({ Pitch = 0, Yaw = rot.Yaw + 180, Roll = 0 }, false) -- face the player
  popups[#popups + 1] = { a = a, t = os.clock() + 4 }
end
-- Entity Spawn Areas (host only): each group waits a random min..max seconds, then spawns its
-- entity at a random spot inside one of its areas (respecting maxAlive), then rolls a new delay.
local function rnd(a, b) a = tonumber(a) or 20; b = math.max(tonumber(b) or a, a); return a + math.random() * (b - a) end
local function spawnerTick(dt)
  local groups = (state.map.settings or {}).spawnGroups
  if not groups then return end
  state.clock = state.clock + dt
  for g, G in pairs(groups) do
    local S = state.spawners[g]
    if not S then S = { next = state.clock + (tonumber(G.startDelay) or 0) + rnd(G.min, G.max), alive = {} }; state.spawners[g] = S end
    for k = #S.alive, 1, -1 do local a = S.alive[k]; if not a or not a:IsValid() then table.remove(S.alive, k) end end
    if state.clock >= S.next then
      S.next = state.clock + rnd(G.min, G.max)
      if G.entity and G.entity ~= '' and #S.alive < (tonumber(G.maxAlive) or 2) then
        local areas = {}
        for _, l in ipairs(state.map.logic or {}) do if l.type == 'entityspawn' and (l.group or 'Group 1') == g then areas[#areas + 1] = l end end
        if #areas > 0 then
          local l = areas[math.random(#areas)]
          local c, sz = W(l.pos), l.size or { 400, 400, 250 }
          local p = vec(c.X + (math.random() - 0.5) * sz[1], c.Y + (math.random() - 0.5) * sz[2], c.Z - sz[3] / 2 + 100)
          local cls = findObj(classCache, G.entity)
          local a = cls and spawn(cls, p)
          if a then
            pcall(function() a:K2_SetActorRotation({ Pitch = 0, Yaw = math.random() * 360, Roll = 0 }, false) end)
            pcall(function() a:SpawnDefaultController() end) -- give it its AI brain
            S.alive[#S.alive + 1] = a; state.spawnedEntities[#state.spawnedEntities + 1] = a
            log(('spawned %s in group "%s" (%d alive), next in %.0f s'):format(G.entity:match('([^./]+)_C$') or G.entity, g, #S.alive, S.next - state.clock))
          else log('could not spawn entity ' .. tostring(G.entity)) end
        end
      end
    end
  end
end

function logicTick()
  -- live pose sample (read on the game thread, sent from the async loop)
  if state.live then
    local pc = localPC()
    if pc and pc.Pawn and pc.Pawn:IsValid() then
      local p = pc.Pawn:K2_GetActorLocation(); local r = pc:GetControlRotation()
      state.live.pose = ('%.0f,%.0f,%.0f'):format(p.X - state.offset[1], p.Y - state.offset[2], p.Z - state.offset[3])
      state.live.yaw = ('%.1f'):format(r.Yaw)
      local cr = 0; pcall(function() if pc.Pawn.bIsCrouched then cr = 1 end end)
      state.live.cr = cr
    end
  end
  if not state.map or state.loading then return end
  if not checkWorld() then return end
  local host = isHost()
  local me = localPC()
  local now = os.clock()
  if host then pcall(spawnerTick, 0.2) end
  for k = #popups, 1, -1 do
    if now > popups[k].t then pcall(function() popups[k].a:K2_DestroyActor() end); table.remove(popups, k) end
  end
  local killZ = state.offset[3] + (((state.map.settings or {}).killZ) or -3000)
  for i, pp in ipairs(playerPawns()) do
    local ok, p = pcall(function() return pp.pawn:K2_GetActorLocation() end)
    if ok and p and p.Z > state.offset[3] - 20000 then
      local key = pp.pc:GetFullName()
      local mine = me and pp.pc == me
      if host and p.Z < killZ then
        local cp = state.checkpoints[key]
        if cp then teleport(pp, cp, { Pitch = 0, Yaw = 0, Roll = 0 }) else local l, r = spawnPoint(i - 1); teleport(pp, l, r) end
      end
      for _, l in ipairs(state.map.logic or {}) do
        local tk = key .. l.id
        local isIn = inside(p, l)
        if isIn and not state.triggered[tk] then
          state.triggered[tk] = true
          if l.type == 'message' and mine then popup(pp.pc, l.text or '')
          elseif l.type == 'checkpoint' then state.checkpoints[key] = W(l.pos); if mine then popup(pp.pc, 'Checkpoint') end
          elseif l.type == 'kill' and host then
            local cp = state.checkpoints[key]
            if cp then teleport(pp, cp, { Pitch = 0, Yaw = 0, Roll = 0 }) else local s, r = spawnPoint(i - 1); teleport(pp, s, r) end
          elseif l.type == 'teleport' and host and l.to then teleport(pp, W(l.to), { Pitch = 0, Yaw = pp.pc:GetControlRotation().Yaw, Roll = 0 })
          elseif l.type == 'exit' then
            if mine then popup(pp.pc, l.text or 'You escaped!') end
            if host and l.next and l.next ~= '' then
              local gm = FindFirstOf('GameModeBase')
              pcall(function() gm:LoadLevel(FName(l.next), false, true) end)
            end
          end
        elseif not isIn and state.triggered[tk] and l.type ~= 'exit' then
          state.triggered[tk] = nil
        end
      end
    end
  end
end

-- ---------- live link ----------
local function findIdx(list, id) for i, v in ipairs(list) do if v.id == id then return i end end end
local function merge(dst, patch) for k, v in pairs(patch) do dst[k] = v end end

-- apply editor ops (same format as the collab server) to the running level
local function applyOps(ops)
  local m = state.map; if not m then return end
  for _, op in ipairs(ops) do
    local c = op.c == 'logic' and 'logic' or 'objects'
    if op.o == 'add' and op.item then
      local list = m[c]; list[#list + 1] = op.item
      if c == 'objects' then local ok, a = pcall(spawnObject, op.item); if ok and a then state.byId[op.item.id] = a end end
    elseif op.o == 'set' then
      local i = findIdx(m[c], op.id)
      if i then
        local it = m[c][i]; merge(it, op.patch or {})
        if c == 'objects' then
          local a = state.byId[op.id]
          local p = op.patch or {}
          if (p.asset or p.kind) or not a or not a:IsValid() then
            destroyId(op.id)
            local ok, na = pcall(spawnObject, it); if ok and na then state.byId[op.id] = na end
          else
            pcall(place, a, it)
            if p.props then pcall(applyProps, a, it) end
          end
        end
      end
    elseif op.o == 'del' then
      local i = findIdx(m[c], op.id)
      if i then table.remove(m[c], i) end
      if c == 'objects' then destroyId(op.id) end
    elseif op.o == 'cfg' then
      local k = op.k == 'meta' and 'meta' or 'settings'
      m[k] = m[k] or {}; merge(m[k], op.patch or {})
      if k == 'settings' and op.patch and op.patch.nav ~= nil then pcall(custom.setNav, op.patch.nav) end
      if op.patch and (op.patch.offset or op.patch.lighting or op.patch.lightBoost) then state.live.rev = -1 end -- full rebuild
    elseif op.o == 'asset' and op.asset then
      m.customAssets = m.customAssets or {}
      m.customAssets[op.asset.id] = op.asset
    elseif op.o == 'replace' then
      state.live.rev = -1
    end
  end
end

local function urlenc(s) return (tostring(s):gsub('[^%w%-_%.~]', function(ch) return ('%%%02X'):format(ch:byte()) end)) end

local function liveTick()
  local L = state.live
  if not L then return true end -- stops the loop
  if L.busy or state.loading then return false end
  L.busy = true
  local url = ('%s/api/room/%s/sync?since=%d&name=%s&color=%s'):format(L.server, L.room, L.rev, urlenc(L.name), urlenc(L.color))
  if L.pose then url = url .. ('&p=%s&yaw=%s&cr=%d'):format(L.pose, L.yaw or 0, L.cr or 0) end
  local h = io.popen('curl.exe -s -f -m 8 "' .. url .. '"')
  local body = h and h:read('a') or ''
  if h then h:close() end
  L.busy = false
  if body == '' then L.fails = (L.fails or 0) + 1; if L.fails == 3 then log('live: server not answering (it may be waking up)…') end; return false end
  L.fails = 0
  local ok, res = pcall(json.decode, body)
  if not ok or type(res) ~= 'table' then return false end
  if res.map then
    L.rev = res.rev
    ExecuteInGameThread(function()
      buildMap(res.map, 'live:' .. L.room, nil, function()
        if not L.started then L.started = true; log('LIVE — level built. Press F6 / etbr start to go to the spawn. Edits appear instantly.') end
      end)
    end)
  elseif res.ops and #res.ops > 0 then
    L.rev = res.rev
    ExecuteInGameThread(function() if checkWorld() then pcall(applyOps, res.ops) end end)
  else
    L.rev = res.rev or L.rev
  end
  return false
end

local function goLive(code, out)
  local saved = {}
  local txt = readFile(LIVE_FILE)
  if txt then local ok, t = pcall(json.decode, txt); if ok and type(t) == 'table' then saved = t end end
  code = (code and code ~= '' and code or saved.room or ''):upper():gsub('[^A-Z0-9]', '')
  if #code ~= 6 then return say(out, 'no live room — press "Test in game" in the editor, or type: etbr live ABC123') end
  if state.live and state.live.room == code then return say(out, 'already live in ' .. code) end
  unload(false)
  state.live = { room = code, server = (saved.server or cfg.serverUrl):gsub('/$', ''), name = saved.name or 'Player', color = saved.color or '#4fd1ff', rev = -1 }
  say(out, 'going LIVE in room ' .. code .. ' — the first connect can take ~30 s if the server was asleep')
  startLogic()
  LoopAsync(cfg.livePollMs, liveTick)
end

-- ---------- optional low effects (off by default) ----------
local function lowfx(on, out)
  local cmds = on and { 'sg.ShadowQuality 0', 'sg.PostProcessQuality 0', 'sg.EffectsQuality 0', 'r.VolumetricFog 0' }
    or { 'sg.ShadowQuality 3', 'sg.PostProcessQuality 3', 'sg.EffectsQuality 3', 'r.VolumetricFog 1' }
  ExecuteInGameThread(function() for _, c in ipairs(cmds) do console(c) end end)
  say(out, 'low effects ' .. (on and 'ON' or 'OFF'))
end

-- ---------- fetch shared map ----------
local function fetch(code, out)
  code = (code or ''):upper():gsub('[^A-Z0-9]', '')
  if #code ~= 6 then return say(out, 'usage: etbr fetch ABC123') end
  local file = MAPS_DIR .. code .. '.etbrmap'
  os.execute('mkdir "' .. MAPS_DIR .. '" 2>nul')
  say(out, 'downloading ' .. code .. '… (first request can take ~30 s while the server wakes)')
  local ok = os.execute(('curl.exe -s -f -m 60 -o "%s" "%s/api/room/%s/map"'):format(file, cfg.serverUrl, code))
  if ok then ExecuteInGameThread(function() loadFile(code, out) end) else say(out, 'download failed — check the code / internet') end
end

-- ---------- commands + keys ----------
local function hasLiveFile() local t = readFile(LIVE_FILE); return t and t:find('"room"') end
local function handle(args, out)
  local sub = (args[1] or 'help'):lower()
  if sub == 'load' then
    local name = table.concat(args, ' ', 2)
    if name == '' then name = listMaps()[1] end
    if not name then say(out, 'no maps in ' .. MAPS_DIR) else ExecuteInGameThread(function() loadFile(name, out) end) end
  elseif sub == 'live' then
    if args[2] == 'off' then unload(out) else goLive(args[2], out) end
  elseif sub == 'start' then ExecuteInGameThread(function() start(out) end)
  elseif sub == 'tp' then
    ExecuteInGameThread(function()
      local pc = localPC()
      if state.map and pc and pc.Pawn then local l, r = spawnPoint(0); teleport({ pc = pc, pawn = pc.Pawn }, l, r) end
    end)
  elseif sub == 'unload' then ExecuteInGameThread(function() checkWorld(); unload(out) end)
  elseif sub == 'fetch' then fetch(args[2], out)
  elseif sub == 'lowfx' then lowfx(args[2] ~= 'off', out)
  elseif sub == 'list' then
    local m = listMaps()
    say(out, #m == 0 and ('no maps in ' .. MAPS_DIR) or ('maps: ' .. table.concat(m, ', ')))
  elseif sub == 'where' then
    ExecuteInGameThread(function()
      local pc = localPC(); local p = pc.Pawn:K2_GetActorLocation()
      say(out, ('%.0f %.0f %.0f  (map-local %.0f %.0f %.0f)'):format(p.X, p.Y, p.Z, p.X - state.offset[1], p.Y - state.offset[2], p.Z - state.offset[3]))
    end)
  else
    say(out, 'ETBR Loader ' .. VERSION .. ' — etbr list | load <name> | live [CODE] | start | fetch <CODE> | tp | unload | lowfx on/off | where')
  end
end

RegisterConsoleCommandHandler('etbr', function(_full, params, out)
  local args = {}
  for i = 1, #params do args[#args + 1] = params[i] end
  handle(args, out)
  return true
end)

-- F7: live test if the editor set one up, otherwise load the newest map file
RegisterKeyBind(Key[cfg.keyLoad], function()
  if hasLiveFile() then handle({ 'live' }) else handle({ 'load', state.name or listMaps()[1] or '' }) end
end)
RegisterKeyBind(Key[cfg.keyStart], function() handle({ 'start' }) end)
RegisterKeyBind(Key[cfg.keyUnload], function() handle({ 'unload' }) end)

-- the old world (and our actors) die on level change; rebuild automatically if we're live
pcall(function()
  local hook = RegisterLoadMapMPPostHook or RegisterLoadMapPostHook
  if hook then hook(function()
    state.byId, state.loading = {}, false
    if state.live then state.live.rev = -1; state.live.started = false else state.map = nil end
  end) end
end)

-- Developer remote control: ONLY active if a "dev.enable" file sits next to the mod (never shipped).
-- Lines written to devcmd.txt run as console commands: "etbr ..." or any Unreal console command after "ue ".
if readFile(MOD_DIR .. 'dev.enable') then
  log('dev command channel enabled (devcmd.txt)')
  LoopAsync(500, function()
    local txt = readFile(MOD_DIR .. 'devcmd.txt')
    if txt and #txt > 0 then
      os.remove(MOD_DIR .. 'devcmd.txt')
      for line in txt:gmatch('[^\r\n]+') do
        log('dev> ' .. line)
        local words = {}
        for w in line:gmatch('%S+') do words[#words + 1] = w end
        if words[1] == 'etbr' then table.remove(words, 1); pcall(handle, words, nil)
        elseif words[1] == 'ue' then local c = line:sub(4); ExecuteInGameThread(function() console(c) end)
        elseif words[1] == 'sig' then -- sig <FunctionName> : parameter list of that function on the pawn's class chain
          ExecuteInGameThread(function()
            local cls = localPC().Pawn:GetClass()
            while cls and cls:IsValid() do
              local fn = nil
              pcall(function() cls:ForEachFunction(function(f) if f:GetFName():ToString() == words[2] then fn = f end end) end)
              if fn then
                log('sig ' .. cls:GetFName():ToString() .. '::' .. words[2])
                pcall(function() fn:ForEachProperty(function(prop) log(('   %s : %s'):format(prop:GetFName():ToString(), prop:GetClass():GetFName():ToString())) end) end)
                return
              end
              local ok, sup = pcall(function() return cls:GetSuperStruct() end)
              if not ok or not sup or not sup:IsValid() then break end
              cls = sup
            end
            log('sig: ' .. tostring(words[2]) .. ' not found')
          end)
        elseif words[1] == 'entdbg' then -- entdbg move|anim|speed|vel on|off
          custom.dbg[words[2] or ''] = words[3] ~= 'off'; log('entdbg ' .. tostring(words[2]) .. '=' .. tostring(custom.dbg[words[2] or '']))
        elseif words[1] == 'msgtest' then ExecuteInGameThread(function() log('msgtest start'); local pc = localPC(); pcall(popup, pc, table.concat(words, ' ', 2) ~= '' and table.concat(words, ' ', 2) or 'Hello from ETBR'); log('msgtest done') end)
        elseif words[1] == 'pickup' then ExecuteInGameThread(function() log('dev pickup: ' .. tostring(select(2, pcall(custom.tryPickup)))) end)
        elseif words[1] == 'use' then ExecuteInGameThread(function() pcall(custom.useHand); log('dev use') end)
        elseif words[1] == 'ents' then ExecuteInGameThread(function()
            for i, e in ipairs(custom.entities) do pcall(function()
              local p = e.actor:K2_GetActorLocation()
              local ctrl, mode, vel = 'none', '?', '?'
              pcall(function() local c = e.actor.Controller; if c and c:IsValid() then ctrl = c:GetClass():GetFName():ToString() end end)
              pcall(function() mode = tostring(e.actor.CharacterMovement.MovementMode) end)
              pcall(function() local v = e.actor:GetVelocity(); vel = ('%.0f,%.0f,%.0f'):format(v.X, v.Y, v.Z) end)
              log(('ent %d %s at %.0f %.0f %.0f state=%s chasing=%s speed=%s path=%s'):format(i, e.asset.name, p.X, p.Y, p.Z, e.state, tostring(e.chasing), tostring(e.vel), tostring(e.path and #e.path)))
            end) end
            log('ents: ' .. #custom.entities .. ', items: ' .. #custom.items)
          end)
        elseif words[1] == 'hideui' then
          ExecuteInGameThread(function()
            pcall(function() StaticFindObject('/Script/UMG.Default__WidgetBlueprintLibrary'):RemoveAllWidgets(currentWorld()) end)
            pcall(function() local pc = localPC(); pc.bShowMouseCursor = false; StaticFindObject('/Script/UMG.Default__WidgetBlueprintLibrary'):SetInputMode_GameOnly(pc) end)
            log('dev: widgets removed')
          end)
        elseif words[1] == 'tpto' then -- tpto x y z (world cm)
          ExecuteInGameThread(function()
            local pc = localPC()
            pcall(function() pc.Pawn:K2_SetActorLocation(vec(tonumber(words[2]), tonumber(words[3]), tonumber(words[4])), false, {}, true) end)
          end)
        elseif words[1] == 'comps' then -- comps <asset substring>: list components of the first matching spawned actor
          ExecuteInGameThread(function()
            local want = words[2] or 'level0'
            for id, a in pairs(state.byId) do
              local ok, nm = pcall(function() return a:GetFullName() end)
              if ok and nm:find(want) then
                log('comps of ' .. nm:sub(1, 120))
                local AC = StaticFindObject('/Script/Engine.ActorComponent')
                local n = 0
                local ok1, e1 = pcall(function()
                  local arr = a:K2_GetComponentsByClass(AC)
                  log('  array type: ' .. type(arr) .. ' len=' .. tostring(#arr))
                  for i = 1, #arr do
                    local c = arr[i]; if c.get then c = c:get() end
                    n = n + 1
                    local cls = '?'; pcall(function() cls = c:GetClass():GetFName():ToString() end)
                    log(('  [%d] %s  %s'):format(i, cls, c:GetFName():ToString()))
                  end
                end)
                if not ok1 then log('  error: ' .. tostring(e1)) end
                log('  total ' .. n)
                break
              end
            end
          end)
        elseif words[1] == 'funcs' then -- funcs <substr> [pawn|ps|gm|pc]: list UFunctions on that object's class chain
          ExecuteInGameThread(function()
            local pc = localPC()
            local target = ({ pawn = function() return pc.Pawn end, ps = function() return pc.PlayerState end, pc = function() return pc end, gm = function() return FindFirstOf('GameModeBase') end })[words[3] or 'pawn']()
            local want = (words[2] or ''):lower()
            local cls = target:GetClass()
            local n = 0
            while cls and cls:IsValid() and n < 400 do
              local cname = cls:GetFName():ToString()
              pcall(function()
                cls:ForEachFunction(function(f)
                  local fn = f:GetFName():ToString()
                  if fn:lower():find(want, 1, true) then log(('  %s::%s'):format(cname, fn)); n = n + 1 end
                end)
              end)
              local ok, sup = pcall(function() return cls:GetSuperStruct() end)
              if not ok or not sup or not sup:IsValid() then break end
              cls = sup
            end
            log('funcs done (' .. n .. ')')
          end)
        elseif words[1] == 'lightinfo' then
          ExecuteInGameThread(function()
            if not LIGHT_CLASS then LIGHT_CLASS = StaticFindObject('/Script/Engine.LightComponent') end
            local total, on = 0, 0
            for id, a in pairs(state.byId) do
              pcall(function()
                for _, lc in ipairs(componentsOf(a, LIGHT_CLASS)) do
                  total = total + 1
                  local vis, mob, inten = '?', '?', '?'
                  pcall(function() vis = tostring(lc:IsVisible()) end)
                  pcall(function() mob = tostring(lc.Mobility) end)
                  pcall(function() inten = tostring(lc.Intensity) end)
                  if vis == 'true' then on = on + 1 end
                  if total <= 4 then log(('  light %s vis=%s mobility=%s intensity=%s'):format(lc:GetFullName():sub(1, 90), vis, mob, inten)) end
                end
              end)
            end
            log(('lightinfo: %d light components, %d visible'):format(total, on))
          end)
        elseif words[1] == 'look' then -- look pitch yaw
          ExecuteInGameThread(function() pcall(function() localPC():SetControlRotation({ Pitch = tonumber(words[2]) or 0, Yaw = tonumber(words[3]) or 0, Roll = 0 }) end) end)
        elseif words[1] == 'state' then
          ExecuteInGameThread(function()
            local n = 0; for _ in pairs(state.byId) do n = n + 1 end
            local pc = localPC(); local where = '?'
            pcall(function() local p = pc.Pawn:K2_GetActorLocation(); where = ('%.0f %.0f %.0f'):format(p.X, p.Y, p.Z) end)
            local w = '?'; pcall(function() w = pc:GetWorld():GetFullName() end)
            log(('state: map=%s actors=%d live=%s rev=%s pawn=%s world=%s'):format(tostring(state.map and state.map.meta and state.map.meta.name), n, tostring(state.live and state.live.room), tostring(state.live and state.live.rev), where, w))
          end)
        end
      end
    end
    return false
  end)
end

log('ETBR Loader ' .. VERSION .. ' ready — maps folder: ' .. MAPS_DIR)
