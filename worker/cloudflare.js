/**
 * Durable Cloudflare edge-traffic archive.
 *
 * Cloudflare keeps this adaptive dataset queryable for eight days and permits
 * at most 24 hours per query. We therefore fetch bounded UTC windows, archive
 * hourly aggregates in D1, and convert them to Zagreb days only when rendering.
 */

import { dayInTimeZone } from './time.js';

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOOKBACK_MS = 8 * DAY_MS;
const LOOKBACK_SAFETY_MS = 5 * 60 * 1000;
const STATS_REFRESH_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 26 * HOUR_MS;
const EXCLUDED_BROWSERS = ['Curl', 'YandexBot', 'GoogleBot', 'ChromeHeadless'];

const QUERY = `
query SredstvaEdge($account: String!, $start: Time!, $end: Time!, $zone: String!, $host: String!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      edgeHours: httpRequestsAdaptiveGroups(
        limit: 1000
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          zoneTag: $zone
          clientRequestHTTPHost: $host
          clientRequestPath_in: ["/", "/index.html"]
          clientRequestHTTPMethodName: "GET"
          edgeResponseStatus: 200
          requestSource: "eyeball"
          verifiedBotCategory: ""
          userAgentBrowser_notin: ["Curl", "YandexBot", "GoogleBot", "ChromeHeadless"]
        }
        orderBy: [datetimeHour_ASC]
      ) {
        count
        sum { visits }
        dimensions { datetimeHour }
      }
      edgeBrowserHours: httpRequestsAdaptiveGroups(
        limit: 5000
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          zoneTag: $zone
          clientRequestHTTPHost: $host
          clientRequestPath_in: ["/", "/index.html"]
          clientRequestHTTPMethodName: "GET"
          edgeResponseStatus: 200
          requestSource: "eyeball"
          verifiedBotCategory: ""
          userAgentBrowser_notin: ["Curl", "YandexBot", "GoogleBot", "ChromeHeadless"]
        }
        orderBy: [datetimeHour_ASC]
      ) {
        count
        sum { visits }
        dimensions { datetimeHour userAgentBrowser }
      }
    }
  }
}`;

function count(value) {
	return Math.max(0, Math.round(Number(value) || 0));
}

function utcDayStart(value) {
	const date = new Date(value);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcHourFloor(value) {
	return Math.floor(Number(value) / HOUR_MS) * HOUR_MS;
}

function utcHourCeil(value) {
	const numeric = Number(value);
	const floor = utcHourFloor(numeric);
	return floor === numeric ? floor : floor + HOUR_MS;
}

function hourIso(value) {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return null;
	return new Date(utcHourFloor(parsed)).toISOString();
}

function safeError(error) {
	return String(error?.message || error || 'unknown error').slice(0, 240);
}

export function splitUtcWindows(start, end, maximumMs = DAY_MS) {
	const from = Number(start);
	const to = Number(end);
	if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
	if (!Number.isFinite(maximumMs) || maximumMs <= 0 || maximumMs > DAY_MS) {
		throw new Error('Cloudflare query windows must be between zero and 24 hours');
	}
	const windows = [];
	for (let cursor = from; cursor < to;) {
		const next = Math.min(cursor + maximumMs, to);
		windows.push({ start: cursor, end: next });
		cursor = next;
	}
	return windows;
}

export async function queryEdgeWindow(env, start, end, fetchFn = fetch) {
	if (!env.CF_ANALYTICS_TOKEN) throw new Error('CF_ANALYTICS_TOKEN is not configured');
	if (end <= start || end - start > DAY_MS) {
		throw new Error('Cloudflare edge query must cover no more than 24 hours');
	}
	const response = await fetchFn(ENDPOINT, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			query: QUERY,
			variables: {
				account: env.CF_ACCOUNT_ID,
				zone: env.CF_ZONE_ID,
				host: env.PUBLIC_HOST,
				start: new Date(start).toISOString(),
				end: new Date(end).toISOString(),
			},
		}),
	});
	if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
	const payload = await response.json();
	if (payload.errors?.length) {
		throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join('; ') || 'GraphQL error');
	}
	const account = payload.data?.viewer?.accounts?.[0];
	if (!account) throw new Error('Cloudflare account data unavailable');

	const hourly = new Map();
	for (const row of account.edgeHours || []) {
		const hour = hourIso(row.dimensions?.datetimeHour);
		if (!hour) continue;
		const current = hourly.get(hour) || { hour, requests: 0, visits: 0 };
		current.requests += count(row.count);
		current.visits += count(row.sum?.visits);
		hourly.set(hour, current);
	}

	const browserHourly = new Map();
	for (const row of account.edgeBrowserHours || []) {
		const hour = hourIso(row.dimensions?.datetimeHour);
		if (!hour) continue;
		const browser = String(row.dimensions?.userAgentBrowser || 'Unknown').slice(0, 80) || 'Unknown';
		const key = JSON.stringify([hour, browser]);
		const current = browserHourly.get(key) || {
			hour,
			browser,
			requests: 0,
			visits: 0,
		};
		current.requests += count(row.count);
		current.visits += count(row.sum?.visits);
		browserHourly.set(key, current);
	}

	return {
		hourly: [...hourly.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
		browserHourly: [...browserHourly.values()]
			.sort((a, b) => a.hour.localeCompare(b.hour) || a.browser.localeCompare(b.browser)),
	};
}

