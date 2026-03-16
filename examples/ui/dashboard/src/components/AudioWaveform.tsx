/** AudioWaveform — Canvas-based waveform. Ported from dev-ui. */
import { useRef, useEffect, useCallback, useState } from 'react';
import type { AudioMetrics } from '../types';

const HISTORY_LENGTH = 80;
const BAR_WIDTH = 2;
const BAR_GAP = 1.5;
const SAMPLE_INTERVAL = 70;

interface HistoryPoint { rms: number; source: string | null; }

function draw(canvas: HTMLCanvasElement | null, history: HistoryPoint[]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const mid = h / 2;
  const maxH = h * 0.4;
  const totalBars = Math.min(HISTORY_LENGTH, Math.floor(w / (BAR_WIDTH + BAR_GAP)));
  const totalW = totalBars * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const startX = (w - totalW) / 2;

  for (let i = 0; i < totalBars; i++) {
    const idx = HISTORY_LENGTH - totalBars + i;
    if (idx < 0) continue;
    const pt = history[idx] || { rms: 0, source: null };
    const intensity = Math.min(1, pt.rms * 4.5);
    const barH = Math.max(1, intensity * maxH);
    const x = startX + i * (BAR_WIDTH + BAR_GAP);

    if (pt.source && pt.rms > 0.005) {
      const isUser = pt.source === 'user';
      const color = isUser ? 'rgb(92, 245, 152)' : 'rgb(190, 124, 255)';
      const dimColor = isUser ? 'rgba(92, 245, 152, 0.2)' : 'rgba(190, 124, 255, 0.2)';
      const grad = ctx.createLinearGradient(x, mid - barH, x, mid + barH);
      grad.addColorStop(0, dimColor);
      grad.addColorStop(0.4, color);
      grad.addColorStop(0.6, color);
      grad.addColorStop(1, dimColor);
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.35 + intensity * 0.65;
    } else {
      ctx.fillStyle = 'rgba(60, 30, 90, 0.2)';
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.roundRect(x, mid - barH, BAR_WIDTH, barH * 2, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

interface Props {
  userMetricsRef: React.MutableRefObject<AudioMetrics | null>;
  botMetricsRef: React.MutableRefObject<AudioMetrics | null>;
  isInCall: boolean;
}

export default function AudioWaveform({ userMetricsRef, botMetricsRef, isInCall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<HistoryPoint[]>(new Array(HISTORY_LENGTH).fill({ rms: 0, source: null }));
  const animRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  const animate = useCallback((ts: number) => {
    if (ts - lastSampleRef.current >= SAMPLE_INTERVAL) {
      lastSampleRef.current = ts;
      const u = userMetricsRef.current;
      const b = botMetricsRef.current;
      const uRms = u ? u.rms : 0;
      const bRms = b ? b.rms : 0;
      const uSpeech = u?.is_speech ?? false;
      const bSpeech = b?.is_speech ?? false;

      let source: string | null = null;
      let rms = 0;
      if (uSpeech && uRms > 0.005) { source = 'user'; rms = uRms; }
      else if (bSpeech && bRms > 0.005) { source = 'bot'; rms = bRms; }
      else { rms = Math.max(uRms, bRms) * 0.3; source = uRms > bRms ? 'user' : bRms > 0.001 ? 'bot' : null; }

      history.current.push({ rms, source });
      if (history.current.length > HISTORY_LENGTH) history.current.shift();

      const src = uSpeech ? 'user' : bSpeech ? 'bot' : null;
      setActiveSrc(prev => prev !== src ? src : prev);
    }
    draw(canvasRef.current, history.current);
    animRef.current = requestAnimationFrame(animate);
  }, [userMetricsRef, botMetricsRef]);

  useEffect(() => {
    if (isInCall) {
      animRef.current = requestAnimationFrame(animate);
    } else {
      history.current = new Array(HISTORY_LENGTH).fill({ rms: 0, source: null });
      setActiveSrc(null);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isInCall, animate]);

  const labelColor = activeSrc === 'user' ? 'rgb(92, 245, 152)' : activeSrc === 'bot' ? 'rgb(190, 124, 255)' : 'rgb(80, 55, 115)';
  const labelText = activeSrc === 'user' ? 'User' : activeSrc === 'bot' ? 'Agent' : 'Idle';

  return (
    <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Audio</span>
        <span className="text-[10px] tracking-wide transition-colors duration-300" style={{ color: labelColor }}>{labelText}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-md"
        style={{ height: isInCall ? '32px' : '18px', transition: 'height 0.3s ease', background: 'rgba(18, 9, 28, 0.4)' }}
      />
    </div>
  );
}
