import { useState } from 'react';
import type { AgentConfig } from '../types';

interface Props {
  onClose: () => void;
  onCreate: (config: AgentConfig) => Promise<any>;
}

export function CreateAgent({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('gpt-4.1-nano');
  const [voice, setVoice] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [instructions, setInstructions] = useState('');
  const [greeting, setGreeting] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }

    setSaving(true);
    setError('');

    const config: AgentConfig = { name: name.trim() };
    if (model) config.model = model;
    if (voice) config.voice = voice;
    if (phone) config.phone = phone;
    if (language) config.language = language;
    if (instructions) config.instructions = instructions;
    if (greeting) config.greeting = greeting;

    try {
      const result = await onCreate(config);
      if (result.error) {
        setError(result.error);
        setSaving(false);
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Create Agent</h2>
          <button onClick={onClose} className="text-muted hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Name *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="my-agent" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="gpt-4.1-nano">gpt-4.1-nano</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Voice</label>
              <input value={voice} onChange={e => setVoice(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="elevenlabs:voice_id" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="+13186330963" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Language</label>
              <input value={language} onChange={e => setLanguage(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="en" />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Instructions</label>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent resize-none"
              placeholder="You are a helpful voice assistant..." />
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Greeting</label>
            <input value={greeting} onChange={e => setGreeting(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
              placeholder="Hello! How can I help?" />
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg bg-surface-hover text-muted text-sm hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-50">
              {saving ? 'Deploying...' : 'Deploy Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
