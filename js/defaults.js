/* Default inputs and FY 2025-26 tax tables. Every value is editable in the UI.
   Conventions: percentages are stored as plain numbers (11 = 11%), money in ₹. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';

  RP.OPTIONS = {
    cls: [
      ['equity', 'Equity'], ['debt', 'Debt / bonds'], ['fixed', 'Fixed income'],
      ['cash', 'Cash / liquid'], ['gold', 'Gold'], ['other', 'Other'],
    ],
    taxType: [
      ['equity', 'Equity LTCG (12.5% above ₹1.25 L)'],
      ['slabRedeem', 'Slab rate on redemption (debt MF)'],
      ['slabAccrual', 'Slab rate yearly (FD interest)'],
      ['ltcgOther', 'LTCG 12.5% (gold, REIT, international)'],
      ['exempt', 'Tax-free (PPF / EPF)'],
    ],
    incomeTax: [
      ['pension', 'Pension / annuity (standard deduction)'],
      ['rent', 'Rent (30% deduction)'],
      ['slab', 'Other taxable'],
      ['exempt', 'Tax-free'],
    ],
    eventType: [['expense', 'Expense (goal)'], ['inflow', 'Inflow']],
    bucket: [['1', '1 · near-term'], ['2', '2 · medium'], ['3', '3 · growth']],
  };

  RP.defaults = function () {
    return {
      version: 1,
      profile: {
        currentAge: 45, retireAge: 60, planUntil: 90,
        useSpouse: false, spouseAge: 42, spousePlanUntil: 92,
        yearsOverride: 0,
      },
      allocMode: 'amounts',          // 'amounts' | 'percent'
      totalCorpus: 12000000,         // used when allocMode = 'percent'
      assets: [
        { name: 'Equity mutual funds', cls: 'equity', amount: 6000000, targetPct: 50, ret: 11, sd: 18, fee: 0.5, taxType: 'equity', costBasisPct: 60, bucket: 3, lockUntilAge: 0 },
        { name: 'Debt mutual funds', cls: 'debt', amount: 2000000, targetPct: 17, ret: 7, sd: 3, fee: 0.3, taxType: 'slabRedeem', costBasisPct: 85, bucket: 2, lockUntilAge: 0 },
        { name: 'FD / SCSS / RBI bonds', cls: 'fixed', amount: 1500000, targetPct: 12, ret: 7.25, sd: 0, fee: 0, taxType: 'slabAccrual', costBasisPct: 100, bucket: 1, lockUntilAge: 0 },
        { name: 'Liquid fund / savings', cls: 'cash', amount: 500000, targetPct: 4, ret: 6, sd: 0.5, fee: 0.2, taxType: 'slabAccrual', costBasisPct: 100, bucket: 1, lockUntilAge: 0 },
        { name: 'PPF / EPF', cls: 'fixed', amount: 2000000, targetPct: 17, ret: 7.1, sd: 0, fee: 0, taxType: 'exempt', costBasisPct: 100, bucket: 2, lockUntilAge: 0 },
      ],
      spending: {
        monthly: 75000, inflation: 6,
        medicalMonthly: 5000, medicalInflation: 10,
        premiumAnnual: 60000, premiumInflation: 12,
        phases: [{ fromAge: 70, pct: 85 }, { fromAge: 80, pct: 75 }],
      },
      presave: { sip: 50000, stepUp: 5 },
      incomes: [
        { name: 'Rental income', monthly: 20000, startAge: 60, endAge: 90, growth: 4, tax: 'rent' },
      ],
      events: [
        { name: "Child's wedding", type: 'expense', age: 52, amount: 2500000, inflation: 6, repeatEvery: 0, repeatUntil: 0 },
        { name: 'Car replacement', type: 'expense', age: 62, amount: 1200000, inflation: 5, repeatEvery: 8, repeatUntil: 78 },
        { name: 'Gratuity + leave encashment', type: 'inflow', age: 60, amount: 1500000, inflation: 5, repeatEvery: 0, repeatUntil: 0 },
      ],
      strategy: {
        order: 'taxefficient',       // 'taxefficient' | 'bucket' | 'prorata'
        bucket1Years: 2, bucket2Years: 5,
        rebalance: 'annual',         // 'none' | 'annual' | 'threshold'
        rebalanceThreshold: 5,
        glideEnabled: true, glideStep: 1, glideFloor: 30,
        harvestLTCG: true,
        emergencyFund: 600000,
        legacyToday: 0,
      },
      tax: {
        enabled: true,
        regime: 'new',
        workingMarginalRate: 30,
        cessPct: 4,
        ltcgRate: 12.5, ltcgExempt: 125000, ltcgOtherRate: 12.5,
        newSlabs: '400000:0, 800000:5, 1200000:10, 1600000:15, 2000000:20, 2400000:25, max:30',
        newStdDeduction: 75000, newRebateLimit: 1200000, newRebateMax: 60000,
        oldSlabsBelow60: '250000:0, 500000:5, 1000000:20, max:30',
        oldSlabs60to80: '300000:0, 500000:5, 1000000:20, max:30',
        oldSlabs80plus: '500000:0, 1000000:20, max:30',
        oldStdDeduction: 50000, oldRebateLimit: 500000, oldRebateMax: 12500,
        oldOtherDeductions: 50000, senior80TTB: 50000,
      },
      sim: { mode: 'mc', runs: 1000, seed: 42, corrEqDebt: 0.1, display: 'real' },
    };
  };

  RP.NEW_ITEMS = {
    assets: () => ({ name: 'New asset', cls: 'debt', amount: 0, targetPct: 0, ret: 7, sd: 3, fee: 0.3, taxType: 'slabRedeem', costBasisPct: 100, bucket: 2, lockUntilAge: 0 }),
    incomes: () => ({ name: 'Pension', monthly: 0, startAge: 60, endAge: 100, growth: 0, tax: 'pension' }),
    events: () => ({ name: 'Goal', type: 'expense', age: 65, amount: 500000, inflation: 6, repeatEvery: 0, repeatUntil: 0 }),
    phases: () => ({ fromAge: 75, pct: 90 }),
  };
})(window.RP);