function valuesSql(columns, rows) {
	return rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
}

function chunks(rows, size) {
	const result = [];
	for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
	return result;
}

export async function replaceEdgeWindow(env, window, data, syncedAt) {
	const replaceStart = new Date(utcHourFloor(window.start)).toISOString();
	const replaceEnd = new Date(utcHourCeil(window.end)).toISOString();
	const statements = [
		env.DB.prepare('DELETE FROM edge_hourly WHERE hour_utc >= ? AND hour_utc < ?')
			.bind(replaceStart, replaceEnd),
		env.DB.prepare('DELETE FROM edge_browser_hourly WHERE hour_utc >= ? AND hour_utc < ?')
			.bind(replaceStart, replaceEnd),
	];

	for (const group of chunks(data.hourly || [], 20)) {
		const columns = ['hour_utc', 'request_count', 'visit_count', 'synced_at'];
		statements.push(env.DB.prepare(
			`INSERT INTO edge_hourly (${columns.join(', ')}) VALUES ${valuesSql(columns, group)}
			ON CONFLICT (hour_utc) DO UPDATE SET
				request_count = excluded.request_count,
				visit_count = excluded.visit_count,
				synced_at = excluded.synced_at`,
		).bind(...group.flatMap((row) => [
			row.hour,
			count(row.requests),
			count(row.visits),
			syncedAt,
		])));
	}

	for (const group of chunks(data.browserHourly || [], 16)) {
		const columns = ['hour_utc', 'browser', 'request_count', 'visit_count', 'synced_at'];
		statements.push(env.DB.prepare(
			`INSERT INTO edge_browser_hourly (${columns.join(', ')}) VALUES ${valuesSql(columns, group)}
			ON CONFLICT (hour_utc, browser) DO UPDATE SET
				request_count = excluded.request_count,
				visit_count = excluded.visit_count,
				synced_at = excluded.synced_at`,
		).bind(...group.flatMap((row) => [
			row.hour,
			row.browser,
			count(row.requests),
			count(row.visits),
			syncedAt,
		])));
	}

	await env.DB.batch(statements);
}

async function readEdgeState(env) {
	const result = await env.DB.prepare('SELECT k, v FROM edge_sync_state').all();
	return new Map((result.results || []).map((row) => [String(row.k), String(row.v)]));
}

async function writeEdgeState(env, entries, { clearError = false } = {}) {
	const statements = [];
	for (const [key, value] of Object.entries(entries)) {
		statements.push(env.DB.prepare(
			'INSERT INTO edge_sync_state (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v',
		).bind(key, String(value)));
	}
	if (clearError) {
		statements.push(env.DB.prepare("DELETE FROM edge_sync_state WHERE k IN ('last_error', 'last_error_at_ms')"));
	}
	if (statements.length) await env.DB.batch(statements);
}

function syncStart(state, now, reason) {
	const retentionStart = now - LOOKBACK_MS + LOOKBACK_SAFETY_MS;
	const archiveStart = state.get('archive_start_utc');
	const lastSuccess = Number(state.get('last_success_ms')) || 0;
	// The oldest retained boundary usually falls mid-hour. Rounding forward
	// loses at most one partial hour but keeps adjacent 24-hour replacements
	// disjoint, so neither window can overwrite half of the other's hour.
	if (!archiveStart || !lastSuccess) return utcHourCeil(retentionStart);

	const todayStart = utcDayStart(now);
	if (reason === 'stats' && lastSuccess >= todayStart) return todayStart;

	const latestTwoDays = utcDayStart(now - DAY_MS);
	const recoveryStart = utcDayStart(lastSuccess - DAY_MS);
	return Math.max(retentionStart, Math.min(latestTwoDays, recoveryStart));
}

