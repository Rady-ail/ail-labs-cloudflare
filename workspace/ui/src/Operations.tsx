import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";

type Supplier = { id: string; name: string; country: string; email: string; whatsapp: string; website: string; status: string; notes: string };
type Clinic = { id: string; name: string; city: string; province: string; contact_name: string; phone: string; email: string; status: string; notes: string };
type Props = { kind: "suppliers" | "clinics" };

const statusOptions = {
  suppliers: [["prospect","Prospek"],["contacted","Dihubungi"],["negotiating","Negosiasi"],["sample","Sampel"],["approved","Disetujui"],["rejected","Ditolak"]],
  clinics: [["lead","Lead"],["contacted","Dihubungi"],["follow_up","Tindak lanjut"],["customer","Pelanggan"],["inactive","Tidak aktif"]],
} as const;

export function Operations({ kind }: Props) {
  const isSupplier = kind === "suppliers";
  const [rows, setRows] = useState<(Supplier | Clinic)[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [region, setRegion] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const endpoint = `/api/ops/${kind}`;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `Gagal memuat data (${response.status})`);
      setRows(Array.isArray(body.data) ? body.data : []);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menghubungi server."); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const payload = isSupplier
      ? { name, country: place, email, whatsapp: phone, website, notes }
      : { name, city: place, province: region, contact_name: contact, email, phone, notes };
    try {
      const response = await fetch(editingId ? `${endpoint}/${editingId}` : endpoint, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `Gagal menyimpan (${response.status})`);
      setName(""); setPlace(""); setContact(""); setEmail(""); setPhone(""); setNotes(""); setWebsite(""); setRegion("");
      setNotice(isSupplier ? (editingId ? "Supplier berhasil diperbarui." : "Supplier berhasil ditambahkan.") : (editingId ? "Klinik berhasil diperbarui." : "Klinik berhasil ditambahkan."));
      setEditingId(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan data."); }
    finally { setBusy(false); }
  }

  function edit(row: Supplier | Clinic) {
    setEditingId(row.id); setName(row.name); setEmail(row.email); setNotes(row.notes || "");
    if (isSupplier) {
      const item = row as Supplier; setPlace(item.country || ""); setPhone(item.whatsapp || ""); setWebsite(item.website || "");
    } else {
      const item = row as Clinic; setPlace(item.city || ""); setRegion(item.province || ""); setContact(item.contact_name || ""); setPhone(item.phone || "");
    }
    setError(""); setNotice("");
  }
  function cancelEdit() {
    setEditingId(null); setName(""); setPlace(""); setContact(""); setEmail(""); setPhone(""); setNotes(""); setWebsite(""); setRegion("");
  }

  async function updateStatus(row: Supplier | Clinic, status: string) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`${endpoint}/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "Status gagal diperbarui.");
      setRows(current => current.map(item => item.id === row.id ? body.data : item));
      setNotice("Status berhasil diperbarui.");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal memperbarui status."); }
  }

  async function remove(row: Supplier | Clinic) {
    if (!window.confirm(`Hapus ${row.name}? Tindakan ini tidak dapat dibatalkan.`)) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`${endpoint}/${row.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "Data gagal dihapus.");
      setRows(current => current.filter(item => item.id !== row.id));
      setNotice("Data berhasil dihapus.");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menghapus data."); }
  }

  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="top"><div><h1>{isSupplier ? "Supplier & Sampel" : "CRM Klinik"}</h1><p className="sub">{isSupplier ? "Kelola pemasok, kontak, negosiasi, dan status sampel." : "Kelola prospek klinik, kontak, dan tindak lanjut."}</p></div><button className="chip" onClick={() => void load()} disabled={loading}>↻ Muat ulang</button></div>
    <div className="grid g2" style={{ alignItems: "start" }}>
      <form className="card" onSubmit={create}>
        <h3>{editingId ? (isSupplier ? "Edit supplier" : "Edit klinik") : (isSupplier ? "Tambah supplier" : "Tambah klinik")}</h3>
        <label className="f">Nama<input className="in" required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder={isSupplier ? "Nama perusahaan" : "Nama klinik"} /></label>
        <label className="f">{isSupplier ? "Negara" : "Kota"}<input className="in" maxLength={100} value={place} onChange={e => setPlace(e.target.value)} /></label>
        {isSupplier && <label className="f">Website<input className="in" type="url" maxLength={500} value={website} onChange={e => setWebsite(e.target.value)} /></label>}
        {!isSupplier && <label className="f">Provinsi<input className="in" maxLength={100} value={region} onChange={e => setRegion(e.target.value)} /></label>}
        {!isSupplier && <label className="f">Nama kontak<input className="in" maxLength={160} value={contact} onChange={e => setContact(e.target.value)} /></label>}
        <label className="f">Email<input className="in" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="f">{isSupplier ? "WhatsApp" : "Telepon"}<input className="in" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label className="f">Catatan<textarea className="in" maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? "Menyimpan…" : editingId ? "Simpan perubahan" : "Simpan"}</button>{editingId && <button className="chip" type="button" onClick={cancelEdit}>Batal edit</button>}</div>
      </form>
      <section className="card">
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}><h3>{isSupplier ? "Daftar supplier" : "Daftar klinik"}</h3><span className="tag">{rows.length} data</span></div>
        {error && <div className="notice" role="alert" style={{marginTop:12}}>{error}</div>}
        {notice && <div className="notice" role="status" style={{marginTop:12}}>{notice}</div>}
        {loading ? <p style={{marginTop:14}}>Memuat data…</p> : rows.length === 0 ? <p style={{marginTop:14}}>Belum ada data. Tambahkan data pertama melalui formulir.</p> :
          <div style={{display:"grid",gap:12,marginTop:14}}>
            {rows.map(row => <article key={row.id} style={{borderTop:"1px solid var(--line)",paddingTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}><div><strong>{row.name}</strong><p>{isSupplier ? (row as Supplier).country : [(row as Clinic).city,(row as Clinic).province].filter(Boolean).join(", ")}</p><p>{row.email || "Email belum diisi"} · {isSupplier ? (row as Supplier).whatsapp : (row as Clinic).phone}</p></div><div style={{display:"flex",gap:6}}><button className="chip" type="button" onClick={() => edit(row)}>Edit</button><button className="chip" type="button" onClick={() => void remove(row)} aria-label={`Hapus ${row.name}`}>Hapus</button></div></div>
              <label className="f" style={{marginTop:8}}>Status<select className="in" value={row.status} onChange={e => void updateStatus(row,e.target.value)}>{statusOptions[kind].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              {row.notes && <p style={{whiteSpace:"pre-wrap",marginTop:8}}>{row.notes}</p>}
            </article>)}
          </div>}
      </section>
    </div>
  </motion.div>;
}

type EmailConfig = { database: boolean; ai: boolean; aiRateLimiter: boolean; email: boolean; emailMode: string };
export function EmailStatus() {
  const [status, setStatus] = useState<EmailConfig | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ops/status", { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || `Gagal memeriksa konfigurasi (${response.status})`);
        setStatus(body as EmailConfig);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Gagal memeriksa status."); });
    return () => controller.abort();
  }, []);
  return <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
    <div className="top"><div><h1>Email</h1><p className="sub">Status integrasi email dan pagar keamanan pengiriman.</p></div></div>
    <section className="card">
      <h3>Kesiapan integrasi</h3>
      {error && <div className="notice" role="alert">{error}</div>}
      {!status && !error && <p>Memeriksa konfigurasi…</p>}
      {status && <>
        <div className="row"><span>Database</span><b>{status.database ? "Terhubung" : "Belum terhubung"}</b></div>
        <div className="row"><span>Resend API</span><b>{status.email ? "Terkonfigurasi" : "Belum dikonfigurasi"}</b></div>
        <div className="row"><span>Mode pengiriman</span><b>{status.emailMode}</b></div>
        <div className="row"><span>AI</span><b>{status.ai ? "Terkonfigurasi" : "Belum dikonfigurasi"}</b></div>
        <div className="notice" style={{marginTop:14}}>Pengiriman email tetap dinonaktifkan dari antarmuka ini. Mode dry-run dipertahankan; tidak ada email yang dikirim otomatis. Inbox, approval draft, dan scheduled sending memerlukan backend email khusus yang belum terpasang pada repository ini.</div>
      </>}
    </section>
  </motion.div>;
}
