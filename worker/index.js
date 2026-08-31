/**
 * Sredstva Worker entry point.
 *
 * Static assets are served before this Worker. The script handles only the
 * first-party usage beacon, the private owner dashboard, and asset fallthrough.
 */

import { aggregate, decodeAggregateKey } from './aggregate.js';
import { syncEdgeArchive } from './cloudflare.js';
import { addDays, dayInTimeZone } from './time.js';
import { renderStats } from './render.js';

const DEFAULT_HOST = 'havc.matijar.info';
const DEFAULT_ACCESS_ISSUER = 'https://kompmajstor.cloudflareaccess.com';
const DEFAULT_ACCESS_AUD = '1bc8c9b9d46cf2f5a27e8863d823f1094801d2b6144c15900a5352b0ce3e98f3';
const ARCHIVE_VERSION = 'v2';
const RAW_RETENTION_DAYS = 30;
const MAX_BODY_BYTES = 8192;
const MAX_EVENTS_PER_FLUSH = 40;
const NO_CONTENT = { status: 204 };

const EVENT_NAMES = new Set([
	'page_view',
	'session_start',
	'data_loaded',
	'app_ready',
	'load_error',
	'view',
	'project_open',
	'studio_open',
	'studio_chapter',
	'filter',
	'pdf_open',
	'share_created',
	'web_vital',
	'session_end',
]);

const FILTER_FIELDS = new Set([
	'program',
	'cat',
	'rok',
	'producer',
	'director',
	'writer',
	'recipient',
	'years',
	'amount',
	'project',
	'q',
]);

const STUDIO_CHAPTERS = new Set([
	'overview',
	'time',
	'distribution',
	'mix',
	'concentration',
	'lifecycles',
	'methodology',
]);

const PROJECT_SOURCES = new Set(['decision-row', 'project-row', 'timeline', 'shared-link']);
const VIEW_NAMES = new Set(['dashboard', 'about', 'process']);
const LOAD_ERROR_STAGES = new Set(['registry', 'about', 'process', 'analytics']);
const VITAL_NAMES = new Set(['ttfb', 'fcp', 'lcp', 'inp', 'cls']);
const UA_BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|phantomjs|selenium|puppeteer|playwright|python-requests|curl|wget|httpclient|monitor|uptime|scan/i;
const PROJECT_RE = /^[a-z0-9][a-z0-9 _-]{0,79}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

const accessKeyCache = new Map();

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const expectedHost = env.PUBLIC_HOST || DEFAULT_HOST;
		if (!isAllowedHost(url.hostname, expectedHost)) {
			return new Response('Not found', { status: 404 });
		}

		if (url.pathname === '/api/u') return ingest(request, env, ctx, url);
		if (url.pathname === '/stats' || url.pathname === '/stats/') return stats(request, env, url);
		if (url.pathname === '/prijava' || url.pathname.startsWith('/prijava/')) {
			return prijava(request, env, url);
		}
		return env.ASSETS.fetch(request);
	},
	async scheduled(controller, env, ctx) {
		const now = Number(controller?.scheduledTime) || Date.now();
		const today = dayInTimeZone(now);
		ctx.waitUntil(runScheduledMaintenance(env, today, now));
	},
};

export function isAllowedHost(hostname, expectedHost = DEFAULT_HOST) {
	return hostname === expectedHost || hostname === 'localhost' || hostname === '127.0.0.1';
}

