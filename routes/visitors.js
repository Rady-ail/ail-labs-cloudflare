const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

const ACTIVE_WINDOW = "last_activity > now() - interval '5 minutes'";
let permissionTablesReady = false;

async function ensurePermissionTables(){
  if(permissionTablesReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_permissions (
    id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,
    camera_status TEXT NOT NULL DEFAULT 'not-requested',
    page TEXT,
    consent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS visitor_identities (
    id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,
    photo_data TEXT NOT NULL,
    consent BOOLEAN NOT NULL DEFAULT false,
    page TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retention_until TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_visitor_permissions_updated ON visitor_permissions(updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC)');
  permissionTablesReady=true;
}

router.get('/active', requireAdmin, async (req, res) => {
  try {
    await ensurePermissionTables();
    const result = await pool.query(
      `SELECT v.id, v.session_id, v.page_visited, v.entry_time,
        p.camera_status, p.consent_at,
        EXTRACT(EPOCH FROM (now() - v.entry_time))::int as duration_seconds
       FROM visitors v
       LEFT JOIN visitor_permissions p ON p.session_id=v.session_id
       WHERE v.is_active = true AND ${ACTIVE_WINDOW}
       ORDER BY v.entry_time DESC LIMIT 50`
    );
    res.json({count: result.rows.length, visitors: result.rows});
  } catch (err) {
    console.error('[visitor/active]', err);
    res.status(500).json({ error: 'Gagal mengambil pengunjung aktif.' });
  }
});

router.get('/today', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) as total_sessions,
        AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::int as avg_duration_seconds,
        MAX(entry_time) as latest_visitor
       FROM visitors WHERE entry_time::date = CURRENT_DATE`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[visitor/today]', err);
    res.status(500).json({ error: 'Gagal mengambil statistik hari ini.' });
  }
});

router.get('/traffic-24h', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DATE_TRUNC('hour', entry_time) as hour,
        COUNT(DISTINCT session_id) as visitors, COUNT(*) as sessions
       FROM visitors WHERE entry_time > now() - interval '24 hours'
       GROUP BY DATE_TRUNC('hour', entry_time) ORDER BY hour DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[visitor/traffic-24h]', err);
    res.status(500).json({ error: 'Gagal mengambil traffic 24 jam.' });
  }
});

router.post('/track', async (req, res) => {
  try {
    const { session_id, page_visited, referrer } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';
    const existing = await pool.query('SELECT id FROM visitors WHERE session_id = $1', [session_id]);
    let result;
    if (existing.rows.length) {
      result = await pool.query(
        `UPDATE visitors SET last_activity = now(), page_visited = $2, is_active = true
         WHERE session_id = $1 RETURNING *`, [session_id, page_visited || '/']
      );
    } else {
      result = await pool.query(
        `INSERT INTO visitors (session_id, ip_address, user_agent, page_visited, referrer)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [session_id, ip, userAgent, page_visited || '/', referrer || 'direct']
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[visitor/track]', err);
    res.status(500).json({ error: 'Gagal mencatat pengunjung.' });
  }
});

router.post('/page-view', async (req, res) => {
  try {
    const { session_id, page_path, duration_ms } = req.body || {};
    if (!session_id || !page_path) return res.status(400).json({ error: 'Data tidak lengkap.' });
    await pool.query('UPDATE visitors SET last_activity = now() WHERE session_id = $1', [session_id]);
    const result = await pool.query(
      `INSERT INTO page_views (session_id, page_path, duration_ms)
       VALUES ($1, $2, $3) RETURNING *`, [session_id, page_path, duration_ms || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[visitor/page-view]', err);
    res.status(500).json({ error: 'Gagal mencatat page view.' });
  }
});

router.post('/event', async (req, res) => {
  try {
    const { session_id, event_type, event_data } = req.body || {};
    if (!session_id || !event_type) return res.status(400).json({ error: 'Data tidak lengkap.' });
    await pool.query('UPDATE visitors SET last_activity = now() WHERE session_id = $1', [session_id]);
    const result = await pool.query(
      `INSERT INTO user_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3) RETURNING *`, [session_id, event_type, event_data || {}]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[visitor/event]', err);
    res.status(500).json({ error: 'Gagal mencatat event.' });
  }
});

router.post('/end-session', async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });
    const result = await pool.query(
      `UPDATE visitors SET is_active = false, exit_time = now(),
        duration_ms = EXTRACT(EPOCH FROM (now() - entry_time))::int * 1000
       WHERE session_id = $1 RETURNING *`, [session_id]
    );
    res.json(result.rows[0] || { message: 'Session ended' });
  } catch (err) {
    console.error('[visitor/end-session]', err);
    res.status(500).json({ error: 'Gagal mengakhiri sesi.' });
  }
});

router.get('/history/days', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const result = await pool.query(
      `SELECT entry_time::date as date, COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(*) as total_sessions,
        AVG(EXTRACT(EPOCH FROM (COALESCE(exit_time, last_activity) - entry_time)))::int as avg_duration_seconds
       FROM visitors WHERE entry_time > CURRENT_DATE - ($1 || ' days')::interval
       GROUP BY entry_time::date ORDER BY date DESC`, [days]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[visitor/history]', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat pengunjung.' });
  }
});

