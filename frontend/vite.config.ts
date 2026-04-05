import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // En producción (desktop): el build se copia directo a ../public/
  // FastAPI lo sirve como archivos estáticos en la misma instancia.
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    // Desarrollo: Vite corre en 5173 y redirige /api al backend
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      }
    }
  }
})
