/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  modulePaths: [
    '<rootDir>/node_modules',
    '<rootDir>/../../node_modules',
    '<rootDir>/../../node_modules/expo/node_modules',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
