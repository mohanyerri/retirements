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

  const SIMPLE_KEY = 'rp.simple.v1', TAB_KEY = 'rp.tab.v1';
  function loadSimple() {
    const def = RP.simple ? RP.simple.SIMPLE_DEFAULTS : {};
    try { const raw = localStorage.getItem(SIMPLE_KEY); if (raw) return merge(clone(def), JSON.parse(raw)); } catch (e) { /* ignore */ }
    return clone(def);
  }
  function saveSimple(v) { try { localStorage.setItem(SIMPLE_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function loadTab() { try { return localStorage.getItem(TAB_KEY) || 'simple'; } catch (e) { return 'simple'; } }
  function saveTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch (e) { /* ignore */ } }

  const BUCKET_KEY = 'rp.bucket.v1';
  function loadBucket() {
    const def = RP.bucket ? RP.bucket.BUCKET_DEFAULTS : {};
    try { const raw = localStorage.getItem(BUCKET_KEY); if (raw) { const v = merge(clone(def), JSON.parse(raw)); if (!Array.isArray(v.b) || v.b.length !== 3) v.b = clone(def.b); return v; } } catch (e) { /* ignore */ }
    return clone(def);
  }
  function saveBucket(v) { try { localStorage.setItem(BUCKET_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  RP.state = { load, save, loadScenarios, saveScenarios, merge, clone, loadSimple, saveSimple, loadTab, saveTab, loadBucket, saveBucket };
})(window.RP);
