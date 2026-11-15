import { useCallback, useEffect, useMemo, useState } from "react";
import { call, jsonInit } from "./FollowUps";
import type { LandedInput } from "../../src/lib/landed";
import { computeLanded } from "../../src/lib/landed";

export const idr = (n: number) => (Number.isFinite(n) ? "Rp " + Math.round(n).toLocaleString("id-ID") : "—");

export const STAGES: [string, string][] = [["aktif", "Aktif"], ["tertahan", "Tertahan"], ["berhenti", "Berhenti"], ["ditutup", "Ditutup"]];
export const GATES: [string, string][] = [["halal", "Halal"], ["loa_bpom", "LoA BPOM"], ["cfs", "CFS"], ["coa_iso", "COA / ISO"], ["pembayaran_aman", "Pembayaran aman"]];
const GATE_STATES: [string, string][] = [["belum", "Belum"], ["diminta", "Diminta"], ["diterima", "Diterima"], ["tidak_ada", "Tidak ada"]];
export const gateLabel = (g: string) => GATES.find(([v]) => v === g)?.[1] ?? g;

export type Gate = { gate: string; state: string; note: string; updated_at: string };
export type SopRow = { id: string; name: string; country: string; status: string; sop_stage: string; gates: Gate[] };

export function gateSummary(gates: Gate[]) {
  return { done: gates.filter((g) => g.state === "diterima").length, total: GATES.length };
}

