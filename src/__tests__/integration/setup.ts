// Integration test setup
if (!process.env.TEST_CONNECTION_STRING) {
    throw new Error('TEST_CONNECTION_STRING environment variable is required for integration tests');
}

// Add global test setup here
beforeAll(async () => {
    // Any global setup before all tests
    console.log('Setting up integration test environment...');
});

afterAll(async () => {
    // Any global cleanup after all tests
    console.log('Cleaning up integration test environment...');
}); 