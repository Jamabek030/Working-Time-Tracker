// Minimal Chrome DevTools Protocol driver (no dependencies; Node 24 global WebSocket).
// Launches a fresh, signed-out headless Chrome profile and exposes helpers to
// evaluate JS inside the nested Apps Script iframes (out-of-process frames).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtt-anon-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()).webSocketDebuggerUrl; }
    catch (e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const contexts = new Map(); let id = 0; const pending = new Map(); const sessions = new Map(); const dialogs = [];
  const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const s = m.params.sessionId; sessions.set(s, m.params.targetInfo);
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s).catch(() => {});
      send('Runtime.enable', {}, s).catch(() => {});
      send('Page.enable', {}, s).catch(() => {});
    }
    if (m.method === 'Runtime.executionContextCreated') { const c = m.params.context; if (c.auxData && c.auxData.isDefault) contexts.set(m.sessionId + ':' + c.id, { session: m.sessionId, contextId: c.id, origin: c.origin, frameId: c.auxData.frameId }); }
    if (m.method === 'Runtime.executionContextDestroyed') contexts.delete(m.sessionId + ':' + m.params.executionContextId);
    if (m.method === 'Runtime.executionContextsCleared') for (const k of Array.from(contexts.keys())) if (k.startsWith(m.sessionId + ':')) contexts.delete(k);
    if (m.method === 'Target.detachedFromTarget') sessions.delete(m.params.sessionId);
    if (m.method === 'Target.targetInfoChanged') for (const [s, t] of sessions) if (t.targetId === m.params.targetInfo.targetId) sessions.set(s, m.params.targetInfo);
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch(() => {});
    }
    listeners.forEach(l => l(m));
  };
  function send(method, params, sessionId) {
    return new Promise((res, rej) => {
      const i = ++id; pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
    });
  }
  async function newPage(url) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    sessions.set(sessionId, { targetId, type: 'page', url: 'about:blank' });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    if (url) await send('Page.navigate', { url }, sessionId);
    return { targetId, sessionId };
  }
  async function evalIn(h, expression) {
    const sessionId = typeof h === 'string' ? h : h.session;
    const params = { expression, awaitPromise: true, returnByValue: true };
    if (typeof h !== 'string') params.contextId = h.contextId;
    const r = await send('Runtime.evaluate', params, sessionId);
    if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  // Find a session (any frame) in which `probe` evaluates truthy.
  async function findFrame(probe, timeoutMs) {
    const end = Date.now() + (timeoutMs || 30000);
    while (Date.now() < end) {
      for (const s of Array.from(contexts.values())) {
        try { if (await evalIn(s, '(function(){try{return !!(' + probe + ')}catch(e){return false}})()')) return s; } catch (e) {}
      }
      await sleep(500);
    }
    throw new Error('frame not found for probe: ' + probe);
  }
  async function close() { try { await send('Browser.close'); } catch (e) {} try { proc.kill(); } catch (e) {} }
  return { send, newPage, evalIn, findFrame, close, sessions, contexts, dialogs, sleep, on: l => listeners.push(l) };
}
module.exports = { launch, sleep };
