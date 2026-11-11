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
      ? { name, country: place, email, whatsapp: phone, notes }
      : { name, city: place, contact_name: contact, email, phone, notes };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `Gagal menyimpan (${response.status})`);
      setName(""); setPlace(""); setContact(""); setEmail(""); setPhone(""); setNotes("");
      setNotice(isSupplier ? "Supplier berhasil ditambahkan." : "Klinik berhasil ditambahkan.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan data."); }
    finally { setBusy(false); }
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
        <h3>{isSupplier ? "Tambah supplier" : "Tambah klinik"}</h3>
        <label className="f">Nama<input className="in" required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder={isSupplier ? "Nama perusahaan" : "Nama klinik"} /></label>
        <label className="f">{isSupplier ? "Negara" : "Kota"}<input className="in" maxLength={100} value={place} onChange={e => setPlace(e.target.value)} /></label>
        {!isSupplier && <label className="f">Nama kontak<input className="in" maxLength={160} value={contact} onChange={e => setContact(e.target.value)} /></label>}
        <label className="f">Email<input className="in" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="f">{isSupplier ? "WhatsApp" : "Telepon"}<input className="in" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label className="f">Catatan<textarea className="in" maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></label>
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? "Menyimpan…" : "Simpan"}</button>
      </form>
      <section className="card">
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}><h3>{isSupplier ? "Daftar supplier" : "Daftar klinik"}</h3><span className="tag">{rows.length} data</span></div>
        {error && <div className="notice" role="alert" style={{marginTop:12}}>{error}</div>}
        {notice && <div className="notice" role="status" style={{marginTop:12}}>{notice}</div>}
        {loading ? <p style={{marginTop:14}}>Memuat data…</p> : rows.length === 0 ? <p style={{marginTop:14}}>Belum ada data. Tambahkan data pertama melalui formulir.</p> :
          <div style={{display:"grid",gap:12,marginTop:14}}>
            {rows.map(row => <article key={row.id} style={{borderTop:"1px solid var(--line)",paddingTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}><div><strong>{row.name}</strong><p>{isSupplier ? (row as Supplier).country : [(row as Clinic).city,(row as Clinic).province].filter(Boolean).join(", ")}</p><p>{row.email || "Email belum diisi"} · {isSupplier ? (row as Supplier).whatsapp : (row as Clinic).phone}</p></div><button className="chip" type="button" onClick={() => void remove(row)} aria-label={`Hapus ${row.name}`}>Hapus</button></div>
              <label className="f" style={{marginTop:8}}>Status<select className="in" value={row.status} onChange={e => void updateStatus(row,e.target.value)}>{statusOptions[kind].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              {row.notes && <p style={{whiteSpace:"pre-wrap",marginTop:8}}>{row.notes}</p>}
            </article>)}
          </div>}
      </section>
    </div>
  </motion.div>;
}
