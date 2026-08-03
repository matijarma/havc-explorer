/**
 * /stats page renderer — server-built HTML with inline-SVG charts, no client JS.
 *
 * Design rules applied (dataviz method):
 *  - every chart on this page is single-series → one accent hue, no legend boxes;
 *    ordered buckets (durations, load time) use a validated ordinal ramp instead
 *  - marks ≤24px thick, 4px rounded data-end, square baseline, 2px surface gaps
 *  - labels/values wear text tokens, never the mark color; tabular figures in
 *    tables and axes only
 *  - a table view exists under every chart (<details>)
 *  - dark mode is selected, not flipped: ramps re-anchored on the dark surface
 *    (light #d29289→#822723 / dark #8a3c35→#edaaa4, both validator-passed)
 *  - the dwell dims exist only since 2026-08; sessions from before are absent
 *    from those charts, never drawn as fabricated zeros
 */

import { aggregate } from './aggregate.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BUCKET_ORDER = {
	dur: ['<1m', '1-5m', '5-15m', '>15m'],
	vis: ['<1m', '1-5m', '5-15m', '>15m'],
	eng: ['<30s', '30s-2m', '2-10m', '>10m'],
	ret: ['0', '1', '2', '3+'],
	ms: ['<3s', '3-8s', '8-20s', '>20s'],
};

const fmt = (n) => Number(n).toLocaleString('en-US');

/* ─── chart builders ──────────────────────────────────────────────────── */

