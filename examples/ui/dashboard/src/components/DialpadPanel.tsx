/** DialpadPanel — Phone controls. Ported from dev-ui. */
import { useState, useCallback, useEffect } from 'react';
import { Phone, PhoneOutgoing, PhoneOff, AlertCircle, Check, Delete, ChevronDown, ChevronUp } from 'lucide-react';
import { DTMF_KEYS } from '../constants';
import { useApi } from '../hooks/useApi';

interface Props {
  activePhones: string[];
  agents: string[];
  sessionId: string | null;
  isInCall: boolean;
  sessionFrom: string | null;
  duration: number;
  hangup: (callId: string) => Promise<any>;
}

function StatusToast({ status }: { status: { type: string; message: string } | null }) {
  if (!status) return null;
  const ok = status.type === 'success';
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px]"
      style={{ background: ok ? 'rgba(92,245,152,0.06)' : 'rgba(255,107,107,0.06)', color: ok ? 'rgb(92,245,152)' : 'rgb(255,107,107)' }}>
      {ok ? <Check size={10} /> : <AlertCircle size={10} />}
      {status.message}
    </div>
  );
}

export default function DialpadPanel({ activePhones, agents, sessionId, isInCall, sessionFrom, duration, hangup }: Props) {
  const { dial } = useApi();
  const [isExpanded, setIsExpanded] = useState(true);
  const [dialInput, setDialInput] = useState('+');
  const [dialFrom, setDialFrom] = useState(activePhones[0] || '');
  const [dialAgent, setDialAgent] = useState(agents[0] || '');
  const [dialGreeting, setDialGreeting] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    if (activePhones.length > 0 && !activePhones.includes(dialFrom)) setDialFrom(activePhones[0]);
  }, [activePhones, dialFrom]);

  useEffect(() => {
    if (agents.length > 0 && !agents.includes(dialAgent)) setDialAgent(agents[0]);
  }, [agents, dialAgent]);

  const flash = useCallback((type: string, message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const ensurePlus = (v: string) => (!v || v === '' ? '+' : v.startsWith('+') ? v : '+' + v);
  const appendDigit = (d: string) => setDialInput(prev => ensurePlus(prev) + d);
  const backspace = () => setDialInput(prev => prev.length > 1 ? prev.slice(0, -1) : '+');

  const handleDial = async () => {
    const num = ensurePlus(dialInput.replace(/[\s\-()]/g, ''));
    if (num.length < 4 || !dialFrom || !dialAgent) return;
    setLoading(true);
    try {
      const r = await dial(dialAgent, num, dialFrom, dialGreeting || undefined);
      if (r.call_id || r.success) { flash('success', `Dialing ${num}…`); setDialInput('+'); setDialGreeting(''); }
      else flash('error', r.error || 'Dial failed');
    } catch (e: any) { flash('error', e.message); }
    setLoading(false);
  };

  const handleHangup = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const r = await hangup(sessionId);
      if (r.success) flash('success', 'Call ended');
      else flash('error', r.error || 'Hangup failed');
    } catch (e: any) { flash('error', e.message); }
    setLoading(false);
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const noPhones = activePhones.length === 0;

  const inputStyle = { background: 'rgba(20,10,32,0.6)', border: '1px solid rgba(60,30,90,0.4)', color: 'rgb(238,240,250)' };

  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid rgba(60,30,90,0.6)' }}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors"
        style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(60,30,90,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="flex items-center gap-2">
          <Phone size={14} style={{ color: 'var(--pc-primary-light)' }} />
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>
            {isInCall ? 'Active Call' : 'Phone'}
          </span>
          {isInCall && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(92,245,152)' }} />
              <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--pc-text-medium)' }}>
                {sessionFrom ? `${sessionFrom} · ` : ''}{fmt(duration)}
              </span>
            </div>
          )}
        </div>
        {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--pc-text-medium)' }} /> : <ChevronDown size={14} style={{ color: 'var(--pc-text-medium)' }} />}
      </button>

      {isExpanded && (
        <div className="overflow-auto px-5 py-4">
          {/* No phones */}
          {noPhones && !isInCall && (
            <div className="text-center py-4">
              <div className="text-xs opacity-60" style={{ color: 'var(--pc-text-medium)' }}>No phone numbers</div>
              <div className="text-[10px] opacity-40" style={{ color: 'var(--pc-text-medium)' }}>Add a phone to start dialing</div>
            </div>
          )}

          {/* Dial section */}
          {!noPhones && (
            <div className="space-y-3">
              <div className="space-y-2">
                {/* Agent selector */}
                {agents.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1" style={{ color: 'var(--pc-text-medium)' }}>Agent</div>
                    <select value={dialAgent} onChange={e => setDialAgent(e.target.value)} className="w-full px-2.5 py-1.5 rounded-md text-xs" style={inputStyle}>
                      {agents.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                )}
                {/* From */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1" style={{ color: 'var(--pc-text-medium)' }}>From</div>
                  <select value={dialFrom} onChange={e => setDialFrom(e.target.value)} className="w-full px-2.5 py-1.5 rounded-md text-xs" style={inputStyle}>
                    {activePhones.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                {/* Greeting */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1" style={{ color: 'var(--pc-text-medium)' }}>Greeting</div>
                  <textarea value={dialGreeting} onChange={e => setDialGreeting(e.target.value)} placeholder="Hello, I'm calling about…" rows={2} className="w-full px-2.5 py-1.5 rounded-md text-xs resize-none" style={inputStyle} />
                </div>
              </div>

              {/* Number */}
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(18,9,28,0.7)', border: '1px solid rgba(50,25,75,0.5)' }}>
                <input
                  type="tel" value={dialInput}
                  onChange={e => setDialInput(ensurePlus(e.target.value.replace(/[^+\d\s\-()]/g, '')))}
                  onKeyDown={e => { if (e.key === 'Enter') handleDial(); if (e.key === 'Backspace' && dialInput === '+') e.preventDefault(); }}
                  className="w-full text-center text-lg font-light tracking-widest font-mono bg-transparent border-none outline-none"
                  style={{ color: dialInput.length > 1 ? 'rgb(230,235,250)' : 'rgb(65,40,95)' }}
                />
              </div>

              {/* Keypad */}
              <div className="grid grid-cols-3 gap-[3px]">
                {DTMF_KEYS.map(({ d, sub }) => (
                  <button key={d} onClick={() => appendDigit(d)} disabled={loading}
                    className="flex flex-col items-center justify-center rounded-lg transition-all duration-100 active:scale-[0.96] disabled:opacity-30"
                    style={{ height: '38px', background: 'rgba(35,18,55,0.7)', border: '1px solid rgba(60,30,90,0.3)', color: 'rgb(210,205,230)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(55,28,85,0.8)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(35,18,55,0.7)'; }}
                  >
                    <span className="text-sm leading-none">{d}</span>
                    {sub && <span className="text-[7px] uppercase tracking-wider opacity-35 mt-0.5">{sub}</span>}
                  </button>
                ))}
              </div>

              {/* Action row */}
              <div className="grid grid-cols-3 gap-[3px]">
                <button onClick={backspace} disabled={dialInput.length <= 1 || loading}
                  className="flex items-center justify-center rounded-lg h-[36px] transition-all disabled:opacity-20" style={{ color: 'rgb(140,110,180)' }}>
                  <Delete size={15} />
                </button>
                <button onClick={handleDial} disabled={dialInput.length < 4 || !dialFrom || !dialAgent || loading}
                  className="flex items-center justify-center rounded-lg h-[36px] transition-all active:scale-[0.96] disabled:opacity-25"
                  style={{ background: 'rgba(92,245,152,0.1)', border: '1px solid rgba(92,245,152,0.2)', color: 'rgb(92,245,152)' }}>
                  <PhoneOutgoing size={15} />
                </button>
                <div />
              </div>
            </div>
          )}

          {/* In-call controls */}
          {isInCall && (
            <div className="space-y-4 mt-4 pt-4" style={{ borderTop: '1px solid rgba(60,30,90,0.4)' }}>
              <button onClick={handleHangup} disabled={loading}
                className="w-full py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{ background: 'rgba(255,107,107,0.08)', color: 'rgb(255,107,107)', border: '1px solid rgba(255,107,107,0.15)' }}>
                <PhoneOff size={13} /> End Call
              </button>
            </div>
          )}

          {status && <div className="mt-2"><StatusToast status={status} /></div>}
        </div>
      )}
    </div>
  );
}
