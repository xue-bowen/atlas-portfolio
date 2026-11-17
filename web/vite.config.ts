import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { yahooChartProxy } from './server/yahooChartProxy.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), yahooChartProxy()],
})
