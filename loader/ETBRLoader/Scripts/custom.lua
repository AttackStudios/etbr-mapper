-- Custom assets (.etbrObject / .etbrEntity / .etbrItem) inside the game.
-- Meshes are built at runtime with ProceduralMeshComponent; textures are loaded from PNG with
-- ImportFileAsTexture2D and shown through a dynamic instance of the game's own M_Master material.
local M = {}
local atlasTex -- font atlas texture (see text section)
local SMA = '/Script/Engine.StaticMeshActor'

-- ---------- base64 ----------
local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local dec = {}
for i = 1, 64 do dec[B64:byte(i)] = i - 1 end
function M.b64decode(s)
  s = s:gsub('^data:[^,]*,', ''):gsub('[^%w%+/=]', '')
  local out, n = {}, 0
  for i = 1, #s, 4 do
    local a, b, c, d = s:byte(i, i + 3)
    local x, y = dec[a] or 0, dec[b] or 0
    local z = (c and c ~= 61) and dec[c] or nil
    local w = (d and d ~= 61) and dec[d] or nil
    local v = x * 262144 + y * 4096 + (z or 0) * 64 + (w or 0)
    n = n + 1
    if w then out[n] = string.char(v >> 16, (v >> 8) & 255, v & 255)
    elseif z then out[n] = string.char(v >> 16, (v >> 8) & 255)
    else out[n] = string.char(v >> 16) end
  end
  return table.concat(out)
end

-- float32 / uint32 arrays
local function floats(b64, per)
  local bin = M.b64decode(b64 or '')
  local t, pos, n = {}, 1, #bin // 4
  for i = 1, n do t[i], pos = string.unpack('<f', bin, pos) end
  return t
end
local function uints(b64)
  local bin = M.b64decode(b64 or '')
  local t, pos = {}, 1
  for i = 1, #bin // 4 do t[i], pos = string.unpack('<I4', bin, pos) end
  return t
end

-- Unreal-side helpers are injected by main.lua (spawn, findObj, world, log …)
local E
function M.init(env) E = env end

local function hexColor(h)
  h = (h or '#ffffff'):gsub('#', '')
  return { R = tonumber(h:sub(1, 2), 16) / 255, G = tonumber(h:sub(3, 4), 16) / 255, B = tonumber(h:sub(5, 6), 16) / 255, A = 1 }
end

