/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0f172a',
          muted: '#475569',
        },
        field: {
          DEFAULT: '#f1f5f9',
          deep: '#e2e8f0',
        },
        accent: {
          DEFAULT: '#0d9488',
          contrast: '#ccfbf1',
        },
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
