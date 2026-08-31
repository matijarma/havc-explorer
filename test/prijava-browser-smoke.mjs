import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workspace = path.resolve(root, '..');
const port = 8878;
const debugPort = 9446;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'havc-prijava-cdp-'));
const screenshots = {
	mobile: path.join(workspace, 'verify-prijava-mobile.png'),
	desktop: path.join(workspace, 'verify-prijava-desktop.png'),
};

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
	const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
	const relative = pathname === '/prijava/' ? 'prijava/index.html' : pathname.replace(/^\/+/, '');
	const target = path.resolve(root, relative);
	if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
		response.writeHead(404);
		response.end('Not found');
		return;
	}
	response.writeHead(200, { 'content-type': contentTypes[path.extname(target)] || 'application/octet-stream' });
	fs.createReadStream(target).pipe(response);
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, attempts = 100) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
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

async function evaluate(cdp, expression) {
	const result = await cdp.send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
	return result.result.value;
}

async function screenshot(cdp, destination) {
	const metrics = await cdp.send('Page.getLayoutMetrics');
	const result = await cdp.send('Page.captureScreenshot', {
		format: 'png',
		captureBeyondViewport: true,
		clip: {
			x: 0,
			y: 0,
			width: metrics.cssContentSize.width,
			height: metrics.cssContentSize.height,
			scale: 1,
		},
	});
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
		`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/prijava/`)}`,
		{ method: 'PUT' },
	);
	const target = await targetResponse.json();
	cdp = new Cdp(target.webSocketDebuggerUrl);
	await cdp.connect();
	await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);

	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 2,
		mobile: true,
		screenWidth: 390,
		screenHeight: 844,
	});
	await cdp.send('Page.reload');
	await delay(500);
	const mobile = await evaluate(cdp, `(() => ({
		title: document.querySelector('h1')?.textContent,
		overflow: document.documentElement.scrollWidth > innerWidth,
		buttonTargets: [...document.querySelectorAll('.button')]
			.map((node) => Math.round(node.getBoundingClientRect().height))
			.filter(Boolean),
		readingTargets: [...document.querySelectorAll('.reading-list a')].map((node) => Math.round(node.getBoundingClientRect().height)),
		stickyNav: getComputedStyle(document.querySelector('.jump-nav')).position,
	}))()`);
	await screenshot(cdp, screenshots.mobile);

	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 1440,
		height: 1000,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send('Page.reload');
	await delay(400);
	const desktop = await evaluate(cdp, `(() => ({
		overflow: document.documentElement.scrollWidth > innerWidth,
		featureColumns: getComputedStyle(document.querySelector('.feature-doc')).gridTemplateColumns,
		sections: document.querySelectorAll('main > .section').length,
	}))()`);
	await screenshot(cdp, screenshots.desktop);

	await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/prijava/reader.html?doc=02-portal-odgovori.txt` });
	await delay(500);
	const reader = await evaluate(cdp, `(() => ({
		title: document.querySelector('h1')?.textContent,
		hasContent: document.querySelector('#content')?.textContent.includes('Odgovori za HAVC-ovu online prijavnicu'),
		overflow: document.documentElement.scrollWidth > innerWidth,
	}))()`);

	if (mobile.title !== 'Prijavna dokumentacija') throw new Error(`Unexpected mobile title: ${mobile.title}`);
	if (mobile.overflow || desktop.overflow || reader.overflow) throw new Error('Unexpected horizontal overflow');
	if (mobile.buttonTargets.some((height) => height < 44)) throw new Error(`Small button target: ${mobile.buttonTargets}`);
	if (mobile.readingTargets.some((height) => height < 44)) throw new Error(`Small reading target: ${mobile.readingTargets}`);
	if (mobile.stickyNav !== 'sticky') throw new Error(`Expected sticky nav, got ${mobile.stickyNav}`);
	if (desktop.sections !== 4) throw new Error(`Expected four primary sections, got ${desktop.sections}`);
	if (!reader.hasContent) throw new Error(`Reader did not load requested source: ${JSON.stringify(reader)}`);

	console.log(JSON.stringify({ mobile, desktop, reader, screenshots }, null, 2));
} finally {
	if (cdp) cdp.close();
	chrome.kill();
	server.close();
	await delay(300);
	try {
		fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	} catch {}
}
