(function (root) {
  'use strict';

  root.createSredstvaAnalyticsStudio = function createSredstvaAnalyticsStudio(api) {
    const {
      Analytics,
      state,
      subscribe,
      setShowAnalytics,
      setSelectedYear,
      addScope,
      applyFilters,
      t,
      el,
      fa,
      formatAmount,
      formatPercent,
      bandLabel,
      asObject,
      toFiniteInt,
      HRK_TO_EUR,
      SIZE_BUCKETS,
    } = api;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const CHAPTERS = [
      'overview',
      'time',
      'distribution',
      'mix',
      'concentration',
      'lifecycles',
      'methodology',
    ];

    let dialog = null;
    let opener = null;
    let model = null;
    let computationTimer = null;
    const benchmarkCache = new Map();
    const ui = {
      chapter: 'overview',
      selection: null,
      timeMetric: 'amount',
      mixDimension: 'programmes',
      mixMetric: 'amount',
      transitionKey: null,
    };

    function data() {
      return api.getData();
    }

    function sanityReport() {
      return api.getSanityReport();
    }

    function svgel(tag, attrs, children) {
      const node = document.createElementNS(SVG_NS, tag);
      if (attrs) {
        for (const key in attrs) {
          const value = attrs[key];
          if (value == null || value === false) continue;
          if (key === 'text') node.textContent = value;
          else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
          } else {
            node.setAttribute(key, value);
          }
        }
      }
      if (children) {
        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
          if (child == null || child === false) return;
          node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
      }
      return node;
    }

    function close() {
      setShowAnalytics(false);
    }

    function removeDialog() {
      if (computationTimer != null) {
        clearTimeout(computationTimer);
        computationTimer = null;
      }
      if (!dialog) return;
      const node = dialog;
      dialog = null;
      model = null;
      ui.selection = null;
      ui.transitionKey = null;
      if (node.open) node.close();
      node.remove();
      const returnTarget = opener;
      opener = null;
      requestAnimationFrame(() => {
        if (returnTarget && typeof returnTarget.focus === 'function' && returnTarget.isConnected) {
          returnTarget.focus();
        }
      });
    }

    function contextYear() {
      if (state.filters.selectedYear != null) return state.filters.selectedYear;
      const yearScope = state.scopes.find((scope) => scope && scope.kind === 'year');
      return yearScope && Number.isInteger(yearScope.value) ? yearScope.value : null;
    }

    function benchmarkRowIds() {
      const registry = data();
      const range = state.filters.yearRange;
      const selectedYear = contextYear();
      const ids = [];
      for (let i = 0; i < registry.rows.length; i++) {
        const row = registry.rows[i];
        if (range && row.year != null && (row.year < range[0] || row.year > range[1])) continue;
        if (selectedYear != null && row.year !== selectedYear) continue;
        ids.push(i);
      }
      return ids;
    }

    function benchmarkCacheKey() {
      const range = state.filters.yearRange || [];
      const selectedYear = contextYear();
      return `${range[0] || ''}:${range[1] || ''}:${selectedYear == null ? '' : selectedYear}`;
    }

    function sameIds(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    function periodLabel(lang) {
      const selectedYear = contextYear();
      if (selectedYear != null) return String(selectedYear);
      const range = state.filters.yearRange;
      if (!range || range[0] == null || range[1] == null) return t('years.all', lang);
      return range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`;
    }

    function contextLabel(lang) {
      const parts = [periodLabel(lang)];
      if (state.filters.programs.size === 1) {
        parts.push(t('prog.' + [...state.filters.programs][0], lang));
      } else if (state.filters.programs.size > 1) {
        parts.push(t('analytics.context.filters', lang, { n: state.filters.programs.size }));
      }
      if (state.filters.cats.size === 1) {
        parts.push(t('cat.' + [...state.filters.cats][0], lang));
      } else if (state.filters.cats.size > 1) {
        parts.push(t('analytics.context.filters', lang, { n: state.filters.cats.size }));
      }
      if (state.filters.roks.size) {
        parts.push(t('analytics.context.filters', lang, { n: state.filters.roks.size }));
      }
      if (state.filters.q.trim()) {
        parts.push(t('analytics.context.search', lang, { q: state.filters.q.trim() }));
      }
      if (state.scopes.length) {
        parts.push(t('analytics.context.scopes', lang, { n: state.scopes.length }));
      }
      return parts.join(' · ');
    }

    function computeModel() {
      if (!Analytics) throw new Error('analytics-core.js did not load');
      const registry = data();
      const currentIds = applyFilters();
      const baselineIds = benchmarkRowIds();
      const options = { currentYear: new Date().getFullYear(), sizeBuckets: SIZE_BUCKETS };
      const cacheKey = benchmarkCacheKey();
      let benchmark = benchmarkCache.get(cacheKey);
      if (!benchmark) {
        benchmark = Analytics.buildAnalyticsSnapshot(
          baselineIds.map((id) => registry.rows[id]),
          options,
        );
        benchmarkCache.set(cacheKey, benchmark);
      }
      const current = sameIds(currentIds, baselineIds)
        ? benchmark
        : Analytics.buildAnalyticsSnapshot(currentIds.map((id) => registry.rows[id]), options);
      return {
        ...Analytics.buildComparisonFromSnapshots(current, benchmark),
        currentIds,
        benchmarkIds: baselineIds,
        samePopulation: current === benchmark,
      };
    }

    function formatNumber(value, lang, digits) {
      const locale = lang === 'hr' ? 'hr-HR' : 'en-US';
      if (value == null || !Number.isFinite(value)) return '—';
      const decimals = digits == null ? 0 : digits;
      return value.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }

    function formatSignedPercent(value, lang, digits) {
      if (value == null || !Number.isFinite(value)) return '—';
      const sign = value > 0 ? '+' : '';
      return sign + formatPercent(value, lang, digits == null ? 1 : digits);
    }

    function programmeLabel(key, lang) {
      return t('prog.' + (key || 'other'), lang);
    }

    function categoryLabel(key, lang) {
      return t('cat.' + (key || 'other'), lang);
    }

    function roundLabel(key, lang) {
      return key === 'other' ? t('analytics.mix.other', lang) : String(key);
    }

    function stageLabel(key, lang) {
      return t('analytics.stage.' + key, lang);
    }

    function selectionKey(selection) {
      if (!selection) return '';
      if (selection.kind === 'compound') return selection.items.map(selectionKey).join('|');
      const value = Array.isArray(selection.value) ? selection.value.join(':') : selection.value;
      return `${selection.kind}:${value}`;
    }

    function isSelected(selection) {
      return selectionKey(ui.selection) === selectionKey(selection);
    }

    function select(selection, focusKey) {
      ui.selection = isSelected(selection) ? null : selection;
      render(focusKey);
    }

    function selectedLabel(selection, lang) {
      if (!selection) return '';
      if (selection.label) return selection.label;
      switch (selection.kind) {
        case 'year':
          return String(selection.value);
        case 'sizeBand':
          return bandLabel(selection.value[0], selection.value[1]);
        case 'program':
          return programmeLabel(selection.value, lang);
        case 'cat':
          return categoryLabel(selection.value, lang);
        case 'rok':
          return roundLabel(selection.value, lang);
        case 'recipient':
        case 'project':
          return selection.value;
        case 'compound':
          return selection.items.map((item) => selectedLabel(item, lang)).join(' · ');
        default:
          return '';
      }
    }

    function applySelection() {
      const selection = ui.selection;
      if (!selection) return;

      function applyOne(item) {
        const label = selectedLabel(item, state.lang);
        if (item.kind === 'year') {
          setSelectedYear(item.value);
          return;
        }
        if (['sizeBand', 'program', 'cat', 'rok', 'recipient', 'project'].includes(item.kind)) {
          addScope({ kind: item.kind, value: item.value, label });
        }
      }

      if (selection.kind === 'compound') selection.items.forEach(applyOne);
      else applyOne(selection);
      close();
      requestAnimationFrame(() => {
        const target = document.querySelector('.scope-chip:last-of-type, .year-pill.is-active, .list-header button');
        if (target && typeof target.focus === 'function') target.focus();
      });
    }

    function toggleGroup(key, items, active, onChange, lang) {
      return el('div', { class: 'analytics-toggle-group', role: 'group' }, items.map((item) => (
        el('button', {
          class: 'analytics-toggle' + (item.key === active ? ' is-active' : ''),
          type: 'button',
          'aria-pressed': item.key === active ? 'true' : 'false',
          dataset: { focusKey: key + '-' + item.key },
          onclick: () => {
            onChange(item.key);
            render(key + '-' + item.key);
          },
          text: item.label || t(item.labelKey, lang),
        })
      )));
    }

    function dataTable(headers, rows, caption) {
      return el('div', { class: 'analytics-table-scroll' }, [
        el('table', { class: 'analytics-data-table' }, [
          caption ? el('caption', { text: caption }) : null,
          el('thead', {}, [
            el('tr', {}, headers.map((header) => el('th', { scope: 'col', text: header }))),
          ]),
          el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell, index) => (
            index === 0
              ? el('th', { scope: 'row', text: cell })
              : el('td', { class: 'mono', text: cell })
          ))))),
        ]),
      ]);
    }

    function exactTable(headers, rows, lang, caption) {
      return el('details', { class: 'analytics-exact-table' }, [
        el('summary', { text: t('analytics.table.open', lang) }),
        dataTable(headers, rows, caption),
      ]);
    }

    function section(title, intro, body, className) {
      return el('section', { class: 'analytics-studio-section' + (className ? (' ' + className) : '') }, [
        el('header', { class: 'analytics-section-head' }, [
          el('h2', { text: title }),
          intro ? el('p', { text: intro }) : null,
        ]),
        body,
      ]);
    }

    function metricDelta(current, benchmark, kind, lang) {
      if (model.samePopulation) return '';
      if (current == null || benchmark == null) return '—';
      if (kind === 'share') return formatSignedPercent(current - benchmark, lang, 1);
      if (!benchmark) return '—';
      return formatSignedPercent((current - benchmark) / benchmark, lang, 1);
    }

    function metricRow(label, currentValue, benchmarkValue, deltaValue, isUnavailable) {
      const lang = state.lang;
      return el('div', { class: 'analytics-ledger-row' + (isUnavailable ? ' is-muted' : '') }, [
        el('div', { class: 'analytics-ledger-label', text: label }),
        el('div', {
          class: 'analytics-ledger-current mono',
          'data-label': t('analytics.context.current', lang),
          text: currentValue,
        }),
        el('div', {
          class: 'analytics-ledger-benchmark mono',
          'data-label': t('analytics.context.benchmark', lang),
          text: benchmarkValue,
        }),
        el('div', {
          class: 'analytics-ledger-delta mono',
          'data-label': t('analytics.metric.vs_benchmark', lang),
          text: deltaValue || '—',
        }),
      ]);
    }

    function metricLedger(rows, lang) {
      return el('div', { class: 'analytics-ledger' }, [
        el('div', { class: 'analytics-ledger-head kicker' }, [
          el('span', { text: '' }),
          el('span', { text: t('analytics.context.current', lang) }),
          el('span', { text: t('analytics.context.benchmark', lang) }),
          el('span', { text: t('analytics.metric.vs_benchmark', lang) }),
        ]),
        ...rows,
      ]);
    }

    function findingText(finding, lang) {
      const values = finding.values;
      switch (finding.key) {
        case 'scopeShare':
          return t('analytics.finding.scopeShare', lang, {
            amount: formatPercent(values.amountShare, lang, 1),
            rows: formatPercent(values.rowShare, lang, 1),
          });
        case 'medianRatio': {
          const key = values.ratio >= 1
            ? 'analytics.finding.medianRatio.up'
            : 'analytics.finding.medianRatio.down';
          return t(key, lang, {
            ratio: formatNumber(values.ratio, lang, 2),
            current: formatAmount(values.current, 'EUR', lang),
            benchmark: formatAmount(values.benchmark, 'EUR', lang),
          });
        }
        case 'repeatDelta':
          return t('analytics.finding.repeatDelta', lang, {
            direction: t(
              values.delta >= 0
                ? 'analytics.finding.direction.more'
                : 'analytics.finding.direction.less',
              lang,
            ),
            current: formatPercent(values.current, lang, 1),
            benchmark: formatPercent(values.benchmark, lang, 1),
          });
        case 'concentrationDelta':
          return t('analytics.finding.concentrationDelta', lang, {
            direction: t(
              values.delta >= 0
                ? 'analytics.finding.concentration.more'
                : 'analytics.finding.concentration.less',
              lang,
            ),
            current: formatPercent(values.current, lang, 1),
            benchmark: formatPercent(values.benchmark, lang, 1),
          });
        case 'programmeOverindex':
          return t('analytics.finding.programmeOverindex', lang, {
            programme: programmeLabel(values.key, lang),
            delta: formatNumber(values.delta * 100, lang, 1),
          });
        case 'latestChange':
          return t('analytics.finding.latestChange', lang, {
            year: values.year,
            previousYear: values.previousYear,
            percent: formatSignedPercent(values.percent, lang, 1),
          });
        case 'distributionSkew':
          return t('analytics.finding.distributionSkew', lang, {
            ratio: formatNumber(values.ratio, lang, 2),
          });
        case 'leadingProgramme':
          return t('analytics.finding.leadingProgramme', lang, {
            programme: programmeLabel(values.key, lang),
            share: formatPercent(values.share, lang, 1),
          });
        default:
          return '';
      }
    }

    function renderOverview(lang) {
      const current = model.current;
      const benchmark = model.benchmark;
      const currentGini = current.concentration.gini;
      const benchmarkGini = benchmark.concentration.gini;
      const ledger = metricLedger([
        metricRow(
          t('metric.total', lang),
          formatAmount(current.totalAmount, 'EUR', lang),
          formatAmount(benchmark.totalAmount, 'EUR', lang),
          metricDelta(current.totalAmount, benchmark.totalAmount, 'ratio', lang),
        ),
        metricRow(
          t('metric.decisions', lang),
          formatNumber(current.rowCount, lang),
          formatNumber(benchmark.rowCount, lang),
          metricDelta(current.rowCount, benchmark.rowCount, 'ratio', lang),
        ),
        metricRow(
          t('analytics.projects', lang),
          formatNumber(current.projectCount, lang),
          formatNumber(benchmark.projectCount, lang),
          metricDelta(current.projectCount, benchmark.projectCount, 'ratio', lang),
        ),
        metricRow(
          t('metric.median', lang),
          formatAmount(current.medianAmount, 'EUR', lang),
          formatAmount(benchmark.medianAmount, 'EUR', lang),
          metricDelta(current.medianAmount, benchmark.medianAmount, 'ratio', lang),
        ),
        metricRow(
          t('analytics.metric.repeat', lang),
          formatPercent(current.lifecycles.repeatFundedShare, lang, 1),
          formatPercent(benchmark.lifecycles.repeatFundedShare, lang, 1),
          metricDelta(
            current.lifecycles.repeatFundedShare,
            benchmark.lifecycles.repeatFundedShare,
            'share',
            lang,
          ),
        ),
        metricRow(
          t('analytics.metric.gini', lang),
          currentGini == null ? t('analytics.metric.not_available', lang) : formatPercent(currentGini, lang, 1),
          benchmarkGini == null ? t('analytics.metric.not_available', lang) : formatPercent(benchmarkGini, lang, 1),
          currentGini == null || benchmarkGini == null
            ? '—'
            : metricDelta(currentGini, benchmarkGini, 'share', lang),
          currentGini == null,
        ),
      ], lang);

      const findings = model.findings.length
        ? model.findings.map((finding, index) => el('li', { class: 'analytics-finding' }, [
            el('span', { class: 'analytics-finding-number mono', text: String(index + 1).padStart(2, '0') }),
            el('p', { text: findingText(finding, lang) }),
          ]))
        : [el('li', { class: 'analytics-finding' }, [
            el('span', { class: 'analytics-finding-number mono', text: '01' }),
            el('p', { text: t('analytics.overview.no_difference', lang) }),
          ])];

      return el('div', { class: 'analytics-chapter analytics-chapter-overview' }, [
        section(
          t('analytics.overview', lang),
          model.samePopulation
            ? t('analytics.context.global', lang)
            : t('analytics.context.same_period', lang),
          ledger,
          'analytics-overview-ledger',
        ),
        section(
          t(model.samePopulation ? 'analytics.overview.findings' : 'analytics.overview.diagnosis', lang),
          null,
          el('ol', { class: 'analytics-findings' }, findings),
          'analytics-diagnosis',
        ),
        current.flags.currentYearPartial
          ? el('p', {
              class: 'analytics-inline-note',
              text: t('analytics.time.partial', lang, { year: current.flags.currentYear }),
            })
          : null,
      ]);
    }

    function seriesValue(item, metric) {
      if (!item) return 0;
      if (metric === 'count') return item.count || 0;
      if (metric === 'median') return item.median || 0;
      return item.amount || 0;
    }

    function seriesValueText(value, metric, lang) {
      return metric === 'count'
        ? formatNumber(value, lang)
        : formatAmount(value, 'EUR', lang);
    }

    function lineChart(currentSeries, benchmarkSeries, metric, lang) {
      const width = 760;
      const height = 286;
      const pad = { top: 28, right: 24, bottom: 42, left: 24 };
      const years = [...new Set([
        ...currentSeries.map((item) => item.year),
        ...benchmarkSeries.map((item) => item.year),
      ])].sort((a, b) => a - b);
      const currentByYear = new Map(currentSeries.map((item) => [item.year, item]));
      const benchmarkByYear = new Map(benchmarkSeries.map((item) => [item.year, item]));
      const allValues = years.flatMap((year) => [
        seriesValue(currentByYear.get(year), metric),
        seriesValue(benchmarkByYear.get(year), metric),
      ]);
      const max = Math.max(1, ...allValues);
      const yearIndex = new Map(years.map((year, index) => [year, index]));
      const x = (year) => (
        pad.left
        + (years.length <= 1 ? 0 : yearIndex.get(year) / (years.length - 1))
        * (width - pad.left - pad.right)
      );
      const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
      const pathFor = (map) => years
        .filter((year) => map.has(year))
        .map((year, index) => `${index === 0 ? 'M' : 'L'} ${x(year).toFixed(1)} ${y(seriesValue(map.get(year), metric)).toFixed(1)}`)
        .join(' ');

      const readout = el('div', {
        class: 'analytics-chart-readout mono',
        text: t('analytics.time.note', lang),
        'aria-live': 'polite',
      });
      const svg = svgel('svg', {
        class: 'analytics-line-chart',
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': t('analytics.time.title', lang),
      });

      [0, 0.5, 1].forEach((fraction) => {
        const lineY = pad.top + fraction * (height - pad.top - pad.bottom);
        svg.appendChild(svgel('line', {
          class: 'analytics-chart-gridline',
          x1: pad.left,
          y1: lineY,
          x2: width - pad.right,
          y2: lineY,
        }));
      });
      svg.appendChild(svgel('path', {
        class: 'analytics-line analytics-line-benchmark',
        d: pathFor(benchmarkByYear),
      }));
      svg.appendChild(svgel('path', {
        class: 'analytics-line analytics-line-current',
        d: pathFor(currentByYear),
      }));

      years.forEach((year, index) => {
        const currentItem = currentByYear.get(year);
        if (currentItem) {
          const value = seriesValue(currentItem, metric);
          const label = `${year} · ${seriesValueText(value, metric, lang)} · ${formatNumber(currentItem.count, lang)} ${t('metric.count', lang)}`;
          const selection = { kind: 'year', value: year, label: String(year) };
          const group = svgel('g', {
            class: 'analytics-chart-mark' + (isSelected(selection) ? ' is-selected' : ''),
            role: 'button',
            tabindex: '0',
            'aria-label': label,
            'aria-pressed': isSelected(selection) ? 'true' : 'false',
            'data-focus-key': `time-year-${year}`,
          }, [
            svgel('circle', {
              class: 'analytics-chart-mark-target',
              cx: x(year),
              cy: y(value),
              r: 12,
            }),
            svgel('circle', {
              class: 'analytics-chart-mark-dot',
              cx: x(year),
              cy: y(value),
              r: 4,
            }),
          ]);
          group.addEventListener('mouseenter', () => { readout.textContent = label; });
          group.addEventListener('mouseleave', () => { readout.textContent = t('analytics.time.note', lang); });
          group.addEventListener('focus', () => { readout.textContent = label; });
          group.addEventListener('click', () => select(selection, `time-year-${year}`));
          group.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            select(selection, `time-year-${year}`);
          });
          svg.appendChild(group);
        }

        const labelEvery = Math.max(1, Math.ceil(years.length / 6));
        if (index === 0 || index === years.length - 1 || index % labelEvery === 0) {
          svg.appendChild(svgel('text', {
            class: 'analytics-axis-label',
            x: x(year),
            y: height - 12,
            'text-anchor': index === 0 ? 'start' : index === years.length - 1 ? 'end' : 'middle',
            text: String(year),
          }));
        }
      });

      return el('div', { class: 'analytics-chart' }, [
        el('div', { class: 'analytics-chart-legend mono' }, [
          el('span', { class: 'analytics-legend-current', text: t('analytics.series.current', lang) }),
          el('span', { class: 'analytics-legend-benchmark', text: t('analytics.series.benchmark', lang) }),
        ]),
        readout,
        svg,
      ]);
    }

    function renderTime(lang) {
      const current = model.current;
      const benchmark = model.benchmark;
      const controls = toggleGroup('time-metric', [
        { key: 'amount', labelKey: 'analytics.control.amount' },
        { key: 'count', labelKey: 'analytics.control.count' },
        { key: 'median', labelKey: 'analytics.control.median' },
      ], ui.timeMetric, (value) => { ui.timeMetric = value; }, lang);
      const chart = lineChart(current.time.series, benchmark.time.series, ui.timeMetric, lang);
      const currentByYear = new Map(current.time.series.map((item) => [item.year, item]));
      const rows = benchmark.time.series.map((item) => {
        const currentItem = currentByYear.get(item.year);
        return [
          String(item.year),
          currentItem ? seriesValueText(seriesValue(currentItem, ui.timeMetric), ui.timeMetric, lang) : '—',
          seriesValueText(seriesValue(item, ui.timeMetric), ui.timeMetric, lang),
        ];
      });
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.time.title', lang),
          t('analytics.time.note', lang),
          el('div', {}, [
            controls,
            chart,
            exactTable(
              [
                t('facet.year', lang),
                t('analytics.series.current', lang),
                t('analytics.series.benchmark', lang),
              ],
              rows,
              lang,
              t('analytics.time.title', lang),
            ),
          ]),
        ),
        current.flags.currentYearPartial
          ? el('p', {
              class: 'analytics-inline-note',
              text: t('analytics.time.partial', lang, { year: current.flags.currentYear }),
            })
          : null,
      ]);
    }

    function histogramChart(current, benchmark, lang) {
      const currentMax = Math.max(1, ...current.distribution.histogram.map((item) => item.count));
      const benchmarkMax = Math.max(1, ...benchmark.distribution.histogram.map((item) => item.count));
      return el('div', { class: 'analytics-histogram', role: 'list' }, current.distribution.histogram.map((item, index) => {
        const baseline = benchmark.distribution.histogram[index] || { count: 0, share: 0 };
        const label = bandLabel(item.min, item.max);
        const selection = { kind: 'sizeBand', value: [item.min, item.max], label };
        return el('button', {
          class: 'analytics-histogram-bin' + (isSelected(selection) ? ' is-selected' : ''),
          type: 'button',
          role: 'listitem',
          'aria-pressed': isSelected(selection) ? 'true' : 'false',
          'aria-label': `${label} · ${formatNumber(item.count, lang)} ${t('metric.count', lang)} · ${formatPercent(item.share, lang, 1)}`,
          dataset: { focusKey: `distribution-${index}` },
          onclick: () => select(selection, `distribution-${index}`),
        }, [
          el('span', { class: 'analytics-histogram-bars', 'aria-hidden': 'true' }, [
            el('span', {
              class: 'analytics-histogram-benchmark',
              style: `height:${Math.max(1, baseline.count / benchmarkMax * 100)}%`,
            }),
            el('span', {
              class: 'analytics-histogram-current',
              style: `height:${Math.max(1, item.count / currentMax * 100)}%`,
            }),
          ]),
          el('span', { class: 'analytics-histogram-label mono', text: label }),
          el('span', { class: 'analytics-histogram-value mono', text: formatNumber(item.count, lang) }),
        ]);
      }));
    }

    function renderDistribution(lang) {
      const current = model.current;
      const benchmark = model.benchmark;
      const percentileRows = [
        ['analytics.distribution.p25', 'p25Amount'],
        ['analytics.distribution.p50', 'medianAmount'],
        ['analytics.distribution.p75', 'p75Amount'],
        ['analytics.distribution.p90', 'p90Amount'],
        ['analytics.distribution.p95', 'p95Amount'],
        ['analytics.distribution.p99', 'p99Amount'],
      ].map(([labelKey, valueKey]) => metricRow(
        t(labelKey, lang),
        formatAmount(current[valueKey], 'EUR', lang),
        formatAmount(benchmark[valueKey], 'EUR', lang),
        metricDelta(current[valueKey], benchmark[valueKey], 'ratio', lang),
      ));
      const tableRows = current.distribution.histogram.map((item, index) => {
        const baseline = benchmark.distribution.histogram[index];
        return [
          bandLabel(item.min, item.max),
          formatNumber(item.count, lang),
          formatPercent(item.share, lang, 1),
          formatNumber(baseline ? baseline.count : 0, lang),
        ];
      });
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.distribution.title', lang),
          t('analytics.distribution.note', lang),
          el('div', {}, [
            el('div', { class: 'analytics-chart-legend mono' }, [
              el('span', { class: 'analytics-legend-current', text: t('analytics.series.current', lang) }),
              el('span', { class: 'analytics-legend-benchmark', text: t('analytics.series.benchmark', lang) }),
            ]),
            histogramChart(current, benchmark, lang),
            exactTable(
              [
                t('scope.kind.sizeBand', lang),
                t('analytics.series.current', lang),
                '%',
                t('analytics.series.benchmark', lang),
              ],
              tableRows,
              lang,
              t('analytics.distribution.title', lang),
            ),
          ]),
        ),
        section(
          t('analytics.distribution.percentiles', lang),
          null,
          metricLedger(percentileRows, lang),
        ),
      ]);
    }

    function mixItems(snapshot) {
      return snapshot.mix[ui.mixDimension] || [];
    }

    function mixSelectionKind() {
      if (ui.mixDimension === 'categories') return 'cat';
      if (ui.mixDimension === 'rounds') return 'rok';
      return 'program';
    }

    function mixLabel(key, lang) {
      if (ui.mixDimension === 'categories') return categoryLabel(key, lang);
      if (ui.mixDimension === 'rounds') return roundLabel(key, lang);
      return programmeLabel(key, lang);
    }

    function mixMetricValue(item) {
      if (!item) return 0;
      if (ui.mixMetric === 'count') return item.count;
      if (ui.mixMetric === 'median') return item.median;
      return item.amount;
    }

    function mixMetricText(item, snapshot, lang) {
      if (!item) return '—';
      if (ui.mixMetric === 'count') {
        const share = snapshot.rowCount ? item.count / snapshot.rowCount : 0;
        return `${formatNumber(item.count, lang)} · ${formatPercent(share, lang, 1)}`;
      }
      if (ui.mixMetric === 'median') return formatAmount(item.median, 'EUR', lang);
      return `${formatAmount(item.amount, 'EUR', lang)} · ${formatPercent(item.share, lang, 1)}`;
    }

    function mixBars(current, benchmark, lang) {
      const currentItems = mixItems(current).slice(0, 12);
      const baselineMap = new Map(mixItems(benchmark).map((item) => [item.key, item]));
      const max = Math.max(
        1,
        ...currentItems.map(mixMetricValue),
        ...currentItems.map((item) => mixMetricValue(baselineMap.get(item.key))),
      );
      return el('div', { class: 'analytics-ranking' }, currentItems.map((item, index) => {
        const baseline = baselineMap.get(item.key);
        const selection = {
          kind: mixSelectionKind(),
          value: item.key,
          label: mixLabel(item.key, lang),
        };
        const focusKey = `mix-${ui.mixDimension}-${item.key}`;
        return el('button', {
          class: 'analytics-ranking-row' + (isSelected(selection) ? ' is-selected' : ''),
          type: 'button',
          'aria-pressed': isSelected(selection) ? 'true' : 'false',
          dataset: { focusKey },
          onclick: () => select(selection, focusKey),
        }, [
          el('span', { class: 'analytics-rank mono', text: String(index + 1).padStart(2, '0') }),
          el('span', { class: 'analytics-ranking-main' }, [
            el('span', { class: 'analytics-ranking-label', text: mixLabel(item.key, lang) }),
            el('span', { class: 'analytics-ranking-track', 'aria-hidden': 'true' }, [
              el('span', {
                class: 'analytics-ranking-benchmark',
                style: `width:${Math.max(1, mixMetricValue(baseline) / max * 100)}%`,
              }),
              el('span', {
                class: 'analytics-ranking-current',
                style: `width:${Math.max(1, mixMetricValue(item) / max * 100)}%`,
              }),
            ]),
          ]),
          el('span', { class: 'analytics-ranking-value mono', text: mixMetricText(item, current, lang) }),
        ]);
      }));
    }

    function heatmap(current, lang) {
      const topProgrammes = current.mix.programmes.slice(0, 7);
      const years = current.time.series.map((item) => item.year);
      const values = new Map();
      let max = 1;
      current.time.series.forEach((yearItem) => {
        yearItem.programmes.forEach((programme) => {
          const key = `${yearItem.year}|${programme.key}`;
          values.set(key, programme.amount);
          max = Math.max(max, programme.amount);
        });
      });
      const grid = el('div', {
        class: 'analytics-heatmap',
        style: `--analytics-heatmap-columns:${Math.max(1, years.length)}`,
      });
      grid.appendChild(el('div', { class: 'analytics-heatmap-corner' }));
      years.forEach((year) => grid.appendChild(el('div', {
        class: 'analytics-heatmap-year mono',
        text: String(year),
      })));
      topProgrammes.forEach((programme) => {
        grid.appendChild(el('div', {
          class: 'analytics-heatmap-label',
          text: programmeLabel(programme.key, lang),
        }));
        years.forEach((year) => {
          const amount = values.get(`${year}|${programme.key}`) || 0;
          const selection = {
            kind: 'compound',
            items: [
              { kind: 'year', value: year, label: String(year) },
              { kind: 'program', value: programme.key, label: programmeLabel(programme.key, lang) },
            ],
            label: `${year} · ${programmeLabel(programme.key, lang)}`,
          };
          const focusKey = `heat-${year}-${programme.key}`;
          grid.appendChild(el('button', {
            class: 'analytics-heatmap-cell' + (isSelected(selection) ? ' is-selected' : ''),
            type: 'button',
            style: `--heat:${Math.max(0, amount / max).toFixed(3)}`,
            title: `${year} · ${programmeLabel(programme.key, lang)} · ${formatAmount(amount, 'EUR', lang)}`,
            'aria-label': `${year} · ${programmeLabel(programme.key, lang)} · ${formatAmount(amount, 'EUR', lang)}`,
            'aria-pressed': isSelected(selection) ? 'true' : 'false',
            dataset: { focusKey },
            onclick: () => select(selection, focusKey),
          }, [
            el('span', { class: 'sr-only', text: formatAmount(amount, 'EUR', lang) }),
          ]));
        });
      });
      return grid;
    }

    function renderMix(lang) {
      const current = model.current;
      const benchmark = model.benchmark;
      const dimensionControls = toggleGroup('mix-dimension', [
        { key: 'programmes', labelKey: 'analytics.control.programmes' },
        { key: 'categories', labelKey: 'analytics.control.categories' },
        { key: 'rounds', labelKey: 'analytics.control.rounds' },
      ], ui.mixDimension, (value) => { ui.mixDimension = value; }, lang);
      const metricControls = toggleGroup('mix-metric', [
        { key: 'amount', labelKey: 'analytics.control.amount' },
        { key: 'count', labelKey: 'analytics.control.count' },
        { key: 'median', labelKey: 'analytics.control.median' },
      ], ui.mixMetric, (value) => { ui.mixMetric = value; }, lang);
      const currentItems = mixItems(current);
      const baselineMap = new Map(mixItems(benchmark).map((item) => [item.key, item]));
      const tableRows = currentItems.map((item) => [
        mixLabel(item.key, lang),
        mixMetricText(item, current, lang),
        mixMetricText(baselineMap.get(item.key), benchmark, lang),
      ]);
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.mix.title', lang),
          null,
          el('div', {}, [
            el('div', { class: 'analytics-control-row' }, [dimensionControls, metricControls]),
            mixBars(current, benchmark, lang),
            exactTable(
              [
                ui.mixDimension === 'programmes'
                  ? t('facet.program', lang)
                  : ui.mixDimension === 'categories'
                    ? t('facet.cat', lang)
                    : t('facet.rok', lang),
                t('analytics.series.current', lang),
                t('analytics.series.benchmark', lang),
              ],
              tableRows,
              lang,
              t('analytics.mix.title', lang),
            ),
          ]),
        ),
        ui.mixDimension === 'programmes'
          ? section(
              t('analytics.mix.heatmap', lang),
              null,
              el('div', { class: 'analytics-heatmap-scroll' }, [heatmap(current, lang)]),
            )
          : null,
      ]);
    }

    function lorenzChart(concentration, lang) {
      const width = 620;
      const height = 320;
      const pad = 32;
      const point = (item) => ({
        x: pad + item.populationShare * (width - pad * 2),
        y: height - pad - item.amountShare * (height - pad * 2),
      });
      const path = concentration.lorenz
        .map((item, index) => {
          const p = point(item);
          return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        })
        .join(' ');
      return el('div', { class: 'analytics-lorenz-wrap' }, [
        svgel('svg', {
          class: 'analytics-lorenz',
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label': t('analytics.concentration.lorenz', lang),
        }, [
          svgel('line', {
            class: 'analytics-lorenz-equality',
            x1: pad,
            y1: height - pad,
            x2: width - pad,
            y2: pad,
          }),
          svgel('path', { class: 'analytics-lorenz-line', d: path }),
          svgel('text', {
            class: 'analytics-axis-label',
            x: pad,
            y: height - 10,
            'text-anchor': 'start',
            text: '0%',
          }),
          svgel('text', {
            class: 'analytics-axis-label',
            x: width - pad,
            y: height - 10,
            'text-anchor': 'end',
            text: '100%',
          }),
        ]),
      ]);
    }

    function recipientRanking(concentration, lang) {
      const max = Math.max(1, ...concentration.entries.slice(0, 15).map((entry) => entry.amount));
      return el('div', { class: 'analytics-ranking analytics-recipient-ranking' },
        concentration.entries.slice(0, 15).map((entry, index) => {
          const selection = { kind: 'recipient', value: entry.key, label: entry.key };
          const focusKey = `recipient-${index}`;
          return el('button', {
            class: 'analytics-ranking-row' + (isSelected(selection) ? ' is-selected' : ''),
            type: 'button',
            'aria-pressed': isSelected(selection) ? 'true' : 'false',
            dataset: { focusKey },
            onclick: () => select(selection, focusKey),
          }, [
            el('span', { class: 'analytics-rank mono', text: String(index + 1).padStart(2, '0') }),
            el('span', { class: 'analytics-ranking-main' }, [
              el('span', { class: 'analytics-ranking-label', text: entry.key }),
              el('span', { class: 'analytics-ranking-track', 'aria-hidden': 'true' }, [
                el('span', {
                  class: 'analytics-ranking-current',
                  style: `width:${Math.max(1, entry.amount / max * 100)}%`,
                }),
              ]),
            ]),
            el('span', {
              class: 'analytics-ranking-value mono',
              text: `${formatAmount(entry.amount, 'EUR', lang)} · ${formatPercent(entry.amount / concentration.denominator, lang, 1)}`,
            }),
          ]);
        }));
    }

    function renderConcentration(lang) {
      const concentration = model.current.concentration;
      const coverage = el('div', { class: 'analytics-coverage-note' }, [
        el('strong', {
          text: t('analytics.concentration.coverage', lang, {
            amount: formatPercent(concentration.amountCoverage, lang, 1),
            rows: formatPercent(concentration.rowCoverage, lang, 1),
          }),
        }),
        el('p', { text: t('analytics.concentration.definition', lang) }),
      ]);
      if (!concentration.eligible) {
        return el('div', { class: 'analytics-chapter' }, [
          section(
            t('analytics.concentration.title', lang),
            null,
            el('div', {}, [
              coverage,
              el('div', { class: 'analytics-empty-state' }, [
                fa('fa-solid fa-scale-balanced'),
                el('h3', { text: t('analytics.metric.not_available', lang) }),
                el('p', { text: t('analytics.concentration.unavailable', lang) }),
              ]),
            ]),
          ),
        ]);
      }

      const shares = concentration.topPercentShares.map((item) => [
        `Top ${formatNumber(item.percent * 100, lang)}%`,
        formatNumber(item.count, lang),
        formatPercent(item.share, lang, 1),
      ]);
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.concentration.title', lang),
          null,
          el('div', {}, [
            coverage,
            el('div', { class: 'analytics-concentration-summary' }, [
              el('div', {}, [
                el('span', { class: 'kicker', text: t('analytics.metric.gini', lang) }),
                el('strong', { class: 'analytics-large-value mono', text: formatPercent(concentration.gini, lang, 1) }),
              ]),
              el('p', {
                text: t('analytics.concentration.pareto', lang, {
                  n: formatNumber(concentration.pareto50.count, lang),
                }),
              }),
            ]),
            el('div', { class: 'analytics-two-column' }, [
              el('div', {}, [
                el('h3', { text: t('analytics.concentration.lorenz', lang) }),
                lorenzChart(concentration, lang),
              ]),
              el('div', {}, [
                el('h3', { text: t('analytics.concentration.top_shares', lang) }),
                dataTable(
                  ['%', t('analytics.concentration.recipients', lang), t('metric.total', lang)],
                  shares,
                  t('analytics.concentration.top_shares', lang),
                ),
              ]),
            ]),
          ]),
        ),
        section(
          t('analytics.concentration.top_recipients', lang),
          null,
          el('div', {}, [
            recipientRanking(concentration, lang),
            exactTable(
              [
                '#',
                t('scope.kind.recipient', lang),
                t('metric.total', lang),
                t('metric.decisions', lang),
              ],
              concentration.entries.map((entry, index) => [
                String(index + 1),
                entry.key,
                formatAmount(entry.amount, 'EUR', lang),
                formatNumber(entry.count, lang),
              ]),
              lang,
              t('analytics.concentration.top_recipients', lang),
            ),
          ]),
        ),
      ]);
    }

    function lifecycleMetric(label, current, benchmark, lang, formatter) {
      const formatValue = formatter || ((value) => formatPercent(value, lang, 1));
      return metricRow(
        label,
        formatValue(current),
        formatValue(benchmark),
        metricDelta(current, benchmark, formatter ? 'ratio' : 'share', lang),
      );
    }

    function transitionList(lang) {
      const lifecycles = model.current.lifecycles;
      const projectsByKey = new Map(lifecycles.projects.map((project) => [project.key, project]));
      if (!lifecycles.transitions.length) {
        return el('div', { class: 'analytics-empty-state is-compact' }, [
          el('p', { text: t('analytics.lifecycle.note', lang) }),
        ]);
      }
      return el('div', { class: 'analytics-transition-list' }, lifecycles.transitions.map((transition) => {
        const open = ui.transitionKey === transition.key;
        return el('article', { class: 'analytics-transition' + (open ? ' is-open' : '') }, [
          el('button', {
            class: 'analytics-transition-head',
            type: 'button',
            'aria-expanded': open ? 'true' : 'false',
            dataset: { focusKey: `transition-${transition.key}` },
            onclick: () => {
              ui.transitionKey = open ? null : transition.key;
              render(`transition-${transition.key}`);
            },
          }, [
            el('span', { class: 'analytics-transition-path' }, [
              el('strong', { text: stageLabel(transition.from, lang) }),
              fa('fa-solid fa-arrow-right'),
              el('strong', { text: stageLabel(transition.to, lang) }),
            ]),
            el('span', {
              class: 'mono',
              text: t('analytics.lifecycle.projects', lang, { n: formatNumber(transition.count, lang) }),
            }),
          ]),
          open ? el('div', { class: 'analytics-transition-projects' }, [
            el('p', { text: t('analytics.selection.project_hint', lang) }),
            ...transition.projectKeys.slice(0, 30).map((key, index) => {
              const project = projectsByKey.get(key);
              const selection = {
                kind: 'project',
                value: key,
                label: project ? project.title : key,
              };
              const focusKey = `transition-project-${index}`;
              return el('button', {
                class: 'analytics-project-link',
                type: 'button',
                dataset: { focusKey },
                onclick: () => select(selection, focusKey),
              }, [
                el('span', { text: project ? project.title : key }),
                project
                  ? el('span', {
                      class: 'mono',
                      text: `${formatAmount(project.amount, 'EUR', lang)} · ${formatNumber(project.decisionCount, lang)} ${t('metric.count', lang)}`,
                    })
                  : null,
              ]);
            }),
          ]) : null,
        ]);
      }));
    }

    function renderLifecycles(lang) {
      const current = model.current.lifecycles;
      const benchmark = model.benchmark.lifecycles;
      const ledger = metricLedger([
        lifecycleMetric(
          t('analytics.metric.repeat', lang),
          current.repeatFundedShare,
          benchmark.repeatFundedShare,
          lang,
        ),
        lifecycleMetric(
          t('analytics.lifecycle.multi_programme', lang),
          current.multiProgrammeShare,
          benchmark.multiProgrammeShare,
          lang,
        ),
        lifecycleMetric(
          t('analytics.lifecycle.duration', lang),
          current.medianDurationYears,
          benchmark.medianDurationYears,
          lang,
          (value) => t('analytics.lifecycle.years', lang, { n: formatNumber(value, lang, 1) }),
        ),
        lifecycleMetric(
          t('metric.medianRounds', lang),
          current.medianDecisions,
          benchmark.medianDecisions,
          lang,
          (value) => formatNumber(value, lang, 1),
        ),
      ], lang);
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.lifecycle.title', lang),
          t('analytics.lifecycle.note', lang),
          ledger,
        ),
        section(
          t('analytics.lifecycle.transitions', lang),
          null,
          transitionList(lang),
        ),
      ]);
    }

    function sanityInfo() {
      const report = sanityReport();
      const directOverall = asObject(asObject(asObject(report).results).direct_overall);
      const counts = asObject(directOverall.group_status_counts_dedup);
      return {
        pass: toFiniteInt(counts.PASS) || 0,
        warn: toFiniteInt(counts.WARN) || 0,
        fail: toFiniteInt(counts.FAIL) || 0,
      };
    }

    function coverageRows(lang) {
      const current = model.current;
      const labels = {
        recipient: lang === 'hr' ? 'Korisnik' : 'Recipient',
        applicant: lang === 'hr' ? 'Prijavitelj' : 'Applicant',
        producer: lang === 'hr' ? 'Producent' : 'Producer',
        director: lang === 'hr' ? 'Redatelj' : 'Director',
        writer: lang === 'hr' ? 'Scenarist' : 'Writer',
        category: lang === 'hr' ? 'Kategorija' : 'Category',
        round: lang === 'hr' ? 'Rok' : 'Round',
      };
      return Object.keys(labels).map((key) => [
        labels[key],
        formatPercent(current.quality[key].rowShare, lang, 1),
        formatPercent(current.quality[key].amountShare, lang, 1),
      ]);
    }

    function renderMethodology(lang) {
      const registry = data();
      const report = sanityReport();
      const sourceFound = registry.docs.filter((doc) => doc && doc.source_url).length;
      const audit = sanityInfo();
      return el('div', { class: 'analytics-chapter' }, [
        section(
          t('analytics.data.title', lang),
          null,
          dataTable(
            [
              t('analytics.data.field', lang),
              t('analytics.data.rows', lang),
              t('analytics.data.amount', lang),
            ],
            coverageRows(lang),
            t('analytics.data.title', lang),
          ),
        ),
        section(
          t('analytics.data.sources', lang),
          null,
          el('ul', { class: 'analytics-method-list' }, [
            el('li', {
              text: t('analytics.data.source_urls', lang, {
                found: formatNumber(sourceFound, lang),
                total: formatNumber(registry.docs.length, lang),
              }),
            }),
            report ? el('li', {
              text: t('analytics.data.audit', lang, {
                pass: formatNumber(audit.pass, lang),
                warn: formatNumber(audit.warn, lang),
                fail: formatNumber(audit.fail, lang),
              }),
            }) : null,
            el('li', {
              text: t('analytics.data.currency', lang, { rate: registry.hrk_to_eur || HRK_TO_EUR }),
            }),
          ]),
        ),
        section(
          t('analytics.data.formulas', lang),
          null,
          el('div', { class: 'analytics-method-details' }, [
            el('details', {}, [
              el('summary', { text: t('metric.median', lang) }),
              el('p', { text: t('analytics.data.formula.median', lang) }),
            ]),
            el('details', {}, [
              el('summary', { text: t('analytics.metric.gini', lang) }),
              el('p', { text: t('analytics.data.formula.gini', lang) }),
              el('pre', { text: t('formula.giniProducers', lang) }),
            ]),
            el('details', {}, [
              el('summary', { text: t('analytics.chapter.lifecycles', lang) }),
              el('p', { text: t('analytics.data.formula.lifecycle', lang) }),
            ]),
          ]),
        ),
        section(
          t('analytics.data.limitations', lang),
          null,
          el('ul', { class: 'analytics-method-list' }, [
            el('li', { text: t('analytics.data.no_acceptance', lang) }),
            el('li', { text: t('analytics.data.creator_sparse', lang) }),
            model.current.flags.currentYearPartial
              ? el('li', {
                  text: t('analytics.time.partial', lang, { year: model.current.flags.currentYear }),
                })
              : null,
          ]),
        ),
      ]);
    }

    function renderChapter(lang) {
      if (!model) {
        return el('div', { class: 'analytics-loading', role: 'status' }, [
          el('span', { class: 'analytics-loading-rule' }),
          el('p', { class: 'mono', text: t('analytics.loading', lang) }),
        ]);
      }
      if (model.current.rowCount === 0) {
        return el('div', { class: 'analytics-empty-state analytics-empty-primary' }, [
          fa('fa-regular fa-folder-open'),
          el('h2', { text: t('analytics.empty.title', lang) }),
          el('p', { text: t('analytics.empty.body', lang) }),
          el('button', { class: 'btn mono', type: 'button', onclick: close }, [
            fa('fa-solid fa-xmark', 'icon-left'),
            t('modal.close', lang),
          ]),
        ]);
      }
      switch (ui.chapter) {
        case 'time': return renderTime(lang);
        case 'distribution': return renderDistribution(lang);
        case 'mix': return renderMix(lang);
        case 'concentration': return renderConcentration(lang);
        case 'lifecycles': return renderLifecycles(lang);
        case 'methodology': return renderMethodology(lang);
        default: return renderOverview(lang);
      }
    }

    function renderSelectionTray(lang) {
      if (!ui.selection) return null;
      return el('aside', { class: 'analytics-selection-tray', 'aria-live': 'polite' }, [
        el('div', { class: 'analytics-selection-copy' }, [
          el('span', { class: 'kicker', text: t('analytics.selection.label', lang) }),
          el('strong', { text: selectedLabel(ui.selection, lang) }),
        ]),
        el('div', { class: 'analytics-selection-actions' }, [
          el('button', {
            class: 'btn mono',
            type: 'button',
            onclick: () => {
              ui.selection = null;
              render();
            },
          }, [
            fa('fa-solid fa-xmark', 'icon-left'),
            t('analytics.selection.clear', lang),
          ]),
          el('button', {
            class: 'btn mono analytics-selection-apply',
            type: 'button',
            onclick: applySelection,
          }, [
            fa('fa-solid fa-arrow-down', 'icon-left'),
            t('analytics.selection.show', lang),
          ]),
        ]),
      ]);
    }

    function render(focusKey) {
      if (!dialog) return;
      const lang = state.lang;
      const head = el('header', { class: 'analytics-studio-head' }, [
        el('div', { class: 'analytics-studio-title-group' }, [
          el('h1', { id: 'analytics-studio-title', text: t('analytics.title', lang) }),
          el('p', { class: 'analytics-studio-subtitle mono', text: t('analytics.studio.subtitle', lang) }),
        ]),
        el('button', {
          class: 'btn mono analytics-studio-close',
          type: 'button',
          onclick: close,
        }, [
          fa('fa-solid fa-xmark', 'icon-left'),
          t('modal.close', lang),
        ]),
      ]);

      const context = el('div', { class: 'analytics-context-bar' }, [
        el('div', { class: 'analytics-context-current' }, [
          el('span', { class: 'kicker', text: t('analytics.context.current', lang) }),
          el('strong', { text: contextLabel(lang) }),
          model ? el('span', {
            class: 'mono',
            text: `${formatNumber(model.current.rowCount, lang)} ${t('metric.count', lang)}`,
          }) : null,
        ]),
        el('div', { class: 'analytics-context-benchmark' }, [
          el('span', { class: 'kicker', text: t('analytics.context.benchmark', lang) }),
          el('strong', { text: t('analytics.context.same_period', lang) }),
          el('span', { class: 'mono', text: periodLabel(lang) }),
        ]),
      ]);

      const navigation = el('nav', {
        class: 'analytics-chapter-nav',
        'aria-label': t('analytics.title', lang),
      }, CHAPTERS.map((chapter, index) => el('button', {
        class: 'analytics-chapter-link' + (ui.chapter === chapter ? ' is-active' : ''),
        type: 'button',
        'aria-current': ui.chapter === chapter ? 'page' : null,
        dataset: { focusKey: `chapter-${chapter}` },
        onclick: () => {
          ui.chapter = chapter;
          ui.selection = null;
          render(`chapter-${chapter}`);
        },
      }, [
        el('span', { class: 'analytics-chapter-index mono', text: String(index + 1).padStart(2, '0') }),
        el('span', { text: t('analytics.chapter.' + chapter, lang) }),
      ])));

      const content = el('main', {
        class: 'analytics-studio-content',
        id: 'analytics-studio-content',
        tabindex: '-1',
      }, [renderChapter(lang)]);
      const body = el('div', { class: 'analytics-studio-body' }, [navigation, content]);
      const tray = renderSelectionTray(lang);
      dialog.replaceChildren(head, context, body, ...(tray ? [tray] : []));

      if (focusKey) {
        requestAnimationFrame(() => {
          if (!dialog) return;
          const target = [...dialog.querySelectorAll('[data-focus-key]')]
            .find((node) => node.dataset.focusKey === focusKey);
          if (target && typeof target.focus === 'function') target.focus();
        });
      }
    }

    function openDialog() {
      if (dialog) return;
      opener = document.activeElement;
      ui.chapter = 'overview';
      ui.selection = null;
      ui.transitionKey = null;
      dialog = el('dialog', {
        class: 'analytics-studio',
        'aria-labelledby': 'analytics-studio-title',
      });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      render();
      computationTimer = setTimeout(() => {
        computationTimer = null;
        if (!dialog || !state.showAnalytics) return;
        try {
          model = computeModel();
          render();
          const content = dialog.querySelector('#analytics-studio-content');
          if (content) content.focus({ preventScroll: true });
        } catch (error) {
          console.error('Failed to build analytics studio', error);
          model = {
            current: { rowCount: 0 },
            benchmark: { rowCount: 0 },
            findings: [],
            samePopulation: false,
          };
          render();
        }
      }, 0);
    }

    function sync() {
      if (state.showAnalytics) openDialog();
      else removeDialog();
    }

    subscribe('showAnalytics', sync);
    subscribe('lang', () => { if (dialog) render(); });
    return { sync };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
