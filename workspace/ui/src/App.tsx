import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Icon } from "./icons";

type View = "home" | "landed" | "ai" | "supplier" | "klinik" | "email";
const NAV: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Beranda", icon: "home" },
  { id: "landed", label: "Landed Cost", icon: "calc" },
  { id: "ai", label: "Asisten AI", icon: "ai" },
  { id: "supplier", label: "Supplier", icon: "box" },
  { id: "klinik", label: "Klinik", icon: "users" },
  { id: "email", label: "Email", icon: "mail" },
];

/* Kartu kaca dengan tilt 3D halus (hanya mouse/pen). */
function Tilt({ children, className = "card" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 22 }), sy = useSpring(y, { stiffness: 220, damping: 22 });
  const rx = useTransform(sy, [-0.5, 0.5], [5, -5]), ry = useTransform(sx, [-0.5, 0.5], [-5, 5]);
  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      whileHover={{ y: -3 }}
      onPointerMove={(e) => {
        if (e.pointerType === "touch" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width - 0.5);
        y.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}

const stagger = { show: { transition: { staggerChildren: 0.06 } } };
const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } } };

function Header({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="top">
      <div><h1>{title}</h1><p className="sub">{sub}</p></div>
      {right}
    </div>
  );
}

/* ---------------- Beranda ---------------- */
function Home({ go }: { go: (v: View) => void }) {
  const [api, setApi] = useState<"cek" | "ok" | "bad" | "unk">("cek");
  const [db, setDb] = useState<"cek" | "ok" | "bad" | "unk">("cek");
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/health", { signal: ac.signal })
      .then(async (r) => { const j = await r.json().catch(() => ({})); const reach = r.ok || r.status === 401 || r.status === 403; setApi(reach ? "ok" : "bad"); setDb(r.ok ? (j.db ? "ok" : "bad") : reach ? "unk" : "bad"); })
      .catch(() => { if (!ac.signal.aborted) { setApi("bad"); setDb("bad"); } });
    return () => ac.abort();
  }, []);
  const st = (s: string) => (s === "ok" ? "Aktif" : s === "bad" ? "Tidak terhubung" : s === "unk" ? "Perlu login" : "Memeriksa…");
  const mods: { id: View; t: string; d: string; tag: string; soon?: boolean }[] = [
    { id: "landed", t: "Kalkulator Landed Cost", d: "Hitung biaya mendarat per unit dan harga jual dari target margin.", tag: "Aktif" },
    { id: "ai", t: "Asisten AI", d: "Menyusun draf balasan supplier dan ringkasan. Tidak pernah mengirim sendiri.", tag: "Menunggu backend", soon: true },
    { id: "supplier", t: "Pelacak Supplier & Sampel", d: "Status negosiasi, sampel, dan dokumen tiap supplier.", tag: "Segera", soon: true },
    { id: "klinik", t: "CRM Klinik", d: "Daftar klinik, tindak lanjut WhatsApp, dan pesanan.", tag: "Segera", soon: true },
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={rise}><Header title="Beranda" sub="Ruang kerja B2B AIL LABS: katalog, supplier, klinik, dan biaya impor dalam satu tempat." /></motion.div>
      <motion.div variants={rise} className="grid g3" style={{ marginBottom: 16 }}>
        <Tilt><h3>Layanan API</h3><div className="kpi" style={{ display: "flex", alignItems: "center", gap: 10 }}><span className={`dot ${api}`} />{st(api)}</div></Tilt>
        <Tilt><h3>Database</h3><div className="kpi" style={{ display: "flex", alignItems: "center", gap: 10 }}><span className={`dot ${db}`} />{st(db)}</div></Tilt>
        <Tilt><h3>Mode email</h3><div className="kpi">Dry-run</div><p style={{ marginTop: 6 }}>Pengiriman nyata baru aktif setelah Rady mengubahnya.</p></Tilt>
      </motion.div>
      <motion.div variants={rise} className="grid g2">
        {mods.map((m) => (
          <Tilt key={m.id}>
            <button className="btn" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }} onClick={() => go(m.id)} aria-label={m.t}>
              <span className={`tag ${m.soon ? "soon" : ""}`}>{m.tag}</span>
              <h3 style={{ marginTop: 12 }}>{m.t}</h3><p>{m.d}</p>
            </button>
          </Tilt>
        ))}
      </motion.div>
    </motion.div>
  );
}

