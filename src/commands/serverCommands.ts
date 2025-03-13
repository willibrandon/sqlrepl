import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ServerTreeItem } from '../features/treeItems';

export class ServerCommands {
    constructor(private context: vscode.ExtensionContext) {}

    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.removeServer', (node?: ServerTreeItem) => this.removeServer(node))
        );
    }

    private async removeServer(node?: ServerTreeItem): Promise<void> {
        try {
            if (!node) {
                vscode.window.showErrorMessage('No server selected');
                return;
            }

            const connectionService = ConnectionService.getInstance(this.context);
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to remove ${node.connection.serverName}?`,
                { modal: true },
                'Yes', 'No'
            );

            if (confirmation === 'Yes') {
                connectionService.removeConnection(node.connection.id);
                vscode.window.showInformationMessage(`Removed server ${node.connection.serverName}`);
                
                // Refresh the tree view
                await vscode.commands.executeCommand('sqlrepl.refreshTree');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to remove server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 