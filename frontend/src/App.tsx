import { useState, useRef, useEffect } from 'react'

const API = '/api'
interface Message { role: 'user' | 'assistant'; content: string; time?: string }
interface ChatSession { id: string; title: string; messages: Message[]; updatedAt: number }

const DARK = {
  bg: '#0a0a0a', sidebar: '#141414', card: '#141414', border: '#252525',
  input: '#1a1a1a', inputBorder: '#303030',
  text: '#f5f5f7', textSub: '#e5e5ea', textMuted: '#98989d',
  accent: '#0a84ff', accentHover: '#409cff',
  msgUser: '#0a84ff', msgUserText: '#fff',
  msgBot: 'transparent', msgBotText: '#e5e5ea',
  btnHover: '#1e1e1e',
  summaryBg: '#1a1a1a',
  tableHead: '#98989d', tableBorder: '#252525', tableText: '#e5e5ea',
  header: '#409cff', headerSub: '#64d2ff', codeText: '#64d2ff', codeBg: '#0a0a0a',
  strongText: '#f5f5f7', hrColor: '#252525',
  logoFilter: 'brightness(1)',
  sidebarBtn: '#1e1e1e',
}

const LIGHT = {
  bg: '#ffffff', sidebar: '#f8f9fa', card: '#ffffff', border: '#e9ecef',
  input: '#f8f9fa', inputBorder: '#dee2e6',
  text: '#202124', textSub: '#3c4043', textMuted: '#5f6368',
  accent: '#1a73e8', accentHover: '#1557b0',
  msgUser: '#e8f0fe', msgUserText: '#1a73e8',
  msgBot: 'transparent', msgBotText: '#3c4043',
  btnHover: '#f1f3f4',
  summaryBg: '#f1f3f4',
  tableHead: '#5f6368', tableBorder: '#e9ecef', tableText: '#3c4043',
  header: '#1a73e8', headerSub: '#1557b0', codeText: '#1557b0', codeBg: '#f1f3f4',
  strongText: '#202124', hrColor: '#e9ecef',
  logoFilter: 'brightness(0.1)',
  sidebarBtn: '#f1f3f4',
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }
function saveSessions(sessions: ChatSession[]) { localStorage.setItem('ai_m_sessions', JSON.stringify(sessions)) }
function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem('ai_m_sessions') || '[]') } catch { return [] }
}

function formatTime() {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function renderMarkdown(text: string, t: typeof DARK) {
  if (!text) return null
  const lines = text.split('\n')
  const elements: any[] = []
  let inTable = false, tableRows: string[][] = [], tableHeaders: string[] = []

  const flushTable = () => {
    if (!tableHeaders.length) return
    elements.push(
      <div key={'t' + elements.length} style={{ overflowX: 'auto', margin: '12px 0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${t.tableBorder}` }}>
              {tableHeaders.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '8px 12px', color: t.tableHead, fontWeight: 600 }}>{h.trim()}</th>)}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: `1px solid ${t.tableBorder}`, background: ri % 2 === 0 ? 'transparent' : t.summaryBg + '40' }}>
                {row.map((cell, ci) => <td key={ci} style={{ padding: '7px 12px', color: t.tableText }}>{cell.trim()}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableHeaders = []; tableRows = []; inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '')
      if (cells.length > 0) {
        if ((lines[i + 1] || '').match(/^\|?[\s-|]+\|?$/)) { tableHeaders = cells; inTable = true; i++; continue }
        if (inTable) { tableRows.push(cells); continue }
      }
    } else if (inTable) flushTable()

    if (line.startsWith('## ')) elements.push(<h3 key={i} style={{ fontSize: '15px', fontWeight: 700, margin: '16px 0 6px', color: t.header }}>{line.slice(3)}</h3>)
    else if (line.startsWith('### ')) elements.push(<h4 key={i} style={{ fontSize: '14px', fontWeight: 600, margin: '12px 0 4px', color: t.headerSub }}>{line.slice(4)}</h4>)
    else if (line.startsWith('# ')) elements.push(<h2 key={i} style={{ fontSize: '17px', fontWeight: 700, margin: '16px 0 8px', color: t.header }}>{line.slice(2)}</h2>)
    else if (line.startsWith('- ') || line.startsWith('* ')) elements.push(<div key={i} style={{ display: 'flex', gap: '8px', margin: '3px 0', color: t.textSub, fontSize: '14px' }}><span style={{ color: t.accent, flexShrink: 0 }}>•</span><span>{fi(line.slice(2), t)}</span></div>)
    else if (line.match(/^\d+\. /)) elements.push(<div key={i} style={{ display: 'flex', gap: '8px', margin: '3px 0', color: t.textSub, fontSize: '14px' }}><span style={{ color: t.accent, flexShrink: 0, minWidth: '16px' }}>{line.match(/^\d+/)![0]}.</span><span>{fi(line.replace(/^\d+\. /, ''), t)}</span></div>)
    else if (line.trim() === '---') elements.push(<hr key={i} style={{ border: 'none', borderTop: `1px solid ${t.hrColor}`, margin: '12px 0' }} />)
    else if (line.trim() === '') elements.push(<div key={i} style={{ height: '6px' }} />)
    else elements.push(<p key={i} style={{ margin: '3px 0', color: t.msgBotText, fontSize: '14px', lineHeight: '1.6' }}>{fi(line, t)}</p>)
  }
  if (inTable) flushTable()
  return elements
}

