// Where the backend lives. Set VITE_BACKEND_URL in frontend/.env to change it.
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');