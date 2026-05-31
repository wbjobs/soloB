/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'deep-blue': '#0A1628',
        'tech-blue': '#00D4FF',
        'warning-yellow': '#FFB800',
        'success-green': '#00FF88',
      },
      fontFamily: {
        'orbitron': ['Orbitron', 'monospace'],
        'jetbrains': ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s infinite',
        'fade-in': 'fadeIn 0.5s ease-in',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 5px #00D4FF, 0 0 10px #00D4FF' },
          '50%': { boxShadow: '0 0 20px #00D4FF, 0 0 30px #00D4FF' },
        },
        'fadeIn': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
