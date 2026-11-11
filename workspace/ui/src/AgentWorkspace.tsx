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

  return <section className="agent-os">
    <div className="top agent-heading">
      <div><div className="eyebrow"><span className="pulse-dot" /> PERSONAL INTELLIGENCE</div><h1>AI Command Center</h1><p className="sub">Orchestrate conversations, memory, tasks, and agent activity from one private workspace.</p></div>
      <div className="agent-status"><span className="status-orb" /><span><b>CORE ONLINE</b><small>Private workspace</small></span></div>
    </div>
    <div className="agent-overview">
      <div className="overview-tile"><span>ACTIVE MODULE</span><b>{tab === "chat" ? "AI Conversation" : tab === "memory" ? "Memory Vault" : tab === "tasks" ? "Task Queue" : "Agent Telemetry"}</b><small>AIL Intelligence Layer</small></div>
      <div className="overview-tile"><span>MEMORY RECORDS</span><b>{memories.length.toString().padStart(2,"0")}</b><small>Explicitly saved</small></div>
      <div className="overview-tile"><span>OPEN TASKS</span><b>{tasks.filter(t => t.status === "pending").length.toString().padStart(2,"0")}</b><small>Pending actions</small></div>
      <div className="overview-tile"><span>RECENT RUNS</span><b>{summary.total.toString().padStart(2,"0")}</b><small>Last 7 days</small></div>
    </div>
    <div className="agent-tabs" role="tablist" aria-label="Assistant modules">
      {tabs.map((t, i) => <button key={t.id} className={tab === t.id ? "active" : ""} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}><span className="tab-index">0{i+1}</span>{t.label}{tab === t.id && <i />}</button>)}
    </div>
    {error && <div className="notice" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
    {tab === "chat" && <div className="agent-chat-layout">
      <div className="card chat-card">
        <div className="panel-head"><div><span className="panel-kicker">LIVE SESSION</span><h3>Conversation stream</h3></div><span className="live-chip"><i /> LIVE</span></div>
        <div className="chat-stream" aria-live="polite">
          {!messages.length && <div className="chat-empty"><div className="empty-orbit"><span /><i /><b>✳</b></div><h3>Intelligence at your command</h3><p>Mulai percakapan. Assistant memilih spesialis Engineering, Research, Business, Automation, atau General berdasarkan konteks.</p><span className="empty-hint">YOUR PRIVATE AI WORKSPACE</span></div>}
          {messages.map((m, i) => <article key={m.id || i} className={m.role === "assistant" ? "message assistant-message" : "message user-message"}>
            <div className="message-meta"><span className={m.role === "assistant" ? "message-avatar ai-avatar" : "message-avatar"}>{m.role === "assistant" ? "✳" : "U"}</span><b>{m.role === "assistant" ? "AIL Assistant" : "You"}</b><small>{m.role === "assistant" ? m.agent_name || "agent" : "USER INPUT"}</small></div>
            <div className="message-content">{m.content}</div>
          </article>)}
          {busy && <div className="thinking-state"><span /><span /><span /> Agent is reasoning…</div>}
        </div>
        <form onSubmit={send} className="composer">
          <input className="in" value={input} onChange={e => setInput(e.target.value)} maxLength={6000} placeholder="Message your AI workspace…" aria-label="Pesan untuk assistant" />
          <button className="btn primary" disabled={busy || !input.trim()}>{busy ? "…" : "Send ↗"}</button>
        </form>
        <div className="composer-foot"><span>↳ ENTER TO SEND</span><span>UP TO 6,000 CHARACTERS</span></div>
        {conversationId && <p className="conversation-id">SESSION · {conversationId}</p>}
      </div>
      <aside className="agent-side-panel">
        <div className="card agent-info-card"><span className="panel-kicker">ROUTING ENGINE</span><h3>Specialist agents</h3><p>Assistant selects a specialist based on your request context.</p><div className="specialist-list">{["Engineering","Research","Business","Automation","General"].map((name, i) => <div key={name}><span className="specialist-icon">{["⌘","⌕","◈","↗","✳"][i]}</span><b>{name}</b><span className="specialist-state">AVAILABLE</span></div>)}</div></div>
        <div className="card agent-info-card"><span className="panel-kicker">SAFETY LAYER</span><h3>Human in control</h3><p>Actions remain advisory. Memory is saved only by explicit request. No automatic outbound messages or arbitrary tool execution.</p><div className="safety-line"><span className="pulse-dot" /> Approval boundary active</div></div>
      </aside>
    </div>}
    {tab === "memory" && <div className="grid g2 agent-data-grid">
      <form className="card" onSubmit={saveMemory}><span className="panel-kicker">LONG-TERM CONTEXT</span><h3>Memory vault</h3><p>Save durable context explicitly. No background capture.</p>
        <label className="f">Category<select className="in" value={memoryCategory} onChange={e => setMemoryCategory(e.target.value)}><option value="general">General</option><option value="preference">Preference</option><option value="project">Project</option><option value="workflow">Workflow</option><option value="fact">Fact</option></select></label>
        <label className="f">Memory<textarea className="in" value={memoryText} onChange={e => setMemoryText(e.target.value)} maxLength={2000} placeholder="Add a useful fact, preference, or project context…" /></label>
        <button className="btn primary" disabled={!memoryText.trim()}>Save to vault ↗</button>
      </form>
      <div className="card"><span className="panel-kicker">PERSISTENT RECORDS</span><h3>Saved memories</h3>{memories.length ? memories.map(m => <div key={m.id} className="row"><div><b>{m.category}</b><p>{m.content}</p></div><button className="btn" onClick={() => deleteMemory(m.id)}>Delete</button></div>) : <div className="empty-state">No saved memories yet.</div>}</div>
    </div>}
    {tab === "tasks" && <div className="card agent-task-panel">
      <span className="panel-kicker">EXECUTION BACKLOG</span><h3>Task queue</h3><p>Track actions assigned to your workspace.</p>
      <form onSubmit={addTask} className="task-composer"><input className="in" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} maxLength={180} placeholder="Create a task…" /><button className="btn primary" disabled={!taskTitle.trim()}>Add task +</button></form>
      {tasks.length ? tasks.map(t => <div className="row" key={t.id}><div><b>{t.title}</b><p>{t.status}</p></div>{t.status === "pending" && <div style={{ display: "flex", gap: 6 }}><button className="btn" onClick={() => updateTask(t.id,"completed")}>Complete</button><button className="btn" onClick={() => updateTask(t.id,"cancelled")}>Cancel</button></div>}</div>) : <div className="empty-state">Your task queue is clear.</div>}
      <p style={{ marginTop: 14 }}>Task creation is available. Scheduler and cross-channel reminders are not enabled yet.</p>
    </div>}
    {tab === "activity" && <div className="card agent-activity-panel">
      <span className="panel-kicker">OBSERVABILITY / 7D</span><h3>Agent telemetry</h3><div className="grid g3" style={{ margin: "18px 0" }}><div className="telemetry-kpi"><b>{summary.total}</b><p>Total runs</p></div><div className="telemetry-kpi"><b>{summary.completed}</b><p>Completed</p></div><div className="telemetry-kpi"><b>{summary.failed}</b><p>Failed</p></div></div>
      {runs.map(r => <div className="row" key={r.id}><div><b>{r.agent_name}</b><p>{new Date(r.created_at).toLocaleString()}</p></div><span>{r.status} · {r.duration_ms ?? 0} ms</span></div>)}
      {!runs.length && <div className="empty-state">No agent activity recorded in this period.</div>}
    </div>}
  </section>;
}
