import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../usage.js', import.meta.url), 'utf8');

class EventTargetMock {
	constructor() {
		this.listeners = new Map();
	}

	addEventListener(type, listener) {
		const list = this.listeners.get(type) || [];
		list.push(listener);
		this.listeners.set(type, list);
	}

	dispatch(type, event = {}) {
		for (const listener of this.listeners.get(type) || []) listener(event);
	}
}

function makeCollector({
	dnt = '0',
	gpc = false,
	ownerOptOut = false,
	sendBeacon = () => true,
	fetchImpl = async () => new Response(null, { status: 204 }),
} = {}) {
	const storage = new Map(ownerOptOut ? [['sredstva-usage-optout', '1']] : []);
	const storageWrites = [];
	const document = new EventTargetMock();
	document.visibilityState = 'visible';
	document.referrer = 'https://example.com/path?q=private';
	const window = new EventTargetMock();
	window.doNotTrack = dnt;
	window.__HAVC_USAGE_TEST__ = true;
	const navigator = {
		globalPrivacyControl: gpc,
		doNotTrack: dnt,
		sendBeacon,
	};
	let clock = 1000;
	const performance = {
		now: () => clock,
		getEntriesByType: () => [],
	};
	const localStorage = {
		getItem: (key) => storage.get(key) || null,
		setItem: (key, value) => {
			storageWrites.push(['set', key, value]);
			storage.set(key, value);
		},
		removeItem: (key) => {
			storageWrites.push(['remove', key]);
			storage.delete(key);
		},
	};
	Object.assign(window, {
		window,
		document,
		navigator,
		location: { host: 'havc.matijar.info' },
		localStorage,
		performance,
	});
	const context = vm.createContext({
		window,
		document,
		navigator,
		location: window.location,
		localStorage,
		performance,
		fetch: fetchImpl,
		crypto: globalThis.crypto,
		URL,
		Blob,
		Response,
		TextEncoder,
		setTimeout,
		clearTimeout,
		console,
	});
	vm.runInContext(source, context, { filename: 'usage.js' });
	return {
		window,
		document,
		navigator,
		storageWrites,
		setClock: (value) => { clock = value; },
	};
}

test('DNT, GPC, and the explicit owner flag disable collection before any request', () => {
	for (const options of [
		{ dnt: '1' },
		{ gpc: true },
		{ ownerOptOut: true },
	]) {
		let calls = 0;
		const harness = makeCollector({
			...options,
			fetchImpl: async () => {
				calls++;
				return new Response(null, { status: 204 });
			},
		});
		harness.window.havcUsage('filter', 'program');
		assert.equal(harness.window.havcUsageStatus.enabled, false);
		assert.equal(calls, 0);
	}
});

test('public collection reads no persistent identifier and writes nothing to storage', async () => {
	const harness = makeCollector();
	assert.equal(harness.window.havcUsageStatus.enabled, true);
	harness.window.havcUsage('filter', 'program');
	await harness.window.__havcUsageTest.flush(false);
	assert.deepEqual(harness.storageWrites, []);
	assert.match(harness.window.__havcUsageTest.sessionId, /^[A-Za-z0-9_-]{16,64}$/);
});

test('sendBeacon false falls back to keepalive fetch without losing the batch', async () => {
	const calls = [];
	const harness = makeCollector({
		sendBeacon: () => false,
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			return new Response(null, { status: 204 });
		},
	});
	harness.window.havcUsage('filter', 'program');
	const sent = await harness.window.__havcUsageTest.flush(true);
	assert.equal(sent, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].options.keepalive, true);
	const payload = JSON.parse(calls[0].options.body);
	assert.deepEqual(payload.e.map((event) => event.n), ['page_view', 'filter']);
	assert.equal(harness.window.__havcUsageTest.queueSize(), 0);
});

test('failed fetch restores the in-memory batch and a later flush retries it', async () => {
	let attempts = 0;
	const payloads = [];
	const harness = makeCollector({
		fetchImpl: async (_url, options) => {
			attempts++;
			payloads.push(JSON.parse(options.body));
			if (attempts === 1) throw new Error('offline');
			return new Response(null, { status: 204 });
		},
	});
	harness.window.havcUsage('studio_open');
	assert.equal(await harness.window.__havcUsageTest.flush(false), false);
	assert.equal(harness.window.__havcUsageTest.queueSize(), 2);
	assert.equal(await harness.window.__havcUsageTest.flush(false), true);
	assert.equal(attempts, 2);
	assert.deepEqual(payloads[0].e, payloads[1].e);
	assert.equal(harness.window.__havcUsageTest.queueSize(), 0);
});

test('visibility lifecycle uses monotonic time and sends one complete end snapshot', async () => {
	const beacons = [];
	const harness = makeCollector({
		sendBeacon: (_url, blob) => {
			beacons.push(blob);
			return true;
		},
	});
	harness.window.havcUsage('session_start', 'hr|auto');
	harness.setClock(2000);
	harness.window.dispatch('pointerdown');
	harness.setClock(5000);
	harness.document.visibilityState = 'hidden';
	harness.document.dispatch('visibilitychange');
	harness.window.dispatch('pagehide');

	assert.equal(beacons.length, 1);
	const payload = JSON.parse(await beacons[0].text());
	const end = payload.e.find((event) => event.n === 'session_end');
	assert.ok(end);
	assert.equal(end.v, 4000);
	assert.equal(end.d, '4000|3000|0');
});
