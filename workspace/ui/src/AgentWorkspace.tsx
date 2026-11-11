import { useEffect, useState, type FormEvent } from "react";

type Tab = "chat" | "memory" | "tasks" | "activity";
type Message = { id?: string; role: string; agent_name?: string | null; content: string; created_at?: string };
type Memory = { id: string; category: string; content: string };
type Task = { id: string; title: string; description: string; status: string; schedule_at?: string | null };
type Run = { id: string; agent_name: string; status: string; duration_ms?: number; created_at: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Permintaan gagal (${response.status})`);
  return body as T;
}

export function AgentWorkspace() {
  const [tab, setTab] = useState<Tab>("chat");
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("general");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [summary, setSummary] = useState({ total: 0, completed: 0, failed: 0 });

  async function loadTab(next = tab) {
    setError("");
    try {
      if (next === "memory") setMemories((await api<{ memories: Memory[] }>("/api/assistant/memories")).memories);
      if (next === "tasks") setTasks((await api<{ tasks: Task[] }>("/api/assistant/tasks")).tasks);
      if (next === "activity") {
        const data = await api<{ runs: Run[]; summary: typeof summary }>("/api/assistant/activity");
        setRuns(data.runs); setSummary(data.summary);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal memuat data."); }
  }

  useEffect(() => { void loadTab(tab); }, [tab]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true); setError("");
    setMessages(old => [...old, { role: "user", content: message }]);
    setInput("");
    try {
      const result = await api<{ conversationId: string; answer: string; agent: string }>("/api/assistant/chat", {
        method: "POST", body: JSON.stringify({ message, conversationId, channel: "workspace" })
      });
      setConversationId(result.conversationId);
      setMessages(old => [...old, { role: "assistant", agent_name: result.agent, content: result.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assistant gagal merespons.");
      setMessages(old => old.filter((m, i) => !(m.role === "user" && i === old.length - 1)));
    } finally { setBusy(false); }
  }

  async function saveMemory(e: FormEvent) {
    e.preventDefault();
    if (!memoryText.trim()) return;
    try {
      await api("/api/assistant/memories", { method: "POST", body: JSON.stringify({ category: memoryCategory, content: memoryText.trim() }) });
      setMemoryText(""); await loadTab("memory");
    } catch (e) { setError(e instanceof Error ? e.message : "Memori gagal disimpan."); }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      await api("/api/assistant/tasks", { method: "POST", body: JSON.stringify({ title: taskTitle.trim() }) });
      setTaskTitle(""); await loadTab("tasks");
    } catch (e) { setError(e instanceof Error ? e.message : "Tugas gagal disimpan."); }
  }

  async function updateTask(id: string, status: "completed" | "cancelled") {
    try {
      await api(`/api/assistant/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadTab("tasks");
    } catch (e) { setError(e instanceof Error ? e.message : "Tugas gagal diperbarui."); }
  }

  async function deleteMemory(id: string) {
    try { await api(`/api/assistant/memories/${id}`, { method: "DELETE" }); await loadTab("memory"); }
    catch (e) { setError(e instanceof Error ? e.message : "Memori gagal dihapus."); }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "chat", label: "Percakapan" }, { id: "memory", label: "Memori" },
    { id: "tasks", label: "Tugas" }, { id: "activity", label: "Monitoring" }
  ];

  return <section>
    <div className="top"><div><h1>Personal AI Assistant</h1><p className="sub">Assistant internal AIL LABS · data terpisah per akun</p></div></div>
    <div className="seg" role="tablist" aria-label="Fitur assistant" style={{ flexWrap: "wrap", marginBottom: 16 }}>
      {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
    </div>
    {error && <div className="notice" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
    {tab === "chat" && <div className="card">
      <div style={{ minHeight: 280, maxHeight: 480, overflowY: "auto", display: "grid", gap: 12, alignContent: "start", marginBottom: 16 }}>
        {!messages.length && <p>Mulai percakapan. Assistant memilih spesialis Engineering, Research, Business, Automation, atau General berdasarkan konteks.</p>}
        {messages.map((m, i) => <article key={m.id || i} style={{ padding: 12, borderRadius: 12, background: m.role === "assistant" ? "var(--panel, rgba(127,127,127,.10))" : "transparent", border: "1px solid var(--line, rgba(127,127,127,.2))" }}>
          <div style={{ fontSize: 11, opacity: .7, marginBottom: 6 }}>{m.role === "assistant" ? `AIL Assistant · ${m.agent_name || "agent"}` : "Kamu"}</div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.content}</div>
        </article>)}
        {busy && <p>Assistant sedang berpikir…</p>}
      </div>
      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input className="in" value={input} onChange={e => setInput(e.target.value)} maxLength={6000} placeholder="Tulis instruksi atau pertanyaan…" aria-label="Pesan untuk assistant" />
        <button className="btn primary" disabled={busy || !input.trim()}>{busy ? "…" : "Kirim"}</button>
      </form>
      {conversationId && <p style={{ marginTop: 8, fontSize: 11, opacity: .65 }}>ID percakapan: {conversationId}</p>}
    </div>}
    {tab === "memory" && <div className="grid g2">
      <form className="card" onSubmit={saveMemory}>
        <h3>Simpan memori</h3><p>Memori disimpan hanya atas tindakan eksplisitmu.</p>
        <label className="f">Kategori<select className="in" value={memoryCategory} onChange={e => setMemoryCategory(e.target.value)}><option value="general">Umum</option><option value="preference">Preferensi</option><option value="project">Proyek</option><option value="workflow">Workflow</option><option value="fact">Fakta</option></select></label>
        <label className="f">Isi memori<textarea className="in" value={memoryText} onChange={e => setMemoryText(e.target.value)} maxLength={2000} placeholder="Contoh: Gunakan draft-only untuk komunikasi supplier." /></label>
        <button className="btn primary" disabled={!memoryText.trim()}>Simpan memori</button>
      </form>
      <div className="card"><h3>Memori tersimpan</h3>{memories.length ? memories.map(m => <div key={m.id} className="row"><div><b>{m.category}</b><p>{m.content}</p></div><button className="btn" onClick={() => deleteMemory(m.id)}>Hapus</button></div>) : <p>Belum ada memori.</p>}</div>
    </div>}
    {tab === "tasks" && <div className="card">
      <h3>Daftar tugas</h3><form onSubmit={addTask} style={{ display: "flex", gap: 8, margin: "12px 0" }}><input className="in" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} maxLength={180} placeholder="Tambahkan tugas…" /><button className="btn primary" disabled={!taskTitle.trim()}>Tambah</button></form>
      {tasks.length ? tasks.map(t => <div className="row" key={t.id}><div><b>{t.title}</b><p>{t.status}</p></div>{t.status === "pending" && <div style={{ display: "flex", gap: 6 }}><button className="btn" onClick={() => updateTask(t.id,"completed")}>Selesai</button><button className="btn" onClick={() => updateTask(t.id,"cancelled")}>Batal</button></div>}</div>) : <p>Belum ada tugas.</p>}
      <p style={{ marginTop: 12 }}>Pembuatan tugas sudah tersedia; scheduler dan pengingat lintas kanal belum diaktifkan.</p>
    </div>}
    {tab === "activity" && <div className="card">
      <h3>Monitoring 7 hari terakhir</h3><div className="grid g3" style={{ margin: "14px 0" }}><div><b>{summary.total}</b><p>Total agent run</p></div><div><b>{summary.completed}</b><p>Berhasil</p></div><div><b>{summary.failed}</b><p>Gagal</p></div></div>
      {runs.map(r => <div className="row" key={r.id}><div><b>{r.agent_name}</b><p>{new Date(r.created_at).toLocaleString()}</p></div><span>{r.status} · {r.duration_ms ?? 0} ms</span></div>)}
    </div>}
  </section>;
}
