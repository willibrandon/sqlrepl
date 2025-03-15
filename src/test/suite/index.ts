import * as path from 'path';
import Mocha = require('mocha');
import { glob } from 'glob';

/**
 * Runs the extension's test suite.
 * Sets up and executes Mocha tests with BDD interface and color output.
 * 
 * @throws {Error} When any test fails, with the count of failed tests
 * @returns Promise that resolves when all tests pass
 */
export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 60000  // 60 second timeout
    });

    const testsRoot = path.resolve(__dirname, '.');

    // Get all test files
    const files = await glob('**/**.test.js', { cwd: testsRoot });

    // Add files to the test suite
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        // Run the mocha test
        return new Promise<void>((resolve, reject) => {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
} 