function localDevelopment(url) {
	return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/* Private application dossier ----------------------------------------- */

export async function prijava(request, env, url = new URL(request.url)) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
	}

	if (!localDevelopment(url)) {
		const token = request.headers.get('cf-access-jwt-assertion');
		const claims = await verifyAccessJwt(token, {
			issuer: env.ACCESS_ISSUER || DEFAULT_ACCESS_ISSUER,
			audience: env.ACCESS_AUD || DEFAULT_ACCESS_AUD,
		});
		if (!claims) return new Response('Forbidden', { status: 403 });
	}

	const assetUrl = new URL(request.url);
	if (assetUrl.pathname === '/prijava' || assetUrl.pathname === '/prijava/') {
		assetUrl.pathname = '/prijava/index.html';
	}
	const assetRequest = assetUrl.toString() === request.url
		? request
		: new Request(assetUrl, request);
	const response = await env.ASSETS.fetch(assetRequest);
	const headers = new Headers(response.headers);
	headers.set('cache-control', 'private, no-store, max-age=0');
	headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
	headers.set('referrer-policy', 'no-referrer');
	headers.set('x-content-type-options', 'nosniff');
	headers.set('x-frame-options', 'DENY');
	headers.set('cross-origin-opener-policy', 'same-origin');
	return new Response(request.method === 'HEAD' ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/* Public ingest ---------------------------------------------------------- */

export async function ingest(request, env, ctx, url = new URL(request.url)) {
	if (request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { Allow: 'POST' } });
	}
	if (!sameOrigin(request, url)) return new Response(null, NO_CONTENT);

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.toLowerCase().startsWith('application/json')) {
		return new Response(null, NO_CONTENT);
	}
	const lengthHeader = request.headers.get('content-length');
	if (lengthHeader !== null) {
		const declaredLength = Number(lengthHeader);
		if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > MAX_BODY_BYTES) {
			return new Response(null, NO_CONTENT);
		}
	}

	const userAgent = request.headers.get('user-agent') || '';
	if (UA_BOT_RE.test(userAgent)) return new Response(null, NO_CONTENT);

	try {
		const ip = request.headers.get('cf-connecting-ip') || 'anon';
		const result = await env.RL_HIT.limit({ key: ip });
		if (!result.success) return new Response(null, NO_CONTENT);
	} catch (_) {
		// Local development and a transient limiter outage fail open. The body
		// still passes strict shape and cardinality validation below.
	}

	let raw;
	try {
		raw = await request.text();
	} catch (_) {
		return new Response(null, NO_CONTENT);
	}
	if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
		return new Response(null, NO_CONTENT);
	}

	let body;
	try {
		body = JSON.parse(raw);
	} catch (_) {
		return new Response(null, NO_CONTENT);
	}

	const session = typeof body?.s === 'string' ? body.s : '';
	if (!SESSION_RE.test(session)) return new Response(null, NO_CONTENT);

	let referrer = typeof body?.ref === 'string' ? body.ref.slice(0, 100).toLowerCase() : '';
	if (!/^[a-z0-9][a-z0-9.-]*$/.test(referrer)) referrer = '';

	const incoming = Array.isArray(body?.e) ? body.e.slice(0, MAX_EVENTS_PER_FLUSH) : [];
	const events = incoming.map(cleanEvent).filter(Boolean);
	if (!events.length) return new Response(null, NO_CONTENT);

	const now = Date.now();
	const row = {
		ts: now,
		day: dayInTimeZone(now),
		session,
		country: /^[A-Z]{2}$/.test(request.cf?.country || '') ? request.cf.country : '',
		device: deviceClass(userAgent),
		referrer,
		payload: JSON.stringify(events),
	};

	try {
		await env.DB.prepare(
			'INSERT INTO usage_events (ts, day, session, country, device, ref_host, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
		)
			.bind(row.ts, row.day, row.session, row.country, row.device, row.referrer, row.payload)
			.run();
		return new Response(null, NO_CONTENT);
	} catch (error) {
		console.error('usage insert failed:', error);
		return new Response(null, { status: 503, headers: { 'retry-after': '2' } });
	}
}

