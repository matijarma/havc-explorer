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

// Buckets keep usage_daily a pure counting table: durations become labelled
// ranges rather than stored averages, which is honest about the precision an
// aggregate-only archive can offer.
function loadBucket(ms) {
	if (ms < 3000) return '<3s';
	if (ms < 8000) return '3-8s';
	if (ms < 20000) return '8-20s';
	return '>20s';
}
function durBucket(ms) {
	const m = ms / 60000;
	if (m < 1) return '<1m';
	if (m < 5) return '1-5m';
	if (m < 15) return '5-15m';
	return '>15m';
}

// Fold raw rows for every day before `today` into usage_daily counters.
// Returns the aggregate map so renderStats can reuse the same shape for the
// un-compacted tail.
function aggregate(rows) {
	const counts = new Map(); // 'day|event|dim|val' -> n
	const bump = (day, event, dim, val, n = 1) => {
		const key = `${day}|${event}|${dim}|${val}`;
		counts.set(key, (counts.get(key) || 0) + n);
	};

	const seenSessions = new Map(); // 'day|session' -> {country, device, ref, lang, theme, dur}
	for (const row of rows) {
		let sess = seenSessions.get(`${row.day}|${row.session}`);
		if (!sess) {
			sess = { country: row.country || '', device: row.device || '', ref: row.ref_host || '', lang: '', theme: '', dur: null };
			seenSessions.set(`${row.day}|${row.session}`, sess);
		}
		let events;
		try {
			events = JSON.parse(row.payload);
		} catch (_) {
			continue;
		}
		if (!Array.isArray(events)) continue;
		for (const ev of events) {
			if (!ev || typeof ev.n !== 'string') continue;
			// session_end can legitimately fire more than once per session (hide,
			// return, hide again). Count it once per session, at the fullest
			// observed duration, instead of once per firing.
			if (ev.n === 'session_end') {
				if (Number.isFinite(ev.v)) sess.dur = Math.max(sess.dur ?? 0, ev.v);
				continue;
			}
			bump(row.day, ev.n, '', '');
			if ((ev.n === 'view' || ev.n === 'studio_chapter' || ev.n === 'filter') && ev.d) {
				bump(row.day, ev.n, 'd', String(ev.d).slice(0, 80));
			}
			if (ev.n === 'data_loaded' && Number.isFinite(ev.v)) bump(row.day, ev.n, 'ms', loadBucket(ev.v));
			if (ev.n === 'session_start' && typeof ev.d === 'string') {
				const [lang, theme] = ev.d.split('|');
				if (lang) sess.lang = lang.slice(0, 8);
				if (theme) sess.theme = theme.slice(0, 8);
			}
		}
	}

	for (const [key, sess] of seenSessions) {
		const day = key.slice(0, 10);
		bump(day, 'session', '', '');
		bump(day, 'session', 'country', sess.country || '??');
		bump(day, 'session', 'device', sess.device || 'unknown');
		bump(day, 'session', 'ref', sess.ref || 'direct');
		if (sess.lang) bump(day, 'session', 'lang', sess.lang);
		if (sess.theme) bump(day, 'session', 'theme', sess.theme);
		if (sess.dur !== null) {
			bump(day, 'session_end', '', '');
			bump(day, 'session_end', 'dur', durBucket(sess.dur));
		}
	}
	return counts;
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

/* ─── stats rendering ─────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function renderStats(env, today, { compactedNow, lastCompaction }) {
	// Archive (compacted) + today's un-compacted tail, merged into one view.
	const [{ results: daily }, { results: tailRows }] = await Promise.all([
		env.DB.prepare('SELECT day, event, dim, val, count FROM usage_daily').all(),
		env.DB.prepare('SELECT * FROM usage_events WHERE day >= ?').bind(today).all(),
	]);

	const merged = new Map();
	for (const r of daily) merged.set(`${r.day}|${r.event}|${r.dim}|${r.val}`, r.count);
	for (const [key, n] of aggregate(tailRows)) merged.set(key, (merged.get(key) || 0) + n);

	// Reshape for the tables.
	const byDay = new Map(); // day -> sessions
	const dimTotals = new Map(); // 'event|dim' -> Map(val -> n)
	const eventTotals = new Map(); // event -> n
	let archiveThrough = '';
	for (const [key, n] of merged) {
		const [day, event, dim, val] = key.split('|');
		if (day > archiveThrough) archiveThrough = day;
		if (event === 'session' && dim === '') byDay.set(day, (byDay.get(day) || 0) + n);
		if (dim === '') eventTotals.set(event, (eventTotals.get(event) || 0) + n);
		if (dim !== '') {
			const k = `${event}|${dim}`;
			if (!dimTotals.has(k)) dimTotals.set(k, new Map());
			const m = dimTotals.get(k);
			m.set(val, (m.get(val) || 0) + n);
		}
	}

	const dayRows = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 60);

	const table = (title, entries, valHead = '', nHead = 'count') => {
		if (!entries.length) return '';
		const rows = entries.map(([val, n]) => `<tr><td>${esc(val)}</td><td class="n">${n}</td></tr>`).join('');
		return `<section><h2>${esc(title)}</h2><table><thead><tr><th>${esc(valHead)}</th><th class="n">${esc(nHead)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
	};
	const dimTable = (title, event, dim, valHead, limit = 25) => {
		const m = dimTotals.get(`${event}|${dim}`);
		if (!m) return '';
		return table(title, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit), valHead, 'count');
	};

	const totalSessions = [...byDay.values()].reduce((a, b) => a + b, 0);
	const compactionNote = compactedNow
		? 'compaction ran on this visit'
		: lastCompaction
			? `last compaction ${new Date(lastCompaction).toISOString().slice(0, 10)}`
			: 'no compaction yet';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sredstva · usage</title>
<style>
  :root { --ink:#2e2522; --paper:#f4ede2; --muted:#8a7e72; --rule:#d6cebe; --red:#c14843; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 60rem; padding: 2rem 1.25rem 4rem;
         background: var(--paper); color: var(--ink);
         font: 14px/1.5 ui-monospace, 'JetBrains Mono', Consolas, monospace; }
  h1 { font-size: 1.1rem; letter-spacing: .04em; }
  h1 .dot { color: var(--red); }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .12em;
       color: var(--muted); margin: 2.2rem 0 .4rem; }
  p.meta { color: var(--muted); font-size: .8rem; }
  table { border-collapse: collapse; width: 100%; max-width: 32rem; }
  th, td { text-align: left; padding: .25rem .6rem .25rem 0; border-bottom: 1px solid var(--rule); }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 500; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0 2.5rem; }
</style>
</head>
<body>
<h1>Sredstva<span class="dot">·</span>usage</h1>
<p class="meta">${totalSessions} sessions on record · archive current through ${esc(archiveThrough || '—')} · ${esc(compactionNote)}.
Aggregate first-party measurement: no cookies, no stored IPs, no stored user agents, sessions forget themselves when the tab closes.</p>

${table('Sessions by day (last 60)', dayRows, 'day', 'sessions')}

<div class="grid">
${dimTable('Countries', 'session', 'country', 'country')}
${dimTable('Devices', 'session', 'device', 'device')}
${dimTable('Referrer hosts', 'session', 'ref', 'host')}
${dimTable('Language', 'session', 'lang', 'lang')}
${dimTable('Theme', 'session', 'theme', 'theme')}
${dimTable('Views', 'view', 'd', 'view')}
${dimTable('Studio chapters', 'studio_chapter', 'd', 'chapter')}
${dimTable('Filter fields', 'filter', 'd', 'field')}
${dimTable('Registry load time', 'data_loaded', 'ms', 'bucket')}
${dimTable('Session length', 'session_end', 'dur', 'bucket')}
${table('Event totals (all time)', [...eventTotals.entries()].filter(([e]) => e !== 'session').sort((a, b) => b[1] - a[1]), 'event', 'count')}
</div>
</body>
</html>`;
}
