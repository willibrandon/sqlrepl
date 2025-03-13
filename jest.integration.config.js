/** @type {import('jest').Config} */
module.exports = {
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: './tsconfig.json'
        }]
    },
    testEnvironment: 'node',
    testMatch: [
        '**/src/__tests__/integration/**/*.test.ts'
    ],
    collectCoverage: true,
    coverageDirectory: 'coverage-integration',
    coverageReporters: ['text', 'lcov'],
    reporters: ['default'],
    testTimeout: 30000, // 30 seconds for integration tests
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.ts']
}; 