-- ---------- textures (cached per asset+name, written once to the mod's cache folder) ----------
local texCache = {}
function M.forgetWorld() texCache = {}; atlasTex = nil; if M.forgetAll then M.forgetAll() end end
local function texture(asset, name)
  if not name or not asset.textures or not asset.textures[name] then return nil end
  local key = asset.id .. '/' .. name
  local t = texCache[key]
  if t ~= nil then return t or nil end
  local path = E.CACHE_DIR .. asset.id .. '_' .. name:gsub('[^%w_-]', '_') .. '.png'
  local f = io.open(path, 'rb')
  if not f then
    os.execute('mkdir "' .. E.CACHE_DIR .. '" 2>nul')
    f = io.open(path, 'wb'); f:write(M.b64decode(asset.textures[name])); f:close()
  else f:close() end
  local ok, tex = pcall(function()
    return StaticFindObject('/Script/Engine.Default__KismetRenderingLibrary'):ImportFileAsTexture2D(E.world(), path)
  end)
  t = (ok and tex and tex:IsValid()) and tex or false
  texCache[key] = t
  if not t then E.log('custom: could not load texture ' .. name .. ' (' .. tostring(tex) .. ')') end
  return t or nil
end

local MASTER = '/Game/Backrooms/Materials/M_Master.M_Master'
local function applyMaterial(comp, idx, asset, sec)
  local master = E.findObj(MASTER)
  if not master then return end
  local ok, mid = pcall(function() return comp:CreateDynamicMaterialInstance(idx, master, FName('None')) end)
  if not ok or not mid then E.log('custom: material failed ' .. tostring(mid)); return end
  local tex = texture(asset, sec.tex)
  pcall(function()
    if tex then mid:SetTextureParameterValue(FName('BaseColor'), tex) end
    mid:SetVectorParameterValue(FName('BaseColorMultiplier'), hexColor(sec.color))
    mid:SetScalarParameterValue(FName('Tiling'), 1)
    if (sec.emissive or 0) > 0 then
      if tex then mid:SetTextureParameterValue(FName('Emissive'), tex) end
      mid:SetScalarParameterValue(FName('EmissiveMultiplier'), sec.emissive)
    else
      mid:SetScalarParameterValue(FName('EmissiveMultiplier'), 0)
    end
  end)
end

-- ---------- meshes ----------
local PMC
local meshCache = {} -- decoded arrays per asset/mesh (decoding is the slow part)
local function decodedMesh(asset, name)
  local key = asset.id .. '/' .. name
  if meshCache[key] then return meshCache[key] end
  local m = asset.meshes and asset.meshes[name]
  if not m then return nil end
  local out = {}
  for si, sec in ipairs(m.sections or {}) do
    local v, nrm, uv, idx = floats(sec.v), floats(sec.n), floats(sec.uv), uints(sec.i)
    local verts, norms, uvs, tris, cols = {}, {}, {}, {}, {}
    for k = 0, #v // 3 - 1 do
      verts[k + 1] = { X = v[k * 3 + 1], Y = v[k * 3 + 2], Z = v[k * 3 + 3] }
      norms[k + 1] = { X = nrm[k * 3 + 1] or 0, Y = nrm[k * 3 + 2] or 0, Z = nrm[k * 3 + 3] or 1 }
      uvs[k + 1] = { X = uv[k * 2 + 1] or 0, Y = uv[k * 2 + 2] or 0 }
    end
    for k = 1, #idx do tris[k] = idx[k] end
    out[si] = { verts = verts, norms = norms, uvs = uvs, tris = tris, sec = sec }
  end
  meshCache[key] = out
  return out
end

-- adds a ProceduralMeshComponent with the asset mesh to an actor; returns the component
function M.addMesh(actor, asset, meshName, collision, relT)
  if not PMC or not PMC:IsValid() then PMC = StaticFindObject('/Script/ProceduralMeshComponent.ProceduralMeshComponent') end
  if not PMC then E.log('custom: ProceduralMeshComponent class missing'); return nil end
  local data = decodedMesh(asset, meshName)
  if not data then E.log('custom: no mesh ' .. tostring(meshName)); return nil end
  local t = relT or { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = { X = 0, Y = 0, Z = 0 }, Scale3D = { X = 1, Y = 1, Z = 1 } }
  local comp = actor:AddComponentByClass(PMC, false, t, false)
  if not comp or not comp:IsValid() then E.log('custom: AddComponentByClass failed'); return nil end
  for si, d in ipairs(data) do
    local ok, err = pcall(function()
      comp:CreateMeshSection_LinearColor(si - 1, d.verts, d.tris, d.norms, d.uvs, {}, {}, {}, {}, {}, collision and true or false)
    end)
    if not ok then E.log('custom: CreateMeshSection failed: ' .. tostring(err)) end
    applyMaterial(comp, si - 1, asset, d.sec)
  end
  return comp
end

-- ---------- spawning by kind ----------
function M.spawnObject(asset, loc)
  local a = E.spawn(E.findClass(SMA), loc)
  if not a then return nil, 'spawn failed' end
  pcall(function() a.StaticMeshComponent:SetMobility(2) end)
  local obj = asset.object or {}
  local comp = M.addMesh(a, asset, obj.mesh or next(asset.meshes or {}), obj.collision ~= false)
  if not comp then pcall(function() a:K2_DestroyActor() end); return nil, 'mesh build failed' end
  return a
end



-- ======================================================================== text (no FText!)
-- Passing FText to Unreal crashes this UE4SS build (found in-game), so text is drawn as a
-- ProceduralMesh of glyph quads cut from fontatlas.png (16x6 grid, ASCII 32..127).
local WIDTHS = require('fontwidths')
local function atlas()
  if atlasTex and pcall(function() return atlasTex:IsValid() end) and atlasTex:IsValid() then return atlasTex end
  local ok, t = pcall(function() return StaticFindObject('/Script/Engine.Default__KismetRenderingLibrary'):ImportFileAsTexture2D(E.world(), E.MOD_DIR .. 'fontatlas.png') end)
  atlasTex = ok and t or nil
  return atlasTex
end
-- builds text into a new actor at loc; the text faces the actor's +X (rotate the actor to aim it)
function M.textActor(loc, text, size, color)
  size = size or 30
  text = tostring(text or ''):gsub('[^\32-\126]', '?')
  if #text == 0 then return nil end
  if not PMC or not PMC:IsValid() then PMC = StaticFindObject('/Script/ProceduralMeshComponent.ProceduralMeshComponent') end
  local a = E.spawn(E.findClass(SMA), loc)
  if not a then return nil end
  pcall(function() a.StaticMeshComponent:SetMobility(2); a:SetActorEnableCollision(false) end)
  local verts, tris, norms, uvs = {}, {}, {}, {}
  local total = 0
  for i = 1, #text do total = total + (WIDTHS[text:byte(i) - 31] or 32) / 64 * size end
  local cursor, half = -total / 2, size / 2
  for i = 1, #text do
    local code = text:byte(i) - 32
    local w = (WIDTHS[code + 1] or 32) / 64 * size
    if code ~= 0 then
      local col, row = code % 16, code // 16
      local cellW = (WIDTHS[code + 1] or 32) / 64 -- glyphs are centred in their 64px cell
      local u0 = (col + 0.5 - cellW / 2) / 16; local u1 = (col + 0.5 + cellW / 2) / 16
      local v0, v1 = row / 6, (row + 1) / 6
      local b = #verts
      -- reading direction is -Y when seen from +X (Unreal: forward X, right Y)
      verts[b + 1] = { X = 0, Y = -cursor, Z = half }; verts[b + 2] = { X = 0, Y = -(cursor + w), Z = half }
      verts[b + 3] = { X = 0, Y = -(cursor + w), Z = -half }; verts[b + 4] = { X = 0, Y = -cursor, Z = -half }
      for k = 1, 4 do norms[b + k] = { X = 1, Y = 0, Z = 0 } end
      uvs[b + 1] = { X = u0, Y = v0 }; uvs[b + 2] = { X = u1, Y = v0 }; uvs[b + 3] = { X = u1, Y = v1 }; uvs[b + 4] = { X = u0, Y = v1 }
      local n = #tris
      tris[n + 1], tris[n + 2], tris[n + 3] = b, b + 1, b + 2
      tris[n + 4], tris[n + 5], tris[n + 6] = b, b + 2, b + 3
    end
    cursor = cursor + w
  end
  local t = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = { X = 0, Y = 0, Z = 0 }, Scale3D = { X = 1, Y = 1, Z = 1 } }
  local comp = a:AddComponentByClass(PMC, false, t, false)
  if not comp then pcall(function() a:K2_DestroyActor() end); return nil end
  pcall(function() comp:CreateMeshSection_LinearColor(0, verts, tris, norms, uvs, {}, {}, {}, {}, {}, false) end)
  local master = E.findObj(MASTER)
  if master then
    pcall(function()
      local mid = comp:CreateDynamicMaterialInstance(0, master, FName('None'))
      local tex = atlas()
      if tex then mid:SetTextureParameterValue(FName('BaseColor'), tex); mid:SetTextureParameterValue(FName('Emissive'), tex) end
      mid:SetVectorParameterValue(FName('BaseColorMultiplier'), hexColor(color or '#fff3c4'))
      mid:SetScalarParameterValue(FName('EmissiveMultiplier'), 4)
    end)
  end
  return a
