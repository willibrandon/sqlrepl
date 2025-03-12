import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Log activation
    console.log('SQL Server Replication Extension is now active');

    // Register commands and views here later
    const disposable = vscode.commands.registerCommand('sqlrepl.showWelcomeMessage', () => {
        vscode.window.showInformationMessage('Welcome to SQL Server Replication Manager!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // Cleanup code here
    console.log('SQL Server Replication Extension is now deactivated');
} 