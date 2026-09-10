import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Bot, Check, ChevronRight, CircleHelp, Clipboard, Cloud,
  Command, FileText, LogOut, Menu, MessageSquareText, PanelLeft,
  Play, Radio, Settings2, ShieldCheck, Sparkles, Terminal, X
} from 'lucide-react';
import './styles.css';

const navItems = [
  { label: 'Overview', icon: PanelLeft, active: true },
  { label: 'Conversations', icon: MessageSquareText },
  { label: 'Model settings', icon: Sparkles },
  { label: 'Deployment', icon: Cloud }
];

const events = [
  ['Just now', 'Incoming message received', '256336667361375@lid'],
  ['2 min ago', 'Qwen response delivered', 'Qwen/Qwen3.8-27B:novita'],
  ['8 min ago', 'Session restored', 'WhatsApp Web']
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [model, setModel] = useState('Qwen/Qwen3.8-27B:novita');
  const [copied, setCopied] = useState(false);
  const [startCopied, setStartCopied] = useState(false);

  const copyConfig = async () => {
    await navigator.clipboard?.writeText(`HF_MODEL=${model}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyStartCommand = async () => {
    await navigator.clipboard?.writeText('npm start');
    setStartCopied(true);
    window.setTimeout(() => setStartCopied(false), 1800);
  };

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Main navigation">
        <div className="brand"><span className="brand-mark"><Bot size={20} /></span><span>Qwen Relay</span><button className="close-menu" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <nav>
          {navItems.map(({ label, icon: Icon, active }) => (
            <button className={active ? 'nav-item active' : 'nav-item'} key={label}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><CircleHelp size={18} /><span>Documentation</span></button>
          <button className="profile"><span className="avatar">Q</span><span><b>Qwen Bot</b><small>Local session</small></span><LogOut size={16} /></button>
        </div>
      </aside>

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation overlay" />}

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <div className="crumbs"><span>Workspace</span><ChevronRight size={15} /><b>Overview</b></div>
          <div className="topbar-actions"><span className="status"><i /> Bot online</span><button className="icon-button" aria-label="Open help"><CircleHelp size={19} /></button></div>
        </header>

        <section className="content">
          <div className="intro"><div><p className="eyebrow">WHATSAPP AI ASSISTANT</p><h1>Everything is <em>ready to reply.</em></h1><p className="intro-copy">Monitor the local WhatsApp session and keep your Qwen model configuration close at hand.</p></div><button className="primary-button" onClick={copyStartCommand}><Play size={17} fill="currentColor" /> {startCopied ? 'Command copied' : 'Copy start command'}</button></div>

          <section className="metric-grid" aria-label="Bot status">
            <article className="metric-card connection"><div className="card-icon violet"><Radio size={20} /></div><div><p>WhatsApp connection</p><strong>Connected</strong><small><i /> Ready to receive messages</small></div></article>
            <article className="metric-card"><div className="card-icon pink"><Sparkles size={20} /></div><div><p>Active model</p><strong className="model-name">Qwen 3.8 27B</strong><small>Novita provider</small></div></article>
            <article className="metric-card"><div className="card-icon blue"><Activity size={20} /></div><div><p>Conversation memory</p><strong>5 turns</strong><small>Per direct chat</small></div></article>
          </section>

          <div className="dashboard-grid">
            <section className="panel model-panel"><div className="panel-heading"><div><p className="eyebrow">INFERENCE</p><h2>Model settings</h2></div><Settings2 size={20} /></div>
              <label htmlFor="model">Hugging Face model</label>
              <div className="input-row"><input id="model" value={model} onChange={(event) => setModel(event.target.value)} spellCheck="false" /><button onClick={copyConfig} aria-label="Copy model setting">{copied ? <Check size={18} /> : <Clipboard size={18} />}</button></div>
              <p className="hint">Routes requests to Novita via Hugging Face Inference Providers. Your token stays in the local <code>.env</code> file.</p>
              <div className="code-snippet"><Terminal size={17} /><code>HF_MODEL={model}</code></div>
              <button className="secondary-button" onClick={copyConfig}>{copied ? 'Copied to clipboard' : 'Copy .env setting'} <ChevronRight size={16} /></button>
            </section>

            <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE ACTIVITY</p><h2>Recent events</h2></div><button className="text-button">View logs</button></div>
              <div className="event-list">{events.map(([time, title, detail]) => <article className="event" key={time + title}><span className="event-dot" /><div><b>{title}</b><p>{detail}</p></div><time>{time}</time></article>)}</div>
              <div className="secure-note"><ShieldCheck size={18} /><span><b>Private by design</b> This dashboard never exposes your HF token.</span></div>
            </section>
          </div>

          <section className="panel quickstart"><div><p className="eyebrow">LOCAL SETUP</p><h2>Three steps to chat</h2></div><div className="steps"><div><span>01</span><b>Start the bot</b><p>Run <code>npm start</code> in the project folder.</p></div><div><span>02</span><b>Link WhatsApp</b><p>Scan the QR code once using Linked devices.</p></div><div><span>03</span><b>Message the bot</b><p>Send a direct message from another account.</p></div></div><a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="deploy-link"><Cloud size={17} /> Deploy dashboard on Vercel</a></section>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
