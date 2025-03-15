import * as vscode from 'vscode';
import { ConnectionCommands } from './commands/connectionCommands';
import { PublicationCommands } from './commands/publicationCommands';
import { ServerCommands } from './commands/serverCommands';
import { SubscriptionCommands } from './commands/subscriptionCommands';
import { AgentCommands } from './commands/agentCommands';
import { ReplicationExplorer } from './features/replicationExplorer';
import { registerMonitoringCommands } from './commands/monitoringCommands';

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

    // Register server commands
    const serverCommands = new ServerCommands(context);
    serverCommands.registerCommands();

    // Register publication commands
    const publicationCommands = new PublicationCommands(context);
    publicationCommands.registerCommands();

    // Register subscription commands
    const subscriptionCommands = new SubscriptionCommands(context);
    subscriptionCommands.registerCommands();

    // Register agent commands
    const agentCommands = new AgentCommands(context);
    agentCommands.registerCommands();

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('sqlrepl.refreshTree', () => {
        replicationExplorer.refresh();
    });

    // Register welcome message command
    const welcomeCommand = vscode.commands.registerCommand('sqlrepl.showWelcomeMessage', () => {
        vscode.window.showInformationMessage(
            'Welcome to SQL Server Replication Manager! 🎉\n\n' +
            'To get started, click the "+" button in the SQL Replication view to add a SQL Server connection.',
            'Add Connection'
        ).then(selection => {
            if (selection === 'Add Connection') {
                vscode.commands.executeCommand('sqlrepl.addConnection');
            }
        });
    });

    // Register monitoring commands
    registerMonitoringCommands(context);

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