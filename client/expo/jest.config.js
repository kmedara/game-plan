/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.env.js'],
  modulePaths: [
    '<rootDir>/node_modules',
    '<rootDir>/../../node_modules',
    '<rootDir>/../../node_modules/expo/node_modules',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
