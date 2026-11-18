/* Stress tests and automatic planner notes. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);

  function medicalShock(c) {
    const age = Math.max(75, num(c.profile.currentAge) + 1);
    c.events.push({ name: 'Medical emergency', type: 'expense', age, amount: 2500000, inflation: num(c.spending.medicalInflation), repeatEvery: 0, repeatUntil: 0 });
  }
  const SCENARIOS = [
    { name: 'Base plan' },
    { name: 'Equity falls 30% in the first retirement year', opts: { crash: -0.30 } },
    { name: 'Inflation 2% higher (living, medical, premium)', mod: c => { c.spending.inflation = num(c.spending.inflation) + 2; c.spending.medicalInflation = num(c.spending.medicalInflation) + 2; c.spending.premiumInflation = num(c.spending.premiumInflation) + 2; } },
    { name: 'Returns 2% lower on every asset', mod: c => c.assets.forEach(a => { a.ret = num(a.ret) - 2; }) },
    { name: 'Living to 100', mod: c => { c.profile.planUntil = Math.max(100, num(c.profile.planUntil)); c.profile.yearsOverride = 0; } },
    { name: '₹25 L medical emergency at 75 (today\'s ₹)', mod: medicalShock },
    {
      name: 'All of the above together', opts: { crash: -0.30 }, mod: c => SCENARIOS.slice(2, 6).forEach(sc => sc.mod(c)),
    },
  ];

  function stress(s) {
    return SCENARIOS.map(sc => {
      const c = clone(s);
      if (sc.mod) sc.mod(c);
      const r = RP.engine.run(c, Object.assign({ light: true }, sc.opts || {}));
      return { name: sc.name, depletedAge: r.depletedAge, endReal: r.endReal, success: r.success, endAge: num(c.profile.currentAge) + r.N };
    });
  }

  function warnings(s, det, mc) {
    const W = [];
    const add = (level, text) => W.push({ level, text });
    const f = RP.fmt;
    const p = s.profile, sp = s.spending, st = s.strategy;
    const inf = num(sp.inflation);
    const endAge = det.startAge + det.N;

    if (det.depletedAge != null) {
      let t = `Money runs out at age ${f.age(det.depletedAge)}, ${(endAge - det.depletedAge).toFixed(1)} years before the plan ends at ${endAge}.`;
      if (p.useSpouse) t += ` Your spouse would be ${Math.floor(num(p.spouseAge) + det.depletedAge - det.startAge)} then.`;
      add('danger', t);
    } else {
      add('ok', `The corpus lasts to age ${endAge} and leaves ${f.short(det.endReal)} in today's money.`);
    }
    if (det.legacyNominal > 0 && !det.success && det.depletedAge == null) add('warn', `The money lasts, but the legacy target of ${f.short(num(st.legacyToday))} (today's ₹) is not met.`);

    if (mc) {
      const r = mc.successRate;
      const lvl = r >= 0.85 ? 'ok' : r >= 0.7 ? 'warn' : 'danger';
      let t = `${f.pct(r, 0)} of ${mc.runs} simulated market paths succeed. Aim for 85–90% or more.`;
      if (mc.depletion.count) t += ` In the paths that fail, the money typically runs out around age ${f.age(mc.depletion.median)} (or as early as ${f.age(mc.depletion.p10)} in the worst 10%).`;
      add(lvl, t);
    }

    if (det.firstYearWR != null) {
      const wr = det.firstYearWR;
      const lvl = wr > 0.045 ? 'danger' : wr > 0.035 ? 'warn' : 'ok';
      add(lvl, `First-year withdrawal rate is ${f.pct(wr)}. With Indian inflation around 6%, 3–3.5% is the sustainable range for a 30-year retirement, not the US 4% rule.`);
    }

    if (det.eq0 < 0.3) add('warn', `Equity is only ${f.pct(det.eq0, 0)} of the portfolio. Over 25–30 years, fixed income alone rarely beats inflation after tax.`);
    if (det.eq0 > 0.7) add('warn', `Equity is ${f.pct(det.eq0, 0)} of the portfolio. A crash in the first 5 years of retirement (sequence-of-returns risk) can do lasting damage, so keep 2–3 years of expenses in safe assets.`);
    if (!st.glideEnabled && det.eq0 > 0.5) add('info', 'Consider a glide path that slowly reduces equity after retirement.');
    if (st.order === 'bucket' && st.rebalance !== 'none') add('info', 'The bucket strategy refills buckets itself, so the rebalancing setting is ignored.');

    for (const inc of s.incomes || []) {
      if (num(inc.monthly) > 0 && num(inc.growth) < inf - 0.5) {
        const left = Math.pow((1 + num(inc.growth) / 100) / (1 + inf / 100), 20);
        add('info', `"${inc.name}" grows at ${num(inc.growth)}% against ${inf}% inflation. After 20 years it buys only ${f.pct(left, 0)} of what it buys today. Annuities and most pensions are not inflation-linked.`);
      }
    }

    const monthlyToday = num(sp.monthly) + num(sp.medicalMonthly) + num(sp.premiumAnnual) / 12;
    if (num(st.emergencyFund) < 6 * monthlyToday) add('warn', `Emergency fund (${f.short(num(st.emergencyFund))}) is less than 6 months of expenses (${f.short(6 * monthlyToday)}). Keep it outside the plan, in a savings account or sweep-in FD.`);
    if (num(sp.premiumAnnual) <= 0) add('danger', 'No health-insurance premium entered. Medical costs are the most common reason Indian retirement plans fail. Budget for a ₹10–25 L family floater plus a super top-up, and buy it before 55 so waiting periods are over.');
    if (num(sp.medicalInflation) < 8) add('warn', `Medical inflation is set to ${num(sp.medicalInflation)}%. Healthcare costs in India have been rising 10–14% a year.`);
    if (inf < 5) add('warn', `General inflation is set to ${inf}%. India's long-run CPI is about 5–6%, and a retiree's personal inflation is often higher.`);
    if (num(p.planUntil) < 85) add('warn', `The plan stops at ${p.planUntil}. Plan to at least 90–95, because outliving your money is a worse outcome than leaving some behind.`);

    for (const a of s.assets) {
      if (a.cls === 'equity' && num(a.ret) > 13) add('warn', `${a.name}: ${a.ret}% is an optimistic long-run equity return. Nifty 50 has delivered about 11–12% CAGR over 20 years.`);
      if ((a.cls === 'fixed' || a.cls === 'debt') && num(a.ret) > 8.5) add('info', `${a.name}: ${a.ret}% may not last. FD and SCSS rates get reset when they mature (reinvestment risk).`);
      if (a.cls === 'equity' && num(a.fee) > 1) add('info', `${a.name}: a ${a.fee}% fee looks like a regular plan. Direct plans cost about 0.5–1% less a year, which compounds to lakhs.`);
      if (/nps/i.test(a.name)) add('info', `${a.name}: at 60, at least 40% of NPS must buy an annuity, which is taxable and not inflation-linked. Model that part as an income stream.`);
    }
    if (!s.tax.enabled) add('info', 'Tax is turned off, so results are optimistic.');
    if ((s.events || []).some(e => e.type !== 'inflow' && num(e.age) < num(p.retireAge))) add('info', 'Goals before retirement are paid from this corpus. If they are funded separately, remove them here.');
    return W;
  }

  RP.insights = { stress, warnings };
})(window.RP);
