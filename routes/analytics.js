const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

router.use(requireAdmin); // seluruh data analytics/bisnis hanya untuk admin

// ============ GET DASHBOARD STATS ============
router.get('/dashboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE aktif = true) as total_products,
        (SELECT COUNT(DISTINCT session_id) FROM visitors WHERE is_active = true AND last_activity > now() - interval '5 minutes') as current_visitors,
        (SELECT COUNT(*) FROM orders WHERE status != 'batal') as active_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'batal' AND created_at > now() - interval '30 days') as revenue_30days,
        (SELECT COUNT(DISTINCT session_id) FROM visitors WHERE entry_time::date = CURRENT_DATE) as visitors_today
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil ringkasan dashboard.' });
  }
});

// ============ GET TODAY SUMMARY ============
router.get('/today-summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        CURRENT_DATE as date,
        (SELECT COUNT(DISTINCT session_id) FROM visitors WHERE entry_time::date = CURRENT_DATE) as unique_visitors,
        (SELECT COUNT(DISTINCT session_id) FROM page_views WHERE timestamp::date = CURRENT_DATE) as sessions_with_pageviews,
        (SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE AND status != 'batal') as orders_today,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE created_at::date = CURRENT_DATE AND status != 'batal') as revenue_today
    `);
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil ringkasan hari ini.' });
  }
});

// ============ GET DAILY STATS (Last N days) ============
router.get('/daily-stats', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

    const result = await pool.query(`
      SELECT
        d.date,
        d.visitors,
        d.total_sessions,
        COALESCE(o.orders, 0) as orders,
        COALESCE(o.revenue, 0) as revenue,
        d.avg_session_duration_seconds
      FROM (
        SELECT
          entry_time::date as date,
          COUNT(DISTINCT session_id) as visitors,
          COUNT(*) as total_sessions,
          ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::numeric, 0)::int as avg_session_duration_seconds
        FROM visitors
        WHERE entry_time > CURRENT_DATE - ($1 || ' days')::interval
        GROUP BY entry_time::date
      ) d
      LEFT JOIN (
        SELECT created_at::date as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE status != 'batal'
        GROUP BY created_at::date
      ) o ON o.date = d.date
      ORDER BY d.date DESC
    `, [days]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil statistik harian.' });
  }
});

// ============ GET HOURLY TRAFFIC ============
router.get('/hourly-traffic', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('hour', entry_time) as hour,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(*) as sessions
      FROM visitors
      WHERE entry_time > now() - ($1 || ' hours')::interval
      GROUP BY DATE_TRUNC('hour', entry_time)
      ORDER BY hour DESC
    `, [hours]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil traffic per jam.' });
  }
});

// ============ GET TOP PRODUCTS ============
router.get('/top-products', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        COUNT(DISTINCT CASE WHEN e.event_type = 'view_product' THEN e.session_id END) as views,
        COUNT(CASE WHEN e.event_type = 'add_to_cart' THEN 1 END) as add_to_cart,
        COUNT(CASE WHEN e.event_type = 'purchase' THEN 1 END) as purchases
      FROM products p
      LEFT JOIN user_events e
        ON e.event_data->>'product_name' = p.name
        AND e.timestamp > now() - ($1 || ' days')::interval
      GROUP BY p.id, p.name
      ORDER BY views DESC
      LIMIT 10
    `, [days]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil produk terlaris.' });
  }
});

// ============ GET ORDERS STATS ============
router.get('/orders-stats', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

    const result = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total_revenue,
        ROUND(AVG(total)::numeric, 0)::int as avg_value
      FROM orders
      WHERE created_at > now() - ($1 || ' days')::interval
      GROUP BY status
      ORDER BY count DESC
    `, [days]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil statistik pesanan.' });
  }
});

// ============ GET CONVERSION FUNNEL ============
router.get('/conversion-funnel', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 365);

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('day', e.timestamp)::date as date,
        COUNT(DISTINCT CASE WHEN e.event_type = 'view_product' THEN e.session_id END) as visits,
        COUNT(DISTINCT CASE WHEN e.event_type = 'add_to_cart' THEN e.session_id END) as add_to_cart,
        COUNT(DISTINCT CASE WHEN e.event_type = 'checkout_start' THEN e.session_id END) as checkout_start,
        COUNT(DISTINCT CASE WHEN e.event_type = 'purchase' THEN e.session_id END) as purchases,
        ROUND(
          (COUNT(DISTINCT CASE WHEN e.event_type = 'purchase' THEN e.session_id END)::numeric /
           NULLIF(COUNT(DISTINCT CASE WHEN e.event_type = 'view_product' THEN e.session_id END), 0)) * 100,
          2
        ) as conversion_rate
      FROM user_events e
      WHERE e.timestamp > now() - ($1 || ' days')::interval
      GROUP BY date
      ORDER BY date DESC
    `, [days]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil funnel konversi.' });
  }
});

// ============ GET DEVICE/BROWSER DATA ============
router.get('/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        user_agent,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(*) as sessions
      FROM visitors
      WHERE entry_time > now() - interval '7 days'
      GROUP BY user_agent
      ORDER BY visitors DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data perangkat.' });
  }
});

// ============ GET TRAFFIC SOURCES ============
router.get('/traffic-sources', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(referrer, 'direct') as source,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(*) as sessions,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::numeric, 0)::int as avg_duration_seconds
      FROM visitors
      WHERE entry_time > now() - interval '30 days'
      GROUP BY referrer
      ORDER BY visitors DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil sumber traffic.' });
  }
});

// ============ GET BOUNCE RATE ============
router.get('/bounce-rate', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        CURRENT_DATE as date,
        COUNT(DISTINCT v.session_id) as total_sessions,
        COUNT(DISTINCT CASE WHEN pv.id IS NULL THEN v.session_id END) as bounced_sessions,
        ROUND(
          (COUNT(DISTINCT CASE WHEN pv.id IS NULL THEN v.session_id END)::numeric /
           NULLIF(COUNT(DISTINCT v.session_id), 0)) * 100,
          2
        ) as bounce_rate
      FROM visitors v
      LEFT JOIN page_views pv ON v.session_id = pv.session_id
      WHERE v.entry_time::date = CURRENT_DATE
    `);
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil bounce rate.' });
  }
});

module.exports = router;
