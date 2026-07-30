(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SredstvaAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SIZE_BUCKETS = [
    0,
    1_000,
    5_000,
    20_000,
    50_000,
    100_000,
    250_000,
    500_000,
    1_000_000,
    Infinity,
  ];

  const STAGE_ORDER = {
    script: 0,
    development: 1,
    production: 2,
    distribution: 3,
    other: 4,
  };

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function positiveAmount(row) {
    const amount = finiteNumber(row && row.amount_eur);
    return amount != null && amount > 0 ? amount : 0;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0111\u0110]/g, 'd')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function projectKey(row) {
    const familyId = typeof (row && row.project_family_id) === 'string'
      ? row.project_family_id.trim()
      : '';
    return familyId || normalizeText((row && (row.family_title || row.title)) || '');
  }

  function recipientForRow(row) {
    if (!row) return null;
    const value = row.producer || row.applicant || null;
    return value == null || String(value).trim() === '' ? null : String(value).trim();
  }

  function stageForProgram(program) {
    switch (program) {
      case 'razvoj_scenarija':
        return 'script';
      case 'razvoj_projekata':
        return 'development';
      case 'proizvodnja':
      case 'manjinske_koprodukcije':
      case 'tv_djela':
      case 'videoigre':
        return 'production';
      case 'distribucija':
      case 'media_matching':
        return 'distribution';
      default:
        return 'other';
    }
  }

  function sum(values) {
    let total = 0;
    for (const value of values) total += value || 0;
    return total;
  }

  function mean(values) {
    return values.length ? sum(values) / values.length : 0;
  }

  function percentileFromSorted(sorted, percentile) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const p = Math.max(0, Math.min(1, percentile));
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function median(values) {
    if (!values.length) return 0;
    return percentileFromSorted(values.slice().sort((a, b) => a - b), 0.5);
  }

  function gini(values) {
    const sorted = values.filter((value) => value >= 0).slice().sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const total = sum(sorted);
    if (!total) return 0;
    let weighted = 0;
    for (let i = 0; i < sorted.length; i++) weighted += (i + 1) * sorted[i];
    const n = sorted.length;
    return (2 * weighted) / (n * total) - ((n + 1) / n);
  }

  function topShare(entries, count, total) {
    if (!total || !entries.length) return 0;
    return sum(entries.slice(0, Math.max(0, count)).map((entry) => entry.amount)) / total;
  }

  function fieldCoverage(rows, selector, totalAmount) {
    let count = 0;
    let amount = 0;
    for (const row of rows) {
      const value = selector(row);
      if (value == null || String(value).trim() === '') continue;
      count += 1;
      amount += positiveAmount(row);
    }
    return {
      count,
      rowShare: rows.length ? count / rows.length : 0,
      amount,
      amountShare: totalAmount ? amount / totalAmount : 0,
    };
  }

  function buildMix(rows, keySelector, totalAmount) {
    const buckets = new Map();
    for (const row of rows) {
      const key = keySelector(row) || 'other';
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, amount: 0, count: 0, amounts: [], years: new Set() };
        buckets.set(key, bucket);
      }
      const amount = positiveAmount(row);
      bucket.amount += amount;
      bucket.count += 1;
      if (amount > 0) bucket.amounts.push(amount);
      if (Number.isInteger(row.year)) bucket.years.add(row.year);
    }
    return [...buckets.values()]
      .map((bucket) => ({
        key: bucket.key,
        amount: bucket.amount,
        count: bucket.count,
        share: totalAmount ? bucket.amount / totalAmount : 0,
        median: median(bucket.amounts),
        yearMin: bucket.years.size ? Math.min(...bucket.years) : null,
        yearMax: bucket.years.size ? Math.max(...bucket.years) : null,
      }))
      .sort((a, b) => b.amount - a.amount || b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }

  function buildHistogram(amounts, buckets) {
    const values = new Array(buckets.length - 1).fill(0);
    for (const amount of amounts) {
      for (let i = 0; i < buckets.length - 1; i++) {
        if (amount >= buckets[i] && amount < buckets[i + 1]) {
          values[i] += 1;
          break;
        }
      }
    }
    return values.map((count, index) => ({
      min: buckets[index],
      max: buckets[index + 1],
      count,
      share: amounts.length ? count / amounts.length : 0,
    }));
  }

  function buildTime(rows, currentYear) {
    const years = new Map();
    for (const row of rows) {
      if (!Number.isInteger(row.year)) continue;
      let bucket = years.get(row.year);
      if (!bucket) {
        bucket = { year: row.year, amount: 0, count: 0, amounts: [], programs: new Map() };
        years.set(row.year, bucket);
      }
      const amount = positiveAmount(row);
      bucket.amount += amount;
      bucket.count += 1;
      if (amount > 0) bucket.amounts.push(amount);
      const program = row.program || 'other';
      bucket.programs.set(program, (bucket.programs.get(program) || 0) + amount);
    }

    const series = [...years.values()]
      .sort((a, b) => a.year - b.year)
      .map((bucket) => ({
        year: bucket.year,
        amount: bucket.amount,
        count: bucket.count,
        median: median(bucket.amounts),
        mean: mean(bucket.amounts),
        programmes: [...bucket.programs.entries()]
          .map(([key, amount]) => ({ key, amount }))
          .sort((a, b) => b.amount - a.amount),
      }));

    const changes = [];
    for (let i = 1; i < series.length; i++) {
      const previous = series[i - 1];
      const current = series[i];
      const delta = current.amount - previous.amount;
      changes.push({
        year: current.year,
        previousYear: previous.year,
        delta,
        ratio: previous.amount > 0 ? current.amount / previous.amount : null,
        percent: previous.amount > 0 ? delta / previous.amount : null,
      });
    }

    const completeChanges = changes.filter((change) => change.year !== currentYear);
    return {
      series,
      changes,
      maxGain: completeChanges.length
        ? completeChanges.reduce((best, item) => item.delta > best.delta ? item : best, completeChanges[0])
        : null,
      maxDrop: completeChanges.length
        ? completeChanges.reduce((best, item) => item.delta < best.delta ? item : best, completeChanges[0])
        : null,
    };
  }

  function buildConcentration(rows, totalAmount) {
    const totals = new Map();
    let attributedRows = 0;
    let attributedAmount = 0;
    for (const row of rows) {
      const amount = positiveAmount(row);
      if (!amount) continue;
      const recipient = recipientForRow(row);
      if (!recipient) continue;
      attributedRows += 1;
      attributedAmount += amount;
      const current = totals.get(recipient) || { key: recipient, amount: 0, count: 0 };
      current.amount += amount;
      current.count += 1;
      totals.set(recipient, current);
    }

    const entries = [...totals.values()]
      .sort((a, b) => b.amount - a.amount || b.count - a.count || a.key.localeCompare(b.key));
    const amountCoverage = totalAmount ? attributedAmount / totalAmount : 0;
    const rowCoverage = rows.length ? attributedRows / rows.length : 0;
    const eligible = entries.length >= 10 && amountCoverage >= 0.6;

    let cumulative = 0;
    let paretoCount = 0;
    for (let i = 0; i < entries.length; i++) {
      cumulative += entries[i].amount;
      paretoCount = i + 1;
      if (attributedAmount && cumulative / attributedAmount >= 0.5) break;
    }

    const ascending = entries.slice().sort((a, b) => a.amount - b.amount);
    const lorenz = [{ populationShare: 0, amountShare: 0 }];
    cumulative = 0;
    for (let i = 0; i < ascending.length; i++) {
      cumulative += ascending[i].amount;
      lorenz.push({
        populationShare: (i + 1) / ascending.length,
        amountShare: attributedAmount ? cumulative / attributedAmount : 0,
      });
    }

    function countForPercent(percent) {
      return Math.max(1, Math.ceil(entries.length * percent));
    }

    return {
      eligible,
      recipientCount: entries.length,
      attributedRows,
      attributedAmount,
      rowCoverage,
      amountCoverage,
      denominator: attributedAmount,
      entries,
      gini: eligible ? gini(entries.map((entry) => entry.amount)) : null,
      lorenz: eligible ? lorenz : [],
      top10CountShare: eligible ? topShare(entries, 10, attributedAmount) : null,
      topPercentShares: eligible ? [
        { percent: 0.01, count: countForPercent(0.01), share: topShare(entries, countForPercent(0.01), attributedAmount) },
        { percent: 0.05, count: countForPercent(0.05), share: topShare(entries, countForPercent(0.05), attributedAmount) },
        { percent: 0.10, count: countForPercent(0.10), share: topShare(entries, countForPercent(0.10), attributedAmount) },
        { percent: 0.25, count: countForPercent(0.25), share: topShare(entries, countForPercent(0.25), attributedAmount) },
        { percent: 0.50, count: countForPercent(0.50), share: topShare(entries, countForPercent(0.50), attributedAmount) },
      ] : [],
      pareto50: {
        count: entries.length ? paretoCount : 0,
        recipientShare: entries.length ? paretoCount / entries.length : 0,
      },
    };
  }

  function buildLifecycles(rows) {
    const projects = new Map();
    for (const row of rows) {
      const amount = positiveAmount(row);
      const key = projectKey(row);
      if (!amount || !key) continue;
      let project = projects.get(key);
      if (!project) {
        project = {
          key,
          title: row.family_title || row.title || key,
          rows: [],
          amount: 0,
          years: new Set(),
          programmes: new Set(),
          stages: new Set(),
        };
        projects.set(key, project);
      }
      project.rows.push(row);
      project.amount += amount;
      if (Number.isInteger(row.year)) project.years.add(row.year);
      if (row.program) project.programmes.add(row.program);
      project.stages.add(stageForProgram(row.program));
    }

    const transitionMap = new Map();
    const projectList = [...projects.values()].map((project) => {
      const years = [...project.years].sort((a, b) => a - b);
      const timeline = project.rows
        .filter((row) => Number.isInteger(row.year))
        .map((row) => ({
          year: row.year,
          stage: stageForProgram(row.program),
          program: row.program || 'other',
        }))
        .sort((a, b) => a.year - b.year || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);

      const orderedStages = [];
      for (const event of timeline) {
        if (event.stage === 'other') continue;
        if (orderedStages[orderedStages.length - 1] !== event.stage) orderedStages.push(event.stage);
      }
      const transitionKeys = [];
      for (let i = 1; i < orderedStages.length; i++) {
        const from = orderedStages[i - 1];
        const to = orderedStages[i];
        if (from === to) continue;
        const key = `${from}>${to}`;
        transitionKeys.push(key);
        let transition = transitionMap.get(key);
        if (!transition) {
          transition = { key, from, to, count: 0, projectKeys: [] };
          transitionMap.set(key, transition);
        }
        transition.count += 1;
        transition.projectKeys.push(project.key);
      }

      return {
        key: project.key,
        title: project.title,
        amount: project.amount,
        decisionCount: project.rows.length,
        programmeCount: project.programmes.size,
        stageCount: project.stages.size,
        yearMin: years.length ? years[0] : null,
        yearMax: years.length ? years[years.length - 1] : null,
        durationYears: years.length ? years[years.length - 1] - years[0] : 0,
        programmes: [...project.programmes],
        stages: [...project.stages],
        transitionKeys,
      };
    });

    const decisionCounts = projectList.map((project) => project.decisionCount);
    const durations = projectList.map((project) => project.durationYears);
    const programmeCounts = projectList.map((project) => project.programmeCount);
    const multiRound = projectList.filter((project) => project.decisionCount >= 2);
    const multiProgramme = projectList.filter((project) => project.programmeCount >= 2);
    const longRunning = projectList.filter((project) => project.durationYears >= 3);
    const transitions = [...transitionMap.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    return {
      projectCount: projectList.length,
      projects: projectList,
      medianDecisions: median(decisionCounts),
      medianDurationYears: median(durations),
      medianProgrammeCount: median(programmeCounts),
      repeatFundedShare: projectList.length ? multiRound.length / projectList.length : 0,
      multiProgrammeShare: projectList.length ? multiProgramme.length / projectList.length : 0,
      longRunningShare: projectList.length ? longRunning.length / projectList.length : 0,
      transitions,
      groups: {
        multiRound: multiRound.map((project) => project.key),
        multiProgramme: multiProgramme.map((project) => project.key),
        longRunning: longRunning.map((project) => project.key),
      },
    };
  }

  function buildAnalyticsSnapshot(inputRows, options) {
    const rows = Array.isArray(inputRows) ? inputRows.filter(Boolean) : [];
    const config = options || {};
    const currentYear = Number.isInteger(config.currentYear)
      ? config.currentYear
      : new Date().getFullYear();
    const sizeBuckets = Array.isArray(config.sizeBuckets) && config.sizeBuckets.length >= 2
      ? config.sizeBuckets.slice()
      : DEFAULT_SIZE_BUCKETS.slice();
    const amounts = rows.map(positiveAmount).filter((amount) => amount > 0).sort((a, b) => a - b);
    const totalAmount = sum(amounts);
    const meanAmount = mean(amounts);
    const medianAmount = percentileFromSorted(amounts, 0.5);
    const time = buildTime(rows, currentYear);
    const years = time.series.map((item) => item.year);
    const lifecycles = buildLifecycles(rows);

    const snapshot = {
      rowCount: rows.length,
      positiveAmountCount: amounts.length,
      totalAmount,
      projectCount: lifecycles.projectCount,
      meanAmount,
      medianAmount,
      meanMedianRatio: medianAmount ? meanAmount / medianAmount : null,
      minAmount: amounts.length ? amounts[0] : 0,
      maxAmount: amounts.length ? amounts[amounts.length - 1] : 0,
      p25Amount: percentileFromSorted(amounts, 0.25),
      p75Amount: percentileFromSorted(amounts, 0.75),
      p90Amount: percentileFromSorted(amounts, 0.90),
      p95Amount: percentileFromSorted(amounts, 0.95),
      p99Amount: percentileFromSorted(amounts, 0.99),
      yearMin: years.length ? years[0] : null,
      yearMax: years.length ? years[years.length - 1] : null,
      time,
      distribution: {
        buckets: sizeBuckets,
        histogram: buildHistogram(amounts, sizeBuckets),
      },
      mix: {
        programmes: buildMix(rows, (row) => row.program || 'other', totalAmount),
        categories: buildMix(rows, (row) => row.cat_type || 'other', totalAmount),
        rounds: buildMix(rows, (row) => row.rok || 'other', totalAmount),
      },
      concentration: buildConcentration(rows, totalAmount),
      lifecycles,
      quality: {
        applicant: fieldCoverage(rows, (row) => row.applicant, totalAmount),
        producer: fieldCoverage(rows, (row) => row.producer, totalAmount),
        recipient: fieldCoverage(rows, recipientForRow, totalAmount),
        director: fieldCoverage(rows, (row) => row.director, totalAmount),
        writer: fieldCoverage(rows, (row) => row.writer, totalAmount),
        category: fieldCoverage(rows, (row) => row.category, totalAmount),
        round: fieldCoverage(rows, (row) => row.rok, totalAmount),
      },
      flags: {
        empty: rows.length === 0,
        smallAwardsSample: amounts.length < 5,
        smallProjectSample: lifecycles.projectCount < 10,
        currentYearPartial: years.length > 0 && years[years.length - 1] === currentYear,
        currentYear,
      },
    };

    return snapshot;
  }

  function relativeRatio(current, benchmark) {
    return benchmark ? current / benchmark : null;
  }

  function mixIndex(mix) {
    return new Map((mix || []).map((item) => [item.key, item]));
  }

  function buildFindings(current, benchmark) {
    if (!current || !benchmark || current.rowCount === 0) return [];
    const findings = [];
    const samePopulation = current.rowCount === benchmark.rowCount
      && Math.abs(current.totalAmount - benchmark.totalAmount) < 0.01;

    if (!samePopulation && benchmark.totalAmount > 0) {
      findings.push({
        key: 'scopeShare',
        score: 100,
        values: {
          amountShare: current.totalAmount / benchmark.totalAmount,
          rowShare: benchmark.rowCount ? current.rowCount / benchmark.rowCount : 0,
        },
      });
    }

    if (
      !samePopulation
      && current.positiveAmountCount >= 5
      && benchmark.positiveAmountCount >= 5
      && benchmark.medianAmount > 0
    ) {
      const ratio = current.medianAmount / benchmark.medianAmount;
      findings.push({
        key: 'medianRatio',
        score: 70 + Math.min(25, Math.abs(Math.log(Math.max(0.01, ratio))) * 20),
        values: { ratio, current: current.medianAmount, benchmark: benchmark.medianAmount },
      });
    }

    if (
      !samePopulation
      && current.lifecycles.projectCount >= 10
      && benchmark.lifecycles.projectCount >= 10
    ) {
      const delta = current.lifecycles.repeatFundedShare - benchmark.lifecycles.repeatFundedShare;
      findings.push({
        key: 'repeatDelta',
        score: 55 + Math.min(20, Math.abs(delta) * 100),
        values: {
          delta,
          current: current.lifecycles.repeatFundedShare,
          benchmark: benchmark.lifecycles.repeatFundedShare,
        },
      });
    }

    if (
      !samePopulation
      && current.concentration.eligible
      && benchmark.concentration.eligible
      && current.concentration.gini != null
      && benchmark.concentration.gini != null
    ) {
      const delta = current.concentration.gini - benchmark.concentration.gini;
      findings.push({
        key: 'concentrationDelta',
        score: 52 + Math.min(20, Math.abs(delta) * 100),
        values: {
          delta,
          current: current.concentration.gini,
          benchmark: benchmark.concentration.gini,
        },
      });
    }

    if (!samePopulation && current.mix.programmes.length > 1) {
      const benchmarkMix = mixIndex(benchmark.mix.programmes);
      let best = null;
      for (const item of current.mix.programmes) {
        const base = benchmarkMix.get(item.key);
        const delta = item.share - (base ? base.share : 0);
        if (!best || delta > best.delta) best = { key: item.key, delta, share: item.share };
      }
      if (best && best.delta >= 0.05) {
        findings.push({
          key: 'programmeOverindex',
          score: 50 + Math.min(20, best.delta * 100),
          values: best,
        });
      }
    }

    if (samePopulation) {
      const completeSeries = current.time.series.filter((item) => item.year !== current.flags.currentYear);
      if (completeSeries.length >= 2) {
        const latest = completeSeries[completeSeries.length - 1];
        const previous = completeSeries[completeSeries.length - 2];
        findings.push({
          key: 'latestChange',
          score: 90,
          values: {
            year: latest.year,
            previousYear: previous.year,
            delta: latest.amount - previous.amount,
            percent: previous.amount ? (latest.amount - previous.amount) / previous.amount : null,
          },
        });
      }
      if (current.meanMedianRatio != null && current.positiveAmountCount >= 5) {
        findings.push({
          key: 'distributionSkew',
          score: 75,
          values: { ratio: current.meanMedianRatio },
        });
      }
      if (current.mix.programmes.length) {
        findings.push({
          key: 'leadingProgramme',
          score: 65,
          values: {
            key: current.mix.programmes[0].key,
            share: current.mix.programmes[0].share,
          },
        });
      }
    }

    return findings.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function buildComparison(currentRows, benchmarkRows, options) {
    const current = buildAnalyticsSnapshot(currentRows, options);
    const benchmark = currentRows === benchmarkRows
      ? current
      : buildAnalyticsSnapshot(benchmarkRows, options);
    return buildComparisonFromSnapshots(current, benchmark);
  }

  function buildComparisonFromSnapshots(current, benchmark) {
    return {
      current,
      benchmark,
      findings: buildFindings(current, benchmark),
      deltas: {
        totalAmountRatio: relativeRatio(current.totalAmount, benchmark.totalAmount),
        rowCountRatio: relativeRatio(current.rowCount, benchmark.rowCount),
        projectCountRatio: relativeRatio(current.projectCount, benchmark.projectCount),
        medianAmountRatio: relativeRatio(current.medianAmount, benchmark.medianAmount),
        repeatFundedDelta: current.lifecycles.repeatFundedShare - benchmark.lifecycles.repeatFundedShare,
        giniDelta: current.concentration.gini != null && benchmark.concentration.gini != null
          ? current.concentration.gini - benchmark.concentration.gini
          : null,
      },
    };
  }

  function rowMatchesSelection(row, selection) {
    if (!selection || !row) return false;
    switch (selection.kind) {
      case 'year':
        return row.year === selection.value;
      case 'sizeBand': {
        const amount = positiveAmount(row);
        return amount >= selection.value[0] && amount < selection.value[1];
      }
      case 'program':
        return (row.program || 'other') === selection.value;
      case 'cat':
        return (row.cat_type || 'other') === selection.value;
      case 'rok':
        return (row.rok || 'other') === selection.value;
      case 'recipient':
        return recipientForRow(row) === selection.value;
      case 'project':
        return projectKey(row) === selection.value;
      default:
        return false;
    }
  }

  return {
    DEFAULT_SIZE_BUCKETS,
    STAGE_ORDER,
    buildAnalyticsSnapshot,
    buildComparison,
    buildComparisonFromSnapshots,
    buildFindings,
    gini,
    median,
    normalizeText,
    percentileFromSorted,
    projectKey,
    recipientForRow,
    relativeRatio,
    rowMatchesSelection,
    stageForProgram,
  };
});
