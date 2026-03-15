/**
 * Server URL config.
 * Uses VITE_SERVER_URL env var, defaults to localhost:4100.
 */
export const SERVER = import.meta.env.VITE_SERVER_URL || 'localhost:4100';
export const API_BASE = `http://${SERVER}`;
export const WS_URL = `ws://${SERVER}`;
