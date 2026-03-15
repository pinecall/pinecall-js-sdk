/**
 * Server URL config.
 * When served embedded by EventServer (port 4100, same origin), uses window.location.
 * In dev mode (Vite at 5173 or other port), always connects to localhost:4100.
 */
const loc = typeof window !== 'undefined' ? window.location : null;
const devServer = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_SERVER_URL : null;

// Detect if we're on the EventServer itself (port 4100) or a dev server (any other port)
const isEmbedded = loc?.port === '4100';

export const SERVER = devServer || (isEmbedded ? loc!.host : 'localhost:4100');
export const API_BASE = devServer ? `http://${devServer}` : isEmbedded ? `${loc!.protocol}//${loc!.host}` : 'http://localhost:4100';
export const WS_URL = devServer ? `ws://${devServer}` : isEmbedded ? `${loc!.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc!.host}` : 'ws://localhost:4100';
