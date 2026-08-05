/**
 * Privacy-preserving aggregation for Sredstva visitor measurement.
 *
 * Raw rows contain short-lived, in-memory tab session IDs. This module folds
 * them into daily counters and never emits an identifier. Aggregate keys are
 * JSON tuples rather than delimiter-joined strings so public project IDs or
 * referrer hosts cannot corrupt the key shape.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DETAIL_EVENTS = new Set([
	'view',
	'studio_chapter',
	'filter',
	'load_error',
	'project_open',
	'share_created',
]);

const FEATURE_EVENTS = new Set([
	'view',
	'studio_open',
	'studio_chapter',
	'filter',
	'project_open',
	'pdf_open',
	'share_created',
]);

const INVESTIGATION_EVENTS = new Set([
	'studio_open',
	'studio_chapter',
	'filter',
	'project_open',
]);

export function aggregateKey(day, event, dim = '', val = '') {
	return JSON.stringify([String(day), String(event), String(dim), String(val)]);
}

export function decodeAggregateKey(key) {
	const tuple = JSON.parse(key);
	if (!Array.isArray(tuple) || tuple.length !== 4) throw new Error('Invalid aggregate key');
	return tuple.map(String);
}

function loadBucket(ms) {
	if (ms < 3000) return '<3s';
	if (ms < 8000) return '3-8s';
	if (ms < 20000) return '8-20s';
	return '>20s';
}

function durationBucket(ms) {
	const minutes = ms / 60000;
	if (minutes < 1) return '<1m';
	if (minutes < 5) return '1-5m';
	if (minutes < 15) return '5-15m';
	return '>15m';
}

function engagementBucket(ms) {
	if (ms < 30000) return '<30s';
	if (ms < 120000) return '30s-2m';
	if (ms < 600000) return '2-10m';
	return '>10m';
}

function returnBucket(value) {
	return value >= 3 ? '3+' : String(value);
}

export function vitalBucket(metric, value) {
	if (!Number.isFinite(value) || value < 0) return null;
	switch (metric) {
		case 'ttfb':
			return value <= 800 ? 'good' : value <= 1800 ? 'needs-work' : 'poor';
		case 'fcp':
			return value <= 1800 ? 'good' : value <= 3000 ? 'needs-work' : 'poor';
		case 'lcp':
			return value <= 2500 ? 'good' : value <= 4000 ? 'needs-work' : 'poor';
		case 'inp':
			return value <= 200 ? 'good' : value <= 500 ? 'needs-work' : 'poor';
		case 'cls':
			// CLS is sent as thousandths to keep the wire value integral.
			return value <= 100 ? 'good' : value <= 250 ? 'needs-work' : 'poor';
		default:
			return null;
	}
}

// session_end.d is "visibleMs|engagedMs|returns". Rows from the first release
// can have d=""; those sessions remain valid but have no dwell distribution.
export function parseDwell(detail) {
	if (typeof detail !== 'string' || !detail) return null;
	const parts = detail.split('|');
	if (parts.length !== 3) return null;
	const [visible, engaged, returns] = parts.map(Number);
	if (![visible, engaged, returns].every(Number.isFinite)) return null;
	return {
		visible: Math.max(0, Math.min(visible, DAY_MS)),
		engaged: Math.max(0, Math.min(engaged, DAY_MS)),
		returns: Math.max(0, Math.min(Math.round(returns), 999)),
	};
}

function sessionRecord(row) {
	return {
		day: row.day,
		country: row.country || '',
		device: row.device || '',
		referrer: row.ref_host || '',
		language: '',
		theme: '',
		duration: null,
		visible: null,
		engaged: null,
		returns: null,
		events: new Set(),
		details: new Map(),
		projects: new Set(),
	};
}

function rememberDetail(session, event, detail) {
	if (!detail) return;
	let values = session.details.get(event);
	if (!values) {
		values = new Set();
		session.details.set(event, values);
	}
	values.add(detail);
}

/**
 * Fold raw usage_events rows into a Map keyed by aggregateKey().
 *
 * Counts are preserved in two forms:
 *  - event totals: how many times an action happened;
 *  - session reach: how many observed tab sessions used the action at least once.
 *
 * That distinction makes adoption and funnels honest without claiming unique
 * people or persistent returning visitors.
 */
