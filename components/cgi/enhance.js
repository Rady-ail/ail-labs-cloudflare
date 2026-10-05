import { detectTier, prefersReducedMotion } from './tier.js';

// Efek DOM progresif di atas UI yang sudah ada. Tier rendah: tidak ada efek (statis).
let started = false;

export function enhance() {
  if (started) return;
  started = true;
  const tier = detectTier();
  document.documentElement.dataset.cgiTier = tier;
  if (tier === 'low') return;
  startParallax();
  startReveal(document.getElementById('root'));
}

// Parallax latar: geser lapisan .cgi-backdrop__drift pelan mengikuti scroll (rAF, passive).
function startParallax() {
  const drift = document.querySelector('.cgi-backdrop__drift');
  if (!drift) return;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const y = prefersReducedMotion() ? 0 : Math.min(scrollY, 2400) * -0.05;
    drift.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
  apply();
}

// Reveal bertahap: elemen di bawah layar muncul halus saat masuk viewport.
// Elemen yang sudah terlihat saat dipindai tidak pernah disembunyikan.
const REVEAL_SELECTOR = '#productGroups .section-block, .info-card, .contact-card, .cart-summary';
const REVEAL_STAGGER_MS = 70;

function startReveal(root) {
  if (!root || !('IntersectionObserver' in window)) return;
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    let i = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      el.style.transitionDelay = `${Math.min(i++, 4) * REVEAL_STAGGER_MS}ms`;
      el.classList.add('cgi-reveal-in');
      io.unobserve(el);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

  let raf = 0;
  const scan = () => {
    raf = 0;
    const reduced = prefersReducedMotion();
    for (const el of root.querySelectorAll(REVEAL_SELECTOR)) {
      if (seen.has(el) || el.offsetParent === null) continue;
      seen.add(el);
      if (reduced || el.getBoundingClientRect().top < innerHeight) continue;
      el.classList.add('cgi-reveal');
      io.observe(el);
    }
  };
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); })
    .observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  scan();
}
