import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Mahant brand — deep navy + champagne gold (premium diamond feel)
        brand: {
          50:  '#f5f7fb',
          100: '#e7ecf5',
          200: '#c5d0e6',
          500: '#3a5079',
          700: '#1f2f4d',
          900: '#0d1628',
        },
        gold: {
          400: '#d4b066',
          500: '#c19a4b',
          600: '#a07f37',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
