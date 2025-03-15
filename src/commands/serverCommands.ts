import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ServerTreeItem } from '../features/treeItems';
import { DistributorService } from '../services/distributorService';

/**
 * Manages VS Code commands related to SQL Server instances.
 * Provides functionality to remove servers and their replication configuration.
 */
export class ServerCommands {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Registers all server-related commands with VS Code.
     * Includes commands for:
     * - Removing a server from the connection list
     * - Removing replication configuration from a server
     */
    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.removeServer', (node?: ServerTreeItem) => this.removeServer(node))
        );

        // Add new command for removing replication
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.removeReplication', async (node: ServerTreeItem) => {
                try {
                    const result = await vscode.window.showWarningMessage(
                        'This will remove all replication configuration from the server. Are you sure?',
                        { modal: true },
                        'Yes',
                        'No'
                    );

                    if (result === 'Yes') {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Removing replication configuration...",
                            cancellable: false
                        }, async () => {
                            await DistributorService.getInstance().removeReplication(node.connection);
                        });

                        vscode.commands.executeCommand('sqlrepl.refreshTree');
                        vscode.window.showInformationMessage('Replication configuration removed successfully');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to remove replication: ${error}`);
                }
            })
        );
    }

    /**
     * Removes a server from the connection list.
     * Shows a confirmation dialog before removal.
     * Refreshes the tree view after successful removal.
     * 
     * @param node - The tree item representing the server to remove
     */
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
