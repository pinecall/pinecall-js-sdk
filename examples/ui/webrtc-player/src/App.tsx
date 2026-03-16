/**
 * Pinecall WebRTC Player — Standalone voice agent interface.
 *
 * Single-page app: connect → speak → see transcript + waveform + events.
 * Same visual quality as the full Pinecall dashboard.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { PhoneCall, PhoneOff, Mic, MicOff, Settings2, ChevronDown, Activity, Trash2, X } from 'lucide-react';
import { useWebRTC } from './hooks/useWebRTC';
import AudioWaveform from './components/AudioWaveform';
import MessageBubble from './components/MessageBubble';
import type { DCEvent } from './types';

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function App() {
  const webrtc = useWebRTC();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<DCEvent | null>(null);

  // Config state — persisted to localStorage
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('pc_server') || 'https://voice.pinecall.io');
  const [agentId, setAgentId] = useState(() => localStorage.getItem('pc_agent') || 'minimal');
  const [tokenUrl, setTokenUrl] = useState(() => localStorage.getItem('pc_token_url') || '');

  // Persist config
  useEffect(() => {
    localStorage.setItem('pc_server', serverUrl);
    localStorage.setItem('pc_agent', agentId);
    localStorage.setItem('pc_token_url', tokenUrl);
  }, [serverUrl, agentId, tokenUrl]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [webrtc.messages]);

  const isConnected = webrtc.status === 'connected';
  const isConnecting = webrtc.status === 'connecting';
  const isIdle = webrtc.status === 'idle';

  const handleCall = useCallback(async () => {
    if (!isIdle) { webrtc.endCall(); return; }

    // Fetch token if tokenUrl is set
    let token: string | undefined;
    if (tokenUrl) {
      try {
        const res = await fetch(tokenUrl);
        const data = await res.json();
        token = data.token;
      } catch (err) {
        console.error('Token fetch failed:', err);
      }
    }

    webrtc.startCall(serverUrl, agentId, token);
  }, [isIdle, webrtc, serverUrl, agentId, tokenUrl]);

  return (
    <div className="h-screen flex flex-col" style={{ background: 'rgb(24, 12, 36)' }}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 h-14 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(60,30,90,0.5)', background: 'rgba(26, 13, 39, 0.8)' }}>
        <div className="flex items-center gap-3">
          <span className="text-lg">🌲</span>
          <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--pc-text-light)' }}>Pinecall</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(190,124,255,0.1)', color: 'var(--pc-primary-light)' }}>WebRTC</span>
        </div>

        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="flex items-center gap-2 mr-2">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(92,245,152)' }} />
              <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--pc-text-medium)' }}>{formatDuration(webrtc.duration)}</span>
            </span>
          )}
          <button onClick={() => setShowEvents(!showEvents)}
            className="p-2 rounded-lg transition-all"
            style={{
              background: showEvents ? 'rgba(190,124,255,0.15)' : 'rgba(40,20,60,0.5)',
              color: showEvents ? 'var(--pc-primary-light)' : 'var(--pc-text-medium)',
            }}>
            <Activity size={15} />
          </button>
          <button onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-lg transition-all"
            style={{
              background: showConfig ? 'rgba(190,124,255,0.15)' : 'rgba(40,20,60,0.5)',
              color: showConfig ? 'var(--pc-primary-light)' : 'var(--pc-text-medium)',
            }}>
            <Settings2 size={15} />
          </button>
        </div>
      </header>

      {/* ── Config Panel (collapsible) ────────────────────────────────── */}
      {showConfig && (
        <div className="px-6 py-4 space-y-3 animate-fade-in flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(60,30,90,0.4)', background: 'rgba(30, 15, 45, 0.9)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--pc-text-medium)' }}>Connection Settings</span>
            <button onClick={() => setShowConfig(false)} className="p-1 rounded" style={{ color: 'var(--pc-text-medium)' }}>
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--pc-text-medium)', opacity: 0.7 }}>Server URL</span>
              <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} disabled={!isIdle}
                className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-all"
                style={{ background: 'rgba(20,10,32,0.8)', border: '1px solid rgba(60,30,90,0.4)', color: 'var(--pc-text-light)' }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--pc-text-medium)', opacity: 0.7 }}>Agent ID</span>
              <input value={agentId} onChange={e => setAgentId(e.target.value)} disabled={!isIdle}
                className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-all"
                style={{ background: 'rgba(20,10,32,0.8)', border: '1px solid rgba(60,30,90,0.4)', color: 'var(--pc-text-light)' }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--pc-text-medium)', opacity: 0.7 }}>Token URL <span style={{ opacity: 0.4 }}>(optional)</span></span>
              <input value={tokenUrl} onChange={e => setTokenUrl(e.target.value)} disabled={!isIdle}
                placeholder="e.g. /api/webrtc-token"
                className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-all"
                style={{ background: 'rgba(20,10,32,0.8)', border: '1px solid rgba(60,30,90,0.4)', color: 'var(--pc-text-light)' }}
              />
            </label>
          </div>
        </div>
      )}

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Conversation column */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Audio Waveform — visible during call */}
          {isConnected && (
            <div className="px-6 py-3 flex-shrink-0">
              <AudioWaveform userMetricsRef={webrtc.userMetrics} botMetricsRef={webrtc.botMetrics} isActive={isConnected} />
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-auto px-6 py-4 space-y-3 scrollbar-thin">
            {webrtc.messages.length > 0 ? (
              <>
                {webrtc.messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                <div ref={messagesEndRef} />
              </>
            ) : (
              /* Idle state — centered call prompt */
              <div className="flex flex-col items-center justify-center h-full gap-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center animate-float"
                    style={{ background: 'linear-gradient(135deg, rgba(85,40,125,0.4), rgba(190,124,255,0.15))' }}>
                    <span className="text-3xl">🌲</span>
                  </div>
                  {isConnecting && (
                    <div className="absolute inset-0 rounded-full border-2 border-transparent"
                      style={{ borderTopColor: 'rgb(190,124,255)', animation: 'spin 1s linear infinite' }} />
                  )}
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--pc-text-light)' }}>
                    {isConnecting ? 'Connecting...' : 'Ready to Talk'}
                  </h2>
                  <p className="text-xs max-w-xs" style={{ color: 'var(--pc-text-medium)', opacity: 0.5 }}>
                    {isConnecting
                      ? `Connecting to ${agentId}...`
                      : `Press the call button to start a conversation with ${agentId}`}
                  </p>
                </div>

                {webrtc.error && (
                  <div className="px-4 py-2 rounded-lg text-xs" style={{ background: 'rgba(255,107,178,0.1)', border: '1px solid rgba(255,107,178,0.2)', color: 'rgb(255,107,178)' }}>
                    {webrtc.error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Bottom Controls ────────────────────────────────────────── */}
          <div className="flex-shrink-0 px-6 py-4" style={{ borderTop: '1px solid rgba(60,30,90,0.4)', background: 'rgba(22,11,35,0.95)' }}>
            <div className="flex items-center justify-center gap-3">
              {isConnected && (
                <button onClick={webrtc.toggleMute}
                  className="w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer hover:brightness-125 active:scale-95"
                  style={{
                    background: webrtc.isMuted ? 'rgba(255,107,178,0.15)' : 'rgba(40,20,60,0.7)',
                    border: `1px solid ${webrtc.isMuted ? 'rgba(255,107,178,0.3)' : 'rgba(60,30,90,0.5)'}`,
                    color: webrtc.isMuted ? 'rgb(255,107,178)' : 'var(--pc-text-medium)',
                  }}>
                  {webrtc.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}

              <button onClick={handleCall} disabled={isConnecting}
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: isConnected
                    ? 'linear-gradient(135deg, rgb(255,80,80), rgb(200,40,40))'
                    : isConnecting
                      ? 'linear-gradient(135deg, rgb(200,150,50), rgb(180,130,30))'
                      : 'linear-gradient(135deg, rgb(60,200,120), rgb(40,160,90))',
                  boxShadow: isConnected
                    ? '0 4px 20px rgba(255,80,80,0.3)'
                    : isConnecting
                      ? '0 4px 20px rgba(200,150,50,0.3)'
                      : '0 4px 20px rgba(60,200,120,0.3)',
                }}>
                {isConnected ? <PhoneOff size={22} color="white" /> : <PhoneCall size={22} color="white" />}
              </button>

              {isConnected && (
                <div className="w-12 h-12" /> /* spacer for symmetry */
              )}
            </div>

            {/* Status text */}
            <p className="text-center text-[10px] mt-2" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
              {isConnected ? (webrtc.isMuted ? 'Muted' : 'Listening...') : isConnecting ? 'Establishing connection...' : `Agent: ${agentId}`}
            </p>
          </div>
        </div>

        {/* ── Event Log Panel (right sidebar) ─────────────────────────── */}
        {showEvents && (
          <aside className="w-80 flex flex-col border-l overflow-hidden animate-fade-in"
            style={{ background: 'rgb(26,13,39)', borderColor: 'rgba(60,30,90,0.5)' }}>
            <div className="px-4 py-3 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid rgba(60,30,90,0.4)' }}>
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--pc-text-medium)' }}>
                Events <span style={{ opacity: 0.4 }}>({webrtc.events.length})</span>
              </span>
              <button onClick={webrtc.clearEvents} className="p-1 rounded" style={{ color: 'var(--pc-text-medium)', opacity: 0.5 }}>
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex-1 overflow-auto scrollbar-thin">
              {webrtc.events.length === 0 ? (
                <div className="flex items-center justify-center h-full" style={{ color: 'var(--pc-text-medium)', opacity: 0.3 }}>
                  <span className="text-xs">No events yet</span>
                </div>
              ) : (
                webrtc.events.map((evt, i) => (
                  <button key={i} onClick={() => setSelectedEvent(selectedEvent === evt ? null : evt)}
                    className="w-full text-left px-4 py-2 transition-all cursor-pointer"
                    style={{
                      borderBottom: '1px solid rgba(40,20,60,0.3)',
                      background: selectedEvent === evt ? 'rgba(85,40,125,0.2)' : 'transparent',
                    }}>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                        background: evt.event.startsWith('user') ? 'rgb(92,245,152)'
                          : evt.event.startsWith('bot') ? 'rgb(190,124,255)'
                          : evt.event.startsWith('session') ? 'rgb(130,210,255)'
                          : 'rgb(100,75,140)',
                      }} />
                      <span className="text-[11px] font-mono truncate" style={{ color: 'var(--pc-text-light)' }}>{evt.event}</span>
                    </div>
                    {selectedEvent === evt && (
                      <pre className="mt-2 text-[10px] p-2 rounded-md overflow-auto" style={{
                        background: 'rgba(18,9,28,0.6)',
                        color: 'var(--pc-text-medium)',
                        maxHeight: '150px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}>
                        {JSON.stringify(evt, null, 2)}
                      </pre>
                    )}
                  </button>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Selected Event Modal ──────────────────────────────────────── */}
      {selectedEvent && !showEvents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSelectedEvent(null)}>
          <div className="rounded-xl p-5 max-w-lg w-full mx-4" style={{ background: 'rgb(30,15,45)', border: '1px solid rgba(60,30,90,0.6)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-mono font-medium" style={{ color: 'var(--pc-primary-light)' }}>{selectedEvent.event}</span>
              <button onClick={() => setSelectedEvent(null)} className="p-1" style={{ color: 'var(--pc-text-medium)' }}><X size={16} /></button>
            </div>
            <pre className="text-xs p-3 rounded-lg overflow-auto max-h-64" style={{ background: 'rgba(18,9,28,0.6)', color: 'var(--pc-text-medium)', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(selectedEvent, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
