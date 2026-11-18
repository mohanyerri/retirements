/* Monte Carlo: lognormal annual returns, equity/debt correlated, seeded PRNG.
   "Expected return" is treated as the long-run CAGR (median growth), so a run with
   volatility 0 reproduces the deterministic projection exactly. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0; while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  function lnParams(g, sd) {
    const base = Math.max(1 + g, 0.01);
    return { mu: Math.log(base), sigma: Math.sqrt(Math.log(1 + (sd * sd) / (base * base))) };
  }
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function run(s, o = {}) {
    const runs = Math.max(1, Math.round(o.runs || 1000));
    const rng = mulberry32(Math.round(num(o.seed != null ? o.seed : 42)));
    const N = RP.engine.horizonYears(s);
    const nA = s.assets.length;
    const params = s.assets.map(a => lnParams(num(a.ret) / 100, num(a.sd) / 100));
    const cls = s.assets.map(a => a.cls);
    const rho = Math.max(-0.99, Math.min(0.99, num(s.sim && s.sim.corrEqDebt)));
    const rc = Math.sqrt(1 - rho * rho);
    const matrix = Array.from({ length: N }, () => new Array(nA).fill(0));
    const returnsFn = (y, i) => matrix[y][i];

    const paths = [], dep = [], depByYear = new Array(N).fill(0);
    let succ = 0;
    for (let r = 0; r < runs; r++) {
      for (let y = 0; y < N; y++) {
        const zE = gauss(rng), zD = rho * zE + rc * gauss(rng);
        for (let i = 0; i < nA; i++) {
          const z = cls[i] === 'equity' ? zE : cls[i] === 'debt' ? zD : gauss(rng);
          const p = params[i];
          matrix[y][i] = Math.exp(p.mu + p.sigma * z) - 1;
        }
      }
      const res = RP.engine.run(s, { light: true, returnsFn });
      paths.push(res.totals);
      for (let y = 0; y < N; y++) if (res.totals[y] <= 1) depByYear[y]++;
      if (res.success) succ++;
      if (res.depletedAge != null) dep.push(res.depletedAge);
    }

    const P = [0.1, 0.25, 0.5, 0.75, 0.9];
    const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
    const keys = Object.keys(bands);
    for (let y = 0; y < N; y++) {
      const col = paths.map(p => p[y]).sort((a, b) => a - b);
      P.forEach((p, k) => bands[keys[k]].push(percentile(col, p)));
    }
    dep.sort((a, b) => a - b);
    return {
      runs, N, successRate: succ / runs, bands, depletedShare: depByYear.map(c => c / runs),
      depletion: { count: dep.length, median: dep.length ? percentile(dep, 0.5) : null, p10: dep.length ? percentile(dep, 0.1) : null },
    };
  }

  RP.montecarlo = { run, mulberry32, gauss, lnParams, percentile };
})(window.RP);