// Single consent-based permission endpoint. Location/GPS is deliberately unsupported.
router.post('/permissions', async (req, res) => {
  try {
    await ensurePermissionTables();
    const { session_id, camera_status, page, consent } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id wajib diisi.' });
    if (consent !== true) return res.status(400).json({ error: 'Persetujuan eksplisit diperlukan.' });
    const session = await pool.query('SELECT session_id FROM visitors WHERE session_id=$1', [session_id]);
    if (!session.rows[0]) return res.status(404).json({ error: 'Session pengunjung belum tercatat.' });
    const allowed = new Set(['granted','denied','prompt','not-requested','not-available','unsupported']);
    const cam = allowed.has(camera_status) ? camera_status : 'not-requested';
    const result = await pool.query(
      `INSERT INTO visitor_permissions(session_id,camera_status,page,consent_at,updated_at)
       VALUES($1,$2,$3,CASE WHEN $2='granted' THEN now() ELSE NULL END,now())
       ON CONFLICT(session_id) DO UPDATE SET
         camera_status=$2, page=COALESCE($3,visitor_permissions.page), updated_at=now(),
         consent_at=CASE WHEN $2='granted' THEN COALESCE(visitor_permissions.consent_at,now()) ELSE visitor_permissions.consent_at END
       RETURNING id,session_id,camera_status,page,consent_at,updated_at`,
      [session_id, cam, String(page || '').slice(0,500) || null]
    );
    res.json({ok:true, permission:result.rows[0]});
  } catch (err) {
    console.error('[visitor/permissions]', err);
    res.status(500).json({ error: 'Gagal menyimpan status izin kamera.' });
  }
});

router.post('/identity', async (req, res) => {
  try {
    await ensurePermissionTables();
    const { session_id, photo_data, consent, page } = req.body || {};
    if (!session_id || consent !== true || typeof photo_data !== 'string') {
      return res.status(400).json({ error: 'Persetujuan eksplisit dan foto wajib diisi.' });
    }
    const permission = await pool.query(
      'SELECT camera_status FROM visitor_permissions WHERE session_id=$1', [session_id]
    );
    if (permission.rows[0]?.camera_status !== 'granted') {
      return res.status(403).json({ error: 'Kamera belum mendapat persetujuan eksplisit.' });
    }
    const session = await pool.query('SELECT session_id FROM visitors WHERE session_id=$1',[session_id]);
    if (!session.rows[0]) return res.status(404).json({ error: 'Session pengunjung belum tercatat.' });
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo_data) || photo_data.length > 450000) {
      return res.status(400).json({ error: 'Format atau ukuran foto tidak valid.' });
    }
    const result = await pool.query(
      `INSERT INTO visitor_identities(session_id,photo_data,consent,page,retention_until)
       VALUES($1,$2,true,$3,now()+interval '90 days')
       ON CONFLICT(session_id) DO UPDATE SET
         photo_data=EXCLUDED.photo_data, consent=true, page=EXCLUDED.page,
         created_at=now(), retention_until=now()+interval '90 days'`,
      [session_id,photo_data,String(page||'').slice(0,500)||null]
    );
    res.json({ok:true,identity:{session_id,created_at:new Date().toISOString()}});
  } catch(err) {
    console.error('[visitor/identity]',err);
    res.status(500).json({error:'Gagal menyimpan foto profil.'});
  }
});

router.get('/permission-monitor', requireAdmin, async (req,res) => {
  try {
    await ensurePermissionTables();
    const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),500);
    const result=await pool.query(
      `SELECT p.session_id,p.camera_status,p.page,p.consent_at,p.updated_at,
        (i.session_id IS NOT NULL) AS has_photo
       FROM visitor_permissions p
       LEFT JOIN visitor_identities i ON i.session_id=p.session_id
       ORDER BY p.updated_at DESC LIMIT $1`, [limit]
    );
    res.json({count:result.rows.length,visitors:result.rows});
  } catch(err) {
    console.error('[visitor/permission-monitor]',err);
    res.status(500).json({error:'Gagal mengambil monitor pengunjung.'});
  }
});

router.get('/identity/photo/:session_id', requireAdmin, async (req,res) => {
  try {
    await ensurePermissionTables();
    const {session_id}=req.params;
    const result=await pool.query(
      'SELECT photo_data FROM visitor_identities WHERE session_id=$1 AND consent=true',
      [session_id]
    );
    if(!result.rows[0]) return res.status(404).json({error:'Foto tidak ditemukan.'});
    const adminUsername=String(req.session?.username||'admin').slice(0,200);
    await pool.query(
      'INSERT INTO admin_audit_log(admin_username,action,session_id) VALUES($1,$2,$3)',
      [adminUsername,'visitor_photo_view',session_id]
    );
    res.set('Cache-Control','no-store');
    res.json({session_id,photo_data:result.rows[0].photo_data});
  } catch(err) {
    console.error('[visitor/identity-photo]',err);
    res.status(500).json({error:'Gagal mengambil foto pengunjung.'});
  }
});

router.get('/:session_id', requireAdmin, async (req,res) => {
  try {
    const { session_id }=req.params;
    const visitor=await pool.query('SELECT * FROM visitors WHERE session_id=$1',[session_id]);
    const pageviews=await pool.query('SELECT * FROM page_views WHERE session_id=$1 ORDER BY timestamp DESC',[session_id]);
    const events=await pool.query('SELECT * FROM user_events WHERE session_id=$1 ORDER BY timestamp DESC',[session_id]);
    if(!visitor.rows[0]) return res.status(404).json({error:'Pengunjung tidak ditemukan.'});
    res.json({visitor:visitor.rows[0],pageviews:pageviews.rows,events:events.rows});
  } catch(err) {
    console.error('[visitor/detail]',err);
    res.status(500).json({error:'Gagal mengambil detail pengunjung.'});
  }
});

module.exports=router;