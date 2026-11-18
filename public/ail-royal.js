/* AIL LABS — Royal layer: per-page 3D stage + luxe interactions.
   No dependencies. Canvas-2D with a tiny own 3D projection (no WebGL).
   Scene is chosen by <body data-royal-scene="...">.
   Respects prefers-reduced-motion (one still frame), pauses when the tab is
   hidden, caps DPR, and lightens geometry on small screens. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, body = doc.body;
  if (!body || body.id !== 'ail-domus') return;
  root.classList.add('royal-js');

  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  var sceneName = body.getAttribute('data-royal-scene') || 'crystal';
  var PHI = (1 + Math.sqrt(5)) / 2, TAU = Math.PI * 2;

  /* ---------- tiny helpers ---------- */
  function circle(n, r, plane, y) {
    var v = [], e = [], i, a;
    for (i = 0; i < n; i++) {
      a = i / n * TAU;
      v.push(plane === 'xz' ? [Math.cos(a) * r, y || 0, Math.sin(a) * r]
        : plane === 'xy' ? [Math.cos(a) * r, Math.sin(a) * r, y || 0]
        : [y || 0, Math.cos(a) * r, Math.sin(a) * r]);
      e.push([i, (i + 1) % n]);
    }
    return { v: v, e: e };
  }
  function merge(parts) {
    var v = [], e = [];
    parts.forEach(function (p) {
      var o = v.length;
      p.v.forEach(function (q) { v.push(q); });
      p.e.forEach(function (q) { e.push([q[0] + o, q[1] + o]); });
    });
    return { v: v, e: e };
  }
  function rotX(p, a) { var c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  function rotY(p, a) { var c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  function rotZ(p, a) { var c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
  function nearestEdges(v, maxD2, tol) {
    var e = [], i, j, dx, dy, dz, d2;
    for (i = 0; i < v.length; i++) for (j = i + 1; j < v.length; j++) {
      dx = v[i][0] - v[j][0]; dy = v[i][1] - v[j][1]; dz = v[i][2] - v[j][2];
      d2 = dx * dx + dy * dy + dz * dz;
      if (tol ? Math.abs(d2 - maxD2) < tol : d2 <= maxD2) e.push([i, j]);
    }
    return e;
  }
  function norm(p) { var l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; }
  function ll(lat, lon, r) {
    var la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return [r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo)];
  }

  /* ---------- scene builders: arrays of parts ----------
     part = { v, e, spin:[x,y,z] rad/s, scale, tone:'gold'|'cyan', lw, dots:fn(t)->[[x,y,z,size,tone]] } */
  var small = window.innerWidth < 720;

  function icosa() {
    var v = [], s = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0]], i;
    s.forEach(function (p) { v.push(norm(p)); });
    s.forEach(function (p) { v.push(norm([0, p[0], p[1]])); });
    s.forEach(function (p) { v.push(norm([p[1], 0, p[0]])); });
    // edge length of normalized icosahedron
    var d = Math.sqrt(Math.pow(v[0][0] - v[1][0], 2) + Math.pow(v[0][1] - v[1][1], 2) + Math.pow(v[0][2] - v[1][2], 2));
    return { v: v, e: nearestEdges(v, d * d, 1e-3) };
  }
  function octa() {
    var v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], e = [], i, j;
    for (i = 0; i < 6; i++) for (j = i + 1; j < 6; j++) if (i >> 1 !== j >> 1) e.push([i, j]);
    return { v: v, e: e };
  }

  var SCENES = {
    /* index — faceted crystal with counter-spinning core and halo ring */
    crystal: function () {
      var a = icosa(), b = octa(), ring = circle(64, 1.42, 'xz', 0);
      return [
        { v: a.v, e: a.e, spin: [.10, .22, .04], scale: 1, tone: 'gold', lw: 1.3, dots: function () { return a.v.map(function (p) { return [p[0], p[1], p[2], 2.4, 'cyan']; }); } },
        { v: b.v, e: b.e, spin: [-.20, -.34, .1], scale: .52, tone: 'cyan', lw: 1.1 },
        { v: ring.v, e: ring.e, spin: [.28, .08, 0], scale: 1, tone: 'gold', lw: .8, tilt: [.9, 0, .3],
          dots: function (t) { var k = t * .6; return [[Math.cos(k) * 1.42, 0, Math.sin(k) * 1.42, 3.2, 'gold']]; } }
      ];
    },
    /* catalog — carousel ring of product vials */
    vials: function () {
      var N = small ? 8 : 12, parts = [], i, k, a, cx, cz, seg = 10, h = .46, r = .15, vs = [], es = [];
      function ringAt(y, rr, cx, cz, off) {
        var base = vs.length, j;
        for (j = 0; j < seg; j++) { vs.push([cx + Math.cos(j / seg * TAU) * rr, y, cz + Math.sin(j / seg * TAU) * rr]); es.push([base + j, base + (j + 1) % seg]); }
        return base;
      }
      for (i = 0; i < N; i++) {
        a = i / N * TAU; cx = Math.cos(a) * 1.15; cz = Math.sin(a) * 1.15;
        var b0 = ringAt(-h, r, cx, cz), b1 = ringAt(h * .55, r, cx, cz), b2 = ringAt(h * .7, r * .62, cx, cz), b3 = ringAt(h, r * .62, cx, cz);
        for (k = 0; k < seg; k += 3) { es.push([b0 + k, b1 + k]); }
        es.push([b1, b2]); es.push([b1 + 5, b2 + 5]); es.push([b2, b3]); es.push([b2 + 5, b3 + 5]);
      }
      var ring = circle(72, 1.15, 'xz', -h - .08), ring2 = circle(72, 1.15, 'xz', h + .12);
      return [
        { v: vs, e: es, spin: [0, .30, 0], scale: 1, tone: 'gold', lw: 1.1, tilt: [.42, 0, 0] },
        { v: ring.v, e: ring.e, spin: [0, .30, 0], scale: 1, tone: 'cyan', lw: .8, tilt: [.42, 0, 0] },
        { v: ring2.v, e: ring2.e, spin: [0, .30, 0], scale: 1, tone: 'cyan', lw: .8, tilt: [.42, 0, 0] }
      ];
    },
    /* private-label — molecule lattice */
    molecule: function () {
      var n = small ? 12 : 18, v = [], i, y, r, a;
      for (i = 0; i < n; i++) { y = 1 - (i + .5) / n * 2; r = Math.sqrt(1 - y * y); a = i * 2.399963; v.push([Math.cos(a) * r * .95, y * .95, Math.sin(a) * r * .95]); }
      v.push([0, 0, 0]);
      var e = nearestEdges(v, 1.05 * 1.05, 0).filter(function (q) { return q[0] !== q[1]; });
      for (i = 0; i < n; i += 3) e.push([i, n]);
      return [{
        v: v, e: e, spin: [.08, .26, .05], scale: 1, tone: 'gold', lw: 1.1,
        dots: function (t) { return v.map(function (p, i) { return [p[0], p[1], p[2], (i === n ? 7 : 3.6) + Math.sin(t * 1.6 + i) * 1, i % 3 === 0 ? 'cyan' : 'gold']; }); }
      }];
    },
    /* procurement — supply-route globe */
    globe: function () {
      var lines = [], i, m = small ? 6 : 8;
      for (i = -2; i <= 2; i++) { var lat = i * 28, rr = Math.cos(lat * Math.PI / 180), c = circle(48, rr, 'xz', Math.sin(lat * Math.PI / 180)); lines.push(c); }
      for (i = 0; i < m; i++) { var c2 = circle(48, 1, 'xy', 0); c2.v = c2.v.map(function (p) { return rotY(p, i / m * Math.PI); }); lines.push(c2); }
      var g = merge(lines);
      var hubs = [[37.5, 127], [22.5, 114], [41, 29], [48.8, 2.3], [35.7, 139.7], [40.7, -74]], dest = ll(-6.2, 106.8, 1), arcs = [];
      hubs.forEach(function (h) {
        var A = ll(h[0], h[1], 1), pts = [], s;
        for (s = 0; s <= 24; s++) { var t = s / 24, p = norm([A[0] * (1 - t) + dest[0] * t, A[1] * (1 - t) + dest[1] * t, A[2] * (1 - t) + dest[2] * t]), lift = 1 + Math.sin(t * Math.PI) * .32; pts.push([p[0] * lift, p[1] * lift, p[2] * lift]); }
        arcs.push(pts);
      });
      var ae = [], av = [];
      arcs.forEach(function (pts) { var o = av.length; pts.forEach(function (p, k) { av.push(p); if (k) ae.push([o + k - 1, o + k]); }); });
      return [
        { v: g.v, e: g.e, spin: [0, .12, 0], scale: 1, tone: 'cyan', lw: .7, tilt: [.38, 0, .18] },
        { v: av, e: ae, spin: [0, .12, 0], scale: 1, tone: 'gold', lw: 1.3, tilt: [.38, 0, .18],
          dots: function (t) { return arcs.map(function (pts, i) { var f = (t * .22 + i / arcs.length) % 1, k = Math.min(23, Math.floor(f * 24)), p = pts[k]; return [p[0], p[1], p[2], 3.4, 'gold']; }).concat(hubs.map(function (h) { var p = ll(h[0], h[1], 1.01); return [p[0], p[1], p[2], 2.6, 'cyan']; })).concat([[dest[0] * 1.01, dest[1] * 1.01, dest[2] * 1.01, 5.5 + Math.sin(t * 3) * 1.2, 'gold']]); } }
      ];
    },
    /* compliance — armillary seal: nested rings + core */
    seal: function () {
      var r1 = circle(72, 1.4, 'xy', 0), r2 = circle(72, 1.12, 'yz', 0), r3 = circle(72, .86, 'xz', 0), core = octa(), ticks = [], i;
      for (i = 0; i < 48; i++) { var a = i / 48 * TAU, c = Math.cos(a), s = Math.sin(a), l = i % 4 ? .06 : .12; ticks.push({ v: [[c * 1.4, s * 1.4, 0], [c * (1.4 + l), s * (1.4 + l), 0]], e: [[0, 1]] }); }
      var tk = merge(ticks);
      return [
        { v: r1.v, e: r1.e, spin: [.14, .10, 0], scale: 1, tone: 'gold', lw: 1.4 },
        { v: tk.v, e: tk.e, spin: [.14, .10, 0], scale: 1, tone: 'gold', lw: .8 },
        { v: r2.v, e: r2.e, spin: [-.10, .26, .08], scale: 1, tone: 'cyan', lw: 1.1 },
        { v: r3.v, e: r3.e, spin: [.22, -.16, .05], scale: 1, tone: 'gold', lw: 1.1 },
        { v: core.v, e: core.e, spin: [.3, .5, .2], scale: .34, tone: 'cyan', lw: 1.2, dots: function (t) { return [[0, 0, 0, 5 + Math.sin(t * 2.4) * 1.5, 'gold']]; } }
      ];
    },
    /* about — double helix */
    helix: function () {
      var n = small ? 44 : 70, turns = 3, v = [], e = [], rungs = [], i, a, y, H = 2.5;
      for (i = 0; i < n; i++) { a = i / (n - 1) * turns * TAU; y = (i / (n - 1) - .5) * H; v.push([Math.cos(a) * .5, y, Math.sin(a) * .5]); }
      for (i = 0; i < n; i++) { a = i / (n - 1) * turns * TAU + Math.PI; y = (i / (n - 1) - .5) * H; v.push([Math.cos(a) * .5, y, Math.sin(a) * .5]); }
      for (i = 1; i < n; i++) { e.push([i - 1, i]); e.push([n + i - 1, n + i]); }
      for (i = 0; i < n; i += 3) e.push([i, n + i]);
      return [{ v: v, e: e, spin: [0, .34, 0], scale: 1, tone: 'gold', lw: 1.2, tilt: [0, 0, .42],
        dots: function (t) { var out = [], k; for (k = 0; k < n; k += 3) { out.push([v[k][0], v[k][1], v[k][2], 2.6, 'cyan']); out.push([v[n + k][0], v[n + k][1], v[n + k][2], 2.6, 'gold']); } return out; } }];
    },
    /* contact — (2,3) torus knot with a travelling spark */
    knot: function () {
      var n = small ? 120 : 200, v = [], e = [], i, t, R, p, q = 3, pp = 2;
      for (i = 0; i < n; i++) { t = i / n * TAU; R = Math.cos(q * t) + 2; v.push([R * Math.cos(pp * t) * .38, R * Math.sin(pp * t) * .38, -Math.sin(q * t) * .5]); e.push([i, (i + 1) % n]); }
      return [{ v: v, e: e, spin: [.16, .24, .06], scale: 1, tone: 'gold', lw: 1.6,
        dots: function (t) { var k = Math.floor(((t * .12) % 1) * n); return [[v[k][0], v[k][1], v[k][2], 6, 'cyan']]; } }];
    }
  };

  var parts = (SCENES[sceneName] || SCENES.crystal)();

  /* ---------- stage ---------- */
  var cv = doc.createElement('canvas'); cv.id = 'royal-stage'; cv.setAttribute('aria-hidden', 'true');
  var au = doc.createElement('div'); au.id = 'royal-aurora'; au.setAttribute('aria-hidden', 'true');
  var gr = doc.createElement('div'); gr.id = 'royal-grain'; gr.setAttribute('aria-hidden', 'true');
  var pr = doc.createElement('div'); pr.id = 'royal-progress'; pr.setAttribute('aria-hidden', 'true');
  body.insertBefore(au, body.firstChild); body.insertBefore(cv, body.firstChild);
  body.appendChild(gr); body.appendChild(pr);
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, dpr = 1, raf = 0, t0 = performance.now(), px = 0, py = 0, tx = 0, ty = 0, sy = 0;

  var TONES = {
    dark: { gold: [236, 210, 154], cyan: [94, 215, 223] },
    light: { gold: [150, 108, 28], cyan: [8, 112, 121] }
  };

  function resize() {
    small = window.innerWidth < 720;
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.6);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    var t = Math.max(0, (now - t0) / 1000), dark = mqDark.matches, pal = dark ? TONES.dark : TONES.light;
    px += (tx - px) * .05; py += (ty - py) * .05;
    ctx.clearRect(0, 0, W, H);
    var wide = W >= 1024, mid = W >= 720;
    var R = wide ? Math.min(W * .26, H * .42) : mid ? Math.min(W * .30, H * .30) : W * .36;
    var cx = wide ? W * .73 : W * .5;
    var cy = (wide ? H * .46 : mid ? H * .30 : H * .20) - sy * .22;
    var fade = Math.max(.16, 1 - sy / (H * 1.25));
    var base = (dark ? .95 : .62) * fade;
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    ctx.lineCap = 'round';
    var CAM = 3.6;

    parts.forEach(function (pt) {
      var col = pal[pt.tone], sp = pt.spin, tl = pt.tilt || [0, 0, 0];
      var ax = sp[0] * t + tl[0] + py * .5, ay = sp[1] * t + tl[1] + px * .7, az = sp[2] * t + tl[2];
      function proj(p) {
        var q = [p[0] * pt.scale, p[1] * pt.scale, p[2] * pt.scale];
        q = rotZ(rotX(rotY(q, ay), ax), az);
        var k = CAM / (CAM - q[2]);
        return [cx + q[0] * k * R, cy - q[1] * k * R, q[2]];
      }
      var P = pt.v.map(proj), i, e, a, b, al;
      ctx.lineWidth = pt.lw;
      for (i = 0; i < pt.e.length; i++) {
        e = pt.e[i]; a = P[e[0]]; b = P[e[1]];
        al = Math.max(.12, Math.min(1, .55 + (a[2] + b[2]) * .28)) * base;
        ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + al.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      if (pt.dots) {
        var D = pt.dots(t), j, d, pp, c2, rad;
        for (j = 0; j < D.length; j++) {
          d = D[j]; pp = proj([d[0], d[1], d[2]]); c2 = pal[d[4]];
          al = Math.max(.25, Math.min(1, .6 + pp[2] * .3)) * Math.min(1, base * 1.25);
          rad = d[3] * (small ? .8 : 1) * (1 + pp[2] * .12);
          var gdt = ctx.createRadialGradient(pp[0], pp[1], 0, pp[0], pp[1], rad * 3.2);
          gdt.addColorStop(0, 'rgba(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ',' + al.toFixed(3) + ')');
          gdt.addColorStop(.35, 'rgba(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ',' + (al * .35).toFixed(3) + ')');
          gdt.addColorStop(1, 'rgba(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ',0)');
          ctx.fillStyle = gdt; ctx.beginPath(); ctx.arc(pp[0], pp[1], rad * 3.2, 0, TAU); ctx.fill();
        }
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(now) { frame(now); raf = requestAnimationFrame(loop); }
  function start() { if (!raf && !mqReduce.matches && !doc.hidden) raf = requestAnimationFrame(loop); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function still() { frame(t0 + 3200); }

  resize();
  if (mqReduce.matches) still(); else start();

  window.addEventListener('resize', function () { resize(); if (mqReduce.matches) still(); }, { passive: true });
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) stop(); else start(); });
  function onMq() { stop(); if (mqReduce.matches) still(); else start(); }
  (mqReduce.addEventListener ? mqReduce.addEventListener('change', onMq) : mqReduce.addListener(onMq));
  (mqDark.addEventListener ? mqDark.addEventListener('change', function () { if (mqReduce.matches) still(); }) : 0);

  window.addEventListener('pointermove', function (e) {
    tx = (e.clientX / W - .5) * 2; ty = (e.clientY / H - .5) * 2;
  }, { passive: true });

  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      sy = window.scrollY || 0;
      var max = Math.max(1, doc.documentElement.scrollHeight - H);
      root.style.setProperty('--royal-progress', Math.min(1, sy / max).toFixed(4));
      if (mqReduce.matches) still();
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- luxe interactions (skipped entirely for reduced motion) ---------- */
  var CARD = '.feature,.card,.category,.compliance-card,.stat,.step,.about-aside';
  var REVEAL = 'main .section,main .feature,main .card,main .category,main .compliance-card,main .stat,main .step,main .cta,main .about-aside,main article[data-product],main > div,main > section > .container > *';

  if (!mqReduce.matches) {
    var els = [].slice.call(doc.querySelectorAll(REVEAL)), seen = new Set();
    els = els.filter(function (el) { if (seen.has(el)) return false; seen.add(el); return !el.closest('header,nav,.lg-dock,.mobile-menu'); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('is-in'); io.unobserve(x.target); } });
      }, { threshold: .08, rootMargin: '0px 0px -6% 0px' });
      els.forEach(function (el, i) { el.classList.add('royal-rv'); el.style.setProperty('--rv-i', String(i % 4)); io.observe(el); });
    }

    if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
      doc.addEventListener('pointermove', function (e) {
        var c = e.target.closest && e.target.closest(CARD);
        if (!c) return;
        var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        c.style.transform = 'perspective(900px) rotateX(' + ((.5 - y) * 5).toFixed(2) + 'deg) rotateY(' + ((x - .5) * 6).toFixed(2) + 'deg) translateZ(0)';
      }, { passive: true });
      doc.addEventListener('pointerout', function (e) {
        var c = e.target.closest && e.target.closest(CARD);
        if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
      }, { passive: true });
    }
  }
})();
