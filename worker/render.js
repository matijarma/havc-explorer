/**
 * Private visitor ledger renderer.
 *
 * The page is server-rendered and deliberately says "sessions", never
 * "visitors" or "people". Every adoption figure includes its denominator,
 * every chart has an exact table, and incomplete coverage is visible.
 */

import { aggregate, aggregateKey, decodeAggregateKey } from './aggregate.js';
import { loadCloudflareSignals } from './cloudflare.js';
import {
	addDays,
	eachDay,
	formatZagrebDateTime,
} from './time.js';

export const esc = (value) => String(value).replace(
	/[&<>"']/g,
	(character) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	}[character]),
);

const RANGE_OPTIONS = ['7', '30', '90', 'all'];
const LOAD_BUCKETS = ['<3s', '3-8s', '8-20s', '>20s'];
const DURATION_BUCKETS = ['<1m', '1-5m', '5-15m', '>15m'];
const ENGAGEMENT_BUCKETS = ['<30s', '30s-2m', '2-10m', '>10m'];
const RETURN_BUCKETS = ['0', '1', '2', '3+'];
const VITAL_BUCKETS = ['good', 'needs-work', 'poor'];

const FEATURE_ROWS = [
	['project_open', 'Project profiles opened'],
	['filter', 'Filters applied'],
	['studio_open', 'Registry Studio opened'],
	['pdf_open', 'Source PDFs opened'],
	['share_created', 'Share links created'],
	['view', 'About or process views opened'],
];

const fmt = (value, digits = 0) => Number(value || 0).toLocaleString('en-GB', {
	minimumFractionDigits: digits,
	maximumFractionDigits: digits,
});

function fmtPercent(value, digits = 1) {
	if (!Number.isFinite(value)) return 'not available';
	return `${fmt(value * 100, digits)}%`;
}

function formatDay(day, style = 'short') {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
	return new Intl.DateTimeFormat('en-GB', style === 'long'
		? { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }
		: { month: 'short', day: '2-digit', timeZone: 'UTC' })
		.format(new Date(`${day}T00:00:00Z`));
}

function sum(values) {
	let total = 0;
	for (const value of values) total += Number(value) || 0;
	return total;
}

