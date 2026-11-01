// Drive the running editor over CDP (tunnelled to localhost:9333).
//   node tools/cdp.mjs eval "<js expression>"      → prints JSON result
//   node tools/cdp.mjs shot out.png                → screenshot
//   node tools/cdp.mjs reload                      → reload page, print console errors for 6 s
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(new URL('../server/index.js', import.meta.url));
const WebSocket = require('ws');
const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
let id = 0; const wait = new Map();
const call = (method, params = {}) => new Promise((res) => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const logs = [];
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.id && wait.has(msg.id)) { wait.get(msg.id)(msg.result ?? msg); wait.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === 'Log.entryAdded') logs.push(`[log ${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
});
await new Promise((r) => ws.on('open', r));
await call('Runtime.enable'); await call('Log.enable');
if (cmd === 'js') {
  const r = await call('Runtime.evaluate', { expression: fs.readFileSync(arg, 'utf8'), awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description ?? r, null, 1));
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(arg || 'shot.png', Buffer.from(r.data, 'base64')); console.log('saved', arg);
} else if (cmd === 'reload') {
  await call('Page.reload', { ignoreCache: true });
  await new Promise((r) => setTimeout(r, +(arg || 6000)));
}
await new Promise((r) => setTimeout(r, 300));
if (logs.length) console.log(logs.join('\n'));
process.exit(0);