end

-- ======================================================================== script sandbox
-- Custom scripts run with NO io/os/require/debug/load: they cannot touch files or run programs.
local function sandbox(asset, api)
  local src = asset.scripts and asset.scripts['main.lua']
  if not src or not src:find('%S') then return {} end
  local env = {
    math = math, string = string, table = table, pairs = pairs, ipairs = ipairs, next = next, type = type,
    tostring = tostring, tonumber = tonumber, select = select, pcall = pcall, error = error, print = function(...) E.log('[' .. asset.name .. '] ' .. table.concat({ ... }, ' ')) end,
    etbr = api,
  }
  local fn, err = load(src, '=' .. (asset.name or 'script'), 't', env)
  if not fn then E.log('script error in ' .. tostring(asset.name) .. ': ' .. tostring(err)); return {} end
  local ok, e2 = pcall(fn)
  if not ok then E.log('script error in ' .. tostring(asset.name) .. ': ' .. tostring(e2)) end
  return env
end
local function hook(env, name, ...)
  local f = env and env[name]
  if type(f) ~= 'function' then return end
  local ok, err = pcall(f, ...)
  if not ok then E.log('script ' .. name .. ' error: ' .. tostring(err)) end
end

local function vdist(a, b) local dx, dy, dz = a.X - b.X, a.Y - b.Y, a.Z - b.Z; return math.sqrt(dx * dx + dy * dy + dz * dz) end
local function lerp(a, b, t) return a + (b - a) * t end
local timers = {}
local function scriptApi(owner)
  return {
    log = function(s) E.log('[' .. owner.asset.name .. '] ' .. tostring(s)) end,
    message = function(s) E.message(tostring(s)) end,
    self = function() local ok, p = pcall(function() return owner.actor:K2_GetActorLocation() end); return ok and { x = p.X, y = p.Y, z = p.Z } or nil end,
    players = function() local t = {}; for _, pp in ipairs(E.players()) do local p = pp.pawn:K2_GetActorLocation(); t[#t + 1] = { x = p.X, y = p.Y, z = p.Z, id = pp.key, _pp = pp } end; return t end,
    nearestPlayer = function() local best, bd; local me = owner.actor:K2_GetActorLocation(); for _, pp in ipairs(E.players()) do local p = pp.pawn:K2_GetActorLocation(); local d = vdist(me, p); if not bd or d < bd then best, bd = { x = p.X, y = p.Y, z = p.Z, id = pp.key, _pp = pp, dist = d }, d end end; return best end,
    play = function(anim) owner.forceAnim = anim end,
    sound = function(name, loop) local h = M.playSound(owner.asset, name, owner.actor, loop, falloff(owner.actor)); if h then owner.sounds = owner.sounds or {}; owner.sounds[#owner.sounds + 1] = h end; return h ~= nil end,
    kill = function(p) if p and p._pp then E.kill(p._pp) end end,
    sanity = function(p, delta) if p and p._pp then E.addSanity(p._pp, delta) end end,
    after = function(sec, fn) timers[#timers + 1] = { t = os.clock() + (tonumber(sec) or 0), fn = fn } end,
  }
end
function M.tickTimers()
  local now = os.clock()
  for i = #timers, 1, -1 do if now >= timers[i].t then local t = table.remove(timers, i); pcall(t.fn) end end
end




-- ======================================================================== sounds
-- Unreal's media player crashed UE4SS here (in-game test), so sounds play through Windows' own
-- SoundPlayer in a hidden background process. Distance falloff = pre-scaled copies (100/60/30 %).
local soundFiles = {}
local function writeOnce(path, bytes)
  local f = io.open(path, 'rb')
  if f then f:close(); return end
  os.execute('mkdir "' .. E.CACHE_DIR .. '" 2>nul')
  f = io.open(path, 'wb'); f:write(bytes); f:close()
end
local function scaled(wavBytes, k)
  -- 16-bit PCM WAV from the editor: 44-byte header + samples
  if k >= 0.99 or #wavBytes < 46 then return wavBytes end
  local out, n = { wavBytes:sub(1, 44) }, 1
  for pos = 45, #wavBytes - 1, 2 do
    local v = string.unpack('<i2', wavBytes, pos)
    n = n + 1; out[n] = string.pack('<i2', math.floor(v * k))
  end
  return table.concat(out)
end
local LEVELS = { 1, 0.6, 0.3 }
local function soundFile(asset, name, vol)
  if not name or name == '' or not asset.sounds or not asset.sounds[name] then return nil end
  local key = asset.id .. '/' .. name
  local s = soundFiles[key]
  if not s then
    local bytes = M.b64decode(asset.sounds[name])
    s = { paths = {}, secs = math.max(0.2, (#bytes - 44) / (22050 * 2)) }
    for i, k in ipairs(LEVELS) do
      local path = E.CACHE_DIR .. asset.id .. '_snd_' .. name:gsub('[^%w_-]', '_') .. '_' .. i .. '.wav'
      writeOnce(path, scaled(bytes, k)); s.paths[i] = path
    end
    soundFiles[key] = s
  end
  local idx = vol > 0.75 and 1 or (vol > 0.4 and 2 or 3)
  return s.paths[idx], s.secs
end
-- launching a process blocks the calling thread, so it never happens on the game thread: queue it
M.soundQueue = {}
local function playFile(path) if #M.soundQueue < 4 then M.soundQueue[#M.soundQueue + 1] = path end end
function M.drainSounds() -- called from a LoopAsync (background) thread
  local path = table.remove(M.soundQueue, 1)
  if path then os.execute(('start "" /b powershell -NoProfile -WindowStyle Hidden -Command "(New-Object Media.SoundPlayer \'%s\').PlaySync()"'):format(path)) end
end
-- returns a handle; loops re-trigger from tickSounds while audible
function M.playSound(asset, name, actor, loop, volume)
  local vol = volume or 1
  local path, secs = soundFile(asset, name, vol)
  if not path then return nil end
  if vol > 0.05 then playFile(path) end
  return { asset = asset, name = name, actor = actor, loop = loop, vol = vol, secs = secs, next = os.clock() + secs }
end
function M.stopSound(h) if h then h.stopped = true end end
function M.setSoundVolume(h, v) if h then h.vol = v end end
function M.tickSound(h)
  if not h or h.stopped or not h.loop then return end
  if os.clock() >= h.next then
    h.next = os.clock() + h.secs
    if h.vol > 0.05 then local path = soundFile(h.asset, h.name, h.vol); if path then playFile(path) end end
  end
end
local function falloff(actor)
  local me = E.localPawn(); if not me then return 1 end
  local ok, d = pcall(function() return vdist(me:K2_GetActorLocation(), actor:K2_GetActorLocation()) end)
  if not ok then return 1 end
  return math.max(0, math.min(1, 1 - (d - 300) / 2700)) -- full within 3 m, silent beyond 30 m
end
M.falloff = falloff

-- ======================================================================== entities
-- An entity is a plain actor carrying the asset's mesh parts. It walks on the level's walk grid
-- (baked in the editor, shipped in the map) with A* path-finding, using only engine calls that are
-- proven safe in this game: set location (no sweep) and set rotation. Engine movement attempts —
-- AddMovementInput, collision sweeps, line traces, MoveToLocation, velocity writes — were ignored or
-- aborted UE4SS during in-game testing, so the walking is done here.
M.entities = {}
M.dbg = { move = true, anim = true }

-- ---------- walk grid ----------
local NAV = nil
function M.setNav(n)
  NAV = nil
  if type(n) ~= 'table' or not n.floors then return end
  local bin = M.b64decode(n.floors)
  local fl, pos = {}, 1
  for i = 1, #bin // 2 do fl[i], pos = string.unpack('<i2', bin, pos) end
  NAV = { cell = n.cell or 50, x0 = n.x0, y0 = n.y0, w = n.w, h = n.h, fl = fl }
  E.log(('entity nav: %dx%d cells'):format(NAV.w, NAV.h))
end
local function cellOf(lx, ly) return math.floor(lx / NAV.cell) - NAV.x0, math.floor(ly / NAV.cell) - NAV.y0 end
local function floorAt(i, j)
  if i < 0 or j < 0 or i >= NAV.w or j >= NAV.h then return nil end
  local f = NAV.fl[j * NAV.w + i + 1]
  if not f or f == -32768 then return nil end
  return f
end
local function cellCentre(i, j) return (NAV.x0 + i + 0.5) * NAV.cell, (NAV.y0 + j + 0.5) * NAV.cell end
-- nearest walkable cell (spiral) for points that land on a wall edge
local function snapCell(i, j)
  if floorAt(i, j) then return i, j end
  for r = 1, 6 do for dj = -r, r do for di = -r, r do
    if (math.abs(di) == r or math.abs(dj) == r) and floorAt(i + di, j + dj) then return i + di, j + dj end
  end end end
  return nil
end
local STEP = 45 -- cm an entity can step up/down between cells
local NB = { { 1, 0, 1 }, { -1, 0, 1 }, { 0, 1, 1 }, { 0, -1, 1 }, { 1, 1, 1.414 }, { 1, -1, 1.414 }, { -1, 1, 1.414 }, { -1, -1, 1.414 } }
local function astar(si, sj, gi, gj)
  local W = NAV.w
  local function key(i, j) return j * W + i end
  local heap, hn = {}, 0 -- binary min-heap of {f, k}
  local function push(f, k)
    hn = hn + 1; heap[hn] = { f, k }; local i = hn
    while i > 1 do local p = i // 2; if heap[p][1] <= heap[i][1] then break end; heap[p], heap[i] = heap[i], heap[p]; i = p end
  end
  local function pop()
    local top = heap[1]; heap[1] = heap[hn]; heap[hn] = nil; hn = hn - 1
    local i = 1
    while true do
      local l, r, m = i * 2, i * 2 + 1, i
      if l <= hn and heap[l][1] < heap[m][1] then m = l end
      if r <= hn and heap[r][1] < heap[m][1] then m = r end
      if m == i then break end
      heap[m], heap[i] = heap[i], heap[m]; i = m
    end
    return top
  end
  local function h(i, j) local dx, dy = math.abs(i - gi), math.abs(j - gj); return math.max(dx, dy) + 0.414 * math.min(dx, dy) end
  local g, came, closed = { [key(si, sj)] = 0 }, {}, {}
  push(h(si, sj), key(si, sj))
  local expansions = 0
  while hn > 0 and expansions < 2500 do
    local cur = pop(); local ck = cur[2]
    if not closed[ck] then
      closed[ck] = true; expansions = expansions + 1
      local ci, cj = ck % W, ck // W
      if ci == gi and cj == gj then
        local path, k = {}, ck
        while k do table.insert(path, 1, { k % W, k // W }); k = came[k] end
        return path
      end
      local cf = floorAt(ci, cj)
      for _, d in ipairs(NB) do
        local ni, nj = ci + d[1], cj + d[2]
        local nf = floorAt(ni, nj)
        if nf and math.abs(nf - cf) <= STEP and (d[3] == 1 or (floorAt(ci + d[1], cj) and floorAt(ci, cj + d[2]))) then
          local nk = key(ni, nj)
          local ng = g[ck] + d[3]
          if not closed[nk] and (not g[nk] or ng < g[nk]) then g[nk] = ng; came[nk] = ck; push(ng + h(ni, nj), nk) end
        end
      end
    end
  end
  return nil
end

function M.spawnEntity(asset, loc, yaw)
  local ent = asset.entity or {}
  local a = E.spawn(E.findClass(SMA), loc)
  if not a then return nil, 'spawn failed' end
  pcall(function() a.StaticMeshComponent:SetMobility(2); a:SetActorEnableCollision(false) end)
  pcall(function() a:K2_SetActorRotation({ Pitch = 0, Yaw = yaw or 0, Roll = 0 }, false) end)
  local comps = {}
  for _, p in ipairs(ent.parts or {}) do
    local t = { Translation = { X = p.pos[1], Y = p.pos[2], Z = p.pos[3] }, Rotation = E.rotToQuat(p.rot or { 0, 0, 0 }), Scale3D = { X = p.scale and p.scale[1] or 1, Y = p.scale and p.scale[2] or 1, Z = p.scale and p.scale[3] or 1 } }
    local c = M.addMesh(a, asset, p.mesh, false, t)
    if c then comps[p.name] = { comp = c, rest = p } end
  end
  local e = { actor = a, asset = asset, comps = comps, home = loc, pos = { X = loc.X, Y = loc.Y, Z = loc.Z }, yaw = yaw or 0, t = 0, state = 'idle' }
  e.env = sandbox(asset, scriptApi(e))
  M.entities[#M.entities + 1] = e
  local snd = ((ent.behavior or {}).sounds) or {}
  hook(e.env, 'onSpawn')
  return a
end

local function sampleTrack(keys, t)
  local n = #keys
  if n == 0 then return nil end
  if t <= keys[1][1] then return keys[1] end
  for i = 2, n do
    local k1, k0 = keys[i], keys[i - 1]
    if t <= k1[1] then
      local f = (t - k0[1]) / math.max(1e-4, k1[1] - k0[1])
      return { t, { lerp(k0[2][1], k1[2][1], f), lerp(k0[2][2], k1[2][2], f), lerp(k0[2][3], k1[2][3], f) },
        { lerp(k0[3][1], k1[3][1], f), lerp(k0[3][2], k1[3][2], f), lerp(k0[3][3], k1[3][3], f) } }
    end
  end
  return keys[n]
end
local function animate(e, dt, speed)
  local ent = e.asset.entity
  local map = ent.map or {}
  local name = e.forceAnim or (e.state == 'attack' and map.attack ~= '' and map.attack) or (speed > 300 and (map.run ~= '' and map.run or map.walk)) or (speed > 20 and map.walk) or map.idle
  local anim = name and name ~= '' and ent.anims and ent.anims[name]
  e.t = e.t + dt
  if anim then
    local t = anim.loop ~= false and (e.t % math.max(anim.length, 0.01)) or math.min(e.t, anim.length)
    for _, tr in ipairs(anim.tracks or {}) do
      local c = e.comps[tr.part]
      local k = c and sampleTrack(tr.keys, t)
      if k then pcall(function() c.comp:K2_SetRelativeLocationAndRotation({ X = k[2][1], Y = k[2][2], Z = k[2][3] }, { Pitch = k[3][1], Yaw = k[3][2], Roll = k[3][3] }, false, {}, true) end) end
    end
  else -- no clip: automatic bob + sway so it never looks frozen
    local amp, freq = (speed > 20) and 4 or 1.5, (speed > 20) and (speed / 60) or 1.2
    local bob, sway = math.sin(e.t * freq * 2) * amp, math.sin(e.t * freq) * ((speed > 20) and 4 or 1)
    for _, c in pairs(e.comps) do
      local p = c.rest
      pcall(function() c.comp:K2_SetRelativeLocationAndRotation({ X = p.pos[1], Y = p.pos[2], Z = p.pos[3] + bob }, { Pitch = p.rot[1], Yaw = p.rot[2], Roll = p.rot[3] + sway }, false, {}, true) end)
    end
  end
end

-- is any player looking at this point? (stalk mode)
local function watched(pos)
  for _, pp in ipairs(E.players()) do
    local ok, seen = pcall(function()
      local cam = pp.pawn:K2_GetActorLocation(); local r = pp.pc:GetControlRotation()
      local yaw, pitch = math.rad(r.Yaw), math.rad(r.Pitch)
      local fx, fy, fz = math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)
      local dx, dy, dz = pos.X - cam.X, pos.Y - cam.Y, pos.Z - cam.Z
      local d = math.sqrt(dx * dx + dy * dy + dz * dz); if d < 1 then return true end
      return (fx * dx + fy * dy + fz * dz) / d > 0.80
    end)
    if ok and seen then return true end
  end
  return false
end

-- walk toward a world point: along the A* path on the walk grid if there is one, else straight
local function walkToward(e, goal, speed, dt)
  local off = E.offset()
  local me = e.pos
  local step = speed * dt
  local tx, ty, tz = goal.X, goal.Y, nil
  if NAV then
    local si, sj = snapCell(cellOf(me.X - off[1], me.Y - off[2]))
    local gi, gj = snapCell(cellOf(goal.X - off[1], goal.Y - off[2]))
    if not si or not gi then return false end
    if (not e.path or e.pathGoal ~= gi .. ',' .. gj or (e.repathT or 0) <= 0) and not M._pathedThisTick then
      M._pathedThisTick = true
      e.path = astar(si, sj, gi, gj); e.pathGoal = gi .. ',' .. gj; e.repathT = 1.5; e.pathIdx = 2
    end
    e.repathT = (e.repathT or 0) - dt
    if not e.path then return false end
    local nxt = e.path[math.min(e.pathIdx or 2, #e.path)]
    local cx, cy = cellCentre(nxt[1], nxt[2])
    tx, ty = cx + off[1], cy + off[2]
    if math.abs(me.X - tx) + math.abs(me.Y - ty) < NAV.cell * 0.4 and (e.pathIdx or 2) < #e.path then e.pathIdx = (e.pathIdx or 2) + 1 end
  end
  local dx, dy = tx - me.X, ty - me.Y
  local l = math.sqrt(dx * dx + dy * dy)
  if l < 1 then return false end
  local mv = math.min(step, l)
  local nx, ny = me.X + dx / l * mv, me.Y + dy / l * mv
  local nz = me.Z
  if NAV then local fi, fj = cellOf(nx - off[1], ny - off[2]); local f = floorAt(fi, fj); if f then nz = f + off[3] end end
  e.pos = { X = nx, Y = ny, Z = nz }
  local targetYaw = math.deg(math.atan(dy, dx))
  local dyaw = ((targetYaw - e.yaw + 540) % 360) - 180
  e.yaw = e.yaw + math.max(-540 * dt, math.min(540 * dt, dyaw))
  pcall(function() e.actor:K2_SetActorLocation(e.pos, false, {}, true) end)
  pcall(function() e.actor:K2_SetActorRotation({ Pitch = 0, Yaw = e.yaw, Roll = 0 }, false) end)
  return true
end

function M.tickEntities(dt)
  M._pathedThisTick = false
  for i = #M.entities, 1, -1 do
    local e = M.entities[i]
    local a = e.actor
    if not a or not pcall(function() return a:IsValid() end) or not a:IsValid() then table.remove(M.entities, i) goto continue end
    do
      local b = e.asset.entity.behavior or {}
      local me = e.pos
      local target, td
      for _, pp in ipairs(E.players()) do
        local ok, p = pcall(function() return pp.pawn:K2_GetActorLocation() end)
        if ok and p then local d = vdist(me, p); if d < (e.chasing and (b.loseSight or 3500) or (b.sight or 2500)) and (not td or d < td) then target, td = pp, d end end
      end
      if target and not e.chasing then
        hook(e.env, 'onSeePlayer', { _pp = target })
        local cs = (b.sounds or {}).chase
        if cs and cs ~= '' then M.stopSound(e.chaseSound); e.chaseSound = M.playSound(e.asset, cs, a, false, falloff(a)) end
      end
      if e.idleSound then M.setSoundVolume(e.idleSound, falloff(a) * 0.8); M.tickSound(e.idleSound) end
      e.chasing = target ~= nil
      local mode = b.mode or 'chase'
      local frozen = mode == 'static' or (mode == 'stalk' and watched(me))
      local moved, speed = false, 0
      if not frozen and M.dbg.move then
        if target and (mode ~= 'wander' or td < (b.sight or 2500) * 0.5) then
          speed = b.runSpeed or 520
          moved = walkToward(e, target.pawn:K2_GetActorLocation(), speed, dt)
        elseif mode ~= 'static' then
          e.wanderT = (e.wanderT or 0) - dt
          if not e.wander or e.wanderT <= 0 or vdist(me, e.wander) < 80 then
            local ang, r = math.random() * math.pi * 2, 300 + math.random() * 1200
            e.wander = { X = e.home.X + math.cos(ang) * r, Y = e.home.Y + math.sin(ang) * r, Z = me.Z }; e.wanderT = 5 + math.random() * 6; e.path = nil
          end
          speed = b.walkSpeed or 250
          moved = walkToward(e, e.wander, speed, dt)
          if not moved then e.wander = nil end
        end
      end
      e.vel = moved and speed or 0
      -- kill / touch: each player's own machine decides their death (their copy is what they see)
      e.state = 'idle'
      if target and td and td < (b.killRange or 130) + 40 then
        e.state = 'attack'
        if target.isLocal then
          hook(e.env, 'onTouch', { _pp = target })
          if b.kill and not e.killedAt then
            e.killedAt = os.clock()
            local ks = (b.sounds or {}).kill
            if ks and ks ~= '' then M.playSound(e.asset, ks, a, false, 1) end
            E.kill(target)
          end
        end
      end
      if e.killedAt and os.clock() - e.killedAt > 4 then e.killedAt = nil end
      if M.dbg.anim then animate(e, dt, e.vel) end
      hook(e.env, 'onTick', dt)
    end
    ::continue::
  end
end

-- ======================================================================== items
M.items = {}
local hand = nil -- { asset, actor, light }
function M.spawnItem(asset, loc)
  local a = E.spawn(E.findClass(SMA), loc)
  if not a then return nil, 'spawn failed' end
  pcall(function() a.StaticMeshComponent:SetMobility(2) end)
  local it = asset.item or {}
  local comp = M.addMesh(a, asset, (it.ground or {}).mesh or 'body', true)
  if not comp then pcall(function() a:K2_DestroyActor() end); return nil, 'mesh build failed' end
  local entry = { actor = a, asset = asset, env = nil }
  entry.env = sandbox(asset, scriptApi(entry))
  M.items[#M.items + 1] = entry
  return a
end
local function dropHand()
  if not hand then return end
  pcall(function() hand.actor:K2_DestroyActor() end)
  hand = nil
end
-- E near a custom item: pick it up into the hand slot (attached to the first-person camera)
function M.tryPickup()
  local me = E.localPawn(); if not me then return false end
  local mp = me:K2_GetActorLocation()
  local best, bd
  for i, it in ipairs(M.items) do
    local ok, p = pcall(function() return it.actor:K2_GetActorLocation() end)
    if ok and p and not it.taken then local d = vdist(mp, p); if d < 220 and (not bd or d < bd) then best, bd = i, d end end
  end
  if not best then return false end
  local it = M.items[best]
  it.taken = true
  pcall(function() it.actor:SetActorHiddenInGame(true); it.actor:SetActorEnableCollision(false) end)
  dropHand()
  local h = it.asset.item.hand or {}
  local a = E.spawn(E.findClass(SMA), mp)
  if not a then return false end
  pcall(function() a.StaticMeshComponent:SetMobility(2); a:SetActorEnableCollision(false) end)
  M.addMesh(a, it.asset, h.mesh or 'body', false)
  local cam = nil
  pcall(function() cam = me.CameraComponent end)
  if not cam then pcall(function() cam = me.FirstPersonCamera end) end
  pcall(function() a:K2_AttachToComponent(cam or me.RootComponent, FName('None'), 0, 0, 0, false) end) -- keep relative
  local hp, hr, hs = h.pos or { 35, 18, -22 }, h.rot or { 0, 0, 0 }, h.scale or { 1, 1, 1 }
  pcall(function() a:K2_SetActorRelativeLocation({ X = hp[1], Y = hp[2], Z = hp[3] }, false, {}, true) end)
  pcall(function() a:K2_SetActorRelativeRotation({ Pitch = hr[1], Yaw = hr[2], Roll = hr[3] }, false, {}, true) end)
  pcall(function() a:SetActorRelativeScale3D({ X = hs[1], Y = hs[2], Z = hs[3] }) end)
  hand = { asset = it.asset, actor = a, src = it }
  E.message(it.asset.item.pickupText ~= '' and it.asset.item.pickupText or it.asset.name)
  hook(it.env, 'onPickup', {})
  return true
end
function M.useHand()
  if not hand then return end
  local u = hand.asset.item.use or {}
  local pp = E.localPlayer()
  if u.type == 'light' then
    if hand.light then pcall(function() hand.light:K2_DestroyActor() end); hand.light = nil
    else
      local l = E.spawn(E.findClass('/Script/Engine.SpotLight'), hand.actor:K2_GetActorLocation())
      if l then
        pcall(function() local lc = l.LightComponent; lc:SetMobility(2); lc:SetIntensity(u.light.intensity or 3000); lc:SetAttenuationRadius(u.light.range or 1500) end)
        pcall(function() l.SpotLightComponent:SetOuterConeAngle(u.light.angle or 30) end)
        pcall(function() l:K2_AttachToActor(hand.actor, FName('None'), 1, 1, 1, false) end)
        hand.light = l
      end
    end
  elseif u.type == 'sanity' then E.addSanity(pp, u.amount or 25)
  elseif u.type == 'stamina' then pcall(function() local c = pp.pawn; c.Stamina = math.min(c.MaxStamina or 45, (c.Stamina or 0) + (u.amount or 25)) end)
  elseif u.type == 'script' then hook(hand.src.env, 'onUse', { _pp = pp }) end
  if u.consume and u.type ~= 'light' then dropHand() end
end
function M.dropHand() dropHand() end

function M.forgetAll() M.entities, M.items, hand, timers, soundFiles = {}, {}, nil, {}, {} end

return M
