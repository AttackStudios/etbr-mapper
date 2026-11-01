-- Custom assets (.etbrObject / .etbrEntity / .etbrItem) inside the game.
-- Meshes are built at runtime with ProceduralMeshComponent; textures are loaded from PNG with
-- ImportFileAsTexture2D and shown through a dynamic instance of the game's own M_Master material.
local M = {}

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
function M.forgetWorld() texCache = {} end
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
local SMA = '/Script/Engine.StaticMeshActor'
function M.spawnObject(asset, loc)
  local a = E.spawn(E.findClass(SMA), loc)
  if not a then return nil, 'spawn failed' end
  pcall(function() a.StaticMeshComponent:SetMobility(2) end)
  local obj = asset.object or {}
  local comp = M.addMesh(a, asset, obj.mesh or next(asset.meshes or {}), obj.collision ~= false)
  if not comp then pcall(function() a:K2_DestroyActor() end); return nil, 'mesh build failed' end
  return a
end

return M
