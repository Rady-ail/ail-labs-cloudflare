// update_foto_url.js
// Jalankan: DATABASE_URL="postgres://..." node update_foto_url.js
const { Client } = require('pg');
const mapping = require('./id_slug_mapping.json');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let updated = 0;
  for (const [id, info] of Object.entries(mapping)) {
    const fotoUrl = `/images/products/${info.slug}.png`;
    await client.query('UPDATE products SET foto_url = $1 WHERE id = $2', [fotoUrl, Number(id)]);
    updated++;
  }

  console.log(`Selesai update foto_url untuk ${updated} produk`);
  await client.end();
}

main().catch(err => {
  console.error('Gagal update:', err);
  process.exit(1);
});