// 60-day sessions column chart. Continuous day axis from the first recorded
// day (or 60 days back, whichever is later); gaps between recorded days are
// true zeros — measurement was live.
function columnChart(byDay, today) {
	const days = [...byDay.keys()].sort();
	if (!days.length) return '<p class="empty">No sessions recorded yet.</p>';
	const end = new Date(today + 'T00:00:00Z');
	const start = new Date(Math.max(end.getTime() - 59 * 864e5, new Date(days[0] + 'T00:00:00Z').getTime()));
	const series = [];
	for (let t = start.getTime(); t <= end.getTime(); t += 864e5) {
		const day = new Date(t).toISOString().slice(0, 10);
		series.push([day, byDay.get(day) || 0]);
	}
	const max = Math.max(...series.map(([, n]) => n), 1);
	// Clean integer top with an integer midpoint — session counts never get a
	// fractional tick like 2.5.
	const pow = 10 ** Math.floor(Math.log10(max));
	let top = [1, 2, 4, 5, 10].map((m) => m * pow).find((v) => v >= max);
	if (top / 2 !== Math.floor(top / 2)) top = 2 * Math.ceil(top / 2);

	const W = 720, H = 170, padL = 34, padB = 20, padT = 14;
	const plotW = W - padL - 6, plotH = H - padT - padB;
	const slot = plotW / series.length;
	const barW = Math.min(24, Math.max(2, slot - 2));
	const y = (n) => padT + plotH * (1 - n / top);

	let gl = '';
	for (const v of top >= 2 ? [top / 2, top] : [top]) {
		gl += `<line x1="${padL}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`
			+ `<text x="${padL - 5}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${fmt(v)}</text>`;
	}
	gl += `<text x="${padL - 5}" y="${y(0) + 3.5}" class="tick" text-anchor="end">0</text>`;

	let bars = '', labels = '';
	const peak = Math.max(...series.map(([, n]) => n));
	let peakShown = false;
	series.forEach(([day, n], i) => {
		const x = padL + i * slot + (slot - barW) / 2;
		const h = Math.max(n > 0 ? 2 : 0, plotH * (n / top));
		const yTop = padT + plotH - h;
		const r = Math.min(4, h);
		if (n > 0) {
			bars += `<path d="M${x} ${yTop + r} a${r} ${r} 0 0 1 ${r} -${r} h${barW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - r} h${-barW} Z" class="mark"><title>${day}: ${fmt(n)} session${n === 1 ? '' : 's'}</title></path>`;
		}
		if (n === peak && !peakShown && peak > 0) {
			labels += `<text x="${x + barW / 2}" y="${yTop - 4}" class="val" text-anchor="middle">${fmt(n)}</text>`;
			peakShown = true;
		}
		const d = new Date(day + 'T00:00:00Z');
		if (d.getUTCDay() === 1 || series.length <= 10) {
			labels += `<text x="${x + barW / 2}" y="${H - 6}" class="tick" text-anchor="middle">${day.slice(5)}</text>`;
		}
	});

	const table = detailsTable(['day', 'sessions'], series.filter(([, n]) => n > 0).reverse());
	return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sessions per day">${gl}${bars}${labels}
		<line x1="${padL}" x2="${W - 6}" y1="${padT + plotH}" y2="${padT + plotH}" class="axis"/></svg>${table}`;
}

// Horizontal bar list for nominal categories — every bar the same single hue,
// label left, value at the tip in ink.
function barList(entries, { top = 12, unit = '' } = {}) {
	if (!entries.length) return '<p class="empty">Nothing recorded yet.</p>';
	const sorted = [...entries].sort((a, b) => b[1] - a[1]);
	const shown = sorted.slice(0, top);
	const max = shown[0][1];
	let rows = '';
	for (const [val, n] of shown) {
		const w = Math.max(0.6, 100 * (n / max));
		rows += `<div class="brow" title="${esc(val)}: ${fmt(n)}${unit}">
			<span class="blabel">${esc(val)}</span>
			<span class="btrack"><span class="bfill" style="width:${w.toFixed(1)}%"></span></span>
			<span class="bval">${fmt(n)}</span></div>`;
	}
	const more = sorted.length > shown.length
		? `<p class="more">+ ${sorted.length - shown.length} more in the table</p>` : '';
	return `<div class="bars">${rows}</div>${more}${detailsTable(['value', 'count'], sorted)}`;
}

// Ordered-bucket histogram — ordinal ramp by bucket position (validated),
// all defined buckets shown so the shape of the distribution reads.
function bucketBars(dimMap, order) {
	if (!dimMap || ![...dimMap.values()].some((n) => n > 0)) return null;
	const max = Math.max(...order.map((b) => dimMap.get(b) || 0), 1);
	let rows = '';
	order.forEach((bucket, i) => {
		const n = dimMap.get(bucket) || 0;
		const w = Math.max(n > 0 ? 1 : 0, 100 * (n / max));
		rows += `<div class="brow" title="${esc(bucket)}: ${fmt(n)}">
			<span class="blabel">${esc(bucket)}</span>
			<span class="btrack"><span class="bfill ramp${i + 1}" style="width:${w.toFixed(1)}%"></span></span>
			<span class="bval">${n > 0 ? fmt(n) : '<span class="zero">0</span>'}</span></div>`;
	});
	return `<div class="bars">${rows}</div>`;
}

// 100%-stacked share bar for 2–4 slices. Identity comes from the inline label
// (when the segment fits) plus the caption list — never from hue alone.
function shareBar(entries) {
	const total = entries.reduce((a, [, n]) => a + n, 0);
	if (!total) return '<p class="empty">Nothing recorded yet.</p>';
	const sorted = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 4);
	let segs = '', caption = [];
	sorted.forEach(([val, n], i) => {
		const pct = 100 * (n / total);
		const label = `${esc(val)} ${Math.round(pct)}%`;
		segs += `<span class="seg ramp${i + 1}" style="width:${pct.toFixed(1)}%" title="${esc(val)}: ${fmt(n)} (${pct.toFixed(1)}%)">${pct >= 14 ? `<span class="seglabel">${label}</span>` : ''}</span>`;
		caption.push(`${esc(val)} <b>${fmt(n)}</b>`);
	});
	return `<div class="share">${segs}</div><p class="sharecap">${caption.join(' · ')}</p>`;
}

function detailsTable(headers, rows) {
	if (!rows.length) return '';
	const body = rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
	return `<details><summary>table</summary><table><thead><tr>${headers.map((h, i) => `<th class="${i > 0 ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></details>`;
}

const tile = (label, value) => `<div class="tile"><span class="tlabel">${esc(label)}</span><span class="tvalue">${value}</span></div>`;
const card = (title, body, note = '') =>
	`<section class="card"><h2>${esc(title)}</h2>${body}${note ? `<p class="note">${esc(note)}</p>` : ''}</section>`;

/* ─── the page ────────────────────────────────────────────────────────── */

export async function renderStats(env, today, { compactedNow, lastCompaction }) {
	// Archive (compacted) + today's un-compacted tail, merged into one view.
	const [{ results: daily }, { results: tailRows }] = await Promise.all([
		env.DB.prepare('SELECT day, event, dim, val, count FROM usage_daily').all(),
		env.DB.prepare('SELECT * FROM usage_events WHERE day >= ?').bind(today).all(),
	]);

	const merged = new Map();
	for (const r of daily) merged.set(`${r.day}|${r.event}|${r.dim}|${r.val}`, r.count);
	for (const [key, n] of aggregate(tailRows)) merged.set(key, (merged.get(key) || 0) + n);

	const byDay = new Map();       // day -> sessions
	const dimTotals = new Map();   // 'event|dim' -> Map(val -> n)
	const eventTotals = new Map(); // event -> n
	for (const [key, n] of merged) {
		const [day, event, dim, val] = key.split('|');
		if (event === 'session' && dim === '') byDay.set(day, (byDay.get(day) || 0) + n);
		if (dim === '') eventTotals.set(event, (eventTotals.get(event) || 0) + n);
		else {
			const k = `${event}|${dim}`;
			if (!dimTotals.has(k)) dimTotals.set(k, new Map());
			const m = dimTotals.get(k);
			m.set(val, (m.get(val) || 0) + n);
		}
	}
	const dim = (event, d) => dimTotals.get(`${event}|${d}`);
	const entriesOf = (event, d) => [...(dim(event, d) || new Map()).entries()];

	const totalSessions = [...byDay.values()].reduce((a, b) => a + b, 0);
	const last7 = (() => {
		let n = 0;
		for (let i = 0; i < 7; i++) {
			const d = new Date(new Date(today + 'T00:00:00Z').getTime() - i * 864e5).toISOString().slice(0, 10);
			n += byDay.get(d) || 0;
		}
		return n;
	})();
	const totalEvents = [...eventTotals.entries()].filter(([e]) => e !== 'session').reduce((a, [, n]) => a + n, 0);

	// Engagement histograms — only when dwell data exists (measured since 2026-08).
	const engBlocks = [
		['Session length', bucketBars(dim('session_end', 'dur'), BUCKET_ORDER.dur)],
		['Active tab time', bucketBars(dim('session_end', 'vis'), BUCKET_ORDER.vis)],
		['Engaged time', bucketBars(dim('session_end', 'eng'), BUCKET_ORDER.eng)],
		['Returns to tab', bucketBars(dim('session_end', 'ret'), BUCKET_ORDER.ret)],
	].filter(([, html]) => html);
	const engagement = engBlocks.length
		? `<div class="grid4">${engBlocks.map(([t, html]) => `<div class="sub"><h3>${esc(t)}</h3>${html}</div>`).join('')}</div>`
		: '<p class="empty">No dwell data yet — active-tab and engaged time are measured since 3 Aug 2026.</p>';

	const compactionNote = compactedNow
		? 'compaction ran on this visit'
		: lastCompaction ? `last compaction ${new Date(lastCompaction).toISOString().slice(0, 10)}` : 'no compaction yet';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sredstva · usage</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Albert+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --paper:#f4ede2; --panel:#efe5d4; --ink:#2e2522; --muted:#8a7e72; --rule:#d6cebe;
    --accent:#c14843; --mark:#a83b37;
    --r1:#d29289; --r2:#bd6459; --r3:#a83b37; --r4:#822723;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:#2a201d; --panel:#382b27; --ink:#f4ede2; --muted:#8a7e72; --rule:#4a3b35;
      --mark:#dc7069;
      --r1:#8a3c35; --r2:#b0554d; --r3:#dc7069; --r4:#edaaa4;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 68rem; padding: 2.2rem 1.4rem 4rem;
         background: var(--paper); color: var(--ink);
         font: 15px/1.5 "Albert Sans", system-ui, sans-serif; }
  h1 { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 1.7rem;
       letter-spacing: -0.02em; margin: 0 0 .2rem; }
  h1 .dot { color: var(--accent); }
  .meta { color: var(--muted); font-size: .82rem; margin: 0 0 1.6rem; max-width: 46rem; }
  .meta code { font-family: "JetBrains Mono", monospace; font-size: .78rem; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .8rem; margin-bottom: 1.4rem; }
  .tile { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: .8rem 1rem; }
  .tlabel { display: block; font-size: .72rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
  .tvalue { display: block; font-weight: 600; font-size: 1.7rem; letter-spacing: -0.01em; margin-top: .15rem; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: .9rem; }
  .card { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 1rem 1.1rem 0.9rem; }
  .card.wide { grid-column: 1 / -1; }
  h2 { font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: .95rem;
       letter-spacing: .01em; margin: 0 0 .7rem; }
  h3 { font-size: .72rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
       font-weight: 600; margin: .2rem 0 .45rem; }
  .grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .4rem 1.6rem; }

  svg { width: 100%; height: auto; display: block; }
  .mark { fill: var(--mark); }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .axis { stroke: var(--muted); stroke-width: 1; }
  .tick { fill: var(--muted); font: 10px "JetBrains Mono", monospace; }
  .val  { fill: var(--ink); font: 600 10.5px "Albert Sans", sans-serif; }

  .bars { display: flex; flex-direction: column; gap: 5px; }
  .brow { display: grid; grid-template-columns: 7.5rem 1fr 3.2rem; gap: .6rem; align-items: center; }
  .blabel { font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btrack { height: 14px; }
  .bfill { display: block; height: 100%; background: var(--mark); border-radius: 0 4px 4px 0; min-width: 0; }
  .ramp1 { background: var(--r1); } .ramp2 { background: var(--r2); }
  .ramp3 { background: var(--r3); } .ramp4 { background: var(--r4); }
  .bval { font: 500 .78rem "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; }
  .zero { color: var(--muted); }
  .more { color: var(--muted); font-size: .75rem; margin: .4rem 0 0; }

  .share { display: flex; gap: 2px; height: 26px; border-radius: 5px; overflow: hidden; }
  .seg { display: flex; align-items: center; justify-content: center; min-width: 3px; }
  .seglabel { font: 600 .72rem "Albert Sans", sans-serif; color: #f9f4ec; white-space: nowrap; }
  .ramp4 .seglabel, .ramp1 .seglabel { color: var(--paper); }
  .sharecap { color: var(--muted); font-size: .78rem; margin: .45rem 0 0; }
  .sharecap b { color: var(--ink); font-weight: 600; }

  details { margin-top: .55rem; }
  summary { cursor: pointer; color: var(--muted); font: .72rem "JetBrains Mono", monospace;
            text-transform: uppercase; letter-spacing: .1em; }
  table { border-collapse: collapse; width: 100%; margin-top: .4rem; }
  th, td { text-align: left; padding: .22rem .6rem .22rem 0; border-bottom: 1px solid var(--rule); font-size: .8rem; }
  th { font-size: .68rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 600; }
  td.n, th.n { text-align: right; font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }

  .empty, .note { color: var(--muted); font-size: .8rem; }
  .note { margin: .55rem 0 0; }
  footer { margin-top: 2rem; color: var(--muted); font: .72rem "JetBrains Mono", monospace; }
</style>
</head>
<body>
<h1>Sredstva<span class="dot">·</span>usage</h1>
<p class="meta">Aggregate first-party measurement: no cookies, no stored IPs, no stored user agents;
sessions forget themselves when the tab closes. Archive is permanent (D1); ${esc(compactionNote)}.</p>

<div class="kpis">
${tile('Sessions', fmt(totalSessions))}
${tile('Last 7 days', fmt(last7))}
${tile('Active days', fmt(byDay.size))}
${tile('Events', fmt(totalEvents))}
</div>

<div class="cards">
${card('Sessions by day', columnChart(byDay, today)).replace('class="card"', 'class="card wide"')}
${card('Engagement', engagement, engBlocks.length ? 'Active-tab and engaged time measured since 3 Aug 2026; engaged = input within 15 s, tab in foreground.' : '')
	.replace('class="card"', 'class="card wide"')}
${card('Countries', barList(entriesOf('session', 'country')))}
${card('Referrer hosts', barList(entriesOf('session', 'ref')))}
${card('Views', barList(entriesOf('view', 'd')))}
${card('Studio chapters', barList(entriesOf('studio_chapter', 'd')))}
${card('Filter fields', barList(entriesOf('filter', 'd')))}
${card('Registry load time', bucketBars(dim('data_loaded', 'ms'), BUCKET_ORDER.ms) || '<p class="empty">Nothing recorded yet.</p>')}
${card('Device', shareBar(entriesOf('session', 'device')))}
${card('Language', shareBar(entriesOf('session', 'lang')))}
${card('Theme', shareBar(entriesOf('session', 'theme')))}
${card('Event totals', detailsTable(['event', 'count'], [...eventTotals.entries()].filter(([e]) => e !== 'session').sort((a, b) => b[1] - a[1])).replace('<details>', '<details open>'))}
</div>

<footer>archive current through ${esc([...byDay.keys()].sort().pop() || '—')} · sredstva/havc-explorer</footer>
</body>
</html>`;
}
