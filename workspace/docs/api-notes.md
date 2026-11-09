# API implementation notes — foundation

- Tahap ini hanya menyiapkan fondasi Worker, middleware, validasi, koneksi Neon, audit helper, dan health check. Kontrak endpoint Email dan CRM tetap mengikuti LAMPIRAN 3 dan LAMPIRAN 4; tidak ada endpoint bisnis yang didefinisikan di tahap ini.
- Normalisasi telepon mengikuti urutan LAMPIRAN 4 §11: trim; hapus spasi/tanda kurung/tanda hubung; hapus `+`; ubah `0062` menjadi `62`; ubah awalan `0` menjadi `62`; tambahkan `62` pada awalan `8`; pertahankan awalan `62`; validasi `^628[1-9][0-9]{7,11}$`.
- Body JSON API dibatasi 256 KiB. Webhook nantinya menerapkan batas tersendiri 1 MiB sesuai keputusan implementasi.
- Origin hanya dibatasi pada request non-GET/HEAD yang membawa header `Origin`; request tanpa header tersebut tetap diizinkan.
- Respons JSON memakai request ID, header keamanan, dan error handler yang tidak mengembalikan stack atau detail SQL.
- `EMAIL_SEND_MODE` default deployment adalah `dry-run`. Tidak ada pengiriman email pada tahap fondasi.
