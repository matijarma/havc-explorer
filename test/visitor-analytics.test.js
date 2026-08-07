import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
	cleanEvent,
	ingest,
	syncArchive,
	verifyAccessJwt,
} from '../worker/index.js';
import {
	aggregate,
	aggregateKey,
	decodeAggregateKey,
} from '../worker/aggregate.js';
import { loadCloudflareSignals } from '../worker/cloudflare.js';
import { renderStats } from '../worker/render.js';
import { dayInTimeZone } from '../worker/time.js';

function rawRow(overrides = {}) {
	return {
		id: 1,
		ts: Date.parse('2026-08-03T12:00:00Z'),
		day: '2026-08-03',
		session: 'session_abcdefghijklmnop',
		country: 'HR',
		device: 'desktop',
		ref_host: 'direct',
		payload: JSON.stringify([
			{ n: 'page_view', d: 'app', t: 0 },
			{ n: 'data_loaded', v: 1200, t: 1200 },
			{ n: 'session_start', d: 'hr|auto', t: 1201 },
		]),
		...overrides,
	};
}

function cloneState(state) {
	return {
		events: state.events.map((row) => ({ ...row })),
		daily: state.daily.map((row) => ({ ...row })),
		meta: new Map(state.meta),
		nextId: state.nextId,
	};
}

class FakeStatement {
	constructor(db, sql, params = []) {
		this.db = db;
		this.sql = sql.replace(/\s+/g, ' ').trim();
		this.params = params;
	}

	bind(...params) {
		return new FakeStatement(this.db, this.sql, params);
	}

	all() {
		return Promise.resolve({ results: this.db.query(this.sql, this.params) });
	}

	first() {
		return this.all().then(({ results }) => results[0] || null);
	}

	run() {
		this.db.mutate(this.db.state, this.sql, this.params);
		return Promise.resolve({ success: true });
	}
}

class FakeD1 {
	constructor({ events = [], daily = [], meta = [] } = {}) {
		this.state = {
			events: events.map((row, index) => ({ id: row.id || index + 1, ...row })),
			daily: daily.map((row) => ({ ...row })),
			meta: new Map(meta),
			nextId: events.length + 1,
		};
		this.failNextBatch = false;
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	query(sql, params) {
		const state = this.state;
		if (sql.startsWith('SELECT day, COUNT(*) AS row_count')) {
			const [today] = params;
			const grouped = new Map();
			for (const row of state.events.filter((candidate) => candidate.day < today)) {
				const current = grouped.get(row.day) || { day: row.day, row_count: 0, max_id: 0 };
				current.row_count++;
				current.max_id = Math.max(current.max_id, row.id);
				grouped.set(row.day, current);
			}
			return [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day));
		}
		if (sql.startsWith("SELECT DISTINCT day FROM usage_daily")) {
			const [today] = params;
			return [...new Set(state.daily
				.filter((row) => row.event === 'session' && row.dim === '' && row.day < today)
				.map((row) => row.day))]
				.map((day) => ({ day }));
		}
		if (sql.startsWith("SELECT k, v FROM usage_meta WHERE k LIKE 'archive:v2:%'")) {
			return [...state.meta.entries()]
				.filter(([key]) => key.startsWith('archive:v2:'))
				.map(([k, v]) => ({ k, v }));
		}
		if (sql.startsWith('SELECT * FROM usage_events WHERE day = ?')) {
			return state.events.filter((row) => row.day === params[0]).sort((a, b) => a.id - b.id);
		}
		if (sql.startsWith('SELECT day, event, dim, val, count FROM usage_daily')) {
			return state.daily.slice().sort((a, b) => a.day.localeCompare(b.day));
		}
		if (sql.startsWith('SELECT * FROM usage_events ORDER BY id')) {
			return state.events.slice().sort((a, b) => a.id - b.id);
		}
		if (sql === 'SELECT k, v FROM usage_meta') {
			return [...state.meta.entries()].map(([k, v]) => ({ k, v }));
		}
		throw new Error(`Unsupported fake query: ${sql}`);
	}

