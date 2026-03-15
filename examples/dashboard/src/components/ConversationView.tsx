/** ConversationView — Messages area + agent reply input. Ported from dev-ui. */
import { useRef, useEffect, useState } from 'react';
import { Trash2, Phone as PhoneIcon, Send, Bot } from 'lucide-react';
import MessageBubble from './MessageBubble';
import type { Message } from '../types';

interface Props {
  messages: Message[];
  onClear: () => void;
  isInCall: boolean;
  send: (msg: any) => void;
  sessionId: string | null;
}

export default function ConversationView({ messages, onClear, isInCall, send, sessionId }: Props) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = replyText.trim();
    if (!text) return;
    send({ event: 'client.reply', text, call_id: sessionId || undefined });
    setReplyText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      {messages.length > 0 && (
        <div className="px-6 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Conversation</span>
          <button onClick={onClear} className="p-1 rounded transition-colors" style={{ color: 'var(--pc-text-medium)', opacity: 0.5 }}>
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* Content */}
      {isInCall || messages.length > 0 ? (
        <div ref={messagesRef} className="flex-1 overflow-auto p-6 space-y-4 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
              <p className="text-sm">Waiting for conversation...</p>
            </div>
          ) : (
            messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(85, 40, 125, 0.2)' }}>
            <PhoneIcon size={20} style={{ color: 'var(--pc-primary-light)' }} />
          </div>
          <h2 className="text-base font-medium" style={{ color: 'var(--pc-text-medium)' }}>Agent Ready</h2>
          <p className="text-xs max-w-xs text-center" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
            Call your registered phone number to start a conversation.
          </p>
        </div>
      )}

      {/* Agent reply input */}
      {isInCall && (
        <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(60,30,90,0.5)', background: 'rgba(22,11,35,0.95)' }}>
          <div className="flex items-end gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(40,20,65,0.7)', border: '1px solid rgba(80,40,120,0.4)' }}>
            <Bot size={16} className="flex-shrink-0 mb-1.5" style={{ color: 'rgb(190, 124, 255)', opacity: 0.6 }} />
            <textarea
              ref={inputRef}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply as agent (TTS)..."
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none text-sm leading-relaxed"
              style={{ color: 'var(--pc-text-light)', maxHeight: '120px' }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={handleSend}
              disabled={!replyText.trim()}
              className="flex-shrink-0 p-1.5 rounded-lg transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style={{ background: replyText.trim() ? 'rgba(190,124,255,0.2)' : 'transparent', color: 'rgb(190, 124, 255)' }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
