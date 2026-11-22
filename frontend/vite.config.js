import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The backend only allows http://localhost:5173, so never pick another port silently
  server: { port: 5173, strictPort: true },
});