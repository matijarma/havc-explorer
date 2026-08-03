/*
 * usage.js — first-party, cookieless usage measurement for Sredstva.
 *
 * Contract with the visitor (mirrored on /extension-privacy/):
 *  - NOTHING is written to the device: no cookies, no localStorage, no
 *    sessionStorage, no IndexedDB. The session id below lives in a closure
 *    variable and evaporates when the tab closes. A reload is a new session.
 *  - No fingerprinting: no IP or User-Agent hashing, no canvas, no fonts.
 *  - The referrer is reduced to its HOST here, in the browser, so the full
 *    referring URL never even leaves the page.
 *  - Do Not Track / Global Privacy Control are honoured by not existing:
 *    every call becomes a no-op and no request is ever made.
 *
 * The app calls window.havcUsage(name, detail, value) from a handful of hooks
 * in main.js — always via optional chaining, so a blocked or failed collector
 * can never break the registry.
 *
 * (Not to be confused with analytics-core.js / analytics-studio.js, which are
 * the funding-statistics feature of the app itself and track nothing.)
 */
(() => {
  'use strict';

  const optedOut =
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1';

  if (optedOut || typeof fetch !== 'function') {
    window.havcUsage = () => {};
    return;
  }

  // In-memory only, by design. Sessions — not daily uniques — are the metric.
  const SID = (crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);

  let refHost = '';
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).host;
      if (host !== location.host) refHost = host;
    }
  } catch (_) { /* unparseable referrer: treat as direct */ }

  const started = Date.now();
  let queue = [];
  let flushTimer = null;
  let endSent = false;

  function flush(useBeacon) {
    if (!queue.length) return;
    clearTimeout(flushTimer);
    flushTimer = null;
    const body = JSON.stringify({ s: SID, ref: refHost, e: queue.slice(0, 40) });
    queue = [];
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/u', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/u', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } })
          .catch(() => {});
      }
    } catch (_) { /* measurement must never surface as an app error */ }
  }

  window.havcUsage = (name, detail, value) => {
    if (typeof name !== 'string' || !name) return;
    queue.push({
      n: name,
      d: typeof detail === 'string' ? detail.slice(0, 80) : '',
      v: Number.isFinite(value) ? Math.round(value) : undefined,
      t: Date.now() - started,
    });
    if (queue.length >= 20) flush(false);
    else if (!flushTimer) flushTimer = setTimeout(() => flush(false), 5000);
  };

  // The tab going hidden is the only reliable "goodbye" on the mobile web —
  // pagehide covers bfcache navigations that never fire visibilitychange.
  function onLeave() {
    if (!endSent) {
      endSent = true;
      window.havcUsage('session_end', '', Date.now() - started);
    }
    flush(true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave();
    else endSent = false; // came back: a later hide should count the fuller session
  });
  window.addEventListener('pagehide', onLeave);
})();
