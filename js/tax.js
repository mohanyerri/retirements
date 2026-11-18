/* Indian income-tax approximation for a retiree (FY 2025-26 defaults).
   Not covered: surcharge (income > ₹50 L), STCG, loss carry-forward. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const n = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);

  /** "400000:0, 800000:5, max:30" → [{upto, rate}] (rate as a fraction) */
  function parseSlabs(str) {
    return String(str || '').split(',').map(p => p.trim()).filter(Boolean).map(p => {
      const [u, r] = p.split(':').map(x => x.trim());
      return { upto: /max|inf/i.test(u) ? Infinity : n(u), rate: n(r) / 100 };
    }).sort((a, b) => a.upto - b.upto);
  }

  function slabTax(income, slabs) {
    let tax = 0, prev = 0;
    for (const s of slabs) {
      if (income <= prev) break;
      tax += (Math.min(income, s.upto) - prev) * s.rate;
      prev = s.upto;
    }
    return tax;
  }

  /**
   * inp: { retired, age, interest, slabGains, pension, rent, otherSlab, ltcgEq, ltcgOther }  (annual ₹)
   * returns { slab, cg, total } including cess
   */
  function compute(inp, cfg) {
    const cess = 1 + n(cfg.cessPct) / 100;
    const ltcgEqTax = Math.max(0, n(inp.ltcgEq) - n(cfg.ltcgExempt)) * n(cfg.ltcgRate) / 100;
    const ltcgOtherTax = Math.max(0, n(inp.ltcgOther)) * n(cfg.ltcgOtherRate) / 100;
    const cg = ltcgEqTax + ltcgOtherTax;

    const rent = n(inp.rent) * 0.7;            // 30% standard deduction on house property
    const pension = n(inp.pension);
    const interest = n(inp.interest);
    const other = n(inp.otherSlab) + n(inp.slabGains);
    let slab = 0, income = 0, regime = 'working', std = 0, deductions = 0, rebate = 0, slabsUsed = null;

    if (!inp.retired) {
      // Still earning a salary: portfolio income stacks on top at your marginal rate.
      income = interest + other + rent + pension;
      slab = income * n(cfg.workingMarginalRate) / 100;
    } else if (cfg.regime === 'old') {
      const age = n(inp.age);
      regime = 'old';
      const slabs = slabsUsed = parseSlabs(age >= 80 ? cfg.oldSlabs80plus : age >= 60 ? cfg.oldSlabs60to80 : cfg.oldSlabsBelow60);
      std = Math.min(pension, pension > 0 ? n(cfg.oldStdDeduction) : 0);
      const interestDed = age >= 60 ? Math.min(interest, n(cfg.senior80TTB)) : 0;
      deductions = interestDed + n(cfg.oldOtherDeductions);
      income = Math.max(0, pension - std + rent + interest + other - deductions);
      slab = slabTax(income, slabs);
      if (income <= n(cfg.oldRebateLimit)) { rebate = Math.min(slab, n(cfg.oldRebateMax)); slab -= rebate; }
    } else {
      regime = 'new';
      slabsUsed = parseSlabs(cfg.newSlabs);
      std = Math.min(pension, pension > 0 ? n(cfg.newStdDeduction) : 0);
      income = Math.max(0, pension - std + rent + interest + other);
      slab = slabTax(income, slabsUsed);
      const lim = n(cfg.newRebateLimit);
      if (income <= lim) { rebate = Math.min(slab, n(cfg.newRebateMax)); slab -= rebate; }   // Sec 87A rebate (not on LTCG)
      else if (slab > income - lim) { rebate = slab - (income - lim); slab = income - lim; }   // marginal relief
    }
    return {
      slab: slab * cess, cg: cg * cess, total: (slab + cg) * cess,
      detail: {
        regime, income, std, deductions, rebate, slabsUsed, slabBeforeCess: slab, cessPct: n(cfg.cessPct),
        marginalRate: n(cfg.workingMarginalRate),
        interest, slabGains: n(inp.slabGains), rentGross: n(inp.rent), rent, pension, otherSlab: n(inp.otherSlab),
        ltcgEq: n(inp.ltcgEq), ltcgExempt: n(cfg.ltcgExempt), ltcgRate: n(cfg.ltcgRate), ltcgEqTax,
        ltcgOther: n(inp.ltcgOther), ltcgOtherRate: n(cfg.ltcgOtherRate), ltcgOtherTax,
      },
    };
  }

  RP.tax = { compute, parseSlabs, slabTax };
})(window.RP);
