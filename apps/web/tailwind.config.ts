import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        span: {
          llm: '#3b82f6',        // blue-500
          tool: '#22c55e',       // green-500
          agent: '#a855f7',      // purple-500
          retrieval: '#f97316',  // orange-500
          custom: '#6b7280',     // gray-500
        },
      },
    },
  },
  plugins: [],
}

export default config
