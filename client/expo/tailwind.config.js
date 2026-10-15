const plugin = require('tailwindcss/plugin');

/** React Native uses a separate font file per weight, so weight classes select that file. */
const plusJakarta = plugin(({ addUtilities }) => {
  addUtilities({
    '.font-sans': { fontFamily: 'PlusJakartaSans_400Regular' },
    '.font-normal': { fontFamily: 'PlusJakartaSans_400Regular', fontWeight: '400' },
    '.font-medium': { fontFamily: 'PlusJakartaSans_500Medium', fontWeight: '400' },
    '.font-semibold': { fontFamily: 'PlusJakartaSans_600SemiBold', fontWeight: '400' },
    '.font-bold': { fontFamily: 'PlusJakartaSans_700Bold', fontWeight: '400' },
  });
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['PlusJakartaSans_400Regular'],
      },
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
  plugins: [plusJakarta],
};
