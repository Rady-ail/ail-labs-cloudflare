const pool = require('../db/pool');

async function runVisitorPhotoRetention() {
  if (process.env.VISITOR_PHOTO_PURGE_ENABLED !== 'true') {
    return { enabled: false, deleted: 0 };
  }

  const result = await pool.query(
    `DELETE FROM visitor_identities
     WHERE COALESCE(retention_until, created_at + interval '90 days') <= now()
     RETURNING session_id`
  );

  return { enabled: true, deleted: result.rowCount || 0 };
}

module.exports = { runVisitorPhotoRetention };
