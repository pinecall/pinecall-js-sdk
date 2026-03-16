/** MessageBubble — Chat message component. Same design as Pinecall dashboard. */
import { User, Bot, Volume2, XCircle } from 'lucide-react';
import type { Message } from '../types';

export default function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';

  if (msg.role === 'system') {
    return (
      <div className="flex justify-center animate-fade-in">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium"
          style={{ background: 'rgba(190, 124, 255, 0.08)', border: '1px solid rgba(190, 124, 255, 0.15)', color: 'rgb(190, 124, 255)' }}>
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      <div className={`max-w-[75%] rounded-xl px-4 py-3 ${msg.isInterim ? 'opacity-50' : ''}`}
        style={{
          background: isUser ? 'rgba(85, 40, 125, 0.5)' : 'rgb(40, 20, 60)',
          border: isUser
            ? (msg.isInterim ? '1px dashed rgba(190, 124, 255, 0.3)' : '1px solid rgba(190, 124, 255, 0.2)')
            : '1px solid rgba(90, 45, 135, 0.3)',
        }}>
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {isUser ? <User size={12} style={{ color: 'rgb(190, 124, 255)' }} /> : <Bot size={12} style={{ color: 'rgb(92, 245, 152)' }} />}
          <span className="text-[11px] font-medium uppercase" style={{ color: isUser ? 'rgb(190, 124, 255)' : 'rgb(92, 245, 152)' }}>
            {isUser ? 'You' : 'Assistant'}
          </span>
          {msg.isInterim && <span className="text-[11px] italic" style={{ color: 'var(--pc-text-medium)', opacity: 0.6 }}>typing...</span>}
          {msg.speaking && (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgb(230, 130, 255)' }}>
              <Volume2 size={10} /> Speaking
            </span>
          )}
          {msg.interrupted && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(255, 107, 178, 0.12)', color: 'rgb(255, 107, 178)' }}>
              <XCircle size={9} /> Interrupted
            </span>
          )}
        </div>
        <div className="text-sm leading-relaxed" style={{ color: 'var(--pc-text-light)' }}>{msg.text || '...'}</div>
      </div>
    </div>
  );
}
