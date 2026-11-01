-- Minimal JSON decoder (objects, arrays, strings, numbers, true/false/null).
local json = {}
local esc = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }

local function skip(s, i)
  local _, e = s:find('^[ \n\r\t]*', i)
  return e + 1
end

local parse
local function str(s, i)
  local out, j = {}, i + 1
  while true do
    local c = s:sub(j, j)
    if c == '' then error('unterminated string at ' .. i) end
    if c == '"' then return table.concat(out), j + 1 end
    if c == '\\' then
      local n = s:sub(j + 1, j + 1)
      if n == 'u' then
        local cp = tonumber(s:sub(j + 2, j + 5), 16) or 63
        if cp < 128 then out[#out + 1] = string.char(cp)
        elseif cp < 2048 then out[#out + 1] = string.char(192 + (cp >> 6), 128 + (cp & 63))
        else out[#out + 1] = string.char(224 + (cp >> 12), 128 + ((cp >> 6) & 63), 128 + (cp & 63)) end
        j = j + 6
      else
        out[#out + 1] = esc[n] or n; j = j + 2
      end
    else
      local k = s:find('["\\]', j)
      if not k then error('unterminated string') end
      out[#out + 1] = s:sub(j, k - 1); j = k
    end
  end
end

function parse(s, i)
  i = skip(s, i)
  local c = s:sub(i, i)
  if c == '{' then
    local t = {}; i = skip(s, i + 1)
    if s:sub(i, i) == '}' then return t, i + 1 end
    while true do
      local k; k, i = str(s, skip(s, i))
      i = skip(s, i); if s:sub(i, i) ~= ':' then error('expected : at ' .. i) end
      t[k], i = parse(s, i + 1)
      i = skip(s, i); c = s:sub(i, i)
      if c == '}' then return t, i + 1 end
      if c ~= ',' then error('expected , or } at ' .. i) end
      i = i + 1
    end
  elseif c == '[' then
    local t, n = {}, 0; i = skip(s, i + 1)
    if s:sub(i, i) == ']' then return t, i + 1 end
    while true do
      n = n + 1; t[n], i = parse(s, i)
      i = skip(s, i); c = s:sub(i, i)
      if c == ']' then return t, i + 1 end
      if c ~= ',' then error('expected , or ] at ' .. i) end
      i = i + 1
    end
  elseif c == '"' then return str(s, i)
  elseif s:sub(i, i + 3) == 'true' then return true, i + 4
  elseif s:sub(i, i + 4) == 'false' then return false, i + 5
  elseif s:sub(i, i + 3) == 'null' then return nil, i + 4
  else
    local num = s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', i)
    if not num or num == '' then error('unexpected "' .. c .. '" at ' .. i) end
    return tonumber(num), i + #num
  end
end

function json.decode(s)
  if s:sub(1, 3) == '\239\187\191' then s = s:sub(4) end -- BOM
  local v = parse(s, 1)
  return v
end
return json
