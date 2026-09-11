import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 局域网访问：dev/preview 监听所有接口（手机访问 http://<PC局域网IP>:5173）。
  server: { host: true },
  preview: { host: true },
});