	mutate(state, sql, params) {
		if (sql.startsWith('DELETE FROM usage_daily WHERE day = ?')) {
			state.daily = state.daily.filter((row) => row.day !== params[0]);
			return;
		}
		if (sql.startsWith('DELETE FROM usage_events WHERE day = ?')) {
			state.events = state.events.filter((row) => row.day !== params[0]);
			return;
		}
		if (sql.startsWith('INSERT INTO usage_daily')) {
			for (let index = 0; index < params.length; index += 5) {
				const [day, event, dim, val, count] = params.slice(index, index + 5);
				const existing = state.daily.find((row) =>
					row.day === day && row.event === event && row.dim === dim && row.val === val);
				if (existing) existing.count = count;
				else state.daily.push({ day, event, dim, val, count });
			}
			return;
		}
		if (sql.startsWith('INSERT INTO usage_meta')) {
			let key;
			let value;
			if (sql.includes("VALUES ('last_compaction', ?)")) {
				key = 'last_compaction';
				[value] = params;
			} else if (sql.includes("VALUES ('archive_version', ?)")) {
				key = 'archive_version';
				[value] = params;
			} else {
				[key, value] = params;
			}
			state.meta.set(key, String(value));
			return;
		}
		if (sql.startsWith('INSERT INTO usage_events')) {
			const [ts, day, session, country, device, ref_host, payload] = params;
			state.events.push({
				id: state.nextId++,
				ts,
				day,
				session,
				country,
				device,
				ref_host,
				payload,
			});
			return;
		}
		throw new Error(`Unsupported fake mutation: ${sql}`);
	}

	async batch(statements) {
		if (this.failNextBatch) {
			this.failNextBatch = false;
			throw new Error('simulated batch failure');
		}
		const next = cloneState(this.state);
		for (const statement of statements) this.mutate(next, statement.sql, statement.params);
		this.state = next;
		return statements.map(() => ({ success: true }));
	}
}

test('aggregate keys preserve delimiters and session reach deduplicates repeated actions', () => {
	const rows = [
		rawRow({
			payload: JSON.stringify([
				{ n: 'session_start', d: 'hr|auto' },
				{ n: 'data_loaded', v: 1000 },
				{ n: 'filter', d: 'program' },
				{ n: 'filter', d: 'program' },
				{ n: 'view', d: 'about|research' },
			]),
		}),
		rawRow({
			id: 2,
			payload: JSON.stringify([
				{ n: 'filter', d: 'program' },
				{ n: 'project_open', d: 'project-row', p: 'project one' },
			]),
		}),
	];
	const result = aggregate(rows);
	assert.equal(result.get(aggregateKey('2026-08-03', 'session')), 1);
	assert.equal(result.get(aggregateKey('2026-08-03', 'filter')), 3);
	assert.equal(result.get(aggregateKey('2026-08-03', 'filter', 'sessions')), 1);
	assert.equal(result.get(aggregateKey('2026-08-03', 'filter', 'session_d', 'program')), 1);
	const delimiterKey = aggregateKey('2026-08-03', 'view', 'd', 'about|research');
	assert.deepEqual(decodeAggregateKey(delimiterKey), ['2026-08-03', 'view', 'd', 'about|research']);
	assert.equal(result.get(delimiterKey), 1);
});

test('session-end reach is counted once even when several lifecycle flushes exist', () => {
	const result = aggregate([
		rawRow({
			payload: JSON.stringify([
				{ n: 'session_end', d: '1000|500|0', v: 1200 },
				{ n: 'session_end', d: '5000|2000|1', v: 6000 },
			]),
		}),
	]);
	assert.equal(result.get(aggregateKey('2026-08-03', 'session')), 1);
	assert.equal(result.get(aggregateKey('2026-08-03', 'session_end')), 1);
	assert.equal(result.get(aggregateKey('2026-08-03', 'session_end', 'sessions')), 1);
});

