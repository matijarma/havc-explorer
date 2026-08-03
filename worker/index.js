/**
 * havc-explorer — Worker entry point.
 *
 * Static assets are matched and served BEFORE this code runs, and asset requests
 * are free and unmetered. This handler therefore only executes for paths that
 * are not files in the repo: the usage beacon (POST /api/u), the private stats
 * page (GET /stats), and 404 passthrough for everything else.
 *
 * There is deliberately no `run_worker_first` in wrangler.jsonc: setting it would
 * route every page load through this Worker and bill each one against the
 * account-wide Workers request budget, which is shared with ~40 other Workers.
 *
 * Privacy contract (mirrored in /extension-privacy/):
 *  - no cookies, nothing written to the visitor's device (the client collector
 *    holds its session id in a JS variable only);
 *  - the visitor's IP is used transiently as a rate-limit key at the edge and
 *    is NEVER stored;
 *  - the raw User-Agent is reduced to 'mobile'|'tablet'|'desktop' and NEVER stored;
 *  - referrer is reduced to its host client-side and re-validated here;
 *  - data lives in this account's D1 and is used solely to improve the app.
 */

import { aggregate } from './aggregate.js';
import { renderStats } from './render.js';

// Only these event names are accepted from the wire. Anything else is dropped.
const EVENT_NAMES = new Set([
	'session_start',
	'data_loaded',
	'view',
	'studio_open',
	'studio_chapter',
	'filter',
	'pdf_open',
	'share_created',
	'session_end',
]);

const UA_BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|phantomjs|selenium|puppeteer|playwright|python-requests|curl|wget|httpclient|monitor|uptime|scan/i;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === '/api/u') return ingest(request, env, ctx, url);
		if (url.pathname === '/stats') return stats(request, env, url);
		return env.ASSETS.fetch(request);
	},
};

/* ─── ingest ──────────────────────────────────────────────────────────── */

// Probing this endpoint yields no signal: every rejected write is the same 204
// as an accepted one. Only the method check is honest (405), so the browser
// console stays quiet about the beacon and curl explorers learn nothing.
const NO_CONTENT = { status: 204 };

async function ingest(request, env, ctx, url) {
	if (request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { Allow: 'POST' } });
	}

	if (!sameOrigin(request, url)) return new Response(null, NO_CONTENT);

	const len = Number(request.headers.get('content-length'));
	if (!Number.isFinite(len) || len <= 0 || len > 4096) return new Response(null, NO_CONTENT);

	const ua = request.headers.get('user-agent') || '';
	if (UA_BOT_RE.test(ua)) return new Response(null, NO_CONTENT);

	// The IP is a transient throttle key at the edge; it is never stored.
	try {
		const ip = request.headers.get('cf-connecting-ip') || 'anon';
		const { success } = await env.RL_HIT.limit({ key: ip });
		if (!success) return new Response(null, NO_CONTENT);
	} catch (_) {
		// Rate limiter unavailable (e.g. local dev without the binding): fail open.
	}

	let body;
	try {
		body = await request.json();
	} catch (_) {
		return new Response(null, NO_CONTENT);
	}

	const session = typeof body?.s === 'string' ? body.s.slice(0, 64) : '';
	if (!session) return new Response(null, NO_CONTENT);

	// Referrer host arrives pre-reduced by the client; re-validate it as a bare
	// hostname so a full URL (or garbage) can never be stored.
	let refHost = typeof body?.ref === 'string' ? body.ref.slice(0, 100).toLowerCase() : '';
	if (!/^[a-z0-9][a-z0-9.-]*$/.test(refHost)) refHost = '';

	const events = Array.isArray(body?.e) ? body.e.slice(0, 40) : [];
	const clean = [];
	for (const ev of events) {
		if (!ev || typeof ev.n !== 'string' || !EVENT_NAMES.has(ev.n)) continue;
		clean.push({
			n: ev.n,
			d: typeof ev.d === 'string' ? ev.d.slice(0, 80) : '',
			v: Number.isFinite(ev.v) ? Math.round(ev.v) : null,
		});
	}
	if (!clean.length) return new Response(null, NO_CONTENT);

	const now = Date.now();
	const row = {
		ts: now,
		day: new Date(now).toISOString().slice(0, 10),
		session,
		country: typeof request.cf?.country === 'string' ? request.cf.country : '',
		device: deviceClass(ua),
		refHost,
		payload: JSON.stringify(clean),
	};

	// Respond immediately; the insert must never add latency for the visitor.
	ctx.waitUntil(
		env.DB.prepare(
			'INSERT INTO usage_events (ts, day, session, country, device, ref_host, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
		)
			.bind(row.ts, row.day, row.session, row.country, row.device, row.refHost, row.payload)
			.run()
			.catch((err) => console.error('usage insert failed:', err)),
	);

	return new Response(null, NO_CONTENT);
}