export async function syncEdgeArchive(env, {
	now = Date.now(),
	reason = 'scheduled',
	fetchFn = fetch,
} = {}) {
	if (!env.CF_ANALYTICS_TOKEN) return { status: 'not-configured', windows: 0 };

	let state;
	try {
		state = await readEdgeState(env);
	} catch (error) {
		console.error('Cloudflare edge state read failed:', error);
		return { status: 'error', phase: 'storage', windows: 0, error: safeError(error) };
	}

	const lastSuccess = Number(state.get('last_success_ms')) || 0;
	if (reason === 'stats' && lastSuccess && now - lastSuccess < STATS_REFRESH_MS) {
		return { status: 'current', skipped: true, windows: 0, syncedAt: lastSuccess };
	}

	const start = syncStart(state, now, reason);
	const windows = splitUtcWindows(start, now);
	try {
		await writeEdgeState(env, {
			last_attempt_ms: now,
			last_attempt_reason: reason,
		});

		for (const window of windows) {
			const data = await queryEdgeWindow(env, window.start, window.end, fetchFn);
			await replaceEdgeWindow(env, window, data, now);
		}

		const previousStart = state.get('archive_start_utc');
		const archiveStart = previousStart && Date.parse(previousStart) < start
			? previousStart
			: new Date(start).toISOString();
		await writeEdgeState(env, {
			archive_start_utc: archiveStart,
			last_success_ms: now,
			last_success_reason: reason,
		}, { clearError: true });
		return {
			status: 'ok',
			windows: windows.length,
			syncedAt: now,
			archiveStart,
			backfilled: !state.get('archive_start_utc'),
		};
	} catch (error) {
		const message = safeError(error);
		console.error('Cloudflare edge archive sync failed:', error);
		try {
			await writeEdgeState(env, {
				last_error: message,
				last_error_at_ms: now,
			});
		} catch (stateError) {
			console.error('Cloudflare edge failure state write failed:', stateError);
		}
		return { status: 'error', phase: 'sync', windows: windows.length, error: message };
	}
}

export function aggregateEdgeRows(hourlyRows, browserRows, {
	startDay = null,
	endDay = null,
} = {}) {
	const inRange = (day) =>
		(!startDay || day >= startDay) && (!endDay || day <= endDay);
	const daily = new Map();
	for (const row of hourlyRows || []) {
		const parsed = Date.parse(row.hour_utc);
		if (!Number.isFinite(parsed)) continue;
		const day = dayInTimeZone(parsed);
		if (!inRange(day)) continue;
		const current = daily.get(day) || { day, requests: 0, visits: 0 };
		current.requests += count(row.request_count);
		current.visits += count(row.visit_count);
		daily.set(day, current);
	}

	const browsers = new Map();
	for (const row of browserRows || []) {
		const parsed = Date.parse(row.hour_utc);
		if (!Number.isFinite(parsed)) continue;
		const day = dayInTimeZone(parsed);
		if (!inRange(day)) continue;
		const name = String(row.browser || 'Unknown');
		const current = browsers.get(name) || { name, requests: 0, visits: 0 };
		current.requests += count(row.request_count);
		current.visits += count(row.visit_count);
		browsers.set(name, current);
	}

	const edgeDaily = [...daily.values()].sort((a, b) => a.day.localeCompare(b.day));
	const browserTotals = [...browsers.values()]
		.sort((a, b) => b.visits - a.visits || b.requests - a.requests || a.name.localeCompare(b.name));
	return {
		edgeDaily,
		browsers: browserTotals,
		edgeRequests: edgeDaily.reduce((total, row) => total + row.requests, 0),
		edgeVisits: edgeDaily.reduce((total, row) => total + row.visits, 0),
	};
}

export async function loadEdgeArchive(env, { now = Date.now() } = {}) {
	try {
		const [{ results: hourly }, { results: browserHourly }, state] = await Promise.all([
			env.DB.prepare(
				'SELECT hour_utc, request_count, visit_count FROM edge_hourly ORDER BY hour_utc',
			).all(),
			env.DB.prepare(
				'SELECT hour_utc, browser, request_count, visit_count FROM edge_browser_hourly ORDER BY hour_utc, browser',
			).all(),
			readEdgeState(env),
		]);
		const rows = hourly || [];
		const lastSyncAt = Number(state.get('last_success_ms')) || null;
		return {
			status: rows.length ? 'ok' : env.CF_ANALYTICS_TOKEN ? 'empty' : 'not-configured',
			tokenConfigured: Boolean(env.CF_ANALYTICS_TOKEN),
			hourly: rows,
			browserHourly: browserHourly || [],
			archiveStart: state.get('archive_start_utc') || rows[0]?.hour_utc || null,
			lastSyncAt,
			lastAttemptAt: Number(state.get('last_attempt_ms')) || null,
			lastError: state.get('last_error') || '',
			lastErrorAt: Number(state.get('last_error_at_ms')) || null,
			stale: !lastSyncAt || now - lastSyncAt > STALE_AFTER_MS,
			excludedBrowsers: EXCLUDED_BROWSERS,
		};
	} catch (error) {
		const message = safeError(error);
		if (!/no such table/i.test(message)) console.error('Cloudflare edge archive read failed:', error);
		return {
			status: /no such table/i.test(message) ? 'schema-missing' : 'error',
			tokenConfigured: Boolean(env.CF_ANALYTICS_TOKEN),
			hourly: [],
			browserHourly: [],
			archiveStart: null,
			lastSyncAt: null,
			lastAttemptAt: null,
			lastError: message,
			lastErrorAt: null,
			stale: true,
			excludedBrowsers: EXCLUDED_BROWSERS,
		};
	}
}

export function edgeSnapshotForRange(archive, startDay, endDay) {
	return {
		...archive,
		...aggregateEdgeRows(archive.hourly, archive.browserHourly, { startDay, endDay }),
	};
}
