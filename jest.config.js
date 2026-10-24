module.exports = {
  testEnvironment: 'node',
  transform: {},
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.js'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: [
    'src/main/**/*.js',
    '!src/main/main.js',
    '!src/main/preload.js',
  ],
};
