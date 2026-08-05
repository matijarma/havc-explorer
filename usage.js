/*
 * First-party, cookieless usage measurement for Sredstva.
 *
 * Public visitors receive no analytics cookie or persistent identifier. The
 * random tab session ID below exists only in memory. The sole storage exception
 * is an explicit owner opt-out flag set from the private /stats page.
 */
(() => {
  'use strict';

  const OPT_OUT_KEY = 'sredstva-usage-optout';
  const MAX_QUEUE = 200;
  const MAX_BATCH = 40;
  const ENGAGE_WINDOW = 15000;

  function ownerOptedOut() {
    try {
      return localStorage.getItem(OPT_OUT_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  const privacyOptOut =
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1';

  if (privacyOptOut || ownerOptedOut() || typeof fetch !== 'function') {
    window.havcUsage = () => {};
    window.havcUsageStatus = {
      enabled: false,
      reason: privacyOptOut ? 'privacy-signal' : ownerOptedOut() ? 'owner-optout' : 'fetch-unavailable',
    };
    return;
  }

  const randomPart = () => Math.random().toString(36).slice(2, 12);
  const sessionId = (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now().toString(36)}_${randomPart()}_${randomPart()}`;
  const now = () => performance.now();
  const started = now();

  let referrerHost = '';
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).host;
      if (host !== location.host) referrerHost = host;
    }
  } catch (_) {
    // An unreadable referrer is treated as direct.
  }

  let queue = [];
  let flushTimer = null;
  let retryTimer = null;
  let retryDelay = 1000;
  let fetchesInFlight = 0;
  let endSent = false;
  let pageWasHidden = document.visibilityState !== 'visible';

  function clearScheduledFlush() {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
  }

  function scheduleFlush(delay = 5000) {
    if (flushTimer !== null || retryTimer !== null || !queue.length) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush(false);
    }, delay);
  }

  function scheduleRetry() {
    if (retryTimer !== null || !queue.length) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush(false);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }

  function restoreBatch(batch) {
    queue = batch.concat(queue).slice(0, MAX_QUEUE);
    scheduleRetry();
  }

  function bodyFor(batch) {
    return JSON.stringify({ s: sessionId, ref: referrerHost, e: batch });
  }

  function sendWithFetch(batch) {
    fetchesInFlight++;
    return fetch('/api/u', {
      method: 'POST',
      body: bodyFor(batch),
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
      .then((response) => {
        if (!response.ok) throw new Error(`usage beacon failed: ${response.status}`);
        retryDelay = 1000;
        return true;
      })
      .catch(() => {
        restoreBatch(batch);
        return false;
      })
      .finally(() => {
        fetchesInFlight--;
        if (queue.length && retryTimer === null) scheduleFlush(250);
      });
  }

  function flush(preferBeacon) {
    if (!queue.length) return Promise.resolve(true);
    if (!preferBeacon && fetchesInFlight > 0) {
      scheduleFlush(250);
      return Promise.resolve(false);
    }

    clearScheduledFlush();
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const batch = queue.splice(0, MAX_BATCH);
    if (preferBeacon && typeof navigator.sendBeacon === 'function') {
      try {
        const accepted = navigator.sendBeacon(
          '/api/u',
          new Blob([bodyFor(batch)], { type: 'application/json' }),
        );
        if (accepted) {
          retryDelay = 1000;
          if (queue.length) scheduleFlush(250);
          return Promise.resolve(true);
        }
      } catch (_) {
        // A false return or exception falls through to keepalive fetch.
      }
    }
    return sendWithFetch(batch);
  }

  window.havcUsage = (name, detail, value, project) => {
    if (typeof name !== 'string' || !name) return;
    const event = {
      n: name,
      t: Math.max(0, Math.round(now() - started)),
    };
    if (typeof detail === 'string' && detail) event.d = detail.slice(0, 80);
    if (Number.isFinite(value)) event.v = Math.round(value);
    if (typeof project === 'string' && project) event.p = project.slice(0, 80);
    queue.push(event);
    if (queue.length > MAX_QUEUE) queue.shift();
    if (queue.length >= 20) flush(false);
    else scheduleFlush();
  };

  window.havcUsageStatus = { enabled: true, storage: 'none', session: 'tab-memory' };

  // Count the page even if registry data later fails to load.
  window.havcUsage('page_view', 'app');

  // Tab activity and dwell ------------------------------------------------

  let visibleMs = 0;
  let engagedMs = 0;
  let returns = 0;
  let visibleSince = document.visibilityState === 'visible' ? now() : null;
  let engagedSince = null;
  let lastInput = 0;

  function settleEngagement(at) {
    if (engagedSince === null) return;
    engagedMs += Math.max(0, Math.min(at, lastInput + ENGAGE_WINDOW) - engagedSince);
    engagedSince = null;
  }

  function onInput() {
    const at = now();
    if (visibleSince === null) return;
    if (engagedSince !== null && at - lastInput > ENGAGE_WINDOW) settleEngagement(at);
    if (engagedSince === null) engagedSince = at;
    lastInput = at;
  }

  for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(eventName, onInput, { passive: true, capture: true });
  }

  function settleVisibility(at = now()) {
    settleEngagement(at);
    if (visibleSince !== null) {
      visibleMs += Math.max(0, at - visibleSince);
      visibleSince = null;
    }
  }

  function dwellSnapshot(at = now()) {
    const visible = visibleMs + (visibleSince !== null ? Math.max(0, at - visibleSince) : 0);
    const engaged = engagedMs + (engagedSince !== null
      ? Math.max(0, Math.min(at, lastInput + ENGAGE_WINDOW) - engagedSince)
      : 0);
    return `${Math.round(visible)}|${Math.round(Math.min(engaged, visible))}|${returns}`;
  }

  // Performance ----------------------------------------------------------

  const observers = [];
  const reportedVitals = new Set();
  let lcp = null;
  let cls = 0;
  let clsWindow = 0;
  let clsWindowStart = 0;
  let clsLastAt = 0;
  const interactions = new Map();
  let lcpSupported = false;
  let clsSupported = false;
  let inpSupported = false;

  function observe(type, callback, options = {}) {
    if (typeof PerformanceObserver !== 'function') return false;
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true, ...options });
      observers.push(observer);
      return true;
    } catch (_) {
      return false;
    }
  }

  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation && Number.isFinite(navigation.responseStart)) {
      window.havcUsage('web_vital', 'ttfb', navigation.responseStart);
      reportedVitals.add('ttfb');
    }
  } catch (_) {}

  observe('paint', (entries) => {
    const entry = entries.find((candidate) => candidate.name === 'first-contentful-paint');
    if (entry && !reportedVitals.has('fcp')) {
      reportedVitals.add('fcp');
      window.havcUsage('web_vital', 'fcp', entry.startTime);
    }
  });

  lcpSupported = observe('largest-contentful-paint', (entries) => {
    const entry = entries[entries.length - 1];
    if (entry) lcp = entry.startTime;
  });

  clsSupported = observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      if (!clsWindowStart || entry.startTime - clsLastAt > 1000 || entry.startTime - clsWindowStart > 5000) {
        clsWindowStart = entry.startTime;
        clsWindow = entry.value;
      } else {
        clsWindow += entry.value;
      }
      clsLastAt = entry.startTime;
      cls = Math.max(cls, clsWindow);
    }
  });

  inpSupported = observe('event', (entries) => {
    for (const entry of entries) {
      if (!entry.interactionId || !Number.isFinite(entry.duration)) continue;
      interactions.set(
        entry.interactionId,
        Math.max(interactions.get(entry.interactionId) || 0, entry.duration),
      );
    }
  }, { durationThreshold: 40 });

  function estimatedInp() {
    const values = [...interactions.values()].sort((a, b) => b - a);
    if (!values.length) return null;
    return values[Math.min(values.length - 1, Math.floor(values.length / 50))];
  }

  function reportFinalVitals() {
    if (lcpSupported && lcp !== null && !reportedVitals.has('lcp')) {
      reportedVitals.add('lcp');
      window.havcUsage('web_vital', 'lcp', lcp);
    }
    if (clsSupported && !reportedVitals.has('cls')) {
      reportedVitals.add('cls');
      window.havcUsage('web_vital', 'cls', cls * 1000);
    }
    const inp = estimatedInp();
    if (inpSupported && inp !== null && !reportedVitals.has('inp')) {
      reportedVitals.add('inp');
      window.havcUsage('web_vital', 'inp', inp);
    }
  }

  // Lifecycle ------------------------------------------------------------

  function onLeave() {
    const at = now();
    settleVisibility(at);
    reportFinalVitals();
    if (!endSent) {
      endSent = true;
      window.havcUsage('session_end', dwellSnapshot(at), at - started);
    }
    flush(true);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pageWasHidden = true;
      onLeave();
      return;
    }
    const at = now();
    if (pageWasHidden) returns++;
    pageWasHidden = false;
    endSent = false;
    if (visibleSince === null) visibleSince = at;
  });

  window.addEventListener('pagehide', onLeave);
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const at = now();
    endSent = false;
    if (document.visibilityState === 'visible' && visibleSince === null) visibleSince = at;
    if (pageWasHidden) {
      returns++;
      pageWasHidden = false;
    }
    window.havcUsage('page_view', 'app');
  });

  if (window.__HAVC_USAGE_TEST__) {
    window.__havcUsageTest = {
      flush,
      queueSize: () => queue.length,
      sessionId,
      inFlight: () => fetchesInFlight,
    };
  }
})();
