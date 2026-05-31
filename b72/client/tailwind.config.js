/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1e3a5f',
        secondary: '#d4af37',
        accent: '#e8d5a3',
        light: '#f8f5f0',
        dark: '#0f1d2e'
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['"Source Sans Pro"', 'sans-serif']
      }
    },
  },
  plugins: [],
}
