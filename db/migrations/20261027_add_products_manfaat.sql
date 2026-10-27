-- Kolom manfaat (deskripsi umum, bukan klaim medis) untuk agent WhatsApp katalog.
-- Additive & idempotent. Sengaja dikosongkan (NULL) untuk obat resep/keras dan produk dengan
-- bahan aktif obat (hydroquinone, tretinoin, klobetasol/betametason, clindamycin, injeksi, dll.):
-- agent tidak boleh memberi indikasi untuk produk tersebut dan akan menyerahkan ke admin.
ALTER TABLE products ADD COLUMN IF NOT EXISTS manfaat TEXT;

UPDATE products p SET manfaat = v.m FROM (VALUES
 (139,'Membantu mencerahkan dan menyegarkan tampilan kulit (ampul Vitamin C).'),
 (140,'Membantu tampilan kulit tampak lebih kencang dan kontur wajah lebih terdefinisi.'),
 (141,'Membantu menenangkan kulit yang tampak sensitif atau kemerahan.'),
 (142,'Membantu merawat kulit berminyak/berjerawat agar tampak lebih bersih.'),
 (143,'Membantu pembaruan tekstur kulit agar tampak lebih halus (Vitamin A).'),
 (156,'Balm perawatan untuk membantu mencerahkan tampilan kulit.'),
 (157,'Pembersih berbasis enzim untuk membantu mengangkat sel kulit mati dan mencerahkan tampilan kulit.'),
 (130,'Membantu tampilan kulit tampak lebih cerah dan bercahaya.'),
 (131,'Membantu kulit tampak bersih dan seimbang.'),
 (132,'Membantu menghidrasi dan menyegarkan kulit.'),
 (158,'Gel perawatan untuk membantu menenangkan dan merawat kulit.'),
 (23,'Membantu mencerahkan tampilan kulit area lipatan (underarm).'),
 (26,'Krim perawatan anti-penuaan dan pencerah (Purac Acid dan Vitamin C).'),
 (27,'Netralisator berbasis asam bikarbonat untuk menetralkan efek larutan peeling pada tindakan.'),
 (164,'Membantu melembapkan dan meremajakan tampilan kulit (DNA Salmon).'),
 (28,'Membantu menjaga skin barrier dan melembapkan kulit (Ceramide dan Aloe vera).'),
 (29,'Melembapkan dan membantu mencerahkan tampilan kulit (Arbutin dan Ceramide).'),
 (30,'Eksfoliasi lembut AHA 8% agar kulit tampak lebih halus dan cerah.'),
 (31,'Eksfoliasi AHA 10% agar kulit tampak lebih halus dan cerah.'),
 (32,'Eksfoliasi AHA 12% agar kulit tampak lebih halus dan cerah.'),
 (33,'Eksfoliasi AHA 8% dan Salicylic Acid 2% untuk membantu pori tampak lebih bersih.'),
 (34,'Membantu melembapkan, antioksidan, dan membuat kulit tampak lebih kenyal (Collagen, Vitamin C dan E).'),
 (35,'Eksfoliasi lembut dan melembapkan dengan Lactic Acid 5%.'),
 (36,'Antioksidan dan membantu mencerahkan tampilan kulit (Vitamin C 3%).'),
 (37,'Membantu menenangkan dan meratakan tampilan kulit (Niacinamide 4% dan Aloe vera).'),
 (159,'Pelembap antioksidan untuk membantu melindungi dan melembapkan kulit.'),
 (19,'Lotion tubuh dengan AHA 10% untuk membantu kulit tubuh tampak lebih halus dan cerah.'),
 (144,'Peel-off mask untuk membantu tampilan kulit lebih kencang (Pearl Milk, anti-kerut).'),
 (145,'Peel-off mask eksfoliasi dengan ekstrak papaya untuk membantu kulit tampak lebih halus.'),
 (146,'Peel-off mask untuk menenangkan kulit (Aloe).'),
 (147,'Peel-off mask pemurni dengan Tea Tree untuk membantu kulit tampak bersih.'),
 (148,'Peel-off mask Rose untuk melembapkan dan menyegarkan kulit.'),
 (149,'Peel-off mask Lavender untuk membantu menenangkan kulit.'),
 (150,'Peel-off mask Mint untuk menyegarkan dan membuat kulit tampak jernih.'),
 (151,'Peel-off mask Cucumber untuk menghidrasi dan menyegarkan kulit.'),
 (152,'Masker polifenol anggur untuk perawatan antioksidan.'),
 (153,'Modeling powder mask untuk perawatan anti-penuaan.'),
 (154,'Modeling powder mask untuk perawatan kulit berjerawat agar tampak lebih bersih.'),
 (155,'Modeling mask hyaluronic untuk menenangkan dan menghidrasi kulit.'),
 (163,'Peeling DNA Salmon untuk membantu meremajakan tampilan kulit; penggunaan oleh tenaga profesional.'),
 (161,'Skinbooster DNA Salmon untuk membantu hidrasi dan tekstur kulit.'),
 (162,'Skinbooster DNA Salmon untuk perawatan harian membantu hidrasi dan tekstur kulit.'),
 (54,'Serum Vitamin C 15% sebagai antioksidan dan pencerah tampilan kulit.'),
 (55,'Serum Niacinamide 6% untuk membantu tampilan pori dan warna kulit tampak lebih merata.'),
 (57,'Serum AHA 12% untuk eksfoliasi agar kulit tampak lebih halus dan cerah.'),
 (59,'Serum Collagen 1% untuk membantu kulit tampak lebih kenyal dan terhidrasi.'),
 (60,'Serum Centella 5% untuk membantu menenangkan kulit.'),
 (166,'Sheet mask DNA Salmon untuk membantu meremajakan dan menghidrasi kulit.'),
 (133,'Sheet mask area mata untuk perawatan kulit sekitar mata.'),
 (134,'Sheet mask 3D untuk membantu menghidrasi dan membuat kulit tampak lebih kencang.'),
 (135,'Sheet mask untuk membantu mencerahkan tampilan kulit.'),
 (136,'Sheet mask untuk hidrasi mendalam.'),
 (137,'Sheet mask untuk membantu kulit tampak lebih kencang.'),
 (138,'Sheet mask untuk membantu mengontrol minyak berlebih.'),
 (165,'Tabir surya harian untuk membantu melindungi kulit dari sinar matahari (lihat label untuk nilai SPF).'),
 (70,'Tabir surya SPF 15 (Titanium Dioxide) untuk perlindungan harian dari sinar matahari.'),
 (71,'Tabir surya SPF 30 dengan AHA 4% untuk perlindungan dan membantu kulit tampak lebih halus.'),
 (72,'Tabir surya SPF 30 dengan Arbutin untuk perlindungan dan membantu mencerahkan tampilan kulit.'),
 (74,'Tabir surya SPF 5 White+ untuk perlindungan ringan dan membantu tampilan kulit lebih cerah.'),
 (75,'Tabir surya dengan Thiamidol untuk perlindungan dan membantu mencerahkan tampilan kulit.')
) AS v(id,m) WHERE p.id = v.id;

