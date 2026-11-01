-- ETBR Loader — loads .etbrmap custom levels into Escape the Backrooms (UE4SS Lua)
-- by AttackStudioYT
--
-- Console (` / ~):
--   etbr list                 list maps in the maps folder
--   etbr load <name>          build the level (EVERY player runs this)
--   etbr start                host: teleport everyone to the spawn  |  client: teleport yourself
--   etbr fetch <CODE>         download a shared/collab map by its 6-letter code, then load it
--   etbr unload               remove the custom level
--   etbr tp                   teleport yourself back to the spawn
-- Hotkeys: F7 load last map · F6 start · F8 unload
local json = require('json')
local cfg = require('config')

local VERSION = '1.0.0'
local SCRIPT_DIR = debug.getinfo(1, 'S').source:match('^@(.*[\\/])') or './'
local MOD_DIR = SCRIPT_DIR:gsub('[\\/]Scripts[\\/]$', '\\')
local MAPS_DIR = MOD_DIR .. 'maps\\'

local state = {
  map = nil, name = nil, spawned = {}, loading = false,
  offset = { 0, 0, 200000 }, checkpoints = {}, triggered = {}, logicLoop = false,
}

local function log(s) print('[ETBR] ' .. tostring(s) .. '\n') end

-- ---------- engine helpers ----------
local GS, KSL
local function statics()
  if not GS or not GS:IsValid() then GS = StaticFindObject('/Script/Engine.Default__GameplayStatics') end
  return GS
end
local function localPC()
  local pc = statics():GetPlayerController(FindFirstOf('GameStateBase') or FindFirstOf('World'), 0)
  if pc and pc:IsValid() then return pc end
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
local function W(p) -- map-local UE cm -> world
  return vec(p[1] + state.offset[1], p[2] + state.offset[2], p[3] + state.offset[3])
end
local function say(out, s) log(s); if out then pcall(function() out:Log('[ETBR] ' .. s) end) end end

local classCache, assetCache = {}, {}
local function findClass(path)
  if classCache[path] ~= nil then return classCache[path] end
  local c = StaticFindObject(path)
  if (not c or not c:IsValid()) and LoadAsset then pcall(function() c = LoadAsset(path) end) end
  if c and not c:IsValid() then c = nil end
  classCache[path] = c or false
  return c
end
local function loadAsset(path)
  if assetCache[path] ~= nil then return assetCache[path] end
  local a = StaticFindObject(path)
  if (not a or not a:IsValid()) and LoadAsset then pcall(function() a = LoadAsset(path) end) end
  if a and not a:IsValid() then a = nil end
  assetCache[path] = a or false
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

local function spawnObject(o)
  local loc = W(o.pos or { 0, 0, 0 })
  if o.kind == 'mesh' then
    local mesh = loadAsset(o.asset)
    if not mesh then return nil, 'mesh not found' end
    local a = spawn(findClass(SMA_CLASS), loc)
    if not a then return nil, 'spawn failed' end
    local c = a.StaticMeshComponent
    c:SetMobility(2) -- Movable, so SetStaticMesh works at runtime
    c:SetStaticMesh(mesh)
    if o.props and o.props.noCollision then a:SetActorEnableCollision(false) end
    place(a, o)
    return a
  elseif o.kind == 'text' then
    local a = spawn(findClass(TEXT_CLASS), loc)
    if not a then return nil, 'spawn failed' end
    local c = a.TextRender
    c:SetText(FText((o.props and o.props.text) or 'Text'))
    c:SetWorldSize((o.props and o.props.size) or 40)
    c:SetTextRenderColor(hexColor(o.props and o.props.color, 1))
    c:SetHorizontalAlignment(1)
    place(a, o)
    return a
  else -- actor (blueprint or engine class)
    local cls = findClass(o.asset)
    if not cls then return nil, 'class not found' end
    local a = spawn(cls, loc)
    if not a then return nil, 'spawn failed' end
    -- replicated gameplay actors only live on the host (they replicate to clients)
    if not isHost() and a.bReplicates then a:K2_DestroyActor(); return nil, 'host-only' end
    place(a, o)
    local p = o.props or {}
    local lc = a.LightComponent
    if lc and lc:IsValid() then
      if p.intensity then pcall(function() lc:SetIntensity(p.intensity) end) end
      if p.color then pcall(function() lc:SetLightColor(hexColor(p.color), true) end) end
      if p.radius then pcall(function() lc:SetAttenuationRadius(p.radius) end) end
    end
    return a
  end
end

-- ---------- load / unload ----------
local function unload(out)
  local n = 0
  for _, a in ipairs(state.spawned) do
    if a and a:IsValid() then pcall(function() a:K2_DestroyActor() end); n = n + 1 end
  end
  state.spawned, state.map, state.triggered, state.checkpoints = {}, nil, {}, {}
  if out ~= false then say(out, 'unloaded ' .. n .. ' actors') end
end

local function readFile(p)
  local f = io.open(p, 'rb'); if not f then return nil end
  local s = f:read('a'); f:close(); return s
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

local logicTick
local function load(name, out)
  if state.loading then return say(out, 'already loading…') end
  local path = resolveMap(name)
  local txt = path and readFile(path)
  if not txt then return say(out, 'map not found: ' .. tostring(path) .. '  (try: etbr list)') end
  local ok, map = pcall(json.decode, txt)
  if not ok or type(map) ~= 'table' or map.format ~= 'etbrmap' then return say(out, 'not a valid .etbrmap: ' .. tostring(map)) end
  unload(false)
  state.map, state.name, state.loading = map, name, true
  local st = map.settings or {}
  state.offset = st.offset or cfg.defaultOffset
  local objs = map.objects or {}
  local i, okN, failN, fails = 0, 0, 0, {}
  say(out, ('building "%s" — %d objects…'):format((map.meta and map.meta.name) or name, #objs))
  LoopAsync(cfg.batchDelayMs, function()
    local done = false
    ExecuteInGameThread(function()
      for _ = 1, cfg.batchSize do
        i = i + 1
        local o = objs[i]
        if not o then done = true; break end
        local ok2, a, err = pcall(spawnObject, o)
        if ok2 and a then okN = okN + 1; state.spawned[#state.spawned + 1] = a
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
      say(out, isHost() and 'host: type  etbr start  (or F6) when everyone has loaded' or 'waiting for host to start (or F6 to go now)')
      if not state.logicLoop then
        state.logicLoop = true
        LoopAsync(200, function() ExecuteInGameThread(logicTick); return false end)
      end
      return true
    end
    return false
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
  local ring = (i or 0) * 90 -- small spread so players don't stack
  return W({ p[1] + (i and i > 0 and math.cos(i) * 90 or 0), p[2] + (i and i > 0 and math.sin(i) * 90 or 0), p[3] }), { Pitch = 0, Yaw = sp.yaw or 0, Roll = 0 }, ring
end

local function teleport(pp, loc, rot)
  pcall(function() pp.pawn:K2_TeleportTo(loc, rot) end)
  pcall(function() pp.pc:SetControlRotation(rot) end)
end

local function start(out)
  if not state.map then return say(out, 'no map loaded — etbr load <name> first') end
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
  local a = spawn(findClass(TEXT_CLASS), vec(loc.X + math.cos(yaw) * 220, loc.Y + math.sin(yaw) * 220, loc.Z + 40))
  if not a then return end
  a.TextRender:SetText(FText(text)); a.TextRender:SetWorldSize(22); a.TextRender:SetHorizontalAlignment(1)
  a.TextRender:SetTextRenderColor(hexColor('#fff3c4'))
  a:K2_SetActorRotation({ Pitch = 0, Yaw = rot.Yaw + 180, Roll = 0 }, false)
  popups[#popups + 1] = { a = a, t = os.clock() + 4 }
end

function logicTick()
  if not state.map or state.loading then return end
  local host = isHost()
  local me = localPC()
  local now = os.clock()
  for k = #popups, 1, -1 do
    if now > popups[k].t then pcall(function() popups[k].a:K2_DestroyActor() end); table.remove(popups, k) end
  end
  local killZ = state.offset[3] + (((state.map.settings or {}).killZ) or -3000)
  for i, pp in ipairs(playerPawns()) do
    local ok, p = pcall(function() return pp.pawn:K2_GetActorLocation() end)
    if ok and p then
      local key = pp.pc:GetFullName()
      local mine = me and pp.pc == me
      -- only consider players who are actually inside the custom level's vertical band
      if p.Z > state.offset[3] - 20000 then
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
end

-- ---------- fetch from collab server ----------
local function fetch(code, out)
  code = (code or ''):upper():gsub('[^A-Z0-9]', '')
  if #code ~= 6 then return say(out, 'usage: etbr fetch ABC123') end
  local file = MAPS_DIR .. code .. '.etbrmap'
  os.execute('mkdir "' .. MAPS_DIR .. '" 2>nul')
  local cmd = ('curl.exe -s -f -m 60 -o "%s" "%s/api/room/%s/map"'):format(file, cfg.serverUrl, code)
  say(out, 'downloading ' .. code .. '… (first request can take ~30 s while the server wakes)')
  local ok = os.execute(cmd)
  if ok then load(code, out) else say(out, 'download failed — check the code / internet') end
end

-- ---------- commands + keys ----------
local function handle(args, out)
  local sub = (args[1] or 'help'):lower()
  if sub == 'load' then
    local name = table.concat(args, ' ', 2)
    if name == '' then name = listMaps()[1] end
    if not name then say(out, 'no maps in ' .. MAPS_DIR) else ExecuteInGameThread(function() load(name, out) end) end
  elseif sub == 'start' then ExecuteInGameThread(function() start(out) end)
  elseif sub == 'tp' then
    ExecuteInGameThread(function()
      local pc = localPC()
      if state.map and pc and pc.Pawn then local l, r = spawnPoint(0); teleport({ pc = pc, pawn = pc.Pawn }, l, r) end
    end)
  elseif sub == 'unload' then ExecuteInGameThread(function() unload(out) end)
  elseif sub == 'fetch' then fetch(args[2], out)
  elseif sub == 'list' then
    local m = listMaps()
    say(out, #m == 0 and ('no maps in ' .. MAPS_DIR) or ('maps: ' .. table.concat(m, ', ')))
  elseif sub == 'where' then
    ExecuteInGameThread(function()
      local pc = localPC(); local p = pc.Pawn:K2_GetActorLocation()
      say(out, ('%.0f %.0f %.0f  (map-local %.0f %.0f %.0f)'):format(p.X, p.Y, p.Z, p.X - state.offset[1], p.Y - state.offset[2], p.Z - state.offset[3]))
    end)
  else
    say(out, 'ETBR Loader ' .. VERSION .. ' — etbr list | load <name> | start | fetch <CODE> | tp | unload | where')
  end
end

RegisterConsoleCommandHandler('etbr', function(_full, params, out)
  local args = {}
  for i = 1, #params do args[#args + 1] = params[i] end
  handle(args, out)
  return true
end)

RegisterKeyBind(Key[cfg.keyLoad], function() handle({ 'load', state.name or listMaps()[1] or '' }) end)
RegisterKeyBind(Key[cfg.keyStart], function() handle({ 'start' }) end)
RegisterKeyBind(Key[cfg.keyUnload], function() handle({ 'unload' }) end)

-- auto-clean when the game changes level (spawned actors die with the old world anyway)
pcall(function()
  local hook = RegisterLoadMapMPPostHook or RegisterLoadMapPostHook
  if hook then hook(function() state.spawned, state.map, state.loading = {}, nil, false end) end
end)

log('ETBR Loader ' .. VERSION .. ' ready — maps folder: ' .. MAPS_DIR)