/* ---------------- Landed cost ---------------- */
const idr = (n: number) => (isFinite(n) ? "Rp " + Math.round(n).toLocaleString("id-ID") : "—");
function Num({ label, v, set, step = "any", suffix }: { label: string; v: number; set: (n: number) => void; step?: string; suffix?: string }) {
  return (
    <label className="f">{label}{suffix ? ` (${suffix})` : ""}
      <input className="in" type="number" inputMode="decimal" min="0" step={step} value={Number.isFinite(v) ? v : 0} onChange={(e) => set(parseFloat(e.target.value) || 0)} />
    </label>
  );
}
function Landed() {
  const [f, setF] = useState({ fob: 0, qty: 1, kurs: 16000, freight: 0, insPct: 0.5, dutyPct: 0, ppnPct: 11, pphPct: 0, other: 0, margin: 30, taxCost: true });
  const u = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const goods = f.fob * f.qty * f.kurs, freight = f.freight * f.kurs;
  const ins = (goods + freight) * (f.insPct / 100), cif = goods + freight + ins;
  const duty = cif * (f.dutyPct / 100), base = cif + duty;
  const ppn = base * (f.ppnPct / 100), pph = base * (f.pphPct / 100);
  const total = cif + duty + (f.taxCost ? ppn + pph : 0) + f.other;
  const unit = f.qty > 0 ? total / f.qty : NaN;
  const price = f.margin < 100 ? unit / (1 - f.margin / 100) : NaN;
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={rise}><Header title="Landed Cost" sub="Hitung biaya mendarat per unit. Tarif diisi manual: verifikasi HS code dan tarif resmi sebelum dipakai untuk keputusan." /></motion.div>
      <motion.div variants={rise} className="grid g2">
        <div className="card">
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Num label="Harga FOB / unit" suffix="USD" v={f.fob} set={u("fob")} />
            <Num label="Jumlah unit" v={f.qty} set={u("qty")} step="1" />
            <Num label="Kurs" suffix="IDR/USD" v={f.kurs} set={u("kurs")} />
            <Num label="Ongkir total" suffix="USD" v={f.freight} set={u("freight")} />
            <Num label="Asuransi" suffix="%" v={f.insPct} set={u("insPct")} />
            <Num label="Bea masuk" suffix="%" v={f.dutyPct} set={u("dutyPct")} />
            <Num label="PPN" suffix="%" v={f.ppnPct} set={u("ppnPct")} />
            <Num label="PPh 22" suffix="%" v={f.pphPct} set={u("pphPct")} />
            <Num label="Biaya lain total" suffix="IDR" v={f.other} set={u("other")} />
            <Num label="Target margin" suffix="%" v={f.margin} set={u("margin")} />
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" checked={f.taxCost} onChange={(e) => u("taxCost")(e.target.checked)} /> Masukkan PPN dan PPh ke biaya (konservatif)
          </label>
        </div>
        <div className="card">
          <div className="row"><span>Nilai barang</span><b>{idr(goods)}</b></div>
          <div className="row"><span>Ongkir + asuransi</span><b>{idr(freight + ins)}</b></div>
          <div className="row"><span>CIF</span><b>{idr(cif)}</b></div>
          <div className="row"><span>Bea masuk</span><b>{idr(duty)}</b></div>
          <div className="row"><span>PPN + PPh 22</span><b>{idr(ppn + pph)}</b></div>
          <div className="row"><span>Biaya lain</span><b>{idr(f.other)}</b></div>
          <div className="row"><span>Total biaya mendarat</span><b>{idr(total)}</b></div>
          <div className="row"><span>Landed cost / unit</span><b className="big">{idr(unit)}</b></div>
          <div className="row"><span>Harga jual minimum untuk margin {f.margin}%</span><b>{idr(price)}</b></div>
          <p style={{ marginTop: 12 }}>Hasil ini alat bantu hitung. Harga jual final tetap Rady yang menentukan.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------------- Asisten AI ---------------- */
const KINDS = [
  { id: "supplier", label: "Balasan supplier", hint: "Tempel pesan dari supplier. AI menyusun draf mengikuti Aturan Emas AIL LABS." },
  { id: "email", label: "Ringkas email", hint: "Tempel email masuk untuk diringkas dan diberi usulan tindakan." },
  { id: "landed", label: "Analisis biaya", hint: "Tempel penawaran supplier untuk diperiksa komponen biayanya." },
];
function AI() {
  const [kind, setKind] = useState("supplier");
  const [text, setText] = useState("");
  const inputLength = Array.from(text.trim()).length;
  const inputTooLong = inputLength > 800;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true); setErr(""); setDraft("");
    try {
      const r = await fetch("/api/ai/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, input: text }) });
      if (r.status === 404) throw new Error("Endpoint /api/ai/draft belum ada di backend. Tombol ini aktif setelah backend AI dipasang.");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || `Gagal (${r.status}).`);
      setDraft(String(j.draft ?? ""));
    } catch (e) { setErr(e instanceof Error ? e.message : "Gagal menghubungi server."); }
    finally { setBusy(false); }
  }
  const cur = KINDS.find((k) => k.id === kind)!;
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={rise}><Header title="Asisten AI" sub="Menyusun draf dan ringkasan. AI tidak bisa menyetujui pembelian, kontrak, atau pembayaran, dan tidak mengirim pesan keluar." /></motion.div>
      <motion.div variants={rise} className="grid g2">
        <div className="card">
          <div className="seg" role="group" aria-label="Jenis tugas" style={{ marginBottom: 14, flexWrap: "wrap" }}>
            {KINDS.map((k) => <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
          </div>
          <p style={{ marginBottom: 12 }}>{cur.hint}</p>
          <label className="f">Teks sumber<textarea className="in" value={text} maxLength={1600} aria-describedby="ai-input-count" onChange={(e) => setText(e.target.value)} placeholder="Tempel teks di sini…" /></label>
          <div id="ai-input-count" style={{ marginTop: 6, fontSize: 12, color: inputTooLong ? "var(--orange)" : "var(--muted)" }}>
            {inputLength}/800 karakter setelah trim
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <motion.button whileTap={{ scale: 0.96 }} className="btn primary" disabled={busy || !text.trim() || inputTooLong} onClick={run}>{busy ? "Menyusun…" : "Susun draf"}</motion.button>
          </div>
        </div>
        <div className="card">
          <h3>Draf</h3>
          <AnimatePresence mode="wait">
            {err ? <motion.div key="e" className="notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ marginTop: 10 }}>{err}</motion.div>
              : draft ? <motion.pre key="d" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14, lineHeight: 1.6, margin: "10px 0 0" }}>{draft}</motion.pre>
              : <motion.p key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ marginTop: 10 }}>Draf akan tampil di sini.</motion.p>}
          </AnimatePresence>
          <div className="notice" style={{ marginTop: 16 }}>Gerbang persetujuan: draf tidak dikirim otomatis. Kirim hanya setelah Rady menyetujui, dan atas nama Alexa.</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------------- Modul yang belum aktif ---------------- */
