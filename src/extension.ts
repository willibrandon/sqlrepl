import * as vscode from 'vscode';
import { ConnectionCommands } from './commands/connectionCommands';
import { ReplicationExplorer } from './features/replicationExplorer';

export function activate(context: vscode.ExtensionContext) {
    // Log activation
    console.log('SQL Server Replication Extension is now active');

    // Create and register the tree data provider
    const replicationExplorer = new ReplicationExplorer(context);
    const treeView = vscode.window.createTreeView('replicationTree', {
        treeDataProvider: replicationExplorer,
        showCollapseAll: true
    });

    // Register connection commands
    const connectionCommands = new ConnectionCommands(context);
    connectionCommands.registerCommands();

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('sqlrepl.refreshTree', () => {
        replicationExplorer.refresh();
    });

    // Register welcome message command
    const welcomeCommand = vscode.commands.registerCommand('sqlrepl.showWelcomeMessage', () => {
        vscode.window.showInformationMessage('Welcome to SQL Server Replication Manager!');
    });

    // Add to subscriptions
    context.subscriptions.push(
        treeView,
        refreshCommand,
        welcomeCommand
    );
}

export function deactivate() {
    // Cleanup code here
    console.log('SQL Server Replication Extension is now deactivated');
} 