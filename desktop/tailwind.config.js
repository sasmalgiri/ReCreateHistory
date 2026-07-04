/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // "Atlas" ink palette — a calm, archival knowledge-OS look.
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b0b8c9',
          400: '#8591aa',
          500: '#66738f',
          600: '#515c76',
          700: '#434b60',
          800: '#3a4051',
          900: '#0f1219',
          950: '#080a0f'
        },
        accent: {
          DEFAULT: '#c98a3a',
          soft: '#e0b980'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
