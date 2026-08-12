import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	aggregateEdgeRows,
	queryEdgeWindow,
	splitUtcWindows,
	syncEdgeArchive,
} from '../worker/cloudflare.js';

function cloneState(state) {
	return {
		hourly: new Map([...state.hourly].map(([key, value]) => [key, { ...value }])),
		browsers: new Map([...state.browsers].map(([key, value]) => [key, { ...value }])),
		sync: new Map(state.sync),
	};
}

class EdgeStatement {
	constructor(db, sql, params = []) {
		this.db = db;
		this.sql = sql.replace(/\s+/g, ' ').trim();
		this.params = params;
	}

	bind(...params) {
		return new EdgeStatement(this.db, this.sql, params);
	}

	all() {
		return Promise.resolve({ results: this.db.query(this.sql) });
	}

	run() {
		this.db.mutate(this.db.state, this.sql, this.params);
		return Promise.resolve({ success: true });
	}
}

class EdgeD1 {
	constructor() {
		this.state = {
			hourly: new Map(),
			browsers: new Map(),
			sync: new Map(),
		};
		this.failNextBatch = false;
	}

	prepare(sql) {
		return new EdgeStatement(this, sql);
	}

	query(sql) {
		if (sql === 'SELECT k, v FROM edge_sync_state') {
			return [...this.state.sync].map(([k, v]) => ({ k, v }));
		}
		if (sql.startsWith('SELECT hour_utc, request_count, visit_count FROM edge_hourly')) {
			return [...this.state.hourly.values()].sort((a, b) => a.hour_utc.localeCompare(b.hour_utc));
		}
		if (sql.startsWith('SELECT hour_utc, browser, request_count, visit_count FROM edge_browser_hourly')) {
			return [...this.state.browsers.values()]
				.sort((a, b) => a.hour_utc.localeCompare(b.hour_utc) || a.browser.localeCompare(b.browser));
		}
		throw new Error(`Unsupported edge query: ${sql}`);
	}

	mutate(state, sql, params) {
		if (sql.startsWith('DELETE FROM edge_hourly WHERE')) {
			const [start, end] = params;
			for (const key of state.hourly.keys()) {
				if (key >= start && key < end) state.hourly.delete(key);
			}
			return;
		}
		if (sql.startsWith('DELETE FROM edge_browser_hourly WHERE')) {
			const [start, end] = params;
			for (const [key, row] of state.browsers) {
				if (row.hour_utc >= start && row.hour_utc < end) state.browsers.delete(key);
			}
			return;
		}
		if (sql.startsWith('INSERT INTO edge_hourly')) {
			for (let index = 0; index < params.length; index += 4) {
				const [hour_utc, request_count, visit_count, synced_at] = params.slice(index, index + 4);
				state.hourly.set(hour_utc, { hour_utc, request_count, visit_count, synced_at });
			}
			return;
		}
		if (sql.startsWith('INSERT INTO edge_browser_hourly')) {
			for (let index = 0; index < params.length; index += 5) {
				const [hour_utc, browser, request_count, visit_count, synced_at] = params.slice(index, index + 5);
				state.browsers.set(JSON.stringify([hour_utc, browser]), {
					hour_utc,
					browser,
					request_count,
					visit_count,
					synced_at,
				});
			}
			return;
		}
		if (sql.startsWith('INSERT INTO edge_sync_state')) {
			state.sync.set(String(params[0]), String(params[1]));
			return;
		}
		if (sql.startsWith('DELETE FROM edge_sync_state WHERE')) {
			state.sync.delete('last_error');
			state.sync.delete('last_error_at_ms');
			return;
		}
		throw new Error(`Unsupported edge mutation: ${sql}`);
	}

	async batch(statements) {
		if (this.failNextBatch) {
			this.failNextBatch = false;
			throw new Error('simulated edge batch failure');
		}
		const next = cloneState(this.state);
		for (const statement of statements) this.mutate(next, statement.sql, statement.params);
		this.state = next;
		return statements.map(() => ({ success: true }));
	}
}

test('Cloudflare windows never exceed the live 24-hour limit', () => {
	const start = Date.parse('2026-08-04T12:35:00Z');
	const end = Date.parse('2026-08-12T12:30:00Z');
	const windows = splitUtcWindows(start, end);
	assert.equal(windows.length, 8);
	assert.equal(windows[0].start, start);
	assert.equal(windows.at(-1).end, end);
	for (const window of windows) {
		assert.ok(window.end - window.start <= 24 * 60 * 60 * 1000);
		assert.ok(window.end > window.start);
	}
});

