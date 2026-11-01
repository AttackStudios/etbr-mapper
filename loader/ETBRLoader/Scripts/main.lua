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
local function localPC()
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

local function spawn(cls, loc)
  local t = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = loc, Scale3D = vec(1, 1, 1) }
  local a = statics():BeginDeferredActorSpawnFromClass(worldCtx(), cls, t, 1, nil)
  if not a or not a:IsValid() then return nil end
  statics():FinishSpawningActor(a, t)
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

local function applyProps(a, o)
  local p = o.props or {}
  if o.kind == 'mesh' then pcall(function() a:SetActorEnableCollision(not p.noCollision) end) end
  if o.kind == 'text' then
    local c = a.TextRender
    c:SetText(FText(p.text or 'Text')); c:SetWorldSize(p.size or 40)
    c:SetTextRenderColor(hexColor(p.color, 1)); c:SetHorizontalAlignment(1)
  end
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
    a = spawn(findObj(classCache, TEXT_CLASS), loc)
    if not a then return nil, 'spawn failed' end
  else
    local cls = findObj(classCache, o.asset)
    if not cls then return nil, 'class not found' end
    a = spawn(cls, loc)
    if not a then return nil, 'spawn failed' end
    -- replicated gameplay actors only live on the host (they replicate to clients)
    if not isHost() and a.bReplicates then a:K2_DestroyActor(); return nil, 'host-only' end
  end
  place(a, o); applyProps(a, o)
  return a
end

local function destroyId(id)
  local a = state.byId[id]
  if a then pcall(function() if a:IsValid() then a:K2_DestroyActor() end end) end
  state.byId[id] = nil
end

-- ---------- load / unload ----------
local logicTick
local function unload(out, keepLive)
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
local function buildMap(map, label, out, onDone)
  if state.loading then return say(out, 'already loading…') end
  unload(false, true)
  state.map, state.name, state.loading = map, label, true
  state.offset = (map.settings or {}).offset or cfg.defaultOffset
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
local function playerPawns()
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
local function teleport(pp, loc, rot)
  pcall(function() pp.pawn:K2_TeleportTo(loc, rot) end)
  pcall(function() pp.pc:SetControlRotation(rot) end)
end
local function start(out)
  if not state.map then return say(out, 'no map loaded — etbr load <name> or etbr live first') end
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
local popups = {}
local function popup(pc, text)
  local pawn = pc.Pawn; if not pawn or not pawn:IsValid() then return end
  local loc = pawn:K2_GetActorLocation()
  local rot = pc:GetControlRotation()
  local yaw = math.rad(rot.Yaw)
  local a = spawn(findObj(classCache, TEXT_CLASS), vec(loc.X + math.cos(yaw) * 220, loc.Y + math.sin(yaw) * 220, loc.Z + 40))
  if not a then return end
  a.TextRender:SetText(FText(text)); a.TextRender:SetWorldSize(22); a.TextRender:SetHorizontalAlignment(1)
  a.TextRender:SetTextRenderColor(hexColor('#fff3c4'))
  a:K2_SetActorRotation({ Pitch = 0, Yaw = rot.Yaw + 180, Roll = 0 }, false)
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
      if op.patch and op.patch.offset then state.live.rev = -1 end -- moved the whole level: full rebuild
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
    ExecuteInGameThread(function() pcall(applyOps, res.ops) end)
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
  elseif sub == 'unload' then ExecuteInGameThread(function() unload(out) end)
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

log('ETBR Loader ' .. VERSION .. ' ready — maps folder: ' .. MAPS_DIR)
