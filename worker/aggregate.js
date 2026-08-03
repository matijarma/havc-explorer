/**
 * Aggregation core shared by compaction (index.js) and rendering (render.js):
 * fold raw usage_events rows into 'day|event|dim|val' -> count entries.
 */

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
function engBucket(ms) {
	if (ms < 30000) return '<30s';
	if (ms < 120000) return '30s-2m';
	if (ms < 600000) return '2-10m';
	return '>10m';
}
function retBucket(n) {
	return n >= 3 ? '3+' : String(n);
}

// session_end.d is "visibleMs|engagedMs|returns" (since 2026-08). Older rows
// have d="" — return null and the dwell dims are simply not counted for them.
const DAY_MS = 24 * 60 * 60 * 1000;
function parseDwell(d) {
	if (typeof d !== 'string' || !d) return null;
	const parts = d.split('|');
	if (parts.length !== 3) return null;
	const [vis, eng, ret] = parts.map(Number);
	if (![vis, eng, ret].every(Number.isFinite)) return null;
	return {
		vis: Math.max(0, Math.min(vis, DAY_MS)),
		eng: Math.max(0, Math.min(eng, DAY_MS)),
		ret: Math.max(0, Math.min(Math.round(ret), 999)),
	};
}

// Fold raw rows for every day before `today` into usage_daily counters.
// Returns the aggregate map so renderStats can reuse the same shape for the
// un-compacted tail.
export function aggregate(rows) {
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
			// observed values, instead of once per firing.
			if (ev.n === 'session_end') {
				if (Number.isFinite(ev.v)) sess.dur = Math.max(sess.dur ?? 0, ev.v);
				const dw = parseDwell(ev.d);
				if (dw) {
					sess.vis = Math.max(sess.vis ?? 0, dw.vis);
					sess.eng = Math.max(sess.eng ?? 0, dw.eng);
					sess.ret = Math.max(sess.ret ?? 0, dw.ret);
				}
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
		if (sess.vis !== undefined) {
			// engaged ≤ visible ≤ wall, enforced at count time.
			const wall = sess.dur ?? DAY_MS;
			const vis = Math.min(sess.vis, wall);
			const eng = Math.min(sess.eng ?? 0, vis);
			bump(day, 'session_end', 'vis', durBucket(vis));
			bump(day, 'session_end', 'eng', engBucket(eng));
			bump(day, 'session_end', 'ret', retBucket(sess.ret ?? 0));
		}
	}
	return counts;
}