test('Zagreb calendar assignment handles summer and winter midnight boundaries', () => {
	assert.equal(dayInTimeZone(Date.parse('2026-08-05T21:59:59Z')), '2026-08-05');
	assert.equal(dayInTimeZone(Date.parse('2026-08-05T22:00:00Z')), '2026-08-06');
	assert.equal(dayInTimeZone(Date.parse('2026-01-10T22:59:59Z')), '2026-01-10');
	assert.equal(dayInTimeZone(Date.parse('2026-01-10T23:00:00Z')), '2026-01-11');
});

test('ingest event validation enforces allowlists, value bounds, and project shape', () => {
	assert.deepEqual(cleanEvent({ n: 'filter', d: 'program', t: 4 }), { n: 'filter', d: 'program', t: 4 });
	assert.equal(cleanEvent({ n: 'filter', d: 'secret-value' }), null);
	assert.equal(cleanEvent({ n: 'unknown' }), null);
	assert.equal(cleanEvent({ n: 'web_vital', d: 'lcp', v: -1 }), null);
	assert.equal(cleanEvent({ n: 'project_open', d: 'project-row', p: '<script>' }), null);
	assert.deepEqual(
		cleanEvent({ n: 'project_open', d: 'timeline', p: 'normalized project title', t: 25 }),
		{ n: 'project_open', d: 'timeline', p: 'normalized project title', t: 25 },
	);
});

test('ingest accepts valid same-origin payloads and silently drops invalid cardinality', async () => {
	const db = new FakeD1();
	const env = {
		DB: db,
		RL_HIT: { limit: async () => ({ success: true }) },
	};
	const valid = new Request('https://havc.matijar.info/api/u', {
		method: 'POST',
		headers: {
			origin: 'https://havc.matijar.info',
			'content-type': 'application/json',
			'user-agent': 'Mozilla/5.0',
		},
		body: JSON.stringify({
			s: 'session_abcdefghijklmnop',
			ref: 'example.com',
			e: [{ n: 'filter', d: 'program' }, { n: 'filter', d: 'not-a-field' }],
		}),
	});
	let pending;
	const response = await ingest(valid, env, { waitUntil: (promise) => { pending = promise; } });
	await pending;
	assert.equal(response.status, 204);
	assert.equal(db.state.events.length, 1);
	assert.deepEqual(JSON.parse(db.state.events[0].payload), [{ n: 'filter', d: 'program' }]);

	const invalid = new Request('https://havc.matijar.info/api/u', {
		method: 'POST',
		headers: {
			origin: 'https://evil.example',
			'content-type': 'application/json',
		},
		body: JSON.stringify({ s: 'session_abcdefghijklmnop', e: [{ n: 'filter', d: 'program' }] }),
	});
	await ingest(invalid, env, { waitUntil() {} });
	assert.equal(db.state.events.length, 1);
});

test('Access JWT validation checks signature, issuer, audience, and time claims', async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	);
	const kid = `test-${Date.now()}`;
	const issuer = `https://access-${Date.now()}.example`;
	const audience = 'audience-id';
	const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
	Object.assign(publicJwk, { kid, alg: 'RS256', use: 'sig' });
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const now = Date.now();
	const header = encode({ alg: 'RS256', kid, typ: 'JWT' });
	const payload = encode({
		iss: issuer,
		aud: [audience],
		iat: Math.floor(now / 1000) - 1,
		nbf: Math.floor(now / 1000) - 1,
		exp: Math.floor(now / 1000) + 300,
	});
	const signingInput = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		{ name: 'RSASSA-PKCS1-v1_5' },
		pair.privateKey,
		new TextEncoder().encode(signingInput),
	);
	const token = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
	const fetchFn = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});

	assert.ok(await verifyAccessJwt(token, { issuer, audience, now, fetchFn }));
	assert.equal(await verifyAccessJwt(token, { issuer, audience: 'wrong', now, fetchFn }), null);
	assert.equal(await verifyAccessJwt(`${signingInput}.AAAA`, { issuer, audience, now, fetchFn }), null);
});