function Soon({ title, sub }: { title: string; sub: string }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={rise}><Header title={title} sub={sub} /></motion.div>
      <motion.div variants={rise} className="card"><span className="tag soon">Segera</span><h3 style={{ marginTop: 12 }}>Menunggu endpoint backend</h3><p>Modul ini terhubung ke data setelah endpoint-nya tersedia di backend Workspace. Tidak ada data contoh yang ditampilkan.</p></motion.div>
    </motion.div>
  );
}

/* ---------------- Cangkang aplikasi ---------------- */
export default function App() {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<"midnight" | "frost">(() => {
    try { const s = localStorage.getItem("ail-theme"); if (s === "midnight" || s === "frost") return s; } catch { /* abaikan */ }
    return matchMedia("(prefers-color-scheme: light)").matches ? "frost" : "midnight";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ail-theme", theme); } catch { /* abaikan */ }
  }, [theme]);
  const nav = (inTab: boolean) => NAV.map((n) => (
    <button key={n.id} className="nav" aria-current={view === n.id ? "page" : undefined} onClick={() => setView(n.id)}>
      {view === n.id && <motion.span layoutId={inTab ? "pill-tab" : "pill-side"} className="pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
      <Icon name={n.icon} /><span>{n.label}</span>
    </button>
  ));
  return (
    <div className="app">
      <aside className="side" aria-label="Navigasi utama">
        <div className="brand"><i />AIL LABS</div>
        {nav(false)}
        <div className="grow" />
        <div className="seg" role="group" aria-label="Tema">
          <button aria-pressed={theme === "midnight"} onClick={() => setTheme("midnight")}>Midnight</button>
          <button aria-pressed={theme === "frost"} onClick={() => setTheme("frost")}>Frost</button>
        </div>
      </aside>
      <main className="main">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }} className="theme-m">
          <button className="chip" onClick={() => setTheme(theme === "midnight" ? "frost" : "midnight")} aria-label="Ganti tema"><Icon name={theme === "midnight" ? "sun" : "moon"} /><span>{theme === "midnight" ? "Frost" : "Midnight"}</span></button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
            {view === "home" && <Home go={setView} />}
            {view === "landed" && <Landed />}
            {view === "ai" && <AI />}
            {view === "supplier" && <Soon title="Supplier & Sampel" sub="Status negosiasi, sampel, dan dokumen tiap supplier." />}
            {view === "klinik" && <Soon title="CRM Klinik" sub="Daftar klinik, tindak lanjut WhatsApp, dan pesanan." />}
            {view === "email" && <Soon title="Email" sub="Kotak masuk real-time dan draf yang menunggu persetujuan." />}
          </motion.div>
        </AnimatePresence>
      </main>
      <nav className="tabbar" aria-label="Navigasi">{nav(true)}</nav>
    </div>
  );
}
