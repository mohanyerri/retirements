/* In-browser assertion runner for the calculation engine (open tests.html). */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function close(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || ''} expected ${b}, got ${a}`); }
  function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

  function base() {
    const s = RP.defaults();
    s.assets = [{ name: 'Cash', cls: 'cash', amount: 1e7, targetPct: 100, ret: 0, sd: 0, fee: 0, taxType: 'slabAccrual', costBasisPct: 100, bucket: 1, lockUntilAge: 0 }];
    s.profile = { currentAge: 60, retireAge: 60, planUntil: 90, useSpouse: false, spouseAge: 0, spousePlanUntil: 0, yearsOverride: 0 };
    s.spending = { monthly: 50000, inflation: 0, medicalMonthly: 0, medicalInflation: 0, premiumAnnual: 0, premiumInflation: 0, phases: [] };
    s.presave = { sip: 0, stepUp: 0 };
    s.incomes = []; s.events = [];
    s.tax.enabled = false;
    Object.assign(s.strategy, { order: 'prorata', rebalance: 'none', glideEnabled: false, harvestLTCG: false, legacyToday: 0 });
    return s;
  }

  test('₹1 Cr, 0% return, 0% inflation, ₹50k/month → runs out after exactly 200 months', () => {
    const r = RP.engine.run(base());
    close((r.depletedAge - 60) * 12, 200, 1e-6, 'months');
    assert(!r.success, 'should fail');
  });

  test('₹1 Cr at 8% for 10 years, no withdrawals → ₹2.159 Cr', () => {
    const s = base(); s.assets[0].ret = 8; s.profile = Object.assign(s.profile, { currentAge: 45, retireAge: 70, planUntil: 55 });
    const r = RP.engine.run(s);
    close(r.endBal, 1e7 * Math.pow(1.08, 10), 1, 'FV');
    close(r.endBal / 1e7, 2.1589, 0.0001, 'FV crore');
  });

  test('Withdrawal step-up: ₹50k at 6% → ₹53,000 in year 2, ₹89,542 in year 11', () => {
    const s = base(); s.spending.inflation = 6; s.assets[0].amount = 1e9;
    const r = RP.engine.run(s);
    close(r.rows[1].spend / 12, 53000, 0.01);
    close(r.rows[10].spend / 12, 89542.38, 0.01);
  });

  test('Spending phases: 85% from age 70', () => {
    const s = base(); s.spending.phases = [{ fromAge: 70, pct: 85 }]; s.assets[0].amount = 1e9;
    const r = RP.engine.run(s);
    close(r.rows[9].spend / 12, 50000, 0.01); close(r.rows[10].spend / 12, 42500, 0.01);
  });

  test('LTCG ₹2 L → (2 − 1.25) L × 12.5% = ₹9,375 (before cess)', () => {
    const cfg = Object.assign(RP.defaults().tax, { cessPct: 0 });
    close(RP.tax.compute({ retired: true, age: 65, ltcgEq: 200000 }, cfg).total, 9375, 0.01);
  });

  test('New regime: ₹12 L slab income → zero tax (87A rebate); ₹12.1 L → marginal relief ₹10k', () => {
    const cfg = Object.assign(RP.defaults().tax, { cessPct: 0 });
    close(RP.tax.compute({ retired: true, age: 65, interest: 1200000 }, cfg).total, 0, 0.01);
    close(RP.tax.compute({ retired: true, age: 65, interest: 1210000 }, cfg).total, 10000, 0.01);
    close(RP.tax.compute({ retired: true, age: 65, interest: 2000000 }, cfg).total, 200000, 0.01);
  });

  test('Old regime senior: ₹10 L interest → 80TTB + deductions applied', () => {
    const cfg = Object.assign(RP.defaults().tax, { cessPct: 0, regime: 'old', oldOtherDeductions: 0 });
    // taxable 9.5 L: 0 on 3L, 5% on 2L = 10k, 20% on 4.5L = 90k → 1,00,000
    close(RP.tax.compute({ retired: true, age: 65, interest: 1000000 }, cfg).total, 100000, 0.01);
  });

  test('Monte Carlo with volatility 0 equals deterministic', () => {
    const s = RP.defaults(); s.assets.forEach(a => { a.sd = 0; });
    const d = RP.engine.run(s, { light: true });
    const m = RP.montecarlo.run(s, { runs: 5, seed: 7 });
    close(m.bands.p50[d.N - 1], d.endBal, Math.max(1, d.endBal * 1e-9), 'end balance');
    assert(m.successRate === (d.success ? 1 : 0), 'success rate');
  });

  test('Monte Carlo: same seed → identical output, different seed → different', () => {
    const s = RP.defaults();
    const a = RP.montecarlo.run(s, { runs: 200, seed: 11 }), b = RP.montecarlo.run(s, { runs: 200, seed: 11 }), c = RP.montecarlo.run(s, { runs: 200, seed: 12 });
    assert(JSON.stringify(a) === JSON.stringify(b), 'not reproducible');
    assert(JSON.stringify(a.bands) !== JSON.stringify(c.bands), 'seed has no effect');
  });

  test('Lognormal sampling: median annual return ≈ CAGR input', () => {
    const rng = RP.montecarlo.mulberry32(3), p = RP.montecarlo.lnParams(0.11, 0.18);
    const xs = []; for (let i = 0; i < 20000; i++) xs.push(Math.exp(p.mu + p.sigma * RP.montecarlo.gauss(rng)) - 1);
    xs.sort((a, b) => a - b);
    close(RP.montecarlo.percentile(xs, 0.5), 0.11, 0.01);
  });

  test('Sustainable withdrawal fed back into engine ends near ₹0', () => {
    const s = base(); s.assets[0].ret = 8; s.spending.inflation = 6;
    const x = RP.solver.sustainableMonthly(s);
    s.spending.monthly = x;
    const r = RP.engine.run(s);
    assert(r.success, 'should succeed at solved value');
    assert(r.endBal < 1e7 * 0.05, 'end balance should be ~0 (solver rounds to ₹100/month), got ' + r.endBal);
    s.spending.monthly = x + 500;
    assert(!RP.engine.run(s).success, 'slightly more should fail');
  });

  test('Required corpus makes the plan just succeed', () => {
    const s = base(); s.assets[0].ret = 7; s.spending.inflation = 6; s.spending.monthly = 100000;
    const req = RP.solver.requiredCorpus(s);
    s.assets[0].amount = req; assert(RP.engine.run(s).success, 'req should succeed');
    s.assets[0].amount = req * 0.99; assert(!RP.engine.run(s).success, '99% should fail');
  });

  test('Default plan runs with all features and conserves money (no NaN)', () => {
    for (const order of ['taxefficient', 'bucket', 'prorata']) {
      const s = RP.defaults(); s.strategy.order = order;
      const r = RP.engine.run(s);
      assert(r.rows.every(row => isFinite(row.closing) && row.balances.every(b => b >= -1e-6)), order + ': bad balances');
      r.rows.forEach(row => close(row.opening + row.contrib + row.growth - row.withdrawn + (row.income > 0 ? 0 : 0), row.closing, Math.max(5, row.closing * 1e-6) + surplus(row), order + ' age ' + row.age + ' flow'));
    }
    function surplus(row) { return Math.max(0, row.income - row.spend - row.medical) + 1; }
  });

  test('Locked asset is not withdrawn before unlock age', () => {
    const s = base();
    s.assets.push({ name: 'PPF', cls: 'fixed', amount: 1e7, ret: 0, sd: 0, fee: 0, taxType: 'exempt', costBasisPct: 100, bucket: 2, lockUntilAge: 70 });
    s.assets[0].amount = 1e6;
    const r = RP.engine.run(s);
    close(r.rows[2].balances[1], 1e7, 1, 'PPF untouched at 62');
    assert(r.depletedAge != null && r.depletedAge < 62, 'cash runs out first');
  });

  RP.testResults = results;
  if (typeof document !== 'undefined' && document.getElementById('out')) {
    const pass = results.filter(r => r.ok).length;
    document.getElementById('out').innerHTML =
      `<h2>${pass} / ${results.length} passed</h2><ul>` +
      results.map(r => `<li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.msg}</li>`).join('') + '</ul>';
  } else if (typeof console !== 'undefined') {
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' — ' + r.msg)));
  }
})(window.RP);
