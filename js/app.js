/* Bootstraps the app: tab switching (Simple / Extensive) and lazy, debounced recomputation. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const TABS = ['simple', 'extensive', 'bucket'];
  let timer = null, extDirty = true, current = null;
  RP.app = { state: null };

  // ---------- Extensive planner ----------
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
  }
  function safeCompute() {
    extDirty = false;
    try { compute(); } catch (e) { console.error(e); RP.ui.showError(e); }
  }
  // Called on every Extensive input change. Save immediately; only recompute if the tab is visible.
  function schedule() {
    RP.state.save(RP.app.state);
    extDirty = true;
    clearTimeout(timer);
    if (current === 'extensive') timer = setTimeout(safeCompute, 250);
  }
  function replaceState(ns) {
    RP.app.state = RP.state.merge(RP.defaults(), ns);
    RP.state.save(RP.app.state);
    RP.ui.refreshAll();
    extDirty = true;
    if (current === 'extensive') safeCompute();
  }

  // ---------- Tabs ----------
  function showTab(name) {
    if (!TABS.includes(name)) name = 'simple';
    current = name;
    TABS.forEach(t => { document.getElementById('tab-' + t).hidden = t !== name; });
    document.querySelectorAll('[data-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    document.querySelectorAll('[data-tab-only]').forEach(el => { el.hidden = el.dataset.tabOnly !== name; });
    if (location.hash !== '#' + name) {
      try { history.replaceState(null, '', location.pathname + location.search + '#' + name); } catch (e) { /* e.g. sandboxed file:// */ }
    }
    RP.state.saveTab(name);
    if (name === 'extensive' && extDirty) safeCompute();
    if (name === 'simple') RP.simple.ensureComputed();
    if (name === 'bucket') RP.bucket.ensureComputed();
    RP.anim.replayPanel(document.getElementById('tab-' + name));
  }

  RP.app.replaceState = replaceState;
  RP.app.showTab = showTab;

  document.addEventListener('DOMContentLoaded', () => {
    RP.app.state = RP.state.load();
    RP.ui.init({ onChange: schedule, replaceState });
    RP.simple.init();
    RP.bucket.init();
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) showTab(b.dataset.tab);
    });
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
    const fromHash = location.hash.slice(1);
    showTab(TABS.includes(fromHash) ? fromHash : RP.state.loadTab());
  });
})(window.RP);
