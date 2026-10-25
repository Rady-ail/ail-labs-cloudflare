/* AIL LABS — interactive islands for the Domus skin.
   No build step: plain React.createElement against /vendor React 18 and Motion 11 (window.Motion).
   Every island enhances markup that already reads fine without JavaScript, and renders static
   under prefers-reduced-motion. */
(function () {
  'use strict';

  var R = window.React;
  var RD = window.ReactDOM;
  var M = window.Motion;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var EASE = [0.2, 0.75, 0.2, 1];

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  /* ───────── Temperature range gauge (home hero stat "2–25°C") ───────── */

  function polar(cx, cy, r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function arcPath(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a0);
    var p1 = polar(cx, cy, r, a1);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }

  function Gauge(props) {
    var h = R.createElement;
    var ref = R.useRef(null);
    var SWEEP = 240;
    var start = -SWEEP / 2;
    var angle = function (v) {
      var t = (v - props.scaleMin) / (props.scaleMax - props.scaleMin);
      return start + Math.max(0, Math.min(1, t)) * SWEEP;
    };
    var cx = 50, cy = 48, r = 36, rIn = 26;

    R.useEffect(function () {
      if (reduce || !M || !ref.current) return undefined;
      var bands = ref.current.querySelectorAll('[data-draw]');
      // Motion animates SVG attributes, so the start state is an attribute too (a style would override it).
      bands.forEach(function (el) { el.setAttribute('stroke-dashoffset', '1'); });
      return M.inView(ref.current, function () {
        M.animate(bands, { strokeDashoffset: [1, 0] }, { duration: 1.1, ease: EASE, delay: M.stagger(0.18) });
      });
    }, []);

    var lo = polar(cx, cy, r + 9, angle(props.min));
    var hi = polar(cx, cy, r + 9, angle(props.max));

    return h('svg', { ref: ref, className: 'dm-gauge', viewBox: '0 0 100 84', role: 'presentation', focusable: 'false' },
      h('path', { className: 'dm-gauge__track', d: arcPath(cx, cy, r, start, start + SWEEP) }),
      h('path', { className: 'dm-gauge__band', 'data-draw': '', pathLength: 1, d: arcPath(cx, cy, r, angle(props.min), angle(props.max)) }),
      h('path', { className: 'dm-gauge__track dm-gauge__track--inner', d: arcPath(cx, cy, rIn, start, start + SWEEP) }),
      h('path', { className: 'dm-gauge__cold', 'data-draw': '', pathLength: 1, d: arcPath(cx, cy, rIn, angle(props.coldMin), angle(props.coldMax)) }),
      h('text', { className: 'dm-gauge__tick', x: lo[0], y: lo[1] + 3, textAnchor: 'middle' }, props.min + '°'),
      h('text', { className: 'dm-gauge__tick', x: hi[0], y: hi[1] + 3, textAnchor: 'middle' }, props.max + '°'),
      h('text', { className: 'dm-gauge__unit', x: cx, y: cy + 4, textAnchor: 'middle' }, '°C')
    );
  }

  function mountGauges() {
    document.querySelectorAll('[data-island="temp-gauge"]').forEach(function (host) {
      var d = host.dataset;
      var slot = document.createElement('div');
      slot.className = 'dm-gauge-slot';
      slot.setAttribute('aria-hidden', 'true');
      var legend = document.createElement('small');
      legend.className = 'dm-gauge-legend';
      legend.textContent = (d.coldMin || '2') + '–' + (d.coldMax || '8') + '°C cold chain';
      host.appendChild(slot);
      host.appendChild(legend);
      host.classList.add('has-gauge');
      RD.createRoot(slot).render(R.createElement(Gauge, {
        min: num(d.min, 2), max: num(d.max, 25),
        coldMin: num(d.coldMin, 2), coldMax: num(d.coldMax, 8),
        scaleMin: num(d.scaleMin, 0), scaleMax: num(d.scaleMax, 30)
      }));
    });
  }

  /* ───────── Procurement stepper (01–04) ───────── */

  function Stepper(props) {
    var h = R.createElement;
    var ref = R.useRef(null);
    var total = props.steps.length;
    var all = reduce || !M;
    var state = R.useState(all ? total : 0);
    var active = state[0];
    var setActive = state[1];

    R.useEffect(function () {
      var el = ref.current;
      if (!el) return undefined;
      if (all) { el.style.setProperty('--dm-progress', '1'); return undefined; }
      return M.scroll(function (p) {
        el.style.setProperty('--dm-progress', p.toFixed(3));
        var n = Math.min(total, Math.floor(p * total + 0.35));
        setActive(function (prev) { return prev === n ? prev : n; });
      }, { target: el, offset: ['start 88%', 'end 55%'] });
    }, []);

    return h('div', { ref: ref, className: 'dm-stepper', style: { '--dm-steps': total } },
      h('span', { className: 'dm-stepper__track', 'aria-hidden': 'true' },
        h('span', { className: 'dm-stepper__fill' })),
      h('ol', { className: 'dm-stepper__list' },
        props.steps.map(function (s, i) {
          return h('li', { key: i, className: 'dm-step' + (i < active ? ' is-active' : '') },
            h('span', { className: 'dm-step__node' }, s.num),
            h('h3', { className: 'dm-step__title' }, s.title),
            h('p', { className: 'dm-step__desc' }, s.desc));
        })
      )
    );
  }

  function mountSteppers() {
    document.querySelectorAll('[data-island="stepper"]').forEach(function (host) {
      var steps = Array.prototype.map.call(host.children, function (c) {
        var n = c.querySelector('span');
        var t = c.querySelector('h3');
        var p = c.querySelector('p');
        return { num: n ? n.textContent.trim() : '', title: t ? t.textContent.trim() : '', desc: p ? p.textContent.trim() : '' };
      }).filter(function (s) { return s.title; });
      if (!steps.length) return;
      var wrap = document.createElement('div');
      wrap.className = 'dm-stepper-wrap';
      host.parentNode.insertBefore(wrap, host.nextSibling);
      host.hidden = true;
      RD.createRoot(wrap).render(R.createElement(Stepper, { steps: steps }));
    });
  }

  /* ───────── Catalog cards: staggered entrance as the catalog script renders them ───────── */

  function watchCatalog() {
    var root = document.getElementById('productGroups');
    if (!root || reduce || !M) return;
    var seen = new WeakSet();
    new MutationObserver(function () {
      var fresh = Array.prototype.filter.call(root.querySelectorAll('article[data-product]'), function (a) {
        if (seen.has(a)) return false;
        seen.add(a);
        return true;
      }).slice(0, 16);
      if (fresh.length) {
        M.animate(fresh, { opacity: [0, 1], transform: ['translateY(14px)', 'translateY(0)'] },
          { duration: 0.45, ease: EASE, delay: M.stagger(0.04) });
      }
    }).observe(root, { childList: true, subtree: true });
  }

  function start() {
    if (R && RD) {
      mountGauges();
      mountSteppers();
    }
    watchCatalog();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
