/**
 * CallControlModal — In-call controls: DTMF tones, Forward, Hold/Mute, Hangup.
 * Appears as an inline panel in the right sidebar when a call is active.
 */
import { useState, useCallback } from 'react';
import {
  PhoneForwarded, PhoneOff, Pause, Play,
  MicOff, Mic, X,
} from 'lucide-react';
import { DTMF_KEYS } from '../constants';

interface Props {
  sessionId: string | null;
  send: (msg: any) => void;
  onHangup: () => void;
  loading?: boolean;
}

export default function CallControlModal({ sessionId, send, onHangup, loading }: Props) {
  const [tab, setTab] = useState<'tones' | 'forward'>('tones');
  const [dtmfBuffer, setDtmfBuffer] = useState('');
  const [forwardTo, setForwardTo] = useState('+');
  const [held, setHeld] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2000);
  }, []);

  const sendDTMF = (digit: string) => {
    if (!sessionId) return;
    setDtmfBuffer(prev => prev + digit);
    send({ action: 'dtmf', call_id: sessionId, digits: digit });
  };

  const clearDTMF = () => setDtmfBuffer('');

  const handleForward = () => {
    const num = forwardTo.replace(/[\s\-()]/g, '');
    if (!sessionId || num.length < 4) return;
    send({ action: 'forward', call_id: sessionId, to: num });
    flash(`Forwarding to ${num}…`);
    setForwardTo('+');
  };

  const toggleHold = () => {
    if (!sessionId) return;
    send({ action: held ? 'unhold' : 'hold', call_id: sessionId });
    setHeld(!held);
    flash(held ? 'Resumed' : 'On hold');
  };

  const toggleMute = () => {
    if (!sessionId) return;
    send({ action: muted ? 'unmute' : 'mute', call_id: sessionId });
    setMuted(!muted);
    flash(muted ? 'Unmuted' : 'Muted');
  };

  const inputStyle = { background: 'rgba(20,10,32,0.6)', border: '1px solid rgba(60,30,90,0.4)', color: 'rgb(238,240,250)' };

  return (
    <div className="px-4 py-3 space-y-3" style={{ borderBottom: '1px solid rgba(60,30,90,0.4)' }}>
      {/* Quick actions row */}
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={toggleHold} title={held ? 'Resume' : 'Hold'}
          className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px]"
          style={{
            background: held ? 'rgba(255,196,60,0.12)' : 'rgba(35,18,55,0.7)',
            border: `1px solid ${held ? 'rgba(255,196,60,0.25)' : 'rgba(60,30,90,0.3)'}`,
            color: held ? 'rgb(255,196,60)' : 'rgb(160,140,190)',
          }}>
          {held ? <Play size={14} /> : <Pause size={14} />}
          {held ? 'Resume' : 'Hold'}
        </button>

        <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}
          className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px]"
          style={{
            background: muted ? 'rgba(255,107,178,0.12)' : 'rgba(35,18,55,0.7)',
            border: `1px solid ${muted ? 'rgba(255,107,178,0.25)' : 'rgba(60,30,90,0.3)'}`,
            color: muted ? 'rgb(255,107,178)' : 'rgb(160,140,190)',
          }}>
          {muted ? <MicOff size={14} /> : <Mic size={14} />}
          {muted ? 'Unmute' : 'Mute'}
        </button>

        <button onClick={() => setTab(tab === 'forward' ? 'tones' : 'forward')} title="Forward call"
          className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px]"
          style={{
            background: tab === 'forward' ? 'rgba(92,180,255,0.12)' : 'rgba(35,18,55,0.7)',
            border: `1px solid ${tab === 'forward' ? 'rgba(92,180,255,0.25)' : 'rgba(60,30,90,0.3)'}`,
            color: tab === 'forward' ? 'rgb(92,180,255)' : 'rgb(160,140,190)',
          }}>
          <PhoneForwarded size={14} />
          Forward
        </button>

        <button onClick={onHangup} disabled={loading} title="End call"
          className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px]"
          style={{
            background: 'rgba(255,107,107,0.08)',
            border: '1px solid rgba(255,107,107,0.15)',
            color: 'rgb(255,107,107)',
          }}>
          <PhoneOff size={14} />
          Hangup
        </button>
      </div>

      {/* Tab content */}
      {tab === 'tones' && (
        <div className="space-y-2 animate-fade-in">
          {/* DTMF display */}
          <div className="flex items-center justify-between rounded-lg px-3 py-1.5"
            style={{ background: 'rgba(18,9,28,0.7)', border: '1px solid rgba(50,25,75,0.5)', minHeight: '32px' }}>
            <span className="text-sm font-mono tracking-[0.3em]" style={{ color: dtmfBuffer ? 'rgb(190,124,255)' : 'rgb(65,40,95)' }}>
              {dtmfBuffer || '·  ·  ·'}
            </span>
            {dtmfBuffer && (
              <button onClick={clearDTMF} className="p-0.5 rounded transition-colors" style={{ color: 'rgb(100,75,140)' }}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* DTMF keypad — compact */}
          <div className="grid grid-cols-4 gap-[2px]">
            {DTMF_KEYS.map(({ d }) => (
              <button key={d} onClick={() => sendDTMF(d)}
                className="flex items-center justify-center rounded-md transition-all duration-75 active:scale-[0.92]"
                style={{ height: '32px', background: 'rgba(35,18,55,0.7)', border: '1px solid rgba(60,30,90,0.3)', color: 'rgb(210,205,230)', fontSize: '13px' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(55,28,85,0.8)'; e.currentTarget.style.color = 'rgb(190,124,255)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(35,18,55,0.7)'; e.currentTarget.style.color = 'rgb(210,205,230)'; }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'forward' && (
        <div className="space-y-2 animate-fade-in">
          <div className="text-[10px] uppercase tracking-wide opacity-60" style={{ color: 'var(--pc-text-medium)' }}>Forward to</div>
          <div className="flex gap-2">
            <input
              type="tel" value={forwardTo}
              onChange={e => setForwardTo(!e.target.value || e.target.value === '' ? '+' : e.target.value.startsWith('+') ? e.target.value : '+' + e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleForward(); }}
              placeholder="+1234567890"
              className="flex-1 px-2.5 py-1.5 rounded-md text-xs font-mono"
              style={inputStyle}
            />
            <button onClick={handleForward} disabled={forwardTo.length < 4}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all disabled:opacity-25"
              style={{ background: 'rgba(92,180,255,0.1)', border: '1px solid rgba(92,180,255,0.2)', color: 'rgb(92,180,255)' }}>
              <PhoneForwarded size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Status flash */}
      {status && (
        <div className="text-center text-[10px] py-1 rounded animate-fade-in" style={{ color: 'var(--pc-primary-light)', background: 'rgba(190,124,255,0.06)' }}>
          {status}
        </div>
      )}
    </div>
  );
}