UPDATE products SET manfaat = CASE
  WHEN name ILIKE 'Jojoba%' THEN 'Minyak dasar kosmetik untuk membantu melembapkan; juga dipakai sebagai bahan campuran formulasi atau pijat.'
  WHEN name ILIKE 'Rosehip%' THEN 'Minyak dasar kosmetik untuk membantu melembapkan dan merawat kulit; bahan campuran formulasi.'
  WHEN name ILIKE 'Squalane%' THEN 'Emolien ringan untuk membantu melembapkan kulit; bahan campuran formulasi.'
  ELSE 'Minyak dasar kosmetik ringan sebagai pelembap dan bahan campuran formulasi atau pijat.' END
WHERE id BETWEEN 322 AND 329;

UPDATE products SET manfaat = CASE
  WHEN name ~* 'Lidocaine' THEN 'Filler asam hialuronat (HA) dengan lidocaine untuk membantu mengembalikan volume dan mengisi kontur wajah; tindakan oleh tenaga medis terlatih.'
  ELSE 'Filler asam hialuronat (HA) untuk membantu mengembalikan volume dan mengisi kontur wajah; tindakan oleh tenaga medis terlatih.' END
WHERE id IN (199,200,201,202,203,204,205,206,207);

UPDATE products SET manfaat = CASE
  WHEN name ~* 'TCA' THEN 'Larutan chemical peeling TCA untuk eksfoliasi dan peremajaan tekstur kulit; penggunaan oleh tenaga medis.'
  WHEN name ~* ' GA ' THEN 'Larutan chemical peeling Glycolic Acid untuk eksfoliasi dan membantu tekstur kulit tampak lebih halus; penggunaan oleh tenaga medis.'
  ELSE 'Larutan chemical peeling Salicylic Acid untuk eksfoliasi dan membantu pori tampak lebih bersih; penggunaan oleh tenaga medis.' END
WHERE id BETWEEN 38 AND 53;

UPDATE products p SET manfaat = CASE c.name
  WHEN 'Threadlift' THEN 'Benang PDO untuk tindakan thread lift guna membantu mengangkat dan mengencangkan jaringan; tindakan oleh tenaga medis terlatih.'
  WHEN 'Cannula' THEN 'Cannula untuk membantu injeksi estetik yang lebih nyaman; digunakan oleh tenaga medis.'
  WHEN 'Needle' THEN 'Jarum halus untuk tindakan injeksi estetik; digunakan oleh tenaga medis.' END
FROM categories c
WHERE c.id = p.category_id AND c.name IN ('Threadlift','Cannula','Needle') AND p.manfaat IS NULL;
