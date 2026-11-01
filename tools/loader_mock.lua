-- Runs the real loader main.lua against a fake UE4SS/Unreal API.
-- lua tools/loader_mock.lua   (from repo root)
package.path = 'loader/ETBRLoader/Scripts/?.lua;' .. package.path
local spawned, destroyed, cmds, loops = {}, 0, {}, {}
local function newActor(cls, loc)
  local a = { cls = cls, loc = loc, valid = true }
  local comp = setmetatable({}, { __index = function() return function() end end })
  a.StaticMeshComponent, a.TextRender = comp, comp
  return setmetatable(a, { __index = function(t, k)
    if k == 'IsValid' then return function(self) return self.valid end end
    if k == 'K2_DestroyActor' then return function(self) self.valid = false; destroyed = destroyed + 1 end end
    if k == 'K2_GetActorLocation' then return function(self) return self.loc end end
    if k == 'K2_SetActorLocation' then return function(self, l) self.loc = l end end
    return function() end
  end })
end
local gs = { IsValid = function() return true end,
  BeginDeferredActorSpawnFromClass = function(_, _, cls, t) local a = newActor(cls, t.Translation); spawned[#spawned + 1] = a; return a end,
  FinishSpawningActor = function() end,
  GetPlayerController = function() return nil end }
local pawnLoc = { X = 0, Y = 0, Z = 0 }
local pc = { IsValid = function() return true end, Pawn = { IsValid = function() return true end, K2_GetActorLocation = function() return pawnLoc end, K2_TeleportTo = function(_, l) pawnLoc = l end },
  GetControlRotation = function() return { Yaw = 0 } end, SetControlRotation = function() end, GetFullName = function() return 'PC0' end }
local objs = setmetatable({}, { __index = function(t, k) local o = { IsValid = function() return true end, name = k }; t[k] = o; return o end })
StaticFindObject = function(p) if p:find('GameplayStatics') then return gs end; if p:find('Missing') then return nil end; return objs[p] end
LoadAsset = function() return nil end
FindFirstOf = function(c) if c == 'GameModeBase' then return { IsValid = function() return true end } end; if c == 'PlayerController' then return pc end end
FindAllOf = function(c) if c == 'PlayerController' then return { pc } end; return {} end
RegisterConsoleCommandHandler = function(name, fn) cmds[name] = fn end
RegisterKeyBind = function() end
Key = setmetatable({}, { __index = function(_, k) return k end })
LoopAsync = function(ms, fn) loops[#loops + 1] = { ms = ms, fn = fn } end
ExecuteInGameThread = function(fn) fn() end
FName = function(s) return s end; FText = function(s) return s end
local real_open = io.open
io.open = function(p, m) return real_open((p:gsub('\\', '/')), m) end -- loader uses Windows paths
local real_print = print
print = function(s) io.write((tostring(s):gsub('\n$', '')) .. '\n') end

dofile('loader/ETBRLoader/Scripts/main.lua')
local out = { Log = function(_, s) io.write('  > ' .. s .. '\n') end }
local function etbr(...) cmds.etbr('etbr', { ... }, out) end
local function runLoops(n) for _ = 1, n do for i = #loops, 1, -1 do if loops[i].fn() == true then table.remove(loops, i) end end end end

-- write a test map into the maps folder
os.execute('mkdir -p loader/ETBRLoader/maps')
local f = io.open('loader/ETBRLoader/maps/MockTest.etbrmap', 'w')
f:write([[{"format":"etbrmap","version":1,"meta":{"name":"Mock"},"settings":{"spawn":{"pos":[0,0,100],"yaw":0},"offset":[0,0,200000],"killZ":-3000,
 "spawnGroups":{"Hounds":{"entity":"/Game/Entity/Hound/BP_Hound.BP_Hound_C","min":2,"max":4,"maxAlive":2,"startDelay":0}}},
 "objects":[{"id":"o1","asset":"/Game/Backrooms/Meshes/SM_Wall_2m.SM_Wall_2m","kind":"mesh","pos":[0,0,0],"rot":[0,90,0],"scale":[1,1,1]},
            {"id":"o2","asset":"/Game/Missing/Thing.Thing","kind":"mesh","pos":[0,0,0],"rot":[0,0,0],"scale":[1,1,1]}],
 "logic":[{"id":"a1","type":"entityspawn","group":"Hounds","pos":[1000,0,0],"size":[400,400,250]},
          {"id":"a2","type":"entityspawn","group":"Hounds","pos":[-1000,0,0],"size":[400,400,250]}]}]])
f:close()

print('--- load file')
etbr('load', 'MockTest'); runLoops(3)
print(('spawned after load: %d actors'):format(#spawned))
print('--- start (teleport)'); etbr('start')
print(('pawn at %.0f %.0f %.0f (expect 0 0 200100)'):format(pawnLoc.X, pawnLoc.Y, pawnLoc.Z))
print('--- run 30 s of logic ticks (spawner: every 2–4 s, max 2 alive)')
local before = #spawned
for _ = 1, 150 do runLoops(1) end
local hounds = 0
for i = before + 1, #spawned do local a = spawned[i]; if tostring(a.cls.name):find('Hound') then hounds = hounds + 1; assert(math.abs(math.abs(a.loc.X) - 1000) <= 200 and a.loc.Z == 200000 - 125 + 100, 'spawned outside its area') end end
print(('hounds spawned: %d (capped by maxAlive=2 → expect 2)'):format(hounds))
spawned[before + 1].valid = false -- one dies
for _ = 1, 40 do runLoops(1) end
local h2 = 0; for i = before + 1, #spawned do if tostring(spawned[i].cls.name):find('Hound') then h2 = h2 + 1 end end
print(('after one died, total hounds spawned: %d (expect 3)'):format(h2))
print('--- unload'); etbr('unload')
print(('destroyed so far: %d'):format(destroyed))
os.remove('loader/ETBRLoader/maps/MockTest.etbrmap')

print('--- LIVE mode')
local responses = {
  [[{"rev":0,"map":{"format":"etbrmap","meta":{"name":"LiveRoom"},"settings":{"spawn":{"pos":[0,0,100],"yaw":0},"offset":[0,0,200000]},"objects":[{"id":"w1","asset":"/Game/A.A","kind":"mesh","pos":[0,0,0],"rot":[0,0,0],"scale":[1,1,1]}],"logic":[]}}]],
  [[{"rev":1,"ops":[{"o":"add","c":"objects","item":{"id":"w2","asset":"/Game/B.B","kind":"mesh","pos":[400,0,0],"rot":[0,0,0],"scale":[1,1,1]}}]}]],
  [[{"rev":2,"ops":[{"o":"set","c":"objects","id":"w2","patch":{"pos":[800,0,0]}}]}]],
  [[{"rev":3,"ops":[{"o":"del","c":"objects","id":"w1"}]}]],
}
local urls = {}
io.popen = function(cmd)
  urls[#urls + 1] = cmd
  local body = table.remove(responses, 1) or '{"rev":3,"ops":[]}'
  return { read = function() return body end, close = function() end }
end
local lf = real_open('loader/ETBRLoader/live.json', 'w'); lf:write('{"room":"ABC123","server":"https://x.test","name":"Jack","color":"#f2d45c"}'); lf:close()
local s0, d0 = #spawned, destroyed
etbr('live')
for _ = 1, 12 do runLoops(1) end
print(('live: spawned %d, destroyed %d (expect spawned 2, destroyed 1)'):format(#spawned - s0, destroyed - d0))
print(('w2 moved to X=%.0f (expect 800)'):format(spawned[#spawned].loc.X))
print('poll URL sample: ' .. (urls[3] or ''):sub(1, 150))
os.remove('loader/ETBRLoader/live.json')
