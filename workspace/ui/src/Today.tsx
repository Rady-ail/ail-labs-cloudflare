import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { call, fmtDue, jsonInit } from "./FollowUps";
import { gateLabel } from "./Procurement";

type Item = { id: string; entity_type: "supplier" | "clinic"; entity_id: string; title: string; due_at: string; entity_name: string | null; overdue: boolean };
type Approval = { id: string; action_type: string; created_at: string; expires_at: string };
type Waiting = { supplier_id: string; name: string; gate: string; updated_at: string };
type Today = { followups: Item[]; approvals: Approval[]; waiting_docs: Waiting[]; held: number; unavailable: string[] };
type Go = (v: "supplier" | "klinik" | "assistant") => void;

const SECTION_LABEL: Record<string, string> = { followups: "tindak lanjut", approvals: "persetujuan", waiting_docs: "dokumen supplier", held: "supplier tertahan" };
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const rise = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } } };

/* Layar kerja harian: hanya hal yang butuh tindakan. Tidak ada angka hiasan. */
export function TodayView({ go }: { go: Go }) {
  const [data, setData] = useState<Today | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    call("/api/proc/today").then((b) => { setData(b as Today); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : "Gagal memuat."));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function done(i: Item) {
    try { await call(`/api/ops/activities/${i.id}`, jsonInit("PATCH", { completed: true })); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal memperbarui."); }
  }
  const empty = data && !data.unavailable.length && !data.followups.length && !data.approvals.length && !data.waiting_docs.length && !data.held;
  const date = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });

  return (
    <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.06 }}>
      <motion.div variants={rise} className="top"><div><h1>Hari ini</h1><p className="sub">{date}. Hanya hal yang perlu tindakan Anda.</p></div><button className="chip" onClick={load}>↻ Muat ulang</button></motion.div>
      {err && <div className="notice" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
      {!data && !err && <p>Memuat…</p>}
      {data && data.unavailable.length > 0 && (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          Bagian ini belum tersedia: {data.unavailable.map((u) => SECTION_LABEL[u] ?? u).join(", ")}. Biasanya karena migrasi database 006 atau 005 belum dijalankan.
        </div>
      )}
      {empty && <motion.div variants={rise} className="card"><h3>Semua beres untuk hari ini</h3><p style={{ marginTop: 6 }}>Tidak ada tindak lanjut jatuh tempo, persetujuan menunggu, atau dokumen supplier yang dinanti.</p></motion.div>}
      {data && data.followups.length > 0 && (
        <motion.section variants={rise} className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>Tindak lanjut</h3><span className="tag" style={data.followups.some((f) => f.overdue) ? { color: "var(--orange)" } : undefined}>{data.followups.filter((f) => f.overdue).length} terlambat · {data.followups.length} total</span></div>
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 10 }}>
            {data.followups.map((f) => (
              <li key={f.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" onChange={() => void done(f)} aria-label={`Tandai selesai: ${f.title}`} />
                <button type="button" className="chip" onClick={() => go(f.entity_type === "clinic" ? "klinik" : "supplier")} style={{ textAlign: "left" }}><b>{f.entity_name ?? "—"}</b> · {f.title}</button>
                <span className="tag" style={f.overdue ? { color: "var(--orange)" } : undefined}>{fmtDue(f.due_at)}{f.overdue ? " · terlambat" : ""}</span>
              </li>
            ))}
          </ul>
        </motion.section>
      )}
      <div className="grid g2">
        {data && data.approvals.length > 0 && (
          <motion.section variants={rise} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>Menunggu persetujuan Anda</h3><span className="tag soon">{data.approvals.length}</span></div>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>{data.approvals.map((a) => <li key={a.id}>{a.action_type.replace(/_/g, " ")} <span style={{ color: "var(--muted)" }}>· kedaluwarsa {fmtDue(a.expires_at)}</span></li>)}</ul>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => go("assistant")}>Buka Personal Assistant</button>
          </motion.section>
        )}
        {data && data.waiting_docs.length > 0 && (
          <motion.section variants={rise} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>Menunggu dokumen supplier</h3><span className="tag">{data.waiting_docs.length}</span></div>
            <div style={{ marginTop: 6 }}>
              {data.waiting_docs.map((w) => (
                <div className="row" key={`${w.supplier_id}-${w.gate}`}>
                  <span><b>{w.name}</b> · {gateLabel(w.gate)}</span>
                  <span className="tag" style={daysSince(w.updated_at) >= 7 ? { color: "var(--orange)" } : undefined}>{daysSince(w.updated_at)} hari</span>
                </div>
              ))}
            </div>
            <button className="chip" style={{ marginTop: 10 }} onClick={() => go("supplier")}>Buka Supplier</button>
          </motion.section>
        )}
        {data && data.held > 0 && (
          <motion.section variants={rise} className="card">
            <h3>Supplier tertahan</h3><div className="kpi">{data.held}</div>
            <p style={{ marginTop: 6 }}>Menunggu perubahan syarat atau dokumen dari pihak supplier.</p>
            <button className="chip" style={{ marginTop: 10 }} onClick={() => go("supplier")}>Lihat daftar</button>
          </motion.section>
        )}
      </div>
    </motion.div>
  );
}
