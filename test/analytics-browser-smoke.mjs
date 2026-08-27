import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workspace = path.resolve(root, '..');
const port = 8765;
const debugPort = 9333;
const baseUrl = `http://127.0.0.1:${port}/`;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sredstva-cdp-'));
const output = {
  desktop: path.join(workspace, 'verify-analytics-studio-desktop.png'),
  dark: path.join(workspace, 'verify-analytics-studio-dark.png'),
  mix: path.join(workspace, 'verify-analytics-studio-mix.png'),
  concentration: path.join(workspace, 'verify-analytics-studio-concentration.png'),
  mobile: path.join(workspace, 'verify-analytics-studio-mobile.png'),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFetch(url, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.listeners.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

async function waitFor(cdp, expression, attempts = 240) {
  for (let i = 0; i < attempts; i++) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(cdp, filePath) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
}

const server = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root,
  windowsHide: true,
  stdio: 'ignore',
});
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  'about:blank',
], {
  windowsHide: true,
  stdio: 'ignore',
});

let cdp;
const exceptions = [];
try {
  await waitForFetch(baseUrl);
  await waitForFetch(`http://127.0.0.1:${debugPort}/json/version`);
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(baseUrl)}`,
    { method: 'PUT' },
  );
  const target = await targetResponse.json();
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  cdp.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params.exceptionDetails?.text || 'Uncaught runtime exception');
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      exceptions.push(params.args?.map((arg) => arg.value || arg.description).join(' ') || 'Console error');
    }
  });
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
  ]);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(cdp, `document.querySelector('.head-stats') && document.querySelectorAll('.row, .group').length > 0`);
  await evaluate(cdp, `document.querySelector('.head-stats').click()`);
  await waitFor(cdp, `document.querySelector('dialog.analytics-studio[open] .analytics-ledger-row')`);

  const desktopState = await evaluate(cdp, `(() => ({
    chapters: document.querySelectorAll('.analytics-chapter-link').length,
    ledgerRows: document.querySelectorAll('.analytics-ledger-row').length,
    context: document.querySelector('.analytics-context-current strong')?.textContent,
    hasNullText: document.querySelector('dialog.analytics-studio')?.textContent.includes('null'),
  }))()`);
  await screenshot(cdp, output.desktop);

  const chapterChecks = {};
  for (const chapter of ['time', 'distribution', 'mix', 'concentration', 'lifecycles', 'methodology']) {
    await evaluate(cdp, `document.querySelector('[data-focus-key="chapter-${chapter}"]').click()`);
    await delay(80);
    chapterChecks[chapter] = await evaluate(cdp, `Boolean(document.querySelector('.analytics-studio-section, .analytics-empty-state'))`);
    if (chapter === 'mix') await screenshot(cdp, output.mix);
    if (chapter === 'concentration') await screenshot(cdp, output.concentration);
  }

  await evaluate(cdp, `localStorage.setItem('sredstva-theme', 'dark')`);
  await cdp.send('Page.reload');
  await waitFor(cdp, `document.querySelector('.head-stats') && document.body.classList.contains('theme-dark')`);
  await evaluate(cdp, `document.querySelector('.head-stats').click()`);
  await waitFor(cdp, `document.querySelector('dialog.analytics-studio[open] .analytics-ledger-row')`);
  const darkState = await evaluate(cdp, `(() => ({
    bodyClass: document.body.className,
    studioBackground: getComputedStyle(document.querySelector('.analytics-studio')).backgroundColor,
  }))()`);
  await screenshot(cdp, output.dark);

  await evaluate(cdp, `document.querySelector('[data-focus-key="chapter-distribution"]').click()`);
  await waitFor(cdp, `document.querySelector('.analytics-histogram-bin')`);
  await evaluate(cdp, `document.querySelector('.analytics-histogram-bin').click()`);
  await waitFor(cdp, `document.querySelector('.analytics-selection-tray .analytics-selection-apply')`);
  await evaluate(cdp, `document.querySelector('.analytics-selection-tray .analytics-selection-apply').click()`);
  await waitFor(cdp, `!document.querySelector('dialog.analytics-studio[open]') && document.querySelector('.scope-chip')`);
  const drillThrough = await evaluate(cdp, `document.querySelector('.scope-chip')?.textContent || ''`);

  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor(cdp, `document.querySelector('.head-stats') && document.querySelectorAll('.row, .group').length > 0`);
  await evaluate(cdp, `document.querySelector('.head-stats').click()`);
  await waitFor(cdp, `document.querySelector('dialog.analytics-studio[open] .analytics-ledger-row')`);
  await evaluate(cdp, `document.querySelector('[data-focus-key="chapter-concentration"]').click()`);
  await waitFor(cdp, `document.querySelector('.analytics-recipient-ranking .analytics-ranking-row')`);
  await evaluate(cdp, `document.querySelector('.analytics-recipient-ranking .analytics-ranking-row').click()`);
  await waitFor(cdp, `document.querySelector('.analytics-selection-tray .analytics-selection-apply')`);
  await evaluate(cdp, `document.querySelector('.analytics-selection-tray .analytics-selection-apply').click()`);
  await waitFor(cdp, `!document.querySelector('dialog.analytics-studio[open]') && document.querySelector('.scope-chip')`);
  await cdp.send('Browser.grantPermissions', {
    origin: baseUrl,
    permissions: ['clipboardReadWrite'],
  });
  await evaluate(cdp, `document.querySelector('.share-view-btn').click()`);
  await waitFor(cdp, `document.querySelector('.share-view-btn.is-copied')`);
  const recipientUrl = await evaluate(cdp, `navigator.clipboard.readText()`);
  await cdp.send('Page.navigate', { url: recipientUrl });
  await waitFor(cdp, `document.querySelector('.scope-chip')`);
  const recipientRoundTrip = await evaluate(cdp, `document.querySelector('.scope-chip')?.textContent || ''`);

  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor(cdp, `document.querySelector('.head-stats') && document.querySelectorAll('.row, .group').length > 0`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector('.search input');
    input.value = 'no-such-registry-record-zzzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(350);
  await evaluate(cdp, `document.querySelector('.head-stats').click()`);
  await waitFor(cdp, `document.querySelector('dialog.analytics-studio[open] .analytics-empty-primary')`);
  const emptyState = await evaluate(cdp, `document.querySelector('.analytics-empty-primary h2')?.textContent || ''`);
  await evaluate(cdp, `document.querySelector('.analytics-studio-close').click()`);

  await evaluate(cdp, `localStorage.setItem('sredstva-theme', 'light')`);
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor(cdp, `document.querySelector('.head-stats') && document.querySelectorAll('.row, .group').length > 0`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await evaluate(cdp, `document.querySelector('.head-stats').click()`);
  await waitFor(cdp, `document.querySelector('dialog.analytics-studio[open] .analytics-ledger-row')`);
  await screenshot(cdp, output.mobile);
  const mobileState = await evaluate(cdp, `(() => ({
    dialogWidth: Math.round(document.querySelector('.analytics-studio').getBoundingClientRect().width),
    viewportWidth: innerWidth,
    navScrollable: document.querySelector('.analytics-chapter-nav').scrollWidth >= document.querySelector('.analytics-chapter-nav').clientWidth,
    closeTarget: Math.round(document.querySelector('.analytics-studio-close').getBoundingClientRect().height),
  }))()`);

  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(' | ')}`);
  if (desktopState.chapters !== 7) throw new Error(`Expected 7 chapters, got ${desktopState.chapters}`);
  if (desktopState.ledgerRows < 6) throw new Error(`Expected at least 6 overview metrics, got ${desktopState.ledgerRows}`);
  if (desktopState.hasNullText) throw new Error('Dialog rendered a literal null value');
  if (!Object.values(chapterChecks).every(Boolean)) throw new Error(`Chapter check failed: ${JSON.stringify(chapterChecks)}`);
  if (!darkState.bodyClass.includes('theme-dark')) throw new Error('Dark theme did not apply to analytics');
  if (!drillThrough.trim()) throw new Error('Drill-through did not add a registry scope');
  if (!recipientUrl || !recipientRoundTrip.trim()) throw new Error('Recipient scope did not survive a URL round trip');
  if (!emptyState.trim()) throw new Error('Empty analytics state did not render');
  if (mobileState.dialogWidth !== mobileState.viewportWidth) {
    throw new Error(`Mobile dialog width mismatch: ${JSON.stringify(mobileState)}`);
  }
  if (mobileState.closeTarget < 44) throw new Error(`Mobile close target is too small: ${mobileState.closeTarget}px`);

  console.log(JSON.stringify({
    desktopState,
    darkState,
    chapterChecks,
    drillThrough,
    recipientRoundTrip,
    emptyState,
    mobileState,
    screenshots: output,
  }, null, 2));
} finally {
  if (cdp) cdp.close();
  chrome.kill();
  server.kill();
  await delay(1000);
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(tempRoot + path.sep)) {
    try {
      fs.rmSync(resolvedProfile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch {
      // Chrome can briefly retain profile handles on Windows. The OS temp
      // directory can safely collect a leftover smoke-test profile.
    }
  }
}
