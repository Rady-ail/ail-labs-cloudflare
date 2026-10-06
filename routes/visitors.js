const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

// Jendela "aktif": pengunjung dianggap masih di situs jika last_activity-nya
// dalam 5 menit terakhir. Ini menggantikan flag is_active mentah, yang tidak
// pernah kadaluarsa kalau browser ditutup paksa (endSession via sendBeacon
// tidak selalu terkirim, mis. koneksi mati / app di-kill di HP).
const ACTIVE_WINDOW = "last_activity > now() - interval '5 minutes'";

async function ensureIdentityColumns() {
  await pool.query(`
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS camera_permission TEXT;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS camera_permission_at TIMESTAMPTZ;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_permission TEXT;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_permission_at TIMESTAMPTZ;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS identity_consent_at TIMESTAMPTZ;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS identity_photo_data TEXT;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS identity_photo_captured_at TIMESTAMPTZ;
  `);
}

router.post('/identity', async (req, res) => {
  try {
    await ensureIdentityColumns();
    const { session_id, camera_permission, location_permission, latitude, longitude, accuracy, consent, photo_data } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });
    if (!/^sess_[A-Za-z0-9_-]{10,120}$/.test(String(session_id))) return res.status(400).json({ error: 'session_id tidak valid.' });
    const camera = ['granted','denied','prompt','unsupported'].includes(camera_permission) ? camera_permission : null;
    const location = ['granted','denied','prompt','unsupported'].includes(location_permission) ? location_permission : null;
    const hasCoords = location === 'granted' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
    const lat = hasCoords ? Number(latitude) : null;
    const lng = hasCoords ? Number(longitude) : null;
    const acc = hasCoords && Number.isFinite(Number(accuracy)) ? Math.min(Math.max(Number(accuracy), 0), 100000) : null;
    const explicitConsent = consent === true;
    let photo = null;
    if (photo_data) {
      if (!explicitConsent) return res.status(400).json({ error: 'Persetujuan foto wajib diberikan.' });
      if (typeof photo_data !== 'string' || !/^data:image\\/jpeg;base64,/.test(photo_data) || photo_data.length > 320000) return res.status(413).json({ error: 'Foto tidak valid atau terlalu besar.' });
      photo = photo_data;
    }
    const result = await pool.query(
      `UPDATE visitors SET
        camera_permission = COALESCE($2, camera_permission),
        camera_permission_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE camera_permission_at END,
        location_permission = COALESCE($3, location_permission),
        location_permission_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE location_permission_at END,
        location_lat = COALESCE($4, location_lat), location_lng = COALESCE($5, location_lng),
        location_accuracy = COALESCE($6, location_accuracy),
        identity_consent_at = CASE WHEN $7 THEN now() ELSE identity_consent_at END,
        identity_photo_data = COALESCE($8, identity_photo_data),
        identity_photo_captured_at = CASE WHEN $8 IS NOT NULL THEN now() ELSE identity_photo_captured_at END,
        last_activity = now()
       WHERE session_id = $1
       RETURNING session_id, camera_permission, camera_permission_at, location_permission, location_permission_at, location_lat, location_lng, location_accuracy, identity_consent_at, identity_photo_captured_at`,
      [session_id, camera, location, lat, lng, acc, explicitConsent, photo]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Session pengunjung tidak ditemukan.' });
    res.json({ ok: true, identity: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Gagal menyimpan status identitas pengunjung.' }); }
});

router.get('/identity-monitor', requireAdmin, async (req, res) => {
  try {
    await ensureIdentityColumns();
    const result = await pool.query(
      `SELECT id, session_id, page_visited, entry_time, last_activity, ip_address,
              camera_permission, camera_permission_at, location_permission, location_permission_at,
              location_lat, location_lng, location_accuracy,
              identity_consent_at, identity_photo_data, identity_photo_captured_at
       FROM visitors WHERE last_activity > now() - interval '24 hours'
       ORDER BY last_activity DESC LIMIT 100`
    );
    res.json({ count: result.rows.length, visitors: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Gagal mengambil monitor identitas pengunjung.' }); }
});


// ============ GET CURRENT ACTIVE VISITORS (admin) ============
router.get('/active', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id, session_id, ip_address, page_visited, entry_time,
        EXTRACT(EPOCH FROM (now() - entry_time))::int as duration_seconds
       FROM visitors
       WHERE is_active = true AND ${ACTIVE_WINDOW}
       ORDER BY entry_time DESC
       LIMIT 50`
    );
    res.json({
      count: result.rows.length,
      visitors: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil pengunjung aktif.' });
  }
});

// ============ GET TODAY VISITORS STATS (admin) ============
router.get('/today', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) as total_sessions,
        AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::int as avg_duration_seconds,
        MAX(entry_time) as latest_visitor
       FROM visitors
       WHERE entry_time::date = CURRENT_DATE`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil statistik hari ini.' });
  }
});

// ============ GET HOURLY TRAFFIC (24 HOURS) (admin) ============
router.get('/traffic-24h', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        DATE_TRUNC('hour', entry_time) as hour,
        COUNT(DISTINCT session_id) as visitors,
        COUNT(*) as sessions
       FROM visitors
       WHERE entry_time > now() - interval '24 hours'
       GROUP BY DATE_TRUNC('hour', entry_time)
       ORDER BY hour DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil traffic 24 jam.' });
  }
});

// ============ TRACK NEW VISITOR (publik — dipanggil oleh visitor-tracker.js) ============
router.post('/track', async (req, res) => {
  try {
    const { session_id, page_visited, referrer } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });

    // IP diambil dari request di server, BUKAN dari client (client tidak
    // pernah tahu IP publiknya sendiri secara andal).
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';

    const existing = await pool.query('SELECT id FROM visitors WHERE session_id = $1', [session_id]);

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE visitors
         SET last_activity = now(), page_visited = $2, is_active = true
         WHERE session_id = $1
         RETURNING *`,
        [session_id, page_visited || '/']
      );
    } else {
      result = await pool.query(
        `INSERT INTO visitors (session_id, ip_address, user_agent, page_visited, referrer)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [session_id, ip, userAgent, page_visited || '/', referrer || 'direct']
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mencatat pengunjung.' });
  }
});

