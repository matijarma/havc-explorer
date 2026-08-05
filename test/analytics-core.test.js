import test from 'node:test';
import assert from 'node:assert/strict';
import '../analytics-core.js';

const Analytics = globalThis.SredstvaAnalytics;

function row(overrides) {
  return {
    title: 'Project',
    family_title: 'Project',
    project_family_id: 'project',
    year: 2024,
    program: 'proizvodnja',
    cat_type: 'feature',
    rok: '1',
    amount_eur: 10_000,
    producer: 'Studio',
    applicant: 'Applicant',
    director: 'Director',
    writer: 'Writer',
    category: 'Feature',
    ...overrides,
  };
}

test('percentiles interpolate deterministically', () => {
  assert.equal(Analytics.percentileFromSorted([10, 20, 30, 40], 0.5), 25);
  assert.equal(Analytics.percentileFromSorted([10, 20, 30, 40], 0.25), 17.5);
  assert.equal(Analytics.percentileFromSorted([], 0.5), 0);
});

test('gini returns expected boundary values', () => {
  assert.equal(Analytics.gini([10, 10, 10]), 0);
  assert.ok(Math.abs(Analytics.gini([0, 0, 30]) - (2 / 3)) < 1e-9);
});

test('recipient fallback prefers producer then applicant', () => {
  assert.equal(Analytics.recipientForRow(row()), 'Studio');
  assert.equal(Analytics.recipientForRow(row({ producer: null })), 'Applicant');
  assert.equal(Analytics.recipientForRow(row({ producer: '', applicant: '' })), null);
});

test('concentration denominator includes attributed funding only', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(row({
      project_family_id: `project-${i}`,
      producer: `Studio ${i}`,
      amount_eur: 10_000,
    }));
  }
  rows.push(row({
    project_family_id: 'unattributed',
    producer: null,
    applicant: null,
    amount_eur: 50_000,
  }));
  const snapshot = Analytics.buildAnalyticsSnapshot(rows, { currentYear: 2026 });
  assert.equal(snapshot.totalAmount, 150_000);
  assert.equal(snapshot.concentration.attributedAmount, 100_000);
  assert.equal(snapshot.concentration.amountCoverage, 2 / 3);
  assert.equal(snapshot.concentration.eligible, true);
  assert.equal(snapshot.concentration.gini, 0);
});

test('concentration is suppressed for low coverage or fewer than ten recipients', () => {
  const sparse = Array.from({ length: 9 }, (_, i) => row({
    project_family_id: `project-${i}`,
    producer: `Studio ${i}`,
  }));
  const sparseSnapshot = Analytics.buildAnalyticsSnapshot(sparse);
  assert.equal(sparseSnapshot.concentration.eligible, false);
  assert.equal(sparseSnapshot.concentration.gini, null);

  const lowCoverage = Array.from({ length: 10 }, (_, i) => row({
    project_family_id: `known-${i}`,
    producer: `Known ${i}`,
    amount_eur: 1_000,
  })).concat([
    row({
      project_family_id: 'unknown',
      producer: null,
      applicant: null,
      amount_eur: 100_000,
    }),
  ]);
  const lowCoverageSnapshot = Analytics.buildAnalyticsSnapshot(lowCoverage);
  assert.equal(lowCoverageSnapshot.concentration.eligible, false);
  assert.equal(lowCoverageSnapshot.concentration.gini, null);
});

test('lifecycle transitions follow the documented stage map', () => {
  const rows = [
    row({ year: 2020, program: 'razvoj_scenarija', amount_eur: 1_000 }),
    row({ year: 2021, program: 'razvoj_projekata', amount_eur: 2_000 }),
    row({ year: 2022, program: 'proizvodnja', amount_eur: 3_000 }),
    row({ year: 2024, program: 'distribucija', amount_eur: 4_000 }),
  ];
  const snapshot = Analytics.buildAnalyticsSnapshot(rows, { currentYear: 2026 });
  assert.equal(snapshot.lifecycles.projectCount, 1);
  assert.equal(snapshot.lifecycles.repeatFundedShare, 1);
  assert.equal(snapshot.lifecycles.projects[0].durationYears, 4);
  assert.deepEqual(
    snapshot.lifecycles.transitions.map((item) => item.key),
    ['development>production', 'production>distribution', 'script>development'],
  );
});

test('comparison findings suppress fragile claims for small samples', () => {
  const benchmark = Array.from({ length: 20 }, (_, i) => row({
    project_family_id: `benchmark-${i}`,
    amount_eur: 10_000 + i * 1_000,
    producer: `Studio ${i}`,
  }));
  const current = benchmark.slice(0, 3);
  const comparison = Analytics.buildComparison(current, benchmark, { currentYear: 2026 });
  assert.ok(comparison.findings.some((finding) => finding.key === 'scopeShare'));
  assert.ok(!comparison.findings.some((finding) => finding.key === 'medianRatio'));
  assert.ok(!comparison.findings.some((finding) => finding.key === 'repeatDelta'));
});

test('field coverage uses recorded raw fields rather than derived fallback categories', () => {
  const rows = [
    row({ project_family_id: 'one', category: null, cat_type: 'other' }),
    row({ project_family_id: 'two', category: 'Feature', cat_type: 'feature' }),
  ];
  const snapshot = Analytics.buildAnalyticsSnapshot(rows);
  assert.equal(snapshot.quality.category.count, 1);
  assert.equal(snapshot.quality.category.rowShare, 0.5);
});

test('partial current year is flagged and excluded from extrema', () => {
  const rows = [
    row({ year: 2024, amount_eur: 10_000 }),
    row({ year: 2025, amount_eur: 20_000, project_family_id: 'two' }),
    row({ year: 2026, amount_eur: 1_000, project_family_id: 'three' }),
  ];
  const snapshot = Analytics.buildAnalyticsSnapshot(rows, { currentYear: 2026 });
  assert.equal(snapshot.flags.currentYearPartial, true);
  assert.equal(snapshot.time.maxGain.year, 2025);
});

test('selection matching covers every registry-compatible selection', () => {
  const sample = row();
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'year', value: 2024 }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'sizeBand', value: [5_000, 20_000] }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'program', value: 'proizvodnja' }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'cat', value: 'feature' }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'rok', value: '1' }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'recipient', value: 'Studio' }), true);
  assert.equal(Analytics.rowMatchesSelection(sample, { kind: 'project', value: 'project' }), true);
});
