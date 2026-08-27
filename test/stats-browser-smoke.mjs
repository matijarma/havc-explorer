import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStats } from '../worker/render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workspace = path.resolve(root, '..');
const debugPort = 9444;
const port = 8877;
const url = `http://127.0.0.1:${port}/stats?range=7`;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sredstva-stats-cdp-'));
const screenshots = {
  desktop: path.join(workspace, 'verify-visitor-stats-desktop.png'),
  mobile: path.join(workspace, 'verify-visitor-stats-mobile.png'),
};

const dayCounts = [
  ['2026-08-03', 3],
  ['2026-08-04', 1],
  ['2026-08-05', 10],
];
let id = 1;
const raw = [];
for (const [day, count] of dayCounts) {
  for (let index = 0; index < count; index++) {
    const session = `session_${day.replaceAll('-', '')}_${String(index).padStart(4, '0')}`;
    const events = [
      { n: 'page_view', d: 'app', t: 0 },
      { n: 'data_loaded', v: 900 + index * 260, t: 1000 },
      { n: 'session_start', d: `${index % 3 === 0 ? 'en' : 'hr'}|${index % 2 ? 'dark' : 'auto'}`, t: 1001 },
      { n: 'app_ready', v: 1200 + index * 310, t: 1200 },
      { n: 'web_vital', d: 'ttfb', v: 280 + index * 45, t: 300 },
      { n: 'web_vital', d: 'lcp', v: 1350 + index * 190, t: 2500 },
    ];
    if (index % 2 === 0) events.push({ n: 'filter', d: index % 4 ? 'program' : 'years', t: 4000 });
    if (index % 3 !== 1) {
      events.push({
        n: 'project_open',
        d: index % 2 ? 'timeline' : 'project-row',
        p: ['sigurno mjesto', 'covjek koji nije mogao sutjeti', 'fiume o morte'][index % 3],
        t: 5000,
      });
    }
    if (index % 4 === 0) events.push({ n: 'studio_open', t: 6500 });
    if (index % 5 === 0) events.push({ n: 'pdf_open', t: 8000 });
    if (index === 0) events.push({ n: 'share_created', d: 'dashboard', t: 9000 });
    events.push({
      n: 'session_end',
      d: `${45000 + index * 9000}|${18000 + index * 5000}|${index % 4}`,
      v: 60000 + index * 12000,
      t: 60000,
    });
    raw.push({
      id: id++,
      ts: Date.parse(`${day}T12:00:00Z`) + index * 60000,
      day,
      session,
      country: index % 4 === 0 ? 'DE' : 'HR',
      device: index % 5 === 0 ? 'mobile' : 'desktop',
      ref_host: index % 3 === 0 ? 'google.com' : 'direct',
      payload: JSON.stringify(events),
    });
  }
}

const db = {
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      all: async () => {
        if (normalized.startsWith('SELECT day, event')) return { results: [] };
        if (normalized.startsWith('SELECT * FROM usage_events')) return { results: raw };
        if (normalized === 'SELECT k, v FROM usage_meta') return { results: [] };
        if (normalized.startsWith('SELECT hour_utc, request_count, visit_count FROM edge_hourly')) return { results: [] };
        if (normalized.startsWith('SELECT hour_utc, browser, request_count, visit_count FROM edge_browser_hourly')) return { results: [] };
        if (normalized === 'SELECT k, v FROM edge_sync_state') return { results: [] };
        throw new Error(`Unsupported query: ${normalized}`);
      },
    };
  },
};

