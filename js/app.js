/* Bootstraps the app and recomputes (debounced) whenever an input changes. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  let timer = null;
  RP.app = { state: null };

  function compute() {
    const s = RP.app.state;
    const det = RP.engine.run(s);
    const mc = s.sim.mode === 'mc'
      ? RP.montecarlo.run(s, { runs: Math.max(100, Math.min(5000, num(s.sim.runs) || 1000)), seed: num(s.sim.seed) })
      : null;
    const solve = RP.solver.all(s);
    const stress = RP.insights.stress(s);
    const warnings = RP.insights.warnings(s, det, mc);
    RP.ui.renderResults({ s, det, mc, solve, stress, warnings });
    RP.ui.clearError();
    RP.state.save(s);
  }
  function safeCompute() {
    try { compute(); } catch (e) { console.error(e); RP.ui.showError(e); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(safeCompute, 250); }
  function replaceState(ns) {
    RP.app.state = RP.state.merge(RP.defaults(), ns);
    RP.ui.refreshAll();
    safeCompute();
  }

  document.addEventListener('DOMContentLoaded', () => {
    RP.app.state = RP.state.load();
    RP.ui.init({ onChange: schedule, replaceState });
    safeCompute();
  });
})(window.RP);
