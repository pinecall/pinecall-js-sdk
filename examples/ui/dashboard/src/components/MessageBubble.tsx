/** MessageBubble — Conversation message. Ported from dev-ui. */
import { User, Bot, Pause, CheckCircle, XCircle, Volume2, Wrench, Check } from 'lucide-react';
import type { Message } from '../types';

export default function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';

  // Tool call messages — purple accent with wrench icon
  if (msg.type === 'tool_call') {
    return (
      <div className="flex justify-center">
        <div
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono max-w-[85%]"
          style={{
            background: 'rgba(167, 139, 250, 0.06)',
            border: '1px solid rgba(167, 139, 250, 0.2)',
          }}
        >
          <Wrench size={12} style={{ color: 'rgb(167, 139, 250)', flexShrink: 0 }} />
          <span style={{ color: 'rgb(167, 139, 250)' }}>{msg.toolName}</span>
          <span style={{ color: 'rgba(156, 163, 175, 0.7)', fontSize: '11px', wordBreak: 'break-all' }}>
            ({msg.toolArgs})
          </span>
        </div>
      </div>
    );
  }

  // Tool result messages — green accent with check icon
  if (msg.type === 'tool_result') {
    return (
      <div className="flex justify-center">
        <div
          className="inline-flex items-start gap-2 px-4 py-2.5 rounded-xl text-xs font-mono max-w-[85%]"
          style={{
            background: 'rgba(74, 222, 128, 0.06)',
            border: '1px solid rgba(74, 222, 128, 0.2)',
          }}
        >
          <Check size={12} style={{ color: 'rgb(74, 222, 128)', flexShrink: 0, marginTop: '2px' }} />
          <span style={{ color: 'rgba(156, 163, 175, 0.8)', fontSize: '11px', wordBreak: 'break-all' }}>
            {msg.toolResult}
          </span>
        </div>
      </div>
    );
  }

  // System messages — centered pill banners
  if (msg.role === 'system') {
    const isError = msg.type === 'call_error';
    return (
      <div className="flex justify-center">
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium"
          style={{
            background: isError ? 'rgba(255, 107, 107, 0.1)' : 'rgba(190, 124, 255, 0.08)',
            border: isError ? '1px solid rgba(255, 107, 107, 0.2)' : '1px solid rgba(190, 124, 255, 0.15)',
            color: isError ? 'rgb(255, 107, 107)' : 'rgb(190, 124, 255)',
          }}
        >
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-xl px-4 py-3 ${msg.isInterim ? 'opacity-50' : ''}`}
        style={{
          background: isUser ? 'rgba(85, 40, 125, 0.5)' : 'rgb(40, 20, 60)',
          border: isUser
            ? (msg.isInterim ? '1px dashed rgba(190, 124, 255, 0.3)' : '1px solid rgba(190, 124, 255, 0.2)')
            : '1px solid rgba(90, 45, 135, 0.3)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {isUser ? (
            <User size={12} style={{ color: 'rgb(190, 124, 255)' }} />
          ) : (
            <Bot size={12} style={{ color: 'rgb(92, 245, 152)' }} />
          )}
          <span className="text-[11px] font-medium uppercase" style={{ color: isUser ? 'rgb(190, 124, 255)' : 'rgb(92, 245, 152)' }}>
            {isUser ? 'You' : 'Assistant'}
          </span>

          {msg.isInterim && (
            <span className="text-[11px] italic" style={{ color: 'var(--pc-text-medium)', opacity: 0.6 }}>typing...</span>
          )}

          {msg.status === 'pause' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(255, 196, 60, 0.12)', color: 'rgb(255, 196, 60)' }}>
              <Pause size={9} />
              PAUSE {msg.probability !== undefined && `${Math.round(msg.probability * 100)}%`}
            </span>
          )}

          {msg.status === 'end' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(92, 245, 152, 0.12)', color: 'rgb(92, 245, 152)' }}>
              <CheckCircle size={9} />
              END {msg.probability !== undefined && `${Math.round(msg.probability * 100)}%`}
            </span>
          )}

          {msg.speaking && (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgb(230, 130, 255)' }}>
              <Volume2 size={10} />
              Speaking
            </span>
          )}

          {msg.interrupted && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(255, 107, 178, 0.12)', color: 'rgb(255, 107, 178)' }}>
              <XCircle size={9} />
              Interrupted
            </span>
          )}
        </div>

        {/* Text */}
        <div className="text-sm leading-relaxed" style={{ color: 'var(--pc-text-light)' }}>
          {msg.text || '...'}
        </div>
      </div>
    </div>
  );
}
