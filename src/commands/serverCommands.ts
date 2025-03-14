import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ServerTreeItem } from '../features/treeItems';
import { ReplicationService } from '../services/replicationService';

export class ServerCommands {
    private context: vscode.ExtensionContext;
    private replicationService: ReplicationService;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.replicationService = ReplicationService.getInstance();
    }

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
                            await this.replicationService.removeReplication(node.connection);
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