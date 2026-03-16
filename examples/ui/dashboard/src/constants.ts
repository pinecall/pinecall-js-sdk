/** Constants — ported from dev-ui */

// ── Status / Direction colors ─────────────────────────────────────────────
export const STATUS_COLORS: Record<string, string> = {
  connected: 'rgb(92, 245, 152)',
  offline: 'rgb(255, 107, 178)',
  listening: 'rgb(92, 245, 152)',
  speaking: 'rgb(190, 124, 255)',
  pause: 'rgb(255, 196, 60)',
  idle: 'rgb(130, 100, 170)',
  ended: 'rgb(130, 100, 170)',
};

export const DIRECTION_COLORS: Record<string, string> = {
  in: 'rgb(92, 245, 152)',
  out: 'rgb(190, 124, 255)',
  system: 'rgb(100, 75, 140)',
};

// ── LLM Models ────────────────────────────────────────────────────────────
export const LLM_MODELS = [
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano (fastest)' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
];

// ── DTMF keypad ───────────────────────────────────────────────────────────
export const DTMF_KEYS = [
  { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
  { d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' },
];