const html = await renderStats({ DB: db }, '2026-08-05', {
  range: '7',
  archiveStatus: {
    refreshed: ['2026-08-03', '2026-08-04'],
    pruned: [],
    syncedAt: Date.parse('2026-08-05T17:30:00Z'),
  },
  nonce: 'browser-smoke',
});

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Cdp {
  constructor(socketUrl) {
    this.socket = new WebSocket(socketUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(urlToFetch, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(urlToFetch);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${urlToFetch}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
}

async function screenshot(cdp, destination, fullPage = false) {
  const params = { format: 'png', captureBeyondViewport: fullPage };
  if (fullPage) {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    params.clip = {
      x: 0,
      y: 0,
      width: metrics.cssContentSize.width,
      height: metrics.cssContentSize.height,
      scale: 1,
    };
  }
  const result = await cdp.send('Page.captureScreenshot', params);
  fs.writeFileSync(destination, Buffer.from(result.data, 'base64'));
}

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });

let cdp;
try {
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`);
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  );
  const target = await targetResponse.json();
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.reload');
  await delay(600);
  const desktop = await evaluate(cdp, `(() => {
    const linearChannels = (value) => {
      const numbers = (value.match(/-?[\\d.]+/g) || []).slice(0, 3).map(Number);
      if (value.startsWith('oklch')) {
        const [lightness, chroma, hue] = numbers;
        const radians = hue * Math.PI / 180;
        const a = chroma * Math.cos(radians);
        const b = chroma * Math.sin(radians);
        const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
        const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
        const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
        const l = lRoot ** 3;
        const m = mRoot ** 3;
        const s = sRoot ** 3;
        return [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ].map((channel) => Math.max(0, Math.min(1, channel)));
      }
      return numbers.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
    };
    const luminance = (value) => {
      const channels = linearChannels(value);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground, background) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const background = getComputedStyle(document.body).backgroundColor;
    const quietColor = getComputedStyle(document.querySelector('.lede')).color;
    const accentColor = getComputedStyle(document.querySelector('.funnel-index')).color;
    return {
      title: document.querySelector('h1')?.textContent,
      sections: document.querySelectorAll('.ledger-section').length,
      sessions: [...document.querySelectorAll('.metric-row')]
        .find((row) => row.querySelector('.metric-copy strong')?.textContent.includes('Detailed first-party sessions'))
        ?.querySelector('.metric-value')?.childNodes[0]?.textContent.trim(),
      bodyOverflow: document.documentElement.scrollWidth > innerWidth,
      summaries: [...document.querySelectorAll('summary')].map((node) => Math.round(node.getBoundingClientRect().height)),
      optOut: document.querySelector('#owner-optout-status')?.textContent,
      background,
      quietColor,
      accentColor,
      quietContrast: contrast(quietColor, background),
      accentContrast: contrast(accentColor, background),
    };
  })()`);
  await screenshot(cdp, screenshots.desktop, true);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 320,
    screenHeight: 800,
  });
  await cdp.send('Page.reload');
  await delay(500);
  const mobile = await evaluate(cdp, `(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyOverflow: document.documentElement.scrollWidth > innerWidth,
    rangeTargets: [...document.querySelectorAll('.range-nav a')].map((node) => Math.round(node.getBoundingClientRect().height)),
    summaryTargets: [...document.querySelectorAll('summary')].map((node) => Math.round(node.getBoundingClientRect().height)),
    metricRows: document.querySelectorAll('.metric-row').length,
  }))()`);
  await screenshot(cdp, screenshots.mobile, true);

  if (desktop.sections !== 6) throw new Error(`Expected 6 sections: ${JSON.stringify(desktop)}`);
  if (desktop.sessions !== '14') throw new Error(`Expected 14 sessions: ${JSON.stringify(desktop)}`);
  if (desktop.bodyOverflow || mobile.bodyOverflow) throw new Error(`Unexpected page overflow: ${JSON.stringify({ desktop, mobile })}`);
  if (desktop.summaries.some((height) => height < 44)) throw new Error(`Desktop summary target below 44px: ${desktop.summaries}`);
  if (desktop.quietContrast < 4.5) throw new Error(`Quiet text contrast too low: ${JSON.stringify(desktop)}`);
  if (desktop.accentContrast < 4.5) throw new Error(`Accent text contrast too low: ${JSON.stringify(desktop)}`);
  if (mobile.rangeTargets.some((height) => height < 44)) throw new Error(`Mobile range target below 44px: ${mobile.rangeTargets}`);
  if (mobile.summaryTargets.some((height) => height < 44)) throw new Error(`Mobile summary target below 44px: ${mobile.summaryTargets}`);

  console.log(JSON.stringify({ desktop, mobile, screenshots }, null, 2));
} finally {
  if (cdp) cdp.close();
  chrome.kill();
  server.close();
  await delay(500);
  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
}