export function aggregate(rows) {
	const counts = new Map();
	const bump = (day, event, dim = '', val = '', amount = 1) => {
		const key = aggregateKey(day, event, dim, val);
		counts.set(key, (counts.get(key) || 0) + amount);
	};

	const sessions = new Map();
	for (const row of rows || []) {
		if (!row || typeof row.day !== 'string' || typeof row.session !== 'string') continue;
		const sessionKey = JSON.stringify([row.day, row.session]);
		let session = sessions.get(sessionKey);
		if (!session) {
			session = sessionRecord(row);
			sessions.set(sessionKey, session);
		} else {
			if (!session.country && row.country) session.country = row.country;
			if (!session.device && row.device) session.device = row.device;
			if (!session.referrer && row.ref_host) session.referrer = row.ref_host;
		}

		let events;
		try {
			events = JSON.parse(row.payload);
		} catch (_) {
			continue;
		}
		if (!Array.isArray(events)) continue;

		for (const event of events) {
			if (!event || typeof event.n !== 'string') continue;
			const name = event.n;
			const detail = typeof event.d === 'string' ? event.d.slice(0, 80) : '';
			const project = typeof event.p === 'string' ? event.p.slice(0, 80) : '';
			session.events.add(name);

			if (name === 'session_end') {
				if (Number.isFinite(event.v)) {
					session.duration = Math.max(session.duration ?? 0, Math.max(0, event.v));
				}
				const dwell = parseDwell(detail);
				if (dwell) {
					session.visible = Math.max(session.visible ?? 0, dwell.visible);
					session.engaged = Math.max(session.engaged ?? 0, dwell.engaged);
					session.returns = Math.max(session.returns ?? 0, dwell.returns);
				}
				continue;
			}

			bump(row.day, name);
			if (DETAIL_EVENTS.has(name) && detail) {
				bump(row.day, name, 'd', detail);
				rememberDetail(session, name, detail);
			}

			if ((name === 'data_loaded' || name === 'app_ready') && Number.isFinite(event.v)) {
				bump(row.day, name, 'ms', loadBucket(event.v));
			}

			if (name === 'project_open' && project) {
				bump(row.day, name, 'project', project);
				session.projects.add(project);
			}

			if (name === 'web_vital' && detail && Number.isFinite(event.v)) {
				const bucket = vitalBucket(detail, event.v);
				if (bucket) bump(row.day, name, detail, bucket);
				rememberDetail(session, name, detail);
			}

			if (name === 'session_start' && detail) {
				const [language, theme] = detail.split('|');
				if (language) session.language = language.slice(0, 8);
				if (theme) session.theme = theme.slice(0, 8);
			}
		}
	}

	for (const session of sessions.values()) {
		const day = session.day;
		bump(day, 'session');
		bump(day, 'session', 'country', session.country || '??');
		bump(day, 'session', 'device', session.device || 'unknown');
		bump(day, 'session', 'ref', session.referrer || 'direct');
		if (session.language) bump(day, 'session', 'lang', session.language);
		if (session.theme) bump(day, 'session', 'theme', session.theme);

		for (const name of session.events) {
			if (name !== 'session_end') bump(day, name, 'sessions');
		}
		for (const [name, values] of session.details) {
			for (const value of values) bump(day, name, 'session_d', value);
		}
		for (const project of session.projects) bump(day, 'project_open', 'session_project', project);

		const ready = session.events.has('app_ready') || session.events.has('data_loaded');
		const investigated = ready && [...INVESTIGATION_EVENTS].some((name) => session.events.has(name));
		const sourceOpened = investigated && session.events.has('pdf_open');
		bump(day, 'journey', 'stage', 'observed');
		if (ready) bump(day, 'journey', 'stage', 'ready');
		if (investigated) bump(day, 'journey', 'stage', 'investigated');
		if (sourceOpened) bump(day, 'journey', 'stage', 'source');
		if ([...FEATURE_EVENTS].some((name) => session.events.has(name))) {
			bump(day, 'session', 'feature', 'yes');
		}

		if (session.duration !== null) {
			bump(day, 'session_end');
			bump(day, 'session_end', 'sessions');
			bump(day, 'session_end', 'dur', durationBucket(session.duration));
		}
		if (session.visible !== null) {
			const wall = session.duration ?? DAY_MS;
			const visible = Math.min(session.visible, wall);
			const engaged = Math.min(session.engaged ?? 0, visible);
			bump(day, 'session_end', 'vis', durationBucket(visible));
			bump(day, 'session_end', 'eng', engagementBucket(engaged));
			bump(day, 'session_end', 'ret', returnBucket(session.returns ?? 0));
			if (engaged > 0) bump(day, 'session', 'engaged', 'yes');
		}
	}

	return counts;
}
