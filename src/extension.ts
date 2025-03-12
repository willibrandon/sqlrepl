import * as vscode from 'vscode';
import { ConnectionCommands } from './commands/connectionCommands';

export function activate(context: vscode.ExtensionContext) {
    // Log activation
    console.log('SQL Server Replication Extension is now active');

    // Register connection commands
    const connectionCommands = new ConnectionCommands(context);
    connectionCommands.registerCommands();

    // Register welcome message command
    const welcomeCommand = vscode.commands.registerCommand('sqlrepl.showWelcomeMessage', () => {
        vscode.window.showInformationMessage('Welcome to SQL Server Replication Manager!');
    });

    context.subscriptions.push(welcomeCommand);
}

export function deactivate() {
    // Cleanup code here
    console.log('SQL Server Replication Extension is now deactivated');
} 