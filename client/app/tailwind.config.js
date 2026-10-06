/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'var(--mat-sys-on-surface)',
          muted: 'var(--mat-sys-on-surface-variant)',
        },
        field: {
          DEFAULT: 'var(--mat-sys-surface-container)',
          deep: 'var(--mat-sys-outline-variant)',
        },
        accent: {
          DEFAULT: 'var(--mat-sys-primary)',
          contrast: 'var(--mat-sys-primary-container)',
        },
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
