import * as assert from 'assert';
import * as vscode from 'vscode';

describe('SQL Replication Extension', () => {
    beforeEach(async () => {
        // Reset any extension state before each test
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    afterEach(async () => {
        // Clean up after each test
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    it('should activate successfully', async () => {
        const ext = vscode.extensions.getExtension('sqlrepl.sqlrepl');
        assert.ok(ext);
        await ext?.activate();
        assert.strictEqual(ext?.isActive, true);
    });

    it('should register all commands', async () => {
        const allCommands = await vscode.commands.getCommands();
        
        // Test for the presence of our commands
        assert.ok(allCommands.includes('sqlrepl.refreshTree'));
        assert.ok(allCommands.includes('sqlrepl.showWelcomeMessage'));
        // Add more command checks as needed
    });

    it('should show welcome message', async () => {
        let shownMessage: string | null = null;
        const originalShowMessage = vscode.window.showInformationMessage;
        
        // Mock the showInformationMessage function
        vscode.window.showInformationMessage = async (message: string): Promise<string | undefined> => {
            shownMessage = message;
            return undefined;
        };

        try {
            // Trigger the welcome message command
            await vscode.commands.executeCommand('sqlrepl.showWelcomeMessage');

            // Verify the message was shown
            assert.strictEqual(shownMessage, 'Welcome to SQL Server Replication Manager!');
        } finally {
            // Restore the original function
            vscode.window.showInformationMessage = originalShowMessage;
        }
    });

    // Add more test cases for other extension functionality
}); 