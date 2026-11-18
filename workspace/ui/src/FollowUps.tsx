import { useCallback, useEffect, useState } from "react";

export type EntityType = "supplier" | "clinic";
type Activity = { id: string; activity_type: string; title: string; body: string; due_at: string | null; completed_at: string | null };
export type Followup = { id: string; entity_type: EntityType; entity_id: string; activity_type: string; title: string; due_at: string; entity_name: string | null };

const TYPES: [string, string][] = [["follow_up", "Tindak lanjut"], ["whatsapp", "WhatsApp"], ["call", "Telepon"], ["email", "Email"], ["meeting", "Pertemuan"], ["sample", "Sampel"], ["note", "Catatan"]];
const typeLabel = (t: string) => TYPES.find(([v]) => v === t)?.[1] ?? t;

export const fmtDue = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const isOverdue = (iso: string | null, done: string | null = null) => Boolean(iso) && !done && new Date(iso as string).getTime() < Date.now();

/* Tautan wa.me: hanya MEMBUKA chat; pemilik yang menekan kirim sendiri. */
export function waLink(raw: string, indonesia: boolean): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (indonesia && d.startsWith("0")) d = "62" + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? `https://wa.me/${d}` : null;
}

/* CSV aman: tameng injeksi rumus (= + - @) dan BOM agar Excel membaca UTF-8. */
export function toCsv(rows: Record<string, unknown>[], cols: [string, string][]): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + [cols.map(([, h]) => cell(h)).join(","), ...rows.map((r) => cols.map(([k]) => cell(r[k])).join(","))].join("\r\n");
}
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Gagal (${r.status})`);
  return b;
}
export const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* Riwayat + tindak lanjut satu supplier/klinik. */
export function ActivityPanel({ entityType, entityId, onChange }: { entityType: EntityType; entityId: string; onChange?: () => void }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("follow_up");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setItems((await call(`/api/ops/activities?entity_type=${entityType}&entity_id=${entityId}`)).data ?? []); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal memuat aktivitas."); }
    finally { setLoading(false); }
  }, [entityType, entityId]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      await call("/api/ops/activities", jsonInit("POST", { entity_type: entityType, entity_id: entityId, activity_type: type, title, body, due_at: due ? new Date(due).toISOString() : null }));
      setTitle(""); setBody(""); setDue(""); await load(); onChange?.();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  }
  async function toggle(a: Activity) {
    setErr("");
    try { await call(`/api/ops/activities/${a.id}`, jsonInit("PATCH", { completed: !a.completed_at })); await load(); onChange?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal memperbarui."); }
  }
  async function del(a: Activity) {
    if (!window.confirm("Hapus aktivitas ini?")) return;
    setErr("");
    try { await call(`/api/ops/activities/${a.id}`, { method: "DELETE" }); await load(); onChange?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal menghapus."); }
  }

  return (
    <div className="activity-panel" style={{ marginTop: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 14 }}>
      <form onSubmit={add} style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="f">Jenis<select className="in" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="f">Jatuh tempo<input className="in" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <label className="f">Judul<input className="in" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mis. Tanya kebutuhan stok bulan ini" /></label>
        <label className="f">Catatan<textarea className="in" rows={2} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <div><button className="btn primary" type="submit" disabled={busy || !title.trim()}>{busy ? "Menyimpan…" : "Tambah aktivitas"}</button></div>
      </form>
      {err && <div className="notice" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      {loading ? <p style={{ marginTop: 10 }}>Memuat…</p> : items.length === 0 ? <p style={{ marginTop: 10 }}>Belum ada aktivitas.</p> :
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {items.map((a) => (
            <li key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", opacity: a.completed_at ? 0.6 : 1 }}>
              <input type="checkbox" checked={Boolean(a.completed_at)} onChange={() => void toggle(a)} aria-label={`Selesai: ${a.title}`} style={{ marginTop: 4 }} />
              <div style={{ flex: 1 }}>
                <strong style={{ textDecoration: a.completed_at ? "line-through" : "none" }}>{a.title}</strong>{" "}
                <span className="tag">{typeLabel(a.activity_type)}</span>
                {a.due_at && <span className="tag" style={isOverdue(a.due_at, a.completed_at) ? { color: "var(--orange)" } : undefined}> ⏰ {fmtDue(a.due_at)}{isOverdue(a.due_at, a.completed_at) ? " · terlambat" : ""}</span>}
                {a.body && <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{a.body}</p>}
              </div>
              <button className="chip" type="button" onClick={() => void del(a)} aria-label={`Hapus aktivitas ${a.title}`}>✕</button>
            </li>
          ))}
        </ul>}
    </div>
  );
}

/* Daftar tindak lanjut terbuka (Beranda). */
export function DueList({ go }: { go: (v: "supplier" | "klinik") => void }) {
  const [rows, setRows] = useState<Followup[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { call("/api/ops/followups").then((b) => setRows(b.data ?? [])).catch((e) => setErr(e instanceof Error ? e.message : "Gagal memuat.")); }, []);
  useEffect(() => { load(); }, [load]);
  async function done(f: Followup) {
    try { await call(`/api/ops/activities/${f.id}`, jsonInit("PATCH", { completed: true })); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal memperbarui."); }
  }
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>Tindak lanjut terdekat</h3><span className="tag">{rows ? rows.length : "…"}</span></div>
      {err && <div className="notice" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      {rows && rows.length === 0 && !err && <p style={{ marginTop: 10 }}>Tidak ada tindak lanjut terbuka. Tambahkan dari halaman Klinik atau Supplier.</p>}
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 10 }}>
        {(rows ?? []).slice(0, 8).map((f) => (
          <li key={f.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" onChange={() => void done(f)} aria-label={`Tandai selesai: ${f.title}`} />
            <button type="button" className="chip" onClick={() => go(f.entity_type === "clinic" ? "klinik" : "supplier")} style={{ textAlign: "left" }}>
              <b>{f.entity_name ?? "—"}</b> · {f.title}
            </button>
            <span className="tag" style={isOverdue(f.due_at) ? { color: "var(--orange)" } : undefined}>{fmtDue(f.due_at)}{isOverdue(f.due_at) ? " · terlambat" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