function sameOrigin(request, url) {
	const sfs = request.headers.get('sec-fetch-site');
	if (sfs) return sfs === 'same-origin';
	// Older browsers: no Sec-Fetch-*, but they do send Origin on POST.
	const origin = request.headers.get('origin');
	if (origin) {
		try {
			return new URL(origin).host === url.host;
		} catch (_) {
			return false;
		}
	}
	return false;
}

function deviceClass(ua) {
	if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
	if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
	return 'desktop';
}

/* ─── stats ───────────────────────────────────────────────────────────── */

const COMPACT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

async function stats(request, env, url) {
	// The real gate is the Cloudflare Access application on havc.matijar.info/stats
	// (configured in the dashboard). This check is the backstop for the day that
	// Access app is removed or misconfigured: no Access JWT, no page. It does not
	// verify the JWT signature — Access itself already did, upstream.
	const isLocalDev = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	if (!isLocalDev && !request.headers.get('cf-access-jwt-assertion')) {
		return new Response('Forbidden', { status: 403 });
	}

	const today = new Date().toISOString().slice(0, 10);

	// Compaction, at most weekly, on visit — deliberately no cron. Raw flush rows
	// older than today are folded into the permanent usage_daily aggregates and
	// deleted, all inside one transactional batch.
	let compactedNow = false;
	const meta = await env.DB.prepare("SELECT v FROM usage_meta WHERE k = 'last_compaction'").first();
	const last = meta ? Number(meta.v) : 0;
	if (Date.now() - last > COMPACT_EVERY_MS) {
		await compact(env, today);
		compactedNow = true;
	}

	const html = await renderStats(env, today, { compactedNow, lastCompaction: last });
	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}


async function compact(env, today) {
	const { results } = await env.DB.prepare('SELECT * FROM usage_events WHERE day < ?').bind(today).all();
	const stmts = [];

	if (results.length) {
		const counts = aggregate(results);
		const entries = [...counts.entries()];
		// One multi-row upsert per chunk; 20 rows x 5 params stays under D1's
		// per-query bound-parameter cap. The whole batch is one transaction.
		const upsert = (rows) =>
			env.DB.prepare(
				'INSERT INTO usage_daily (day, event, dim, val, count) VALUES ' +
					rows.map(() => '(?, ?, ?, ?, ?)').join(', ') +
					' ON CONFLICT (day, event, dim, val) DO UPDATE SET count = count + excluded.count',
			).bind(...rows.flatMap(([key, n]) => {
				const [day, event, dim, val] = key.split('|');
				return [day, event, dim, val, n];
			}));
		for (let i = 0; i < entries.length; i += 20) stmts.push(upsert(entries.slice(i, i + 20)));
		stmts.push(env.DB.prepare('DELETE FROM usage_events WHERE day < ?').bind(today));
	}

	stmts.push(
		env.DB.prepare(
			"INSERT INTO usage_meta (k, v) VALUES ('last_compaction', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
		).bind(String(Date.now())),
	);

	await env.DB.batch(stmts);
}

