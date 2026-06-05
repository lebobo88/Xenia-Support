import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/ui/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['tests/ui/setup.ts'],
    globals: true,
  },
});
