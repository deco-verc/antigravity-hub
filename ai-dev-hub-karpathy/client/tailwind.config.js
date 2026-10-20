/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        hub: {
          950: '#090a0f',
          900: '#0d0f17',
          850: '#121520',
          800: '#181b28',
          750: '#1e2233',
          700: '#262b40',
          600: '#383e5a',
          500: '#525a7f',
          400: '#7e87aa',
          300: '#a5adc6',
          200: '#cbd1e1',
          100: '#e5e8f2',
          accent: '#6366f1',
          'accent-hover': '#4f46e5',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
          cyan: '#06b6d4'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
