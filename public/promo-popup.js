(() => {
  'use strict';
  const URL = '/api/settings/promo-popup';
  const KEY = 'ail_promo_popup_closed_at_v1';
  const ID = 'ail-promo-popup-root';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function styles() {
    if (document.getElementById('ail-promo-popup-styles')) return;
    const s = document.createElement('style');
    s.id = 'ail-promo-popup-styles';
    s.textContent = [
      '#ail-promo-popup-root{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(2,12,19,.74);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);opacity:0;transition:opacity .22s ease}',
      '#ail-promo-popup-root[data-open="true"]{opacity:1}',
      '#ail-promo-popup-root .ail-promo-dialog{position:relative;isolation:isolate;overflow:auto;width:min(100%,520px);max-height:min(90dvh,760px);border:1px solid rgba(103,232,249,.35);border-radius:26px;background:radial-gradient(ellipse at 0% 0%,rgba(34,211,238,.16),transparent 45%),radial-gradient(ellipse at 100% 0%,rgba(251,146,60,.16),transparent 40%),linear-gradient(145deg,#102634,#07141f 72%);color:#eaf7fb;box-shadow:0 32px 100px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);transform:translateY(12px) scale(.985);transition:transform .22s ease;font-family:Inter,system-ui,-apple-system,sans-serif}',
      '#ail-promo-popup-root[data-open="true"] .ail-promo-dialog{transform:translateY(0) scale(1)}',
      '#ail-promo-popup-root .ail-promo-top{height:5px;background:linear-gradient(90deg,#22d3ee,#67e8f9 45%,#fb923c)}',
      '#ail-promo-popup-root .ail-promo-content{padding:clamp(24px,5vw,38px)}',
      '#ail-promo-popup-root .ail-promo-close{position:absolute;right:15px;top:15px;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;border:1px solid rgba(203,235,243,.2);background:rgba(255,255,255,.06);color:#dff8ff;font-size:24px;line-height:1;cursor:pointer}',
      '#ail-promo-popup-root .ail-promo-badge{display:inline-flex;align-items:center;gap:7px;margin:2px 48px 18px 0;padding:7px 11px;border:1px solid rgba(34,211,238,.32);border-radius:999px;background:rgba(34,211,238,.09);color:#a5f3fc;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}',
      '#ail-promo-popup-root .ail-promo-badge:before{content:"";width:6px;height:6px;border-radius:50%;background:#22d3ee;box-shadow:0 0 12px #22d3ee}',
      '#ail-promo-popup-root .ail-promo-title{margin:0 0 12px;color:#f0fbff;font-size:clamp(27px,6vw,40px);font-weight:850;letter-spacing:-.045em;line-height:1.08}',
      '#ail-promo-popup-root .ail-promo-subtitle{margin:0 0 23px;color:#aec7d0;font-size:14px;line-height:1.7}',
      '#ail-promo-popup-root .ail-promo-discount{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 20px;padding:17px 18px;border:1px solid rgba(251,146,60,.28);border-radius:17px;background:linear-gradient(110deg,rgba(251,146,60,.12),rgba(34,211,238,.07))}',
      '#ail-promo-popup-root .ail-promo-discount-label{color:#b6ccd3;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}',
      '#ail-promo-popup-root .ail-promo-discount-value{color:#fdba74;font-size:clamp(24px,5vw,34px);font-weight:900;letter-spacing:-.04em}',
      '#ail-promo-popup-root .ail-promo-note{margin:0 0 23px;color:#91aeb9;font-size:11px;line-height:1.6}',
      '#ail-promo-popup-root .ail-promo-actions{display:flex;gap:10px;flex-wrap:wrap}',
      '#ail-promo-popup-root .ail-promo-cta,#ail-promo-popup-root .ail-promo-secondary{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 17px;border-radius:13px;text-decoration:none;font-size:13px;font-weight:800;cursor:pointer;transition:transform .15s ease,filter .15s ease}',
      '#ail-promo-popup-root .ail-promo-cta{flex:1;background:linear-gradient(120deg,#0891b2,#0e7490);border:1px solid rgba(103,232,249,.35);color:#ecfeff;box-shadow:0 8px 25px rgba(8,145,178,.2)}',
      '#ail-promo-popup-root .ail-promo-secondary{background:rgba(255,255,255,.045);border:1px solid rgba(203,235,243,.17);color:#c9e0e8}',
      '#ail-promo-popup-root .ail-promo-cta:hover,#ail-promo-popup-root .ail-promo-secondary:hover{filter:brightness(1.1);transform:translateY(-1px)}',
      '@media(max-width:480px){#ail-promo-popup-root{padding:12px}#ail-promo-popup-root .ail-promo-dialog{border-radius:22px;max-height:92dvh}#ail-promo-popup-root .ail-promo-content{padding:26px 21px}#ail-promo-popup-root .ail-promo-actions{flex-direction:column}#ail-promo-popup-root .ail-promo-cta,#ail-promo-popup-root .ail-promo-secondary{width:100%;box-sizing:border-box}}',
      '@media(prefers-reduced-motion:reduce){#ail-promo-popup-root,#ail-promo-popup-root .ail-promo-dialog{transition:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function dismissed(hours) {
    if (Number(hours) <= 0) return false;
    try {
      const last = Number(localStorage.getItem(KEY) || 0);
      return last > 0 && Date.now() - last < Number(hours) * 3600000;
    } catch (_) { return false; }
  }
  function close(root, remember) {
    if (remember) { try { localStorage.setItem(KEY, String(Date.now())); } catch (_) {} }
    root.dataset.open = 'false';
    document.body.style.overflow = '';
    window.setTimeout(() => root.remove(), 240);
  }

  function show(settings) {
    if (document.getElementById(ID)) return;
    styles();
    const title = String(settings.title || '').trim() || 'Promo Spesial AIL LABS';
    const subtitle = String(settings.subtitle || '').trim() || 'Temukan penawaran spesial untuk kebutuhan klinik, profesional, dan mitra bisnis Anda.';
    const badge = String(settings.badge || '').trim() || 'Promo Spesial';
    const discount = String(settings.discount || '').trim();
    const note = String(settings.note || '').trim();
    const number = String(settings.whatsapp_number || '').replace(/\D/g, '');
    const message = String(settings.whatsapp_message || '').trim() || 'Halo AIL LABS, saya ingin bertanya tentang promo.';
    const href = number ? 'https://wa.me/' + number + '?text=' + encodeURIComponent(message) : '/contact.html?source=promo-popup';
    const cta = number ? 'Tanya via WhatsApp ↗' : 'Tanya Promo ↗';
    const root = document.createElement('div');
    root.id = ID;
    root.dataset.open = 'false';
    root.innerHTML = '<section class="ail-promo-dialog" role="dialog" aria-modal="true" aria-labelledby="ail-promo-title" aria-describedby="ail-promo-subtitle" tabindex="-1">' +
      '<div class="ail-promo-top"></div><button type="button" class="ail-promo-close" aria-label="Tutup popup promo" title="Tutup">×</button>' +
      '<div class="ail-promo-content"><div class="ail-promo-badge">' + esc(badge) + '</div>' +
      '<h2 class="ail-promo-title" id="ail-promo-title">' + esc(title) + '</h2>' +
      '<p class="ail-promo-subtitle" id="ail-promo-subtitle">' + esc(subtitle) + '</p>' +
      (discount ? '<div class="ail-promo-discount"><span class="ail-promo-discount-label">Penawaran khusus</span><strong class="ail-promo-discount-value">' + esc(discount) + '</strong></div>' : '') +
      (note ? '<p class="ail-promo-note">' + esc(note) + '</p>' : '') +
      '<div class="ail-promo-actions"><a class="ail-promo-cta" href="' + esc(href) + '"' + (number ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + cta + '</a>' +
      '<button type="button" class="ail-promo-secondary">Nanti saja</button></div></div></section>';
    document.body.appendChild(root);
    const dismiss = () => close(root, true);
    root.querySelector('.ail-promo-close').addEventListener('click', dismiss);
    root.querySelector('.ail-promo-secondary').addEventListener('click', dismiss);
    root.addEventListener('click', event => { if (event.target === root) dismiss(); });
    const onKey = event => { if (event.key === 'Escape' && document.getElementById(ID)) { dismiss(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { root.dataset.open = 'true'; root.querySelector('.ail-promo-dialog').focus({preventScroll:true}); });
  }

  async function init() {
    if (document.getElementById(ID)) return;
    try {
      const response = await fetch(URL, {cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const settings = await response.json();
      if (!settings || settings.active !== true || dismissed(settings.reappear_hours == null ? 24 : settings.reappear_hours)) return;
      window.setTimeout(() => show(settings), 650);
    } catch (error) {
      console.warn('[AIL LABS promo popup] Gagal memuat pengaturan promo:', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();