test('direct workers.dev host and a fake stats header are denied before D1 access', async () => {
	let assetCalls = 0;
	const env = { ASSETS: { fetch: () => { assetCalls++; return new Response('asset'); } } };
	const direct = await worker.fetch(
		new Request('https://havc-explorer.kompmajstor4.workers.dev/stats', {
			headers: { 'cf-access-jwt-assertion': 'fake' },
		}),
		env,
		{},
	);
	assert.equal(direct.status, 404);
	assert.equal(assetCalls, 0);

	const fakeHeader = await worker.fetch(
		new Request('https://havc.matijar.info/stats', {
			headers: { 'cf-access-jwt-assertion': 'fake' },
		}),
		env,
		{},
	);
	assert.equal(fakeHeader.status, 403);
	assert.equal(assetCalls, 0);
});

test('owner-triggered archive replacement is idempotent and retains 30 days of raw rows', async () => {
	const db = new FakeD1({
		events: [
			rawRow(),
			rawRow({
				id: 2,
				payload: JSON.stringify([{ n: 'filter', d: 'program' }, { n: 'filter', d: 'program' }]),
			}),
		],
	});
	const env = { DB: db };
	const first = await syncArchive(env, '2026-08-05');
	assert.deepEqual(first.refreshed, ['2026-08-03']);
	assert.equal(db.state.events.length, 2);
	const firstDaily = db.state.daily.map((row) => ({ ...row }));

	const second = await syncArchive(env, '2026-08-05');
	assert.deepEqual(second.refreshed, []);
	assert.deepEqual(db.state.daily, firstDaily);

	db.state.meta.delete('archive:v2:2026-08-03');
	await Promise.all([syncArchive(env, '2026-08-05'), syncArchive(env, '2026-08-05')]);
	assert.deepEqual(db.state.daily, firstDaily);
});

test('failed archive batch leaves raw source and prior archive intact', async () => {
	const db = new FakeD1({ events: [rawRow()] });
	db.failNextBatch = true;
	await assert.rejects(() => syncArchive({ DB: db }, '2026-08-05'), /simulated batch failure/);
	assert.equal(db.state.events.length, 1);
	assert.equal(db.state.daily.length, 0);
	assert.equal(db.state.meta.size, 0);
});

test('archive parity matches direct raw aggregation and old raw rows are pruned only after success', async () => {
	const old = rawRow({ day: '2026-06-01', ts: Date.parse('2026-06-01T12:00:00Z') });
	const db = new FakeD1({ events: [old] });
	const expected = aggregate([old]);
	const status = await syncArchive({ DB: db }, '2026-08-05');
	assert.deepEqual(status.pruned, ['2026-06-01']);
	assert.equal(db.state.events.length, 0);
	for (const [key, count] of expected) {
		const [day, event, dim, val] = decodeAggregateKey(key);
		const archived = db.state.daily.find((row) =>
			row.day === day && row.event === event && row.dim === dim && row.val === val);
		assert.equal(archived?.count, count);
	}
});

test('renderer escapes dimensions and exposes ranges, exact tables, and narrow-screen rules', async () => {
	const db = new FakeD1({
		daily: [
			{ day: '2026-08-05', event: 'session', dim: '', val: '', count: 2 },
			{ day: '2026-08-05', event: 'session', dim: 'ref', val: '<img src=x onerror=alert(1)>', count: 2 },
			{ day: '2026-08-05', event: 'journey', dim: 'stage', val: 'ready', count: 1 },
		],
	});
	const html = await renderStats({ DB: db }, '2026-08-05', {
		range: '7',
		archiveStatus: { refreshed: [], pruned: [], syncedAt: Date.parse('2026-08-05T12:00:00Z') },
		nonce: 'test-nonce',
	});
	assert.match(html, /aria-current="page" class="is-active">7d/);
	assert.match(html, /Show exact daily table/);
	assert.match(html, /@media \(max-width: 420px\)/);
	assert.match(html, /min-height: 44px/);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
	assert.match(html, /nonce="test-nonce"/);
	assert.match(html, /never unique people/i);
});

