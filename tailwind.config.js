/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
    './src/renderer/index.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'claude-bg': '#1a1a1a',
        'claude-surface': '#242424',
        'claude-border': '#333333',
        'claude-text': '#e4e4e4',
        'claude-text-secondary': '#a0a0a0',
        'claude-accent': '#d97706',
        'claude-accent-hover': '#f59e0b',
        'claude-success': '#22c55e',
        'claude-error': '#ef4444',
        'claude-warning': '#f59e0b',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

