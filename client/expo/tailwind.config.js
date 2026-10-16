/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        canvas: '#eef2ef',
        raised: '#f7f9f8',
        paper: '#ffffff',
        inset: '#e4ebe6',
        line: '#c5d0c9',
        ink: '#101412',
        muted: '#5c675f',
        field: '#0a6e38',
        'field-deep': '#064e28',
        danger: '#c42318',
        safety: '#1a8f46',
        caution: '#b58105',
        link: '#3d8bfd',
        fill: '#176d3e',
        'fill-danger': '#b32e23',
      },
    },
  },
};
