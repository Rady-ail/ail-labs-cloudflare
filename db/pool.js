const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.warn('[PERINGATAN] DATABASE_URL belum diset. Isi file .env terlebih dahulu (lihat .env.example).');
}

const pool = {
  async query(text, params = []) {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql.query(text, params);
    return { rows };
  },
};

module.exports = pool;
