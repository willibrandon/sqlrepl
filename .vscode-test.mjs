import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'src/__tests__/extension/**/*.test.ts',
    workspaceFolder: 'test-workspace',
    mocha: {
        ui: 'bdd',
        timeout: 20000,
        color: true
    },
    coverage: {
        enabled: true,
        include: ['src/**/*.ts'],
        exclude: ['src/__tests__/**']
    }
}); 