function fi(text: string, t: typeof DARK): any {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: t.strongText, fontWeight: 600 }}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{ background: t.codeBg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px', color: t.codeText, fontFamily: 'monospace' }}>{p.slice(1, -1)}</code>
    return p
  })
}

function LoginPage({ onLogin, isDark, toggleTheme }: { onLogin: (t: string) => void; isDark: boolean; toggleTheme: () => void }) {
  const t = isDark ? DARK : LIGHT
  const [u, setU] = useState('admin'), [p, setP] = useState('admin'), [err, setErr] = useState(''), [loading, setLoading] = useState(false)

  const login = async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
      if (!r.ok) throw new Error('Invalid credentials')
      const d = await r.json()
      localStorage.setItem('ai_m_token', d.access_token)
      onLogin(d.access_token)
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Google Sans, system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
        <button onClick={toggleTheme} style={{ background: t.sidebarBtn, border: `1px solid ${t.border}`, borderRadius: '20px', padding: '6px 14px', color: t.textMuted, fontSize: '13px', cursor: 'pointer' }}>
          {isDark ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>
      <div style={{ textAlign: 'center', maxWidth: '380px', width: '100%', padding: '0 24px' }}>
        <img src={isDark ? '/logo-dark.png' : '/logo-light.png'} alt="PPLUS" style={{ height: '48px', objectFit: 'contain', marginBottom: '24px' }} />
        <h1 style={{ color: t.text, fontSize: '28px', fontWeight: 400, margin: '0 0 8px' }}>PPLUS-AIOps-M1.0</h1>
        <p style={{ color: t.textMuted, fontSize: '15px', margin: '0 0 40px' }}>Network Infrastructure Intelligence</p>
        <div style={{ background: t.sidebar, border: `1px solid ${t.border}`, borderRadius: '16px', padding: '32px' }}>
          <input value={u} onChange={e => setU(e.target.value)}
            style={{ width: '100%', background: t.input, border: `1px solid ${t.inputBorder}`, borderRadius: '8px', padding: '12px 16px', color: t.text, fontSize: '14px', boxSizing: 'border-box', marginBottom: '12px', outline: 'none' }}
            placeholder="Username" />
          <input type="password" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()}
            style={{ width: '100%', background: t.input, border: `1px solid ${t.inputBorder}`, borderRadius: '8px', padding: '12px 16px', color: t.text, fontSize: '14px', boxSizing: 'border-box', marginBottom: '20px', outline: 'none' }}
            placeholder="Password" />
          {err && <p style={{ color: '#f28b82', fontSize: '13px', margin: '-8px 0 16px', textAlign: 'left' }}>{err}</p>}
          <button onClick={login} disabled={loading}
            style={{ width: '100%', background: t.accent, color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 500, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}

const SUGGESTED = [
  { icon: '⬡', text: 'hosts ทั้งหมดมีกี่ตัว?' },
  { icon: '⚡', text: 'ปัญหา critical มีอะไรบ้าง?' },
  { icon: '◐', text: 'CPU สูงสุด 5 host แรก?' },
  { icon: '◉', text: 'host ไหน down บ้าง?' },
  { icon: '◈', text: 'memory ใช้งานสูงสุดคือ host ไหน?' },
  { icon: '↗', text: 'traffic สูงสุดในช่วงนี้?' },
]

function ChatApp({ token, onLogout, isDark, toggleTheme }: { token: string; onLogout: () => void; isDark: boolean; toggleTheme: () => void }) {
  const t = isDark ? DARK : LIGHT
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<{ hosts: number; problems: number } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions())
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { fetchSummary(); const i = setInterval(fetchSummary, 30000); return () => clearInterval(i) }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const newChat = () => {
    setMessages([])
    setCurrentSessionId(null)
  }

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages)
    setCurrentSessionId(session.id)
  }

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    saveSessions(updated)
    if (currentSessionId === id) { setMessages([]); setCurrentSessionId(null) }
  }

  const fetchSummary = async () => {
    try { const r = await fetch(`${API}/zabbix/summary`, { headers: { Authorization: `Bearer ${token}` } }); if (r.ok) setSummary(await r.json()) } catch {}
  }

  const send = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    setInput('')
    const newMsgs = [...messages, { role: 'user' as const, content: msg, time: formatTime() }]
    setMessages(newMsgs)
    setLoading(true)
    try {
      const r = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: msg, messages: messages.slice(-6) }) })
      const d = await r.json()
      setMessages(p => [...p, { role: 'assistant', content: d.reply, time: formatTime() }])
    } catch (e: any) {
      setMessages(p => [...p, { role: 'assistant', content: `❌ Error: ${e.message}`, time: formatTime() }])
    } finally { setLoading(false) }
  }

  // Auto-save session after messages update
  useEffect(() => {
    if (messages.length === 0) return
    const title = messages[0]?.content?.slice(0, 50) || 'New chat'
    const sid = currentSessionId || genId()
    if (!currentSessionId) setCurrentSessionId(sid)
    const session: ChatSession = { id: sid, title, messages, updatedAt: Date.now() }
    setSessions(prev => {
      const existing = prev.find(s => s.id === sid)
      const updated = existing
        ? prev.map(s => s.id === sid ? session : s)
        : [session, ...prev]
      saveSessions(updated)
      return updated
    })
  }, [messages])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: t.bg, fontFamily: 'Google Sans, system-ui, sans-serif', overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{ width: sidebarOpen ? '280px' : '0px', overflow: 'hidden', transition: 'width 0.25s ease', background: t.sidebar, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '16px', width: '280px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0 16px' }}>
            <img src={isDark ? '/logo-dark.png' : '/logo-light.png'} alt="PPLUS" style={{ height: '28px', objectFit: 'contain' }} />
            <span style={{ color: t.text, fontSize: '15px', fontWeight: 500 }}>PPLUS-AIOps-M1.0</span>
          </div>

          <button onClick={newChat}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'transparent', border: '1px dashed ' + t.border, borderRadius: '8px', padding: '9px 10px', color: t.textMuted, fontSize: '13px', cursor: 'pointer', marginBottom: '12px' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >＋ New chat</button>

          <div style={{ color: t.textMuted, fontSize: '11px', fontWeight: 500, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Recent Chats</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', width: '280px', boxSizing: 'border-box' }}>
          {sessions.length === 0 ? (
            <div style={{ color: t.textMuted, fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>No history yet</div>
          ) : sessions.map(s => (
            <div key={s.id} onClick={() => loadSession(s)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', marginBottom: '2px', background: currentSessionId === s.id ? t.btnHover : 'transparent', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
              onMouseLeave={e => { if (currentSessionId !== s.id) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: '13px', flexShrink: 0 }}>💬</span>
              <span style={{ flex: 1, color: t.textSub, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.4' }}>{s.title}</span>
              <button onClick={e => deleteSession(s.id, e)}
                style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: '14px', cursor: 'pointer', padding: '0 2px', flexShrink: 0, opacity: 0.3 }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f28b82' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.3'; e.currentTarget.style.color = t.textMuted }}
              >×</button>
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: `1px solid ${t.border}`, width: '280px', boxSizing: 'border-box' }}>
          <button onClick={toggleTheme}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'transparent', border: 'none', borderRadius: '8px', padding: '9px 10px', color: t.textMuted, fontSize: '13px', cursor: 'pointer', marginBottom: '2px' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >{isDark ? '◑ Light mode' : '◐ Dark mode'}</button>
          <button onClick={onLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'transparent', border: 'none', borderRadius: '8px', padding: '9px 10px', color: t.textMuted, fontSize: '13px', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >⎋ Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: `1px solid ${t.border}` }}>
          <button onClick={() => setSidebarOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: t.textMuted, fontSize: '18px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >☰</button>
          <span style={{ color: t.textMuted, fontSize: '14px' }}>Network Infrastructure Intelligence</span>
          {messages.length > 0 && (
            <button onClick={newChat}
              style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '5px 12px', color: t.textMuted, fontSize: '12px', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = t.btnHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >+ New chat</button>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
          {messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px 24px' }}>
              <img src={isDark ? '/logo-dark.png' : '/logo-light.png'} alt="PPLUS" style={{ height: '56px', objectFit: 'contain', marginBottom: '20px', opacity: 0.9 }} />
              <h2 style={{ color: t.text, fontSize: '26px', fontWeight: 400, margin: '0 0 8px' }}>Network Infrastructure Intelligence</h2>
              <p style={{ color: t.textMuted, fontSize: '15px', margin: '0 0 40px' }}>ถามเกี่ยวกับ infrastructure ของคุณได้เลย</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', maxWidth: '720px', width: '100%' }}>
                {SUGGESTED.map((s, i) => (
                  <button key={i} onClick={() => send(s.text)}
                    style={{ background: t.sidebar, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '16px', textAlign: 'left', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = t.btnHover; e.currentTarget.style.borderColor = t.accent }}
                    onMouseLeave={e => { e.currentTarget.style.background = t.sidebar; e.currentTarget.style.borderColor = t.border }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '8px' }}>{s.icon}</div>
                    <div style={{ color: t.textSub, fontSize: '13px', lineHeight: '1.4' }}>{s.text}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 24px 0' }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: '28px' }}>
                  {msg.role === 'user' ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ background: t.msgUser, borderRadius: '20px 20px 4px 20px', padding: '12px 18px', maxWidth: '70%' }}>
                        <p style={{ color: t.msgUserText, fontSize: '14px', margin: 0, lineHeight: '1.5' }}>{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: t.sidebar, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                        <img src={isDark ? '/logo-dark.png' : '/logo-light.png'} alt="AI" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                      </div>
                      <div style={{ flex: 1, paddingTop: '4px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: t.accent, marginBottom: '6px' }}>PPLUS-AIOps-M1.0</div>
                        <div>{renderMarkdown(msg.content, t)}</div>
                        <div style={{ color: t.textMuted, fontSize: '11px', marginTop: '8px' }}>{msg.time}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '28px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: t.sidebar, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                    <img src={isDark ? '/logo-dark.png' : '/logo-light.png'} alt="AI" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                  </div>
                  <div style={{ paddingTop: '10px', display: 'flex', gap: '5px' }}>
                    {[0,1,2].map(j => <div key={j} style={{ width: '7px', height: '7px', borderRadius: '50%', background: t.accent, animation: 'pulse 1.4s infinite ease-in-out', animationDelay: `${j*0.2}s`, opacity: 0.6 }} />)}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${t.border}` }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', background: t.input, border: `1.5px solid ${t.inputBorder}`, borderRadius: '24px', padding: '10px 16px', transition: 'border-color 0.2s' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={handleKey}
                placeholder="ถามเกี่ยวกับ hosts, problems, CPU, memory, network..."
                rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', color: t.text, fontSize: '14px', outline: 'none', resize: 'none', lineHeight: '1.5', maxHeight: '120px', minHeight: '24px', fontFamily: 'inherit' }}
                disabled={loading}
              />
              <button onClick={() => send()} disabled={loading || !input.trim()}
                style={{ background: input.trim() && !loading ? t.accent : 'transparent', border: input.trim() && !loading ? 'none' : `1px solid ${t.inputBorder}`, borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', flexShrink: 0, transition: 'background 0.2s', fontSize: '16px' }}>
                <span style={{ color: input.trim() && !loading ? '#fff' : t.textMuted }}>↑</span>
              </button>
            </div>
            <p style={{ textAlign: 'center', color: t.textMuted, fontSize: '11px', margin: '8px 0 0' }}>PPLUS-AIOps-M1.0 · Real-time Zabbix data · Press Enter to send</p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        * { box-sizing: border-box; }
        textarea { scrollbar-width: thin; }
      `}</style>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ai_m_token'))
  const [isDark, setIsDark] = useState(() => localStorage.getItem('ai_m_theme') !== 'light')
  const toggle = () => { const n = !isDark; setIsDark(n); localStorage.setItem('ai_m_theme', n ? 'dark' : 'light') }
  if (!token) return <LoginPage onLogin={t => setToken(t)} isDark={isDark} toggleTheme={toggle} />
  return <ChatApp token={token} onLogout={() => { localStorage.removeItem('ai_m_token'); setToken(null) }} isDark={isDark} toggleTheme={toggle} />
}
