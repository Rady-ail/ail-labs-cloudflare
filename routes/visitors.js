const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

// Jendela "aktif": pengunjung dianggap masih di situs jika last_activity-nya
// dalam 5 menit terakhir. Ini menggantikan flag is_active mentah, yang tidak
// pernah kadaluarsa kalau browser ditutup paksa (endSession via sendBeacon
// tidak selalu terkirim, mis. koneksi mati / app di-kill di HP).
const ACTIVE_WINDOW = "last_activity > now() - interval '5 minutes'";
let permissionColumnsReady = false;
(async () => {
  try {
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS camera_permission TEXT');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS camera_permission_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_permission TEXT');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_permission_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION');
    await pool.query('ALTER TABLE visitors ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION');
    permissionColumnsReady = true;
  } catch (err) { console.error('Visitor permission migration failed:', err.message); }
})();

// ============ GET CURRENT ACTIVE VISITORS (admin) ============
router.get('/active', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id, session_id, ip_address, page_visited, entry_time,
        camera_permission, camera_permission_at, location_permission, location_permission_at,
        latitude, longitude, location_accuracy_m,
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


router.post('/permissions', async (req, res) => {
  try {
    const { session_id, camera_status, location_status, latitude, longitude, accuracy_m } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });
    if (!permissionColumnsReady) return res.status(503).json({ error: 'Permission storage belum siap.' });
    const allowed = new Set(['granted','denied','unsupported']);
    if (camera_status && !allowed.has(camera_status)) return res.status(400).json({ error: 'camera_status tidak valid.' });
    if (location_status && !allowed.has(location_status)) return res.status(400).json({ error: 'location_status tidak valid.' });
    const lat = Number(latitude), lon = Number(longitude), acc = Number(accuracy_m);
    const hasLocation = location_status === 'granted' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    const result = await pool.query(
      `UPDATE visitors SET
        camera_permission = COALESCE($2, camera_permission),
        camera_permission_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE camera_permission_at END,
        location_permission = COALESCE($3, location_permission),
        location_permission_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE location_permission_at END,
        latitude = CASE WHEN $3 = 'granted' AND $4::boolean THEN $5 ELSE latitude END,
        longitude = CASE WHEN $3 = 'granted' AND $4::boolean THEN $6 ELSE longitude END,
        location_accuracy_m = CASE WHEN $3 = 'granted' AND $4::boolean THEN $7 ELSE location_accuracy_m END,
        last_activity = now()
       WHERE session_id = $1
       RETURNING session_id, camera_permission, camera_permission_at, location_permission, location_permission_at, latitude, longitude, location_accuracy_m`,
      [session_id, camera_status || null, location_status || null, hasLocation, hasLocation ? lat : null, hasLocation ? lon : null, hasLocation && Number.isFinite(acc) ? acc : null]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Session tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan status izin.' });
  }
});


// ============ CONSENT-BASED CAMERA / LOCATION / IDENTITY ============
let permissionTablesReady = false;
async function ensurePermissionTables(){
  if(permissionTablesReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_permissions (id SERIAL PRIMARY KEY,session_id TEXT UNIQUE NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,camera_status TEXT NOT NULL DEFAULT 'not-requested',location_status TEXT NOT NULL DEFAULT 'not-requested',latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,accuracy DOUBLE PRECISION,page TEXT,consent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_identities (id SERIAL PRIMARY KEY,session_id TEXT UNIQUE NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,photo_data TEXT NOT NULL,consent BOOLEAN NOT NULL DEFAULT false,page TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_visitor_permissions_updated ON visitor_permissions(updated_at DESC)'); permissionTablesReady=true;
}
router.post('/permissions', async (req,res)=>{try{await ensurePermissionTables();const {session_id,camera_status,location_status,latitude,longitude,accuracy,page}=req.body||{};if(!session_id)return res.status(400).json({error:'session_id wajib diisi.'});const cam=['granted','denied','prompt','not-requested','not-available','unsupported'].includes(camera_status)?camera_status:'not-requested';const loc=['granted','denied','prompt','not-requested','unsupported'].includes(location_status)?location_status:'not-requested';const lat=loc==='granted'&&Number.isFinite(Number(latitude))?Number(latitude):null;const lon=loc==='granted'&&Number.isFinite(Number(longitude))?Number(longitude):null;const acc=loc==='granted'&&Number.isFinite(Number(accuracy))?Math.min(Math.max(Number(accuracy),0),100000):null;const result=await pool.query(`INSERT INTO visitor_permissions(session_id,camera_status,location_status,latitude,longitude,accuracy,page,consent_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $3='granted' OR $2='granted' THEN now() ELSE NULL END,now()) ON CONFLICT(session_id) DO UPDATE SET camera_status=$2,location_status=$3,latitude=CASE WHEN $3='granted' THEN $4 ELSE visitor_permissions.latitude END,longitude=CASE WHEN $3='granted' THEN $5 ELSE visitor_permissions.longitude END,accuracy=CASE WHEN $3='granted' THEN $6 ELSE visitor_permissions.accuracy END,page=COALESCE($7,visitor_permissions.page),updated_at=now(),consent_at=CASE WHEN $3='granted' OR $2='granted' THEN COALESCE(visitor_permissions.consent_at,now()) ELSE visitor_permissions.consent_at END RETURNING *`,[session_id,cam,loc,lat,lon,acc,String(page||'').slice(0,500)||null]);res.json(result.rows[0]);}catch(err){console.error('[visitor/permissions]',err);res.status(500).json({error:'Gagal menyimpan status izin.'})}});
router.post('/identity', async (req,res)=>{try{await ensurePermissionTables();const {session_id,photo_data,consent,page}=req.body||{};if(!session_id||consent!==true||typeof photo_data!=='string')return res.status(400).json({error:'Persetujuan dan foto wajib diisi.'});if(!/^data:image\\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo_data)||photo_data.length>450000)return res.status(400).json({error:'Format atau ukuran foto tidak valid.'});const result=await pool.query(`INSERT INTO visitor_identities(session_id,photo_data,consent,page) VALUES($1,$2,true,$3) ON CONFLICT(session_id) DO UPDATE SET photo_data=EXCLUDED.photo_data,consent=true,page=EXCLUDED.page,created_at=now() RETURNING id,session_id,created_at`,[session_id,photo_data,String(page||'').slice(0,500)||null]);res.json({ok:true,identity:result.rows[0]})}catch(err){console.error('[visitor/identity]',err);res.status(500).json({error:'Gagal menyimpan foto profil.'})}});
router.get('/permission-monitor', requireAdmin, async (req,res)=>{try{await ensurePermissionTables();const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),500);const result=await pool.query(`SELECT p.session_id,p.camera_status,p.location_status,p.latitude,p.longitude,p.accuracy,p.page,p.consent_at,p.updated_at,i.photo_data,i.created_at FROM visitor_permissions p LEFT JOIN visitor_identities i ON i.session_id=p.session_id ORDER BY p.updated_at DESC LIMIT $1`,[limit]);res.json({count:result.rows.length,visitors:result.rows})}catch(err){console.error('[visitor/permission-monitor]',err);res.status(500).json({error:'Gagal mengambil monitor pengunjung.'})}});

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