export function cleanEvent(event) {
	if (!event || typeof event.n !== 'string' || !EVENT_NAMES.has(event.n)) return null;
	const name = event.n;
	const rawDetail = typeof event.d === 'string' ? event.d.slice(0, 80) : '';
	const rawProject = typeof event.p === 'string' ? event.p.slice(0, 80) : '';
	let detail = '';
	let project = '';

	switch (name) {
		case 'page_view':
			if (rawDetail && rawDetail !== 'app') return null;
			detail = 'app';
			break;
		case 'session_start':
			if (!/^(hr|en)\|(light|dark|auto)$/.test(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'view':
			if (!VIEW_NAMES.has(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'studio_chapter':
			if (!STUDIO_CHAPTERS.has(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'filter':
			if (!FILTER_FIELDS.has(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'project_open':
			if (!PROJECT_SOURCES.has(rawDetail) || !PROJECT_RE.test(rawProject)) return null;
			detail = rawDetail;
			project = rawProject;
			break;
		case 'load_error':
			if (!LOAD_ERROR_STAGES.has(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'share_created':
			if (rawDetail && !VIEW_NAMES.has(rawDetail)) return null;
			detail = rawDetail || 'dashboard';
			break;
		case 'web_vital':
			if (!VITAL_NAMES.has(rawDetail)) return null;
			detail = rawDetail;
			break;
		case 'session_end':
			if (rawDetail && !/^\d{1,9}\|\d{1,9}\|\d{1,3}$/.test(rawDetail)) return null;
			detail = rawDetail;
			break;
		default:
			if (rawDetail || rawProject) return null;
	}

	let value;
	if (Number.isFinite(event.v)) {
		value = Math.round(event.v);
		const max = name === 'session_end' ? 7 * 24 * 60 * 60 * 1000
			: name === 'web_vital' ? 600000
				: 60 * 60 * 1000;
		if (value < 0 || value > max) return null;
	}
	if ((name === 'data_loaded' || name === 'app_ready' || name === 'web_vital' || name === 'session_end')
		&& !Number.isFinite(value)) return null;

	const elapsed = Number.isFinite(event.t)
		? Math.max(0, Math.min(Math.round(event.t), 7 * 24 * 60 * 60 * 1000))
		: undefined;
	return {
		n: name,
		...(detail ? { d: detail } : {}),
		...(project ? { p: project } : {}),
		...(Number.isFinite(value) ? { v: value } : {}),
		...(Number.isFinite(elapsed) ? { t: elapsed } : {}),
	};
}

export function sameOrigin(request, url) {
	const origin = request.headers.get('origin');
	if (origin) {
		try {
			return new URL(origin).origin === url.origin;
		} catch (_) {
			return false;
		}
	}
	return request.headers.get('sec-fetch-site') === 'same-origin';
}

function deviceClass(userAgent) {
	if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
	if (/Mobi|iPhone|Android/i.test(userAgent)) return 'mobile';
	return 'desktop';
}

/* Access verification --------------------------------------------------- */

function decodeBase64Url(value) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtJson(segment) {
	return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

async function accessKey(issuer, kid, fetchFn) {
	const cacheKey = `${issuer}|${kid}`;
	const cached = accessKeyCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) return cached.key;

	const response = await fetchFn(`${issuer}/cdn-cgi/access/certs`, {
		headers: { accept: 'application/json' },
		cf: { cacheEverything: true, cacheTtl: 3600 },
	});
	if (!response.ok) throw new Error(`Access cert fetch failed: ${response.status}`);
	const payload = await response.json();
	const jwk = Array.isArray(payload?.keys) ? payload.keys.find((key) => key.kid === kid) : null;
	if (!jwk) throw new Error('Access signing key not found');
	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	accessKeyCache.set(cacheKey, { key, expires: Date.now() + 60 * 60 * 1000 });
	return key;
}

export async function verifyAccessJwt(token, {
	issuer = DEFAULT_ACCESS_ISSUER,
	audience = DEFAULT_ACCESS_AUD,
	now = Date.now(),
	fetchFn = fetch,
} = {}) {
	try {
		if (typeof token !== 'string' || token.length > 8192) return null;
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const header = decodeJwtJson(parts[0]);
		const claims = decodeJwtJson(parts[1]);
		if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
		if (claims.iss !== issuer) return null;
		const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!audiences.includes(audience)) return null;

		const nowSeconds = Math.floor(now / 1000);
		const skew = 60;
		if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds - skew) return null;
		if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + skew) return null;
		if (Number.isFinite(claims.iat) && claims.iat > nowSeconds + skew) return null;

		const key = await accessKey(issuer, header.kid, fetchFn);
		const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const valid = await crypto.subtle.verify(
			{ name: 'RSASSA-PKCS1-v1_5' },
			key,
			decodeBase64Url(parts[2]),
			signed,
		);
		return valid ? claims : null;
	} catch (_) {
		return null;
	}
}

/* Owner-triggered archive ---------------------------------------------- */

export async function syncArchive(env, today) {
	const cutoff = addDays(today, -(RAW_RETENTION_DAYS - 1));
	const [rawSummaryResult, archivedResult, markerResult] = await Promise.all([
		env.DB.prepare(
			'SELECT day, COUNT(*) AS row_count, MAX(id) AS max_id FROM usage_events WHERE day < ? GROUP BY day ORDER BY day',
		).bind(today).all(),
		env.DB.prepare(
			"SELECT DISTINCT day FROM usage_daily WHERE event = 'session' AND dim = '' AND day < ?",
		).bind(today).all(),
		env.DB.prepare("SELECT k, v FROM usage_meta WHERE k LIKE 'archive:v2:%'").all(),
	]);

	const archivedDays = new Set((archivedResult.results || []).map((row) => row.day));
	const markers = new Map((markerResult.results || []).map((row) => [row.k, row.v]));
	const refreshed = [];
	const pruned = [];

	for (const summary of rawSummaryResult.results || []) {
		const day = String(summary.day);
		const markerKey = `archive:${ARCHIVE_VERSION}:${day}`;
		const fingerprint = `${Number(summary.row_count) || 0}:${Number(summary.max_id) || 0}`;
		const needsRefresh = markers.get(markerKey) !== fingerprint || !archivedDays.has(day);

		if (needsRefresh) {
			const raw = await env.DB.prepare('SELECT * FROM usage_events WHERE day = ? ORDER BY id')
				.bind(day)
				.all();
			const entries = [...aggregate(raw.results || []).entries()];
			const statements = [env.DB.prepare('DELETE FROM usage_daily WHERE day = ?').bind(day)];
			for (let index = 0; index < entries.length; index += 20) {
				const chunk = entries.slice(index, index + 20);
				statements.push(
					env.DB.prepare(
						'INSERT INTO usage_daily (day, event, dim, val, count) VALUES '
						+ chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
						+ ' ON CONFLICT (day, event, dim, val) DO UPDATE SET count = excluded.count',
					).bind(...chunk.flatMap(([key, count]) => [...decodeAggregateKey(key), count])),
				);
			}
			statements.push(
				env.DB.prepare(
					'INSERT INTO usage_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v',
				).bind(markerKey, fingerprint),
			);
			if (day < cutoff) {
				statements.push(env.DB.prepare('DELETE FROM usage_events WHERE day = ?').bind(day));
				pruned.push(day);
			}
			// D1 batch is atomic. A failed replacement leaves both the old
			// archive and raw source rows intact for the next /stats visit.
			await env.DB.batch(statements);
			refreshed.push(day);
		} else if (day < cutoff) {
			await env.DB.prepare('DELETE FROM usage_events WHERE day = ?').bind(day).run();
			pruned.push(day);
		}
	}

	const syncedAt = Date.now();
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO usage_meta (k, v) VALUES ('last_compaction', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
		).bind(String(syncedAt)),
		env.DB.prepare(
			"INSERT INTO usage_meta (k, v) VALUES ('archive_version', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
		).bind(ARCHIVE_VERSION),
	]);
	return { refreshed, pruned, syncedAt, cutoff };
}

export async function runScheduledMaintenance(env, today, now = Date.now()) {
	const results = await Promise.allSettled([
		syncArchive(env, today),
		syncEdgeArchive(env, { now, reason: 'scheduled' }),
	]);
	for (const result of results) {
		if (result.status === 'rejected') console.error('scheduled analytics maintenance failed:', result.reason);
	}
	return results;
}

function maintenanceFailed(results) {
	const firstPartyFailed = results[0]?.status === 'rejected';
	const edgeResult = results[1];
	const edgeFailed = edgeResult?.status === 'rejected'
		|| edgeResult?.value?.status === 'error'
		|| edgeResult?.value?.status === 'not-configured';
	return firstPartyFailed || edgeFailed;
}

export function nextArchiveAlarm(now = Date.now()) {
	const date = new Date(now);
	let next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 2, 15);
	if (next <= now + 60 * 1000) next += 24 * 60 * 60 * 1000;
	return next;
}

export class AnalyticsScheduler {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async fetch() {
		const current = await this.state.storage.getAlarm();
		if (current === null) await this.state.storage.setAlarm(nextArchiveAlarm());
		const alarmAt = await this.state.storage.getAlarm();
		return Response.json({ alarmAt });
	}

	async alarm() {
		const now = Date.now();
		const results = await runScheduledMaintenance(this.env, dayInTimeZone(now), now);
		if (maintenanceFailed(results)) {
			const retries = Math.min(6, (Number(await this.state.storage.get('retry_count')) || 0) + 1);
			const delay = Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * (2 ** (retries - 1)));
			await this.state.storage.put('retry_count', retries);
			await this.state.storage.setAlarm(now + delay);
			return;
		}
		await this.state.storage.delete('retry_count');
		await this.state.storage.setAlarm(nextArchiveAlarm(now));
	}
}

export async function ensureAnalyticsAlarm(env) {
	if (!env.CF_ANALYTICS_TOKEN) return { status: 'not-configured', alarmAt: null };
	if (!env.ANALYTICS_SCHEDULER) return { status: 'unavailable', alarmAt: null };
	const id = env.ANALYTICS_SCHEDULER.idFromName('daily-edge-archive');
	const response = await env.ANALYTICS_SCHEDULER.get(id).fetch('https://scheduler.internal/');
	if (!response.ok) throw new Error(`Analytics scheduler returned ${response.status}`);
	const payload = await response.json();
	return { status: 'scheduled', alarmAt: Number(payload.alarmAt) || null };
}

/* Private stats --------------------------------------------------------- */

async function stats(request, env, url) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
	}

	if (!localDevelopment(url)) {
		const token = request.headers.get('cf-access-jwt-assertion');
		const claims = await verifyAccessJwt(token, {
			issuer: env.ACCESS_ISSUER || DEFAULT_ACCESS_ISSUER,
			audience: env.ACCESS_AUD || DEFAULT_ACCESS_AUD,
		});
		if (!claims) return new Response('Forbidden', { status: 403 });
	}

	const today = dayInTimeZone();
	let archiveStatus;
	try {
		archiveStatus = await syncArchive(env, today);
	} catch (error) {
		console.error('usage archive sync failed:', error);
		archiveStatus = { refreshed: [], pruned: [], syncedAt: null, error: true };
	}
	const edgeStatus = await syncEdgeArchive(env, {
		now: Date.now(),
		reason: 'stats',
	});
	let schedulerStatus;
	try {
		schedulerStatus = await ensureAnalyticsAlarm(env);
	} catch (error) {
		console.error('analytics alarm initialization failed:', error);
		schedulerStatus = { status: 'error', alarmAt: null };
	}

	const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
	const nonce = btoa(String.fromCharCode(...nonceBytes));
	const html = await renderStats(env, today, {
		range: url.searchParams.get('range') || '30',
		archiveStatus,
		edgeStatus,
		schedulerStatus,
		nonce,
	});
	const headers = {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'private, no-store, max-age=0',
		'content-security-policy': [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			"style-src 'unsafe-inline' https://fonts.googleapis.com",
			"font-src https://fonts.gstatic.com",
			"img-src 'self' data:",
			"base-uri 'none'",
			"form-action 'self'",
			"frame-ancestors 'none'",
		].join('; '),
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'cross-origin-opener-policy': 'same-origin',
	};
	return new Response(request.method === 'HEAD' ? null : html, { headers });
}
