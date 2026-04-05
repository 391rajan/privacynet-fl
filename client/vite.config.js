import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env vars so we can reference them
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = env.VITE_SERVER_URL || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxy all /api and /socket.io requests to the backend
      proxy: {
        '/api': {
          target: serverUrl,
          changeOrigin: true,
          secure: false
        },
        '/socket.io': {
          target: serverUrl,
          ws: true,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    },
    // Expose VITE_ prefixed env variables to client code
    envPrefix: 'VITE_'
  };
});
