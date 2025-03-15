import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';

suite('SQL Replication Extension', () => {
    test('Extension should be present', async () => {
        const ext = vscode.extensions.getExtension('sqlrepl.sqlrepl');
        assert.ok(ext);
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('sqlrepl.sqlrepl');
        await ext?.activate();
        assert.strictEqual(ext?.isActive, true);
    });

    test('Commands should be registered', async () => {
        const allCommands = await vscode.commands.getCommands();
        
        // Test for the presence of our commands
        assert.ok(allCommands.includes('sqlrepl.refreshTree'));
        assert.ok(allCommands.includes('sqlrepl.showWelcomeMessage'));
    });

    test('Welcome message should be shown', async () => {
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
            assert.strictEqual(shownMessage, 'Welcome to SQL Server Replication Manager! 🎉\n\nTo get started, click the "+" button in the SQL Replication view to add a SQL Server connection.');
        } finally {
            // Restore the original function
            vscode.window.showInformationMessage = originalShowMessage;
        }
    });
}); 