// ============ TRACK PAGE VIEW (publik) ============
router.post('/page-view', async (req, res) => {
  try {
    const { session_id, page_path, duration_ms } = req.body || {};
    if (!session_id || !page_path) return res.status(400).json({ error: 'Data tidak lengkap.' });

    await pool.query(
      `UPDATE visitors SET last_activity = now() WHERE session_id = $1`,
      [session_id]
    );

    const result = await pool.query(
      `INSERT INTO page_views (session_id, page_path, duration_ms)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [session_id, page_path, duration_ms || 0]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mencatat page view.' });
  }
});

// ============ TRACK USER EVENT (publik) ============
router.post('/event', async (req, res) => {
  try {
    const { session_id, event_type, event_data } = req.body || {};
    if (!session_id || !event_type) return res.status(400).json({ error: 'Data tidak lengkap.' });

    await pool.query(
      `UPDATE visitors SET last_activity = now() WHERE session_id = $1`,
      [session_id]
    );

    const result = await pool.query(
      `INSERT INTO user_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [session_id, event_type, event_data || {}]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mencatat event.' });
  }
});

// ============ END VISITOR SESSION (publik — via sendBeacon) ============
router.post('/end-session', async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });

    const result = await pool.query(
      `UPDATE visitors
       SET is_active = false, exit_time = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - entry_time))::int * 1000
       WHERE session_id = $1
       RETURNING *`,
      [session_id]
    );

    res.json(result.rows[0] || { message: 'Session ended' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengakhiri sesi.' });
  }
});

// ============ GET VISITOR HISTORY (Last N days) (admin) ============
router.get('/history/days', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);

    const result = await pool.query(
      `SELECT
        entry_time::date as date,
        COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) as total_sessions,
        AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::int as avg_duration_seconds
       FROM visitors
       WHERE entry_time > CURRENT_DATE - ($1 || ' days')::interval
       GROUP BY entry_time::date
       ORDER BY date DESC`,
      [days]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil riwayat pengunjung.' });
  }
});

// ============ GET VISITOR DETAILS (admin) ============
// Catatan: rute parameter ':session_id' sengaja diletakkan PALING BAWAH
// supaya tidak "menangkap" path literal seperti /active, /today, /history
// di atasnya (urutan route di Express itu penting).
router.get('/:session_id', requireAdmin, async (req, res) => {
  try {
    const { session_id } = req.params;

    const visitor = await pool.query('SELECT * FROM visitors WHERE session_id = $1', [session_id]);
    const pageviews = await pool.query(
      'SELECT * FROM page_views WHERE session_id = $1 ORDER BY timestamp DESC',
      [session_id]
    );
    const events = await pool.query(
      'SELECT * FROM user_events WHERE session_id = $1 ORDER BY timestamp DESC',
      [session_id]
    );

    if (!visitor.rows[0]) return res.status(404).json({ error: 'Pengunjung tidak ditemukan.' });

    res.json({
      visitor: visitor.rows[0],
      pageviews: pageviews.rows,
      events: events.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail pengunjung.' });
  }
});

module.exports = router;
