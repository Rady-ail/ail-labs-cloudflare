/**
 * AIL Labs - Visitor Tracking Script
 * Disematkan otomatis di public/index.html sebagai <script src="/visitor-tracker.js">
 * Selalu memanggil API di origin yang sama (tidak perlu diisi manual).
 */

class VisitorTracker {
  constructor() {
    this.sessionId = this.getOrCreateSession();
    this.pageStartTime = Date.now();
    this.eventQueue = [];
    this.init();
  }

  init() {
    this.trackPageView();
    window.addEventListener('beforeunload', () => this.endSession());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.recordPageTime();
    });
    setInterval(() => this.flushEvents(), 30000);
  }

  // ============ SESSION MANAGEMENT ============
  getOrCreateSession() {
    let sessionId = localStorage.getItem('ail_session_id');
    let isNew = false;
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem('ail_session_id', sessionId);
      isNew = true;
    }
    if (isNew) this.trackNewVisitor(sessionId);
    return sessionId;
  }

  trackNewVisitor(sessionId) {
    this.send('/api/visitors/track', {
      session_id: sessionId,
      page_visited: window.location.pathname,
      referrer: document.referrer || 'direct'
    });
  }

  // ============ PAGE TRACKING ============
  trackPageView() {
    this.pageStartTime = Date.now();
    this.send('/api/visitors/track', {
      session_id: this.sessionId,
      page_visited: window.location.pathname + window.location.search,
      referrer: document.referrer || 'direct'
    });
  }

  recordPageTime() {
    const duration = Date.now() - this.pageStartTime;
    this.send('/api/visitors/page-view', {
      session_id: this.sessionId,
      page_path: window.location.pathname,
      duration_ms: duration
    }, false);
  }

  // ============ EVENT TRACKING ============
  trackEvent(eventType, eventData = {}) {
    this.queueEvent({ session_id: this.sessionId, event_type: eventType, event_data: eventData });
    if (eventType === 'purchase') this.flushEvents();
  }

  // Katalog tidak punya product id di sisi klien, jadi nama produk dipakai
  // sebagai identifier (lihat catatan di routes/analytics.js top-products).
  trackProductView(productName) {
    this.trackEvent('view_product', { product_name: productName });
  }

  trackAddToCart(productName, quantity, price) {
    this.trackEvent('add_to_cart', {
      product_name: productName, quantity, price, total: quantity * price
    });
  }

  trackCheckoutStart(cartValue, itemCount) {
    this.trackEvent('checkout_start', { cart_value: cartValue, item_count: itemCount });
  }

  trackPurchase(total, items) {
    this.trackEvent('purchase', { total, item_count: items.length });
  }

  // ============ SESSION END ============
  endSession() {
    this.recordPageTime();
    navigator.sendBeacon('/api/visitors/end-session', JSON.stringify({ session_id: this.sessionId }));
  }

  // ============ EVENT QUEUE & BATCH SENDING ============
  queueEvent(event) {
    this.eventQueue.push(event);
    if (this.eventQueue.length >= 50) this.flushEvents();
  }

  flushEvents() {
    if (this.eventQueue.length === 0) return;
    const events = [...this.eventQueue];
    this.eventQueue = [];
    events.forEach(event => this.send('/api/visitors/event', event, false));
  }

  send(endpoint, data, showError) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(err => {
      if (showError) console.warn('Tracker gagal mengirim:', err.message);
    });
  }
}

window.TRACKER = new VisitorTracker();