test('hour query uses Time variables, excludes the removed RUM feed, and normalizes groups', async () => {
	let body;
	const fetchFn = async (_url, options) => {
		body = JSON.parse(options.body);
		return new Response(JSON.stringify({
			data: {
				viewer: {
					accounts: [{
						edgeHours: [
							{ count: 3, sum: { visits: 2 }, dimensions: { datetimeHour: '2026-08-12T10:00:00Z' } },
							{ count: 4, sum: { visits: 3 }, dimensions: { datetimeHour: '2026-08-12T10:00:00Z' } },
						],
						edgeBrowserHours: [
							{ count: 7, sum: { visits: 5 }, dimensions: { datetimeHour: '2026-08-12T10:00:00Z', userAgentBrowser: 'Chrome' } },
						],
					}],
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	const result = await queryEdgeWindow({
		CF_ANALYTICS_TOKEN: 'secret',
		CF_ACCOUNT_ID: 'account',
		CF_ZONE_ID: 'zone',
		PUBLIC_HOST: 'havc.matijar.info',
	}, Date.parse('2026-08-12T10:00:00Z'), Date.parse('2026-08-12T11:00:00Z'), fetchFn);

	assert.deepEqual(result.hourly, [{
		hour: '2026-08-12T10:00:00.000Z',
		requests: 7,
		visits: 5,
	}]);
	assert.equal(result.browserHourly[0].browser, 'Chrome');
	assert.match(body.query, /\$start: Time!/);
	assert.match(body.query, /datetimeHour/);
	assert.doesNotMatch(body.query, /rumPageload|siteTag/i);
	assert.doesNotMatch(JSON.stringify(body.variables), /site/i);
});

test('edge synchronization backfills, upserts idempotently, throttles stats, and preserves success state on failure', async () => {
	const db = new EdgeD1();
	const env = {
		DB: db,
		CF_ANALYTICS_TOKEN: 'secret',
		CF_ACCOUNT_ID: 'account',
		CF_ZONE_ID: 'zone',
		PUBLIC_HOST: 'havc.matijar.info',
	};
	let calls = 0;
	const successfulFetch = async (_url, options) => {
		calls++;
		const body = JSON.parse(options.body);
		const hour = new Date(Math.floor(Date.parse(body.variables.start) / 3600000) * 3600000)
			.toISOString().replace('.000Z', 'Z');
		return new Response(JSON.stringify({
			data: {
				viewer: {
					accounts: [{
						edgeHours: [{ count: 6, sum: { visits: 4 }, dimensions: { datetimeHour: hour } }],
						edgeBrowserHours: [{
							count: 6,
							sum: { visits: 4 },
							dimensions: { datetimeHour: hour, userAgentBrowser: 'Chrome' },
						}],
					}],
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	const now = Date.parse('2026-08-12T12:30:00Z');
	const initial = await syncEdgeArchive(env, { now, reason: 'scheduled', fetchFn: successfulFetch });
	assert.equal(initial.status, 'ok');
	assert.equal(initial.backfilled, true);
	assert.equal(initial.windows, 8);
	assert.match(initial.archiveStart, /T\d{2}:00:00\.000Z$/);
	assert.equal(db.state.hourly.size, 8);
	assert.equal(db.state.sync.get('last_success_ms'), String(now));

	const second = await syncEdgeArchive(env, { now, reason: 'scheduled', fetchFn: successfulFetch });
	const afterSecond = cloneState(db.state);
	const third = await syncEdgeArchive(env, { now, reason: 'scheduled', fetchFn: successfulFetch });
	assert.equal(second.status, 'ok');
	assert.equal(third.status, 'ok');
	assert.deepEqual(db.state.hourly, afterSecond.hourly);
	assert.deepEqual(db.state.browsers, afterSecond.browsers);

	const callsBeforeThrottle = calls;
	const throttled = await syncEdgeArchive(env, {
		now: now + 5 * 60 * 1000,
		reason: 'stats',
		fetchFn: successfulFetch,
	});
	assert.equal(throttled.status, 'current');
	assert.equal(calls, callsBeforeThrottle);

	const previousSuccess = db.state.sync.get('last_success_ms');
	const previousRows = cloneState(db.state);
	const failed = await syncEdgeArchive(env, {
		now: now + 24 * 60 * 60 * 1000,
		reason: 'scheduled',
		fetchFn: async () => new Response('upstream failure', { status: 503 }),
	});
	assert.equal(failed.status, 'error');
	assert.equal(db.state.sync.get('last_success_ms'), previousSuccess);
	assert.deepEqual(db.state.hourly, previousRows.hourly);
	assert.match(db.state.sync.get('last_error'), /GraphQL HTTP 503/);
});

test('hourly edge rows aggregate into Zagreb days across DST boundaries', () => {
	const result = aggregateEdgeRows([
		{ hour_utc: '2026-03-28T22:00:00.000Z', request_count: 2, visit_count: 1 },
		{ hour_utc: '2026-03-28T23:00:00.000Z', request_count: 3, visit_count: 2 },
		{ hour_utc: '2026-03-29T01:00:00.000Z', request_count: 5, visit_count: 4 },
		{ hour_utc: '2026-10-25T00:00:00.000Z', request_count: 7, visit_count: 6 },
		{ hour_utc: '2026-10-25T01:00:00.000Z', request_count: 11, visit_count: 8 },
	], []);
	const byDay = new Map(result.edgeDaily.map((row) => [row.day, row]));
	assert.deepEqual(byDay.get('2026-03-28'), { day: '2026-03-28', requests: 2, visits: 1 });
	assert.deepEqual(byDay.get('2026-03-29'), { day: '2026-03-29', requests: 8, visits: 6 });
	assert.deepEqual(byDay.get('2026-10-25'), { day: '2026-10-25', requests: 18, visits: 14 });
});

test('public HTML no longer loads Cloudflare Web Analytics', () => {
	const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
	assert.doesNotMatch(html, /static\.cloudflareinsights\.com|data-cf-beacon/i);
	assert.doesNotMatch(config, /CF_WEB_ANALYTICS_SITE_TAG/);
});