function mapEntries(map) {
	return [...(map || new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function rangeDefinition(today, requested, firstDay) {
	const range = RANGE_OPTIONS.includes(requested) ? requested : '30';
	if (range === 'all') {
		return {
			range,
			start: firstDay || today,
			end: today,
			previousStart: null,
			previousEnd: null,
			label: firstDay ? `${formatDay(firstDay, 'long')} to today` : 'all recorded dates',
		};
	}
	const length = Number(range);
	const start = addDays(today, -(length - 1));
	const previousEnd = addDays(start, -1);
	const previousStart = addDays(previousEnd, -(length - 1));
	return {
		range,
		start,
		end: today,
		previousStart,
		previousEnd,
		label: `${range} days`,
	};
}

function inPeriod(day, start, end) {
	return day >= start && day <= end;
}

export function periodCounters(records, start, end) {
	const counters = new Map();
	const byDay = new Map();
	for (const record of records) {
		if (!inPeriod(record.day, start, end)) continue;
		const key = JSON.stringify([record.event, record.dim, record.val]);
		counters.set(key, (counters.get(key) || 0) + record.count);
		if (record.event === 'session' && record.dim === '' && record.val === '') {
			byDay.set(record.day, (byDay.get(record.day) || 0) + record.count);
		}
	}
	const get = (event, dim = '', val = '') =>
		counters.get(JSON.stringify([event, dim, val])) || 0;
	const dimension = (event, dim) => {
		const result = new Map();
		for (const [key, count] of counters) {
			const [candidateEvent, candidateDim, value] = JSON.parse(key);
			if (candidateEvent === event && candidateDim === dim) result.set(value, count);
		}
		return result;
	};
	return { counters, byDay, get, dimension, start, end };
}

function mergeUsageRows(daily, rawRows, metaRows, today) {
	const merged = new Map();
	const archivedDays = new Set();
	const rawSummary = new Map();
	for (const row of rawRows) {
		const current = rawSummary.get(row.day) || { count: 0, maxId: 0 };
		current.count++;
		current.maxId = Math.max(current.maxId, Number(row.id) || 0);
		rawSummary.set(row.day, current);
	}
	const markers = new Map((metaRows || [])
		.filter((row) => row.k.startsWith('archive:v2:'))
		.map((row) => [row.k.slice('archive:v2:'.length), row.v]));
	for (const row of daily) {
		const raw = rawSummary.get(row.day);
		const fingerprint = raw ? `${raw.count}:${raw.maxId}` : null;
		// If an archive refresh failed, prefer its retained raw source over an
		// older archive rather than adding both or showing stale counters.
		if (raw && row.day !== today && markers.get(row.day) !== fingerprint) continue;
		const key = aggregateKey(row.day, row.event, row.dim, row.val);
		merged.set(key, Number(row.count) || 0);
		if (row.event === 'session' && row.dim === '' && row.val === '') archivedDays.add(row.day);
	}

	// Completed archived days retain raw rows for 30 days for diagnostics. They
	// must not be added twice. A raw day with no archive is always included so a
	// failed owner-triggered sync cannot create another blind window.
	for (const [key, count] of aggregate(rawRows)) {
		const [day] = decodeAggregateKey(key);
		if (day === today || !archivedDays.has(day)) {
			merged.set(key, (merged.get(key) || 0) + count);
		}
	}
	return merged;
}

export async function loadUsageSnapshot(env, today) {
	const [{ results: daily }, { results: rawRows }, { results: metaRows }] = await Promise.all([
		env.DB.prepare('SELECT day, event, dim, val, count FROM usage_daily ORDER BY day').all(),
		env.DB.prepare('SELECT * FROM usage_events ORDER BY id').all(),
		env.DB.prepare('SELECT k, v FROM usage_meta').all(),
	]);
	const merged = mergeUsageRows(daily || [], rawRows || [], metaRows || [], today);
	const records = [...merged.entries()].map(([key, count]) => {
		const [day, event, dim, val] = decodeAggregateKey(key);
		return { day, event, dim, val, count: Number(count) || 0 };
	});
	const rawSessions = new Set((rawRows || []).map((row) => row.session)).size;
	const rawTimes = (rawRows || []).map((row) => Number(row.ts)).filter(Number.isFinite);
	const archiveDays = new Set((daily || []).map((row) => row.day));
	return {
		records,
		meta: new Map((metaRows || []).map((row) => [row.k, row.v])),
		diagnostics: {
			rawRows: (rawRows || []).length,
			rawSessions,
			firstRawAt: rawTimes.length ? Math.min(...rawTimes) : null,
			lastBeaconAt: rawTimes.length ? Math.max(...rawTimes) : null,
			archiveRows: (daily || []).length,
			archiveDays: archiveDays.size,
		},
	};
}

function deltaModel(current, previous) {
	if (previous == null) return { label: 'no prior period', className: 'is-neutral' };
	if (current === previous) return { label: 'no change', className: 'is-neutral' };
	if (previous === 0) return { label: current > 0 ? 'new in this period' : 'no change', className: 'is-neutral' };
	const change = (current - previous) / previous;
	return {
		label: `${change > 0 ? '+' : ''}${fmtPercent(change)} vs prior`,
		className: change > 0 ? 'is-up' : 'is-down',
	};
}

function periodModel(period, previous) {
	const sessions = period.get('session');
	const ready = period.get('journey', 'stage', 'ready');
	const investigated = period.get('journey', 'stage', 'investigated');
	const source = period.get('journey', 'stage', 'source');
	const engaged = period.get('session', 'engaged', 'yes');
	const feature = period.get('session', 'feature', 'yes');
	const ended = period.get('session_end', 'sessions');
	const loadErrors = period.get('load_error', 'sessions');
	return {
		sessions,
		ready,
		investigated,
		source,
		engaged,
		feature,
		ended,
		loadErrors,
		previous: previous ? {
			sessions: previous.get('session'),
			ready: previous.get('journey', 'stage', 'ready'),
			investigated: previous.get('journey', 'stage', 'investigated'),
			source: previous.get('journey', 'stage', 'source'),
			engaged: previous.get('session', 'engaged', 'yes'),
			feature: previous.get('session', 'feature', 'yes'),
			ended: previous.get('session_end', 'sessions'),
			loadErrors: previous.get('load_error', 'sessions'),
		} : null,
	};
}

export function buildStatsModel(snapshot, today, requestedRange) {
	const recordedDays = snapshot.records
		.filter((row) => row.event === 'session' && row.dim === '')
		.map((row) => row.day)
		.sort();
	const firstDay = recordedDays[0] || null;
	const lastDay = recordedDays[recordedDays.length - 1] || null;
	const definition = rangeDefinition(today, requestedRange, firstDay);
	const current = periodCounters(snapshot.records, definition.start, definition.end);
	const previous = definition.previousStart
		? periodCounters(snapshot.records, definition.previousStart, definition.previousEnd)
		: null;
	return {
		today,
		firstDay,
		lastDay,
		definition,
		current,
		previous,
		summary: periodModel(current, previous),
		diagnostics: snapshot.diagnostics,
		meta: snapshot.meta,
	};
}

function table(headers, rows, caption) {
	if (!rows.length) return '<p class="empty">No observations in this period.</p>';
	return `<div class="table-scroll"><table>
		<caption>${esc(caption)}</caption>
		<thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead>
		<tbody>${rows.map((row) => `<tr>${row.map((cell, index) =>
			`${index === 0 ? '<th scope="row">' : '<td>'}${esc(cell)}${index === 0 ? '</th>' : '</td>'}`,
		).join('')}</tr>`).join('')}</tbody>
	</table></div>`;
}

function disclosure(label, content, open = false) {
	return `<details${open ? ' open' : ''}><summary>${esc(label)}</summary>${content}</details>`;
}

function trendChart(period, definition, today) {
	const days = eachDay(definition.start, definition.end);
	const series = days.map((day) => [day, period.byDay.get(day) || 0]);
	if (!series.some(([, count]) => count > 0)) return '<p class="empty">No sessions in this range.</p>';

	const width = 900;
	const height = 230;
	const left = 38;
	const right = 12;
	const top = 24;
	const bottom = 34;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const maximum = Math.max(1, ...series.map(([, count]) => count));
	const tickTop = maximum <= 5 ? maximum : Math.ceil(maximum / 5) * 5;
	const slot = plotWidth / series.length;
	const barWidth = Math.min(22, Math.max(2, slot - 2));
	const y = (value) => top + plotHeight * (1 - value / tickTop);
	const labelEvery = Math.max(1, Math.ceil(series.length / 8));

	const grid = [0, Math.ceil(tickTop / 2), tickTop].map((value) =>
		`<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="grid"/>
		<text x="${left - 7}" y="${y(value) + 4}" text-anchor="end" class="axis-label">${fmt(value)}</text>`,
	).join('');

	const bars = series.map(([day, count], index) => {
		const x = left + index * slot + (slot - barWidth) / 2;
		const barHeight = count ? Math.max(2, plotHeight * count / tickTop) : 0;
		const barY = top + plotHeight - barHeight;
		const partial = day === today ? ' is-partial' : '';
		const label = index % labelEvery === 0 || index === series.length - 1
			? `<text x="${x + barWidth / 2}" y="${height - 9}" text-anchor="middle" class="axis-label">${esc(day.slice(5))}</text>`
			: '';
		return `${count ? `<rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="2" class="trend-bar${partial}">
			<title>${esc(formatDay(day, 'long'))}: ${fmt(count)} session${count === 1 ? '' : 's'}${day === today ? ', partial day' : ''}</title>
		</rect>` : ''}${label}`;
	}).join('');

	const exact = table(
		['Date', 'Sessions', 'Status'],
		series.slice().reverse().map(([day, count]) => [
			formatDay(day, 'long'),
			fmt(count),
			day === today ? 'partial day' : 'complete day',
		]),
		'Sessions by Zagreb calendar day',
	);
	return `<div class="chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trend-title trend-desc">
		<title id="trend-title">Observed tab sessions by day</title>
		<desc id="trend-desc">Daily session counts for ${esc(definition.label)}. Today is marked as partial.</desc>
		<defs><pattern id="partial-pattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--chart)"></rect></pattern></defs>
		${grid}${bars}
	</svg></div>${disclosure('Show exact daily table', exact)}`;
}

function metricRow(label, value, note, delta) {
	return `<div class="metric-row">
		<div class="metric-copy"><strong>${esc(label)}</strong><span>${esc(note)}</span></div>
		<div class="metric-value">${value}</div>
		<div class="metric-delta ${esc(delta.className)}">${esc(delta.label)}</div>
	</div>`;
}

function distribution(title, values, order, denominator, note = '') {
	const total = sum(order.map((bucket) => values.get(bucket) || 0));
	if (!total) return `<div class="distribution"><h3>${esc(title)}</h3><p class="empty">No covered sessions yet.</p></div>`;
	const rows = order.map((bucket) => {
		const count = values.get(bucket) || 0;
		const share = total ? count / total : 0;
		return `<div class="bar-row">
			<span class="bar-label">${esc(bucket)}</span>
			<span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(count ? 1 : 0, share * 100).toFixed(1)}%"></span></span>
			<span class="bar-value">${fmt(count)} <small>${fmtPercent(share, 0)}</small></span>
		</div>`;
	}).join('');
	return `<div class="distribution">
		<h3>${esc(title)}</h3>
		<div class="bar-list">${rows}</div>
		<p class="coverage">${esc(note || `${fmt(total)} covered sessions of ${fmt(denominator)} total`)}</p>
	</div>`;
}

function rankedLedger(title, entries, denominator, options = {}) {
	const top = options.top || 10;
	const rows = mapEntries(entries).slice(0, top);
	if (!rows.length) return `<div class="ranked"><h3>${esc(title)}</h3><p class="empty">No observations in this period.</p></div>`;
	const maximum = Math.max(...rows.map(([, count]) => count), 1);
	return `<div class="ranked">
		<h3>${esc(title)}</h3>
		<div class="rank-list">${rows.map(([label, count]) => `<div class="rank-row">
			<span class="rank-label" title="${esc(label)}">${esc(label)}</span>
			<span class="rank-track" aria-hidden="true"><span style="width:${(count / maximum * 100).toFixed(1)}%"></span></span>
			<span class="rank-value">${fmt(count)}${denominator ? ` <small>${fmtPercent(count / denominator, 0)}</small>` : ''}</span>
		</div>`).join('')}</div>
		${disclosure(`Show all ${title.toLowerCase()}`, table(
			['Value', 'Sessions', denominator ? 'Share of sessions' : 'Count'],
			mapEntries(entries).map(([label, count]) => [
				label,
				fmt(count),
				denominator ? fmtPercent(count / denominator) : fmt(count),
			]),
			title,
		))}
	</div>`;
}

function cloudflareComparison(cloudflare, current) {
	if (cloudflare.status === 'not-configured') {
		return '<p class="section-footnote">Cloudflare edge traffic and RUM are ready to merge here after a durable Analytics Read API token is configured as <code>CF_ANALYTICS_TOKEN</code>.</p>';
	}
	if (cloudflare.status === 'error') {
		return '<p class="alert">Cloudflare traffic comparison could not be loaded. First-party analytics below remain available.</p>';
	}
	const sessions = current.get('session');
	const daily = new Map(cloudflare.edgeDaily.map((row) => [row.day, row]));
	const days = [...new Set([
		...cloudflare.edgeDaily.map((row) => row.day),
		...current.byDay.keys(),
	])].sort().reverse();
	const browserVisits = new Map(cloudflare.browsers.map((row) => [row.name, row.visits]));
	const coverage = cloudflare.edgeVisits ? sessions / cloudflare.edgeVisits : null;
	return `<div class="cloudflare-comparison">
		<div class="metric-ledger compact-ledger">
			${metricRow(
				'Cloudflare browser-like visits',
				fmt(cloudflare.edgeVisits),
				`${fmt(cloudflare.edgeRequests)} successful root-page requests after known bot/tool exclusions`,
				{ label: 'edge estimate', className: 'is-neutral' },
			)}
			${metricRow(
				'First-party session coverage',
				coverage == null ? 'not available' : fmtPercent(coverage),
				`${fmt(sessions)} D1 sessions compared with ${fmt(cloudflare.edgeVisits)} edge visit estimates`,
				{ label: 'diagnostic ratio', className: 'is-neutral' },
			)}
			${metricRow(
				'Cloudflare RUM page loads',
				fmt(cloudflare.rumPageLoads),
				cloudflare.rumPageLoads ? 'cookieless Cloudflare Web Analytics feed' : 'the current Web Analytics site feed returned no rows',
				{ label: cloudflare.rumPageLoads ? 'connected' : 'inactive or mismatched', className: 'is-neutral' },
			)}
		</div>
		<div class="split-grid edge-details">
			<div>
				<h3>Edge comparison by day</h3>
				${table(
					['Date', 'Edge visits', 'Root requests', 'D1 sessions'],
					days.map((day) => {
						const edge = daily.get(day);
						return [
							formatDay(day, 'long'),
							fmt(edge?.visits || 0),
							fmt(edge?.requests || 0),
							fmt(current.byDay.get(day) || 0),
						];
					}),
					'Cloudflare edge estimates compared with first-party sessions',
				)}
			</div>
			${rankedLedger('Browser family at the edge', browserVisits, cloudflare.edgeVisits)}
		</div>
		<p class="section-footnote">Edge visits are Cloudflare estimates, not unique people. Known Curl, YandexBot, GoogleBot, ChromeHeadless, and verified-bot categories are excluded; unclassified automation can still remain.</p>
	</div>`;
}

function adoptionTable(model) {
	const { current, previous } = model;
	const sessions = model.summary.sessions;
	const rows = FEATURE_ROWS.map(([event, label]) => {
		const reach = current.get(event, 'sessions');
		const actions = current.get(event);
		const prior = previous ? previous.get(event, 'sessions') : null;
		return [
			label,
			fmt(reach),
			fmtPercent(sessions ? reach / sessions : 0),
			fmt(actions),
			deltaModel(reach, prior).label,
		];
	});
	return table(
		['Feature', 'Sessions reached', 'Session reach', 'Actions', 'Change'],
		rows,
		'Feature adoption: session reach and total actions',
	);
}

function funnel(model) {
	const stages = [
		['Observed session', model.summary.sessions],
		['Registry ready', model.summary.ready],
		['Investigated data', model.summary.investigated],
		['Opened a source PDF', model.summary.source],
	];
	const maximum = Math.max(stages[0][1], 1);
	return `<ol class="funnel">${stages.map(([label, count], index) => `<li>
		<span class="funnel-index">${String(index + 1).padStart(2, '0')}</span>
		<span class="funnel-copy"><strong>${esc(label)}</strong><small>${index === 0 ? 'denominator' : `${fmtPercent(count / maximum)} of sessions`}</small></span>
		<span class="funnel-track" aria-hidden="true"><span style="width:${Math.max(count ? 1 : 0, count / maximum * 100).toFixed(1)}%"></span></span>
		<span class="funnel-value">${fmt(count)}</span>
	</li>`).join('')}</ol>`;
}

function vitalDistribution(current, metric, sessions) {
	const values = current.dimension('web_vital', metric);
	const covered = current.get('web_vital', 'session_d', metric);
	const labels = { ttfb: 'TTFB', fcp: 'FCP', lcp: 'LCP', inp: 'INP', cls: 'CLS' };
	return distribution(
		labels[metric] || metric.toUpperCase(),
		values,
		VITAL_BUCKETS,
		sessions,
		`${fmt(covered)} sessions reported ${labels[metric] || metric}; thresholds follow Web Vitals bands`,
	);
}

function section(id, kicker, title, note, body) {
	return `<section class="ledger-section" id="${esc(id)}">
		<header class="section-head">
			<div><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2></div>
			${note ? `<p>${esc(note)}</p>` : ''}
		</header>
		${body}
	</section>`;
}

function diagnosticsContent(model, archiveStatus) {
	const diagnostics = model.diagnostics;
	const eventRows = [];
	for (const [key, count] of model.current.counters) {
		const [event, dim, val] = JSON.parse(key);
		if (dim === '' && val === '' && event !== 'session') eventRows.push([event, fmt(count)]);
	}
	eventRows.sort((a, b) => Number(b[1].replace(/,/g, '')) - Number(a[1].replace(/,/g, '')));
	const refreshed = archiveStatus?.refreshed || [];
	const pruned = archiveStatus?.pruned || [];
	return `<div class="diagnostic-grid">
		<div>
			<h3>Collector health</h3>
			<dl class="definition-list">
				<div><dt>Last accepted beacon</dt><dd>${esc(formatZagrebDateTime(diagnostics.lastBeaconAt))}</dd></div>
				<div><dt>Raw flush rows</dt><dd>${fmt(diagnostics.rawRows)}</dd></div>
				<div><dt>Raw session IDs retained</dt><dd>${fmt(diagnostics.rawSessions)}</dd></div>
				<div><dt>Archive rows</dt><dd>${fmt(diagnostics.archiveRows)}</dd></div>
				<div><dt>Archived calendar days</dt><dd>${fmt(diagnostics.archiveDays)}</dd></div>
				<div><dt>Archive refresh</dt><dd>${archiveStatus?.error
					? 'failed; raw fallback is shown'
					: refreshed.length
						? `${refreshed.length} day${refreshed.length === 1 ? '' : 's'} rebuilt`
						: 'already current'}</dd></div>
				<div><dt>Raw retention cleanup</dt><dd>${pruned.length ? `${pruned.length} old day${pruned.length === 1 ? '' : 's'} pruned` : 'nothing due'}</dd></div>
			</dl>
		</div>
		<div>
			<h3>Methodology</h3>
			<ul class="method-list">
				<li>A session is one in-memory tab ID observed on a Zagreb calendar day. Reloading or opening a new tab creates another session.</li>
				<li>No cookie, persistent analytics ID, stored IP address, raw user agent, search term, or filter value is retained.</li>
				<li>Session reach counts a feature once per session. Actions count every accepted event.</li>
				<li>Today is partial. Period comparisons use the immediately preceding period of the same length.</li>
				<li>Raw beacon rows remain for 30 days. Completed days are archived only when this authenticated page is opened.</li>
				<li>This dashboard does not claim unique people, returning visitors, or cross-device identity.</li>
			</ul>
		</div>
	</div>
	${disclosure('Show accepted event totals for this range', table(
		['Event', 'Accepted events'],
		eventRows,
		'Accepted first-party events in the selected period',
	))}`;
}

export async function renderStats(env, today, {
	range = '30',
	archiveStatus = {},
	nonce = '',
} = {}) {
	const snapshot = await loadUsageSnapshot(env, today);
	const model = buildStatsModel(snapshot, today, range);
	const { current, previous, summary, definition } = model;
	const cloudflare = await loadCloudflareSignals(env, definition.start, definition.end);
	const previousSummary = summary.previous;
	const sessions = summary.sessions;
	const updatedAt = archiveStatus.syncedAt || Date.now();
	const sessionEndCoverage = sessions ? summary.ended / sessions : 0;

	const overview = `<div class="metric-ledger" role="table" aria-label="Overview metrics">
		${metricRow(
			'Observed tab sessions',
			fmt(sessions),
			'One tab lifetime per Zagreb calendar day, not unique people',
			deltaModel(sessions, previousSummary?.sessions ?? null),
		)}
		${metricRow(
			'Registry ready',
			`${fmt(summary.ready)} <small>${fmtPercent(sessions ? summary.ready / sessions : 0)}</small>`,
			`of ${fmt(sessions)} observed sessions`,
			deltaModel(summary.ready, previousSummary?.ready ?? null),
		)}
		${metricRow(
			'Used an investigation feature',
			`${fmt(summary.feature)} <small>${fmtPercent(sessions ? summary.feature / sessions : 0)}</small>`,
			'Project, filter, Studio, source, sharing, or secondary view',
			deltaModel(summary.feature, previousSummary?.feature ?? null),
		)}
		${metricRow(
			'Engaged sessions',
			`${fmt(summary.engaged)} <small>${fmtPercent(sessions ? summary.engaged / sessions : 0)}</small>`,
			`input while visible; ${fmtPercent(sessionEndCoverage)} session-end coverage`,
			deltaModel(summary.engaged, previousSummary?.engaged ?? null),
		)}
	</div>`;

	const engagement = `<div class="distribution-grid">
		${distribution('Session wall time', current.dimension('session_end', 'dur'), DURATION_BUCKETS, sessions)}
		${distribution('Visible tab time', current.dimension('session_end', 'vis'), DURATION_BUCKETS, sessions)}
		${distribution('Engaged time', current.dimension('session_end', 'eng'), ENGAGEMENT_BUCKETS, sessions)}
		${distribution('Returns to tab', current.dimension('session_end', 'ret'), RETURN_BUCKETS, sessions)}
	</div>
	<p class="section-footnote">${fmt(summary.ended)} of ${fmt(sessions)} sessions supplied an end snapshot (${fmtPercent(sessionEndCoverage)} coverage). Hidden tabs do not accrue visible or engaged time.</p>`;

	const featureDetails = `<div class="split-grid">
		${rankedLedger(
			'Project profiles by session reach',
			current.dimension('project_open', 'session_project'),
			sessions,
			{ top: 12 },
		)}
		<div class="stacked-ledgers">
			${rankedLedger('Filter fields by session reach', current.dimension('filter', 'session_d'), sessions)}
			${rankedLedger('Studio chapters by session reach', current.dimension('studio_chapter', 'session_d'), sessions)}
		</div>
	</div>`;

	const acquisition = `${cloudflareComparison(cloudflare, current)}
	<div class="split-grid">
		${rankedLedger('Referrer hosts', current.dimension('session', 'ref'), sessions, { top: 12 })}
		${rankedLedger('Countries', current.dimension('session', 'country'), sessions)}
	</div>
	<div class="triple-grid">
		${rankedLedger('Device class', current.dimension('session', 'device'), sessions)}
		${rankedLedger('Language', current.dimension('session', 'lang'), sessions)}
		${rankedLedger('Theme', current.dimension('session', 'theme'), sessions)}
	</div>`;

	const performance = `<div class="distribution-grid performance-grid">
		${distribution('Registry data load', current.dimension('data_loaded', 'ms'), LOAD_BUCKETS, sessions)}
		${distribution('App ready', current.dimension('app_ready', 'ms'), LOAD_BUCKETS, sessions)}
		${vitalDistribution(current, 'ttfb', sessions)}
		${vitalDistribution(current, 'fcp', sessions)}
		${vitalDistribution(current, 'lcp', sessions)}
		${vitalDistribution(current, 'cls', sessions)}
	</div>
	${summary.loadErrors
		? `<p class="alert"><strong>${fmt(summary.loadErrors)} session${summary.loadErrors === 1 ? '' : 's'}</strong> reported a load error in this range.</p>`
		: '<p class="section-footnote">No accepted registry load-error event in this range.</p>'}`;

	const ranges = RANGE_OPTIONS.map((option) => {
		const active = option === definition.range;
		return `<a href="/stats?range=${option}"${active ? ' aria-current="page" class="is-active"' : ''}>${option === 'all' ? 'All' : `${option}d`}</a>`;
	}).join('');

	const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Sredstva visitor ledger</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Albert+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
	color-scheme: light dark;
	--bg: oklch(95% 0.014 75);
	--surface: oklch(91% 0.018 75);
	--surface-strong: oklch(87% 0.022 70);
	--text: oklch(27% 0.020 40);
	--quiet: oklch(44% 0.025 45);
	--rule: oklch(79% 0.020 68);
	--accent: oklch(51% 0.155 28);
	--accent-soft: oklch(89% 0.045 28);
	--focus: oklch(58% 0.175 28);
	--chart: oklch(50% 0.135 28);
	--good: oklch(48% 0.085 145);
	--warning: oklch(57% 0.11 75);
	--poor: oklch(48% 0.14 28);
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: oklch(22% 0.018 45);
		--surface: oklch(26% 0.021 43);
		--surface-strong: oklch(31% 0.024 42);
		--text: oklch(94% 0.014 75);
		--quiet: oklch(76% 0.022 68);
		--rule: oklch(38% 0.025 43);
		--accent: oklch(70% 0.135 28);
		--accent-soft: oklch(31% 0.050 28);
		--focus: oklch(76% 0.145 28);
		--chart: oklch(69% 0.125 28);
		--good: oklch(70% 0.09 145);
		--warning: oklch(75% 0.10 75);
		--poor: oklch(70% 0.13 28);
	}
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font: 1rem/1.5 "Albert Sans", system-ui, sans-serif;
	font-optical-sizing: auto;
	-webkit-font-smoothing: antialiased;
}
a { color: inherit; }
button, input { font: inherit; }
::selection { background: var(--accent); color: var(--bg); }
.skip-link {
	position: fixed; left: 12px; top: 12px; z-index: 10; transform: translateY(-160%);
	background: var(--text); color: var(--bg); padding: 10px 14px; border-radius: 2px;
}
.skip-link:focus { transform: translateY(0); }
.shell { width: min(100% - 32px, 1120px); margin: 0 auto; padding: 32px 0 72px; }
.page-head { display: grid; gap: 24px; padding-bottom: 28px; }
.wordmark { font: 800 1.35rem/1 "Bricolage Grotesque", system-ui, sans-serif; letter-spacing: -0.025em; }
.wordmark span { color: var(--accent); }
.kicker {
	display: block; color: var(--quiet); font: 500 .68rem/1.4 "JetBrains Mono", monospace;
	letter-spacing: .13em; text-transform: uppercase;
}
h1, h2, h3 { text-wrap: balance; }
h1 {
	max-width: 18ch; margin: 10px 0 8px; font: 800 2rem/1.05 "Bricolage Grotesque", system-ui, sans-serif;
	letter-spacing: -.03em;
}
.lede { max-width: 70ch; margin: 0; color: var(--quiet); }
.head-controls { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 16px; }
.range-nav { display: flex; flex-wrap: wrap; gap: 4px; }
.range-nav a {
	display: inline-flex; align-items: center; justify-content: center; min-width: 48px; min-height: 44px;
	padding: 8px 12px; border: 1px solid var(--rule); border-radius: 2px;
	font: 500 .74rem/1 "JetBrains Mono", monospace; text-decoration: none;
}
.range-nav a:hover, .range-nav a:focus-visible { border-color: var(--focus); color: var(--accent); }
.range-nav a.is-active { background: var(--text); border-color: var(--text); color: var(--bg); }
.freshness { color: var(--quiet); font: 500 .72rem/1.5 "JetBrains Mono", monospace; }
.freshness strong { color: var(--text); }
.partial-note {
	display: inline-flex; align-items: center; gap: 7px; margin-top: 8px; color: var(--quiet);
	font: 500 .72rem/1.4 "JetBrains Mono", monospace;
}
.partial-note::before {
	content: ""; width: 14px; height: 10px; border: 1px solid var(--accent);
	background: repeating-linear-gradient(135deg, transparent 0 3px, var(--accent-soft) 3px 6px);
}
.ledger-section { border-top: 1px solid var(--rule); padding: 32px 0 40px; }
.section-head {
	display: grid; grid-template-columns: minmax(0, 1fr) minmax(15rem, 34rem);
	align-items: end; gap: 24px; margin-bottom: 24px;
}
.section-head h2 {
	margin: 5px 0 0; font: 800 1.35rem/1.15 "Bricolage Grotesque", system-ui, sans-serif;
	letter-spacing: -.02em;
}
.section-head p { margin: 0; color: var(--quiet); max-width: 65ch; }
.metric-ledger { border-bottom: 1px solid var(--rule); }
.metric-row {
	display: grid; grid-template-columns: minmax(14rem, 1.5fr) minmax(8rem, .7fr) minmax(9rem, .7fr);
	gap: 20px; align-items: center; padding: 14px 0; border-top: 1px solid var(--rule);
}
.metric-copy { display: grid; gap: 2px; }
.metric-copy strong { font-weight: 650; }
.metric-copy span, .metric-delta { color: var(--quiet); font-size: .83rem; }
.metric-value {
	font: 500 1.35rem/1.1 "JetBrains Mono", monospace; font-variant-numeric: tabular-nums;
	text-align: right;
}
.metric-value small { color: var(--quiet); font-size: .7rem; }
.metric-delta { text-align: right; font-family: "JetBrains Mono", monospace; }
.metric-delta.is-up::before { content: "↑ "; }
.metric-delta.is-down::before { content: "↓ "; }
.chart-scroll, .table-scroll { overflow-x: auto; overscroll-behavior-inline: contain; }
svg { display: block; width: 100%; min-width: 640px; height: auto; }
.grid { stroke: var(--rule); stroke-width: 1; }
.axis-label { fill: var(--quiet); font: 10px "JetBrains Mono", monospace; }
.trend-bar { fill: var(--chart); }
.trend-bar.is-partial { fill: url(#partial-pattern); stroke: var(--accent); stroke-width: 1; }
details { margin-top: 14px; }
summary {
	display: flex; align-items: center; min-height: 44px; width: fit-content; cursor: pointer;
	color: var(--quiet); font: 500 .72rem/1.4 "JetBrains Mono", monospace;
	letter-spacing: .08em; text-transform: uppercase;
}
summary:hover, summary:focus-visible { color: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
	outline: 2px solid var(--focus); outline-offset: 3px;
}
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
caption { text-align: left; padding: 10px 0; color: var(--quiet); font-size: .8rem; }
th, td { padding: 9px 14px 9px 0; border-bottom: 1px solid var(--rule); text-align: left; white-space: nowrap; }
thead th {
	color: var(--quiet); font: 500 .66rem/1.3 "JetBrains Mono", monospace;
	letter-spacing: .1em; text-transform: uppercase;
}
tbody th { max-width: 34rem; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
tbody td { font-family: "JetBrains Mono", monospace; font-size: .8rem; }
.distribution-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 48px; }
.distribution h3, .ranked h3, .diagnostic-grid h3 {
	margin: 0 0 12px; font-size: .84rem; line-height: 1.3; letter-spacing: .01em;
}
.bar-list, .rank-list { display: grid; gap: 8px; }
.bar-row { display: grid; grid-template-columns: 5.5rem 1fr 5.5rem; align-items: center; gap: 10px; }
.bar-label, .rank-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; }
.bar-track, .rank-track { height: 12px; background: var(--surface-strong); }
.bar-fill, .rank-track span { display: block; height: 100%; background: var(--chart); }
.bar-value, .rank-value {
	text-align: right; font: 500 .75rem/1 "JetBrains Mono", monospace; font-variant-numeric: tabular-nums;
}
.bar-value small, .rank-value small { color: var(--quiet); }
.coverage, .section-footnote { color: var(--quiet); font-size: .78rem; max-width: 72ch; }
.coverage { margin: 10px 0 0; }
.section-footnote { margin: 24px 0 0; }
.split-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; }
.triple-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px; margin-top: 36px; }
.cloudflare-comparison { margin-bottom: 38px; }
.compact-ledger { margin-bottom: 28px; }
.edge-details { align-items: start; }
.edge-details h3 { margin: 0 0 12px; font-size: .84rem; }
.section-footnote code { color: var(--text); font: 500 .76rem/1.4 "JetBrains Mono", monospace; }
.stacked-ledgers { display: grid; gap: 36px; }
.rank-row { display: grid; grid-template-columns: minmax(7rem, 1fr) 1fr 5.5rem; align-items: center; gap: 10px; }
.funnel { list-style: none; padding: 0; margin: 0 0 30px; border-bottom: 1px solid var(--rule); }
.funnel li {
	display: grid; grid-template-columns: 2.25rem minmax(12rem, 1.1fr) minmax(8rem, 1fr) 4rem;
	align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid var(--rule);
}
.funnel-index { color: var(--accent); font: 500 .72rem/1 "JetBrains Mono", monospace; }
.funnel-copy { display: grid; }
.funnel-copy small { color: var(--quiet); }
.funnel-track { height: 8px; background: var(--surface-strong); }
.funnel-track span { display: block; height: 100%; background: var(--chart); }
.funnel-value { text-align: right; font: 500 .85rem/1 "JetBrains Mono", monospace; }
.performance-grid .bar-row:nth-child(1) .bar-fill { background: var(--good); }
.performance-grid .bar-row:nth-child(2) .bar-fill { background: var(--warning); }
.performance-grid .bar-row:nth-child(3) .bar-fill { background: var(--poor); }
.alert { padding: 12px 14px; border: 1px solid var(--accent); background: var(--accent-soft); }
.diagnostics { border-top: 1px solid var(--rule); padding-top: 12px; }
.diagnostics > summary { font-size: .78rem; color: var(--text); }
.diagnostic-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; padding-top: 20px; }
.definition-list { margin: 0; }
.definition-list div { display: grid; grid-template-columns: 1fr auto; gap: 16px; padding: 8px 0; border-top: 1px solid var(--rule); }
.definition-list dt { color: var(--quiet); }
.definition-list dd { margin: 0; text-align: right; font: 500 .78rem/1.5 "JetBrains Mono", monospace; }
.method-list { margin: 0; padding-left: 20px; }
.method-list li { margin: 7px 0; }
.owner-control {
	display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center;
	margin-top: 32px; padding: 18px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.owner-control p { margin: 3px 0 0; color: var(--quiet); max-width: 65ch; }
.switch-label { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; font-weight: 600; }
.switch-label input { inline-size: 20px; block-size: 20px; accent-color: var(--accent); }
.empty { color: var(--quiet); }
.page-footer {
	display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px;
	padding-top: 28px; color: var(--quiet); font: 500 .72rem/1.5 "JetBrains Mono", monospace;
}
@media (max-width: 760px) {
	.shell { width: min(100% - 24px, 1120px); padding-top: 22px; }
	.section-head { grid-template-columns: 1fr; align-items: start; gap: 10px; }
	.metric-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; }
	.metric-copy { grid-column: 1; }
	.metric-value { grid-column: 2; grid-row: 1 / span 2; }
	.metric-delta { grid-column: 1 / -1; text-align: left; }
	.distribution-grid, .split-grid, .triple-grid, .diagnostic-grid { grid-template-columns: 1fr; gap: 30px; }
	.triple-grid { margin-top: 30px; }
	.funnel li { grid-template-columns: 2rem minmax(0, 1fr) 3.5rem; }
	.funnel-track { grid-column: 2 / -1; grid-row: 2; }
	.owner-control { grid-template-columns: 1fr; gap: 10px; }
}
@media (max-width: 420px) {
	h1 { font-size: 1.65rem; }
	.page-head { gap: 18px; }
	.head-controls { align-items: start; }
	.range-nav { width: 100%; }
	.range-nav a { flex: 1; }
	.metric-row { padding: 12px 0; }
	.metric-value { font-size: 1.1rem; }
	.bar-row { grid-template-columns: 4.5rem minmax(4rem, 1fr) 4.8rem; gap: 7px; }
	.rank-row { grid-template-columns: minmax(6rem, 1fr) minmax(3rem, .7fr) 4.8rem; gap: 7px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
</head>
<body>
<a class="skip-link" href="#overview">Skip to analytics</a>
<div class="shell">
	<header class="page-head">
		<div>
			<div class="wordmark">Sredstva<span>·</span></div>
			<span class="kicker">Private visitor ledger</span>
			<h1>What reached the app, what worked, and what people used</h1>
			<p class="lede">Cookieless first-party measurement. Counts describe observed tab sessions and actions, never unique people. Existing history is retained even where early sessions have narrower coverage.</p>
		</div>
		<div class="head-controls">
			<nav class="range-nav" aria-label="Reporting range">${ranges}</nav>
			<div class="freshness">
				<div><strong>${esc(definition.label)}</strong></div>
				<div>refreshed ${esc(formatZagrebDateTime(updatedAt))}</div>
				<div class="partial-note">${esc(formatDay(today, 'long'))} is still partial</div>
			</div>
		</div>
	</header>
	<main>
		${section(
			'overview',
			'01 · overview',
			'The reporting denominator',
			'Every rate below uses observed tab sessions in the selected Zagreb-date range.',
			overview,
		)}
		${section(
			'traffic',
			'02 · traffic trend',
			'Sessions by day',
			'Zeroes are shown as zeroes. The current day is visually marked as incomplete.',
			trendChart(current, definition, today),
		)}
		${section(
			'engagement',
			'03 · engagement',
			'Time the tab was actually present',
			'Visible and engaged time are only calculated from session-end snapshots. Coverage is stated below.',
			engagement,
		)}
		${section(
			'adoption',
			'04 · feature adoption',
			'From arrival to investigation',
			'Funnel stages are nested. The adoption table separately shows session reach and repeated actions.',
			`${funnel(model)}${adoptionTable(model)}${featureDetails}`,
		)}
		${section(
			'audience',
			'05 · acquisition and audience',
			'Coarse context, not identity',
			'Referrers are reduced to hosts. Country comes from the edge. Device is a broad user-agent class.',
			acquisition,
		)}
		${section(
			'performance',
			'06 · performance',
			'Registry readiness and Web Vitals',
			'Performance collection is first-party and cookieless. Early sessions may not contain every metric.',
			performance,
		)}
		<details class="diagnostics">
			<summary>Diagnostics, retention, and definitions</summary>
			${diagnosticsContent(model, archiveStatus)}
		</details>
		<section class="owner-control" aria-labelledby="owner-optout-title">
			<div>
				<strong id="owner-optout-title">Exclude this browser from public-app measurement</strong>
				<p>This writes one local opt-out flag on your browser. Ordinary visitors still receive no analytics storage.</p>
				<p id="owner-optout-status" role="status"></p>
			</div>
			<label class="switch-label" for="owner-optout">
				<input type="checkbox" id="owner-optout">
				<span>Owner opt-out</span>
			</label>
		</section>
	</main>
	<footer class="page-footer">
		<span>archive current through ${esc(model.lastDay ? formatDay(model.lastDay, 'long') : 'no recorded day')}</span>
		<span>Sredstva · havc.matijar.info</span>
	</footer>
</div>
<script nonce="${esc(nonce)}">
(() => {
	const key = 'sredstva-usage-optout';
	const input = document.getElementById('owner-optout');
	const status = document.getElementById('owner-optout-status');
	// Must mirror the gate in usage.js, or this status claims inclusion that
	// the collector will refuse.
	const privacySignal =
		navigator.globalPrivacyControl === true ||
		navigator.doNotTrack === '1' ||
		window.doNotTrack === '1';
	const signalCopy = 'This browser sends a privacy signal (Do Not Track or Global Privacy Control), so it is excluded regardless of this toggle.';
	function render() {
		try {
			const excluded = localStorage.getItem(key) === '1';
			input.checked = excluded;
			status.textContent = privacySignal
				? signalCopy
				: excluded
					? 'This browser is excluded. Reloading the public app will send no first-party analytics.'
					: 'This browser is included in the same cookieless measurement as other sessions.';
		} catch (_) {
			input.disabled = true;
			status.textContent = privacySignal
				? signalCopy
				: 'Browser storage is unavailable, so the owner opt-out cannot be changed here.';
		}
	}
	input.addEventListener('change', () => {
		try {
			if (input.checked) localStorage.setItem(key, '1');
			else localStorage.removeItem(key);
		} catch (_) {}
		render();
	});
	render();
})();
</script>
</body>
</html>`;

	return page;
}