/* Tahap SOP + lima gerbang satu supplier. Hanya mencatat status; tidak mengirim apa pun. */
export function SopPanel({ row, onChange }: { row: SopRow; onChange: (r: SopRow) => void }) {
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(row.gates.map((g) => [g.gate, g.note])));
  const byGate = (g: string) => row.gates.find((x) => x.gate === g);

  async function setStage(sop_stage: string) {
    setErr("");
    try { await call(`/api/proc/sop/${row.id}`, jsonInit("PATCH", { sop_stage })); onChange({ ...row, sop_stage }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal menyimpan tahap."); }
  }
  async function saveGate(gate: string, state: string, note: string) {
    setErr("");
    try {
      const b = await call(`/api/proc/sop/${row.id}/gates/${gate}`, jsonInit("PUT", { state, note }));
      const saved: Gate = b.data;
      onChange({ ...row, gates: [...row.gates.filter((g) => g.gate !== gate), { gate, state: saved.state, note: saved.note, updated_at: saved.updated_at }] });
    } catch (e) { setErr(e instanceof Error ? e.message : "Gagal menyimpan gerbang."); }
  }

  return (
    <div className="activity-panel" style={{ marginTop: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 14 }}>
      <label className="f">Tahap SOP
        <select className="in" value={row.sop_stage} onChange={(e) => void setStage(e.target.value)}>{STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {GATES.map(([g, label]) => {
          const cur = byGate(g);
          return (
            <div key={g} style={{ display: "grid", gridTemplateColumns: "minmax(110px,1fr) 1fr", gap: 8, alignItems: "start" }}>
              <div><strong>{label}</strong>{cur && <p style={{ margin: "2px 0 0", fontSize: 11 }}>sejak {new Date(cur.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</p>}</div>
              <div style={{ display: "grid", gap: 6 }}>
                <select className="in" aria-label={`Status ${label}`} value={cur?.state ?? "belum"} onChange={(e) => void saveGate(g, e.target.value, notes[g] ?? cur?.note ?? "")}>{GATE_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input className="in" aria-label={`Sumber ${label}`} maxLength={1000} placeholder="Sumber/keterangan, mis. balasan email 29 Okt" value={notes[g] ?? cur?.note ?? ""}
                  onChange={(e) => setNotes((s) => ({ ...s, [g]: e.target.value }))}
                  onBlur={() => { const n = notes[g]; if (n !== undefined && n !== (cur?.note ?? "")) void saveGate(g, cur?.state ?? "belum", n); }} />
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ marginTop: 12, fontSize: 12 }}>Aturan Emas: pembayaran hanya L/C at sight BNI atau Alibaba Trade Assurance, pengiriman DHL Collect, tolak DP/prepayment untuk order pertama. Fakta BPOM, halal, dan HS code diverifikasi ke sumber resmi sebelum dipakai dalam komunikasi luar.</p>
      {err && <div className="notice" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}

type Quote = { id: string; supplier_id: string | null; supplier_name: string | null; product: string; inputs: LandedInput; total_idr: number; unit_idr: number; price_idr: number | null; created_at: string };

/* Simpan hasil hitung landed cost sebagai penawaran supplier. Server menghitung ulang angkanya. */
export function SaveQuote({ inputs, onSaved }: { inputs: LandedInput; onSaved: () => void }) {
  const [product, setProduct] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call("/api/proc/sop").then((b) => setSuppliers((b.data ?? []).map((s: SopRow) => ({ id: s.id, name: s.name })))).catch(() => { /* pilihan supplier opsional */ }); }, []);
  const r = computeLanded(inputs);
  const valid = Number.isFinite(r.unit) && inputs.fob > 0 && inputs.qty >= 1;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await call("/api/proc/quotes", jsonInit("POST", { product: product.trim(), supplier_id: supplierId || null, inputs }));
      setMsg({ ok: true, t: "Penawaran tersimpan." }); onSaved();
    } catch (er) { setMsg({ ok: false, t: er instanceof Error ? er.message : "Gagal menyimpan." }); }
    finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={save} style={{ marginTop: 16 }}>
      <h3>Simpan sebagai penawaran</h3>
      <p>Simpan hasil di atas agar bisa dibandingkan dengan supplier lain untuk produk yang sama.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <label className="f">Produk<input className="in" required maxLength={160} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Mis. PDRN serum 30 ml" /></label>
        <label className="f">Supplier (opsional)<select className="in" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Tanpa supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div style={{ marginTop: 10 }}><button className="btn primary" type="submit" disabled={busy || !product.trim() || !valid}>{busy ? "Menyimpan…" : "Simpan penawaran"}</button></div>
      {!valid && <p style={{ marginTop: 8 }}>Isi harga FOB dan jumlah unit lebih dulu.</p>}
      {msg && <div className="notice" role={msg.ok ? "status" : "alert"} style={{ marginTop: 10 }}>{msg.t}</div>}
    </form>
  );
}

/* Perbandingan penawaran tersimpan, dikelompokkan per produk, termurah dulu. */
export function QuoteCompare({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { call("/api/proc/quotes").then((b) => { setRows(b.data ?? []); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : "Gagal memuat penawaran.")); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  const groups = useMemo(() => {
    const m = new Map<string, Quote[]>();
    for (const q of rows ?? []) { const k = q.product.trim().toLowerCase(); m.set(k, [...(m.get(k) ?? []), q]); }
    return [...m.values()].map((g) => [...g].sort((a, b) => a.unit_idr - b.unit_idr));
  }, [rows]);
  async function del(q: Quote) {
    if (!window.confirm("Hapus penawaran ini?")) return;
    try { await call(`/api/proc/quotes/${q.id}`, { method: "DELETE" }); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal menghapus."); }
  }
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>Banding penawaran</h3><span className="tag">{rows ? `${rows.length} tersimpan` : "…"}</span></div>
      {err && <div className="notice" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      {rows && rows.length === 0 && !err && <p style={{ marginTop: 10 }}>Belum ada penawaran tersimpan.</p>}
      <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
        {groups.map((g) => (
          <div key={g[0].product.trim().toLowerCase()}>
            <strong>{g[0].product}</strong>
            {g.map((q, i) => {
              const delta = i === 0 ? 0 : ((q.unit_idr - g[0].unit_idr) / g[0].unit_idr) * 100;
              return (
                <div className="row" key={q.id}>
                  <span>{q.supplier_name ?? "Tanpa supplier"} <span style={{ color: "var(--muted)" }}>· {q.inputs.qty} unit @ USD {q.inputs.fob} · {new Date(q.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span></span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b>{idr(q.unit_idr)}</b>
                    {i === 0 && g.length > 1 ? <span className="tag">Termurah</span> : i > 0 ? <span className="tag soon">+{delta.toFixed(delta < 10 ? 1 : 0)}%</span> : null}
                    <button className="chip" type="button" onClick={() => void del(q)} aria-label={`Hapus penawaran ${q.product}`}>✕</button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {groups.some((g) => g.length > 1) && <p style={{ marginTop: 12 }}>Perbandingan adil hanya bila spesifikasi, jumlah, dan syarat pengiriman serupa. Periksa itu sebelum memutuskan.</p>}
    </section>
  );
}
