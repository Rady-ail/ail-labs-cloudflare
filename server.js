// Entry point untuk jalan LOKAL (npm start) dan untuk hosting yang butuh
// server Node terus-menerus seperti Render. Untuk Netlify, backend yang
// sebenarnya dipakai ada di netlify/functions/api.js (lihat README).
const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AIL LABS server berjalan di port ${PORT}`);
});