test('optional Cloudflare comparison aggregates only returned group totals', async () => {
	let requestBody;
	const fetchFn = async (_url, options) => {
		requestBody = JSON.parse(options.body);
		return new Response(JSON.stringify({
			data: {
				viewer: {
					accounts: [{
						edgeDaily: [
							{ count: 16, sum: { visits: 10 }, dimensions: { date: '2026-08-03' } },
							{ count: 22, sum: { visits: 19 }, dimensions: { date: '2026-08-05' } },
						],
						edgeBrowsers: [
							{ count: 20, sum: { visits: 17 }, dimensions: { userAgentBrowser: 'Chrome' } },
							{ count: 18, sum: { visits: 12 }, dimensions: { userAgentBrowser: 'Firefox' } },
						],
						rumDaily: [],
					}],
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	const result = await loadCloudflareSignals({
		CF_ANALYTICS_TOKEN: 'secret',
		CF_ACCOUNT_ID: 'account',
		CF_ZONE_ID: 'zone',
		CF_WEB_ANALYTICS_SITE_TAG: 'site',
		PUBLIC_HOST: 'havc.matijar.info',
	}, '2026-08-03', '2026-08-05', fetchFn);
	assert.equal(result.status, 'ok');
	assert.equal(result.edgeRequests, 38);
	assert.equal(result.edgeVisits, 29);
	assert.equal(result.rumPageLoads, 0);
	assert.equal(requestBody.variables.start, '2026-08-03');
	assert.match(requestBody.query, /userAgentBrowser_notin/);
});

test('Cloudflare GraphQL query declares only valid capitalized variable types', async () => {
	let requestBody;
	const fetchFn = async (_url, options) => {
		requestBody = JSON.parse(options.body);
		return new Response(JSON.stringify({
			data: { viewer: { accounts: [{ edgeDaily: [], edgeBrowsers: [], rumDaily: [] }] } },
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	await loadCloudflareSignals({
		CF_ANALYTICS_TOKEN: 'secret',
		CF_ACCOUNT_ID: 'account',
		CF_ZONE_ID: 'zone',
		CF_WEB_ANALYTICS_SITE_TAG: 'site',
		PUBLIC_HOST: 'havc.matijar.info',
	}, '2026-08-03', '2026-08-05', fetchFn);
	const declarations = [...requestBody.query.matchAll(/\$[A-Za-z]+:\s*([A-Za-z]+)!/g)].map((m) => m[1]);
	assert.ok(declarations.length >= 6, 'expected the query to declare its six variables');
	for (const typeName of declarations) {
		assert.match(typeName, /^[A-Z]/,
			`GraphQL type "${typeName}" is invalid: built-in scalar types are capitalized`);
	}
});

test('owner-control status reports privacy-signal exclusion independently of the toggle', async () => {
	const db = new FakeD1({
		daily: [{ day: '2026-08-05', event: 'session', dim: '', val: '', count: 2 }],
	});
	const html = await renderStats({ DB: db }, '2026-08-05', {
		range: '30',
		archiveStatus: { refreshed: [], pruned: [], syncedAt: Date.parse('2026-08-05T12:00:00Z') },
		nonce: 'test-nonce',
	});
	assert.match(html, /globalPrivacyControl/);
	assert.match(html, /doNotTrack/);
	assert.match(html, /privacy signal/i);
	assert.match(html, /regardless of this toggle/i);
});
