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
      if (d.legend !== 'off') host.appendChild(legend);
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

  /* ───────── Live catalog data (/api/products), fetched once per page ───────── */

  var productsPromise = null;

  function loadProducts() {
    if (!productsPromise) {
      productsPromise = fetch('/api/products', { cache: 'no-store', headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          if (!Array.isArray(d)) throw new Error('Unexpected catalog payload');
          var cats = d.filter(function (x) { return x && typeof x.cat === 'string' && Array.isArray(x.items); })
            .map(function (x) { return { name: x.cat, count: x.items.length }; });
          return { cats: cats, total: cats.reduce(function (s, c) { return s + c.count; }, 0) };
        });
    }
    return productsPromise;
  }

  function useProducts() {
    var st = R.useState({ state: 'loading' });
    R.useEffect(function () {
      var alive = true;
      loadProducts().then(
        function (v) { if (alive) st[1]({ state: v.total ? 'ok' : 'error', data: v }); },
        function () { if (alive) st[1]({ state: 'error' }); });
      return function () { alive = false; };
    }, []);
    return st[0];
  }

  var fmt = function (n) { return Number(n).toLocaleString('id-ID'); };

  // Hero panel card: one honest status line. On failure it renders nothing.
  function CatalogStatus() {
    var h = R.createElement;
    var p = useProducts();
    if (p.state === 'error') return null;
    if (p.state === 'loading') {
      return h('p', { className: 'dm-live is-loading' }, h('i', { className: 'dm-dot', 'aria-hidden': 'true' }), 'Menyinkronkan katalog…');
    }
    return h('p', { className: 'dm-live' }, h('i', { className: 'dm-dot is-live', 'aria-hidden': 'true' }),
      fmt(p.data.total) + ' produk · ' + fmt(p.data.cats.length) + ' kategori · katalog live');
  }

  // Ready Supply card: product count per category as a bar sparkline.
  function CategorySpark() {
    var h = R.createElement;
    var ref = R.useRef(null);
    var p = useProducts();
    var cats = p.state === 'ok' ? p.data.cats.slice().sort(function (a, b) { return b.count - a.count; }).slice(0, 12) : [];
    var top = cats.length ? cats[0].count : 1;

    R.useEffect(function () {
      if (p.state !== 'ok' || reduce || !M || !ref.current) return undefined;
      var bars = ref.current.querySelectorAll('.dm-spark__bar');
      return M.inView(ref.current, function () {
        M.animate(bars, { transform: ['scaleY(0.04)', 'scaleY(1)'] }, { duration: 0.6, ease: EASE, delay: M.stagger(0.035) });
      });
    }, [p.state]);

    if (p.state === 'error') return null;
    if (p.state === 'loading') return h('div', { className: 'dm-spark is-loading', 'aria-hidden': 'true' });
    var label = 'Jumlah produk per kategori: ' + cats.map(function (c) { return c.name + ' ' + c.count; }).join(', ');
    return h('div', { className: 'dm-spark-wrap' },
      h('p', { className: 'dm-spark__caption' },
        h('b', null, fmt(p.data.total)), ' produk aktif · ', fmt(p.data.cats.length), ' kategori'),
      h('div', { ref: ref, className: 'dm-spark', role: 'img', 'aria-label': label },
        cats.map(function (c, i) {
          return h('span', {
            key: c.name, title: c.name + ': ' + c.count,
            className: 'dm-spark__bar' + (i === 0 ? ' is-top' : ''),
            style: { height: Math.max(8, Math.round(c.count / top * 100)) + '%' }
          });
        })));
  }

  // Procurement logistics: sample vs bulk lead time on one shared day scale.
  function LeadTime(props) {
    var h = R.createElement;
    var ref = R.useRef(null);
    R.useEffect(function () {
      if (reduce || !M || !ref.current) return undefined;
      var segs = ref.current.querySelectorAll('.dm-lead__seg');
      return M.inView(ref.current, function () {
        M.animate(segs, { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.8, ease: EASE, delay: M.stagger(0.15) });
      });
    }, []);
    var ticks = [0, 1, 2, 3].map(function (i) { return Math.round(props.max * i / 3); });
    return h('div', { ref: ref, className: 'dm-lead' },
      h('p', { className: 'dm-lead__title' }, 'Lead time (hari)'),
      h('ul', { className: 'dm-lead__rows' },
        props.items.map(function (it, i) {
          return h('li', { key: it.label, className: 'dm-lead__row' + (i ? ' is-bulk' : '') },
            h('span', { className: 'dm-lead__label' }, it.label),
            h('span', { className: 'dm-lead__track', 'aria-hidden': 'true' },
              h('span', { className: 'dm-lead__seg', style: { left: (it.min / props.max * 100) + '%', width: ((it.max - it.min) / props.max * 100) + '%' } })),
            h('span', { className: 'dm-lead__value' }, it.min + '–' + it.max + ' hari'));
        })),
      h('div', { className: 'dm-lead__axis', 'aria-hidden': 'true' },
        ticks.map(function (t) { return h('span', { key: t }, t); })));
  }

  // Working-hours status from the published schedule, in the business's own time zone.
  function Hours(props) {
    var h = R.createElement;
    var compute = function () {
      var now = new Date();
      var local = new Date(now.getTime() + (props.utc * 60 + now.getTimezoneOffset()) * 60000);
      var hr = local.getHours() + local.getMinutes() / 60;
      return props.days.indexOf(local.getDay()) !== -1 && hr >= props.open && hr < props.close;
    };
    var st = R.useState(compute);
    R.useEffect(function () {
      var t = setInterval(function () { st[1](compute()); }, 60000);
      return function () { clearInterval(t); };
    }, []);
    var open = st[0];
    return h(R.Fragment, null,
      h('span', { className: 'dm-pill dm-hours__status' + (open ? ' is-open' : '') },
        h('i', { className: 'dm-dot' + (open ? ' is-live' : ' is-progress'), 'aria-hidden': 'true' }), open ? 'Dalam jam kerja' : 'Di luar jam kerja'),
      props.label ? h('span', { className: 'dm-hours__label' }, props.label) : null);
  }

  // Copy-to-clipboard for contact values.
  function CopyButton(props) {
    var h = R.createElement;
    var st = R.useState(false);
    var timer = R.useRef(0);
    var copy = function () {
      var done = function () {
        st[1](true);
        clearTimeout(timer.current);
        timer.current = setTimeout(function () { st[1](false); }, 1800);
      };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = props.value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* leave the label unchanged */ }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(props.value).then(done, fallback);
      else fallback();
    };
    return h('button', { type: 'button', className: 'dm-pill dm-copy' + (st[0] ? ' is-done' : ''), onClick: copy, 'aria-label': (st[0] ? 'Tersalin: ' : 'Salin ') + props.value },
      h('span', { 'aria-hidden': 'true' }, st[0] ? 'Tersalin' : 'Salin'));
  }

  function mountData() {
    document.querySelectorAll('[data-island="catalog-status"]').forEach(function (host) {
      var slot = document.createElement('div');
      host.appendChild(slot);
      RD.createRoot(slot).render(R.createElement(CatalogStatus));
    });
    document.querySelectorAll('[data-island="category-spark"]').forEach(function (host) {
      var slot = document.createElement('div');
      host.appendChild(slot);
      RD.createRoot(slot).render(R.createElement(CategorySpark));
    });
    document.querySelectorAll('[data-island="leadtime"]').forEach(function (host) {
      var items = String(host.dataset.items || '').split(';').map(function (s) {
        var p = s.split('|');
        return { label: p[0], min: num(p[1], 0), max: num(p[2], 0) };
      }).filter(function (it) { return it.label && it.max > 0; });
      if (!items.length) return;
      RD.createRoot(host).render(R.createElement(LeadTime, { items: items, max: num(host.dataset.max, 45) }));
    });
    document.querySelectorAll('[data-island="hours"]').forEach(function (host) {
      var d = host.dataset;
      RD.createRoot(host).render(R.createElement(Hours, {
        open: num(d.open, 9), close: num(d.close, 17), utc: num(d.utc, 8),
        days: String(d.days || '1,2,3,4,5').split(',').map(Number),
        label: d.label === 'none' ? '' : host.textContent.trim()
      }));
    });
    document.querySelectorAll('[data-copy]').forEach(function (el) {
      var row = document.createElement('div');
      row.className = 'dm-copy-row';
      el.parentNode.insertBefore(row, el);
      row.appendChild(el);
      var slot = document.createElement('span');
      row.appendChild(slot);
      RD.createRoot(slot).render(R.createElement(CopyButton, { value: el.dataset.copy }));
    });
  }

  function start() {
    if (R && RD) {
      mountGauges();
      mountSteppers();
      mountData();
    }
    watchCatalog();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
