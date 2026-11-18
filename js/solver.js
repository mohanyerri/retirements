/* Binary-search solvers on the deterministic engine. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const clone = o => JSON.parse(JSON.stringify(o));
  const ok = s => RP.engine.run(s, { light: true }).success;

  /** Highest monthly living spend (today's ₹) the plan can sustain. */
  function sustainableMonthly(s) {
    const c = clone(s);
    const test = x => { c.spending.monthly = x; return ok(c); };
    if (!test(0)) return 0;
    let lo = 0, hi = Math.max(10000, RP.engine.num(s.spending.monthly) * 2);
    while (test(hi) && hi < 1e9) { lo = hi; hi *= 2; }
    for (let k = 0; k < 40 && hi - lo > 50; k++) { const mid = (lo + hi) / 2; if (test(mid)) lo = mid; else hi = mid; }
    return Math.floor(lo / 100) * 100;
  }

  /** Corpus needed today (same allocation) for the plan to succeed. null if unreachable. */
  function requiredCorpus(s) {
    const c = clone(s);
    const base = RP.engine.initialAmounts(s).reduce((a, b) => a + b, 0);
    if (base <= 0) return null;
    const orig = s.assets.map(a => RP.engine.num(a.amount));
    const scale = k => {
      if (c.allocMode === 'percent') c.totalCorpus = RP.engine.num(s.totalCorpus) * k;
      else c.assets.forEach((a, i) => { a.amount = orig[i] * k; });
      return ok(c);
    };
    if (scale(0)) return 0;
    let lo = 0, hi = 2;
    while (!scale(hi)) { lo = hi; hi *= 2; if (hi > 1e4) return null; }
    for (let k = 0; k < 40 && (hi - lo) * base > 1000; k++) { const mid = (lo + hi) / 2; if (scale(mid)) hi = mid; else lo = mid; }
    return hi * base;
  }

  function earliestRetirement(s) {
    const c = clone(s);
    const cur = Math.round(RP.engine.num(s.profile.currentAge));
    const end = cur + RP.engine.horizonYears(s);
    for (let a = cur; a < end; a++) { c.profile.retireAge = a; if (ok(c)) return a; }
    return null;
  }

  function all(s) {
    const sustainable = sustainableMonthly(s);
    let swr = null;
    if (sustainable > 0) {
      const c = clone(s); c.spending.monthly = sustainable;
      swr = RP.engine.run(c, { light: true }).firstYearWR;
    }
    return { sustainable, swr, requiredCorpus: requiredCorpus(s), earliestRetireAge: earliestRetirement(s) };
  }

  RP.solver = { all, sustainableMonthly, requiredCorpus, earliestRetirement };
})(window.RP);
