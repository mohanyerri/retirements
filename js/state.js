/* Persistence: current plan + saved scenarios in localStorage. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const KEY = 'rp.state.v1';
  const SKEY = 'rp.scenarios.v1';

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  /** Fill missing keys of src from def (so older saved plans pick up new fields). */
  function merge(def, src) {
    if (!isObj(src)) return def;
    const out = {};
    for (const k of Object.keys(def)) {
      if (!(k in src)) out[k] = def[k];
      else if (isObj(def[k])) out[k] = merge(def[k], src[k]);
      else out[k] = src[k];
    }
    for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return merge(RP.defaults(), JSON.parse(raw));
    } catch (e) { console.warn('Could not load saved plan', e); }
    return RP.defaults();
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full / disabled */ } }

  function loadScenarios() {
    try { const raw = localStorage.getItem(SKEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  function saveScenarios(list) { try { localStorage.setItem(SKEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }

  RP.state = { load, save, loadScenarios, saveScenarios, merge, clone };
})(window.RP);
