const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.warn('[PERINGATAN] DATABASE_URL belum diset. Isi file .env terlebih dahulu (lihat .env.example).');
}

const DEFAULT_DB_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 8000);

const pool = {
  async query(text, params = [], options = {}) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi.');
    const sql = neon(process.env.DATABASE_URL);
    const timeoutMs = Number(options.timeoutMs || DEFAULT_DB_TIMEOUT_MS);
    const queryPromise = sql.query(text, params);
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Database query timeout.')), timeoutMs);
      timer.unref?.();
    });
    const rows = await Promise.race([queryPromise, timeoutPromise]);
    return { rows };
  },
};

module.exports = pool;
