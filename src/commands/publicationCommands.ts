import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ReplicationService } from '../services/replicationService';
import { DistributorService } from '../services/distributorService';
import { PublicationOptions } from '../services/interfaces/publicationTypes';
import { ReplicationType } from '../services/interfaces/replicationTypes';
import { FolderTreeItem } from '../features/treeItems';

export class PublicationCommands {
    constructor(private context: vscode.ExtensionContext) {}

    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.createPublication', (node?: FolderTreeItem) => this.createPublication(node))
        );
    }

    private async createPublication(node?: FolderTreeItem): Promise<void> {
        try {
            // If node is not provided, we need to get the server first
            let serverId = node?.serverId;
            if (!serverId) {
                const connections = ConnectionService.getInstance(this.context).getConnections();
                if (connections.length === 0) {
                    throw new Error('No SQL Server connections available. Please add a connection first.');
                }

                const serverPick = await vscode.window.showQuickPick(
                    connections.map(conn => ({
                        label: conn.serverName,
                        description: conn.database || '',
                        connection: conn
                    })),
                    { placeHolder: 'Select SQL Server instance' }
                );

                if (!serverPick) {
                    return; // User cancelled
                }

                serverId = serverPick.connection.id;
            }

            const connection = ConnectionService.getInstance(this.context).getConnection(serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            // Check distributor configuration
            const distInfo = await DistributorService.getInstance().getDistributorInfo(connection);

            if (!distInfo.isDistributor) {
                const configureNow = await vscode.window.showQuickPick(
                    [
                        { label: 'Configure Distribution', description: 'Set up this server as its own distributor', value: true },
                        { label: 'Cancel', description: 'Cancel publication creation', value: false }
                    ],
                    { 
                        placeHolder: 'Distribution is not configured. Would you like to configure it now?',
                        title: 'Configure Distribution'
                    }
                );

                if (!configureNow || !configureNow.value) {
                    return;
                }

                // Get distribution database name
                const distributionDb = await vscode.window.showInputBox({
                    prompt: 'Enter distribution database name',
                    value: 'distribution',
                    validateInput: text => {
                        if (!text) return 'Distribution database name is required';
                        if (!/^[a-zA-Z0-9_]+$/.test(text)) return 'Database name can only contain letters, numbers, and underscores';
                        return null;
                    }
                });

                if (!distributionDb) {
                    return; // User cancelled
                }

                // Get snapshot folder
                const snapshotFolder = await vscode.window.showInputBox({
                    prompt: 'Enter snapshot folder path',
                    value: '\\\\' + connection.serverName + '\\repldata',
                    validateInput: text => {
                        return text ? null : 'Snapshot folder path is required';
                    }
                });

                if (!snapshotFolder) {
                    return; // User cancelled
                }

                // Configure distribution
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Configuring distribution...',
                        cancellable: false
                    },
                    async () => {
                        await DistributorService.getInstance().configureDistributor(connection, distributionDb, snapshotFolder);
                    }
                );

                vscode.window.showInformationMessage('Distribution configured successfully');
            }

            // Get publication type
            const typePick = await vscode.window.showQuickPick(
                [
                    { label: 'Snapshot', value: 'snapshot' as ReplicationType },
                    { label: 'Transactional', value: 'transactional' as ReplicationType }
                ],
                { placeHolder: 'Select publication type' }
            );

            if (!typePick) {
                return; // User cancelled
            }

            // Get publication name
            const name = await vscode.window.showInputBox({
                prompt: 'Enter publication name',
                validateInput: text => {
                    if (!text) return 'Publication name is required';
                    if (!/^[a-zA-Z0-9_]+$/.test(text)) return 'Publication name can only contain letters, numbers, and underscores';
                    return null;
                }
            });

            if (!name) {
                return; // User cancelled
            }

            // Get database if not already specified
            const database = connection.database || await vscode.window.showInputBox({
                prompt: 'Enter database name',
                placeHolder: 'master',
                validateInput: text => {
                    return text ? null : 'Database name is required';
                }
            });

            if (!database) {
                return; // User cancelled
            }

            // Validate distributor configuration after database selection
            const isDistributorValid = await DistributorService.getInstance().validateDistributor(connection);
            if (!isDistributorValid) {
                throw new Error('Distribution is not configured for this server. Please configure distribution first.');
            }

            // Get snapshot folder
            const snapshotFolder = await vscode.window.showInputBox({
                prompt: 'Enter snapshot folder path',
                value: '\\\\' + connection.serverName + '\\Repldata',
                validateInput: text => {
                    return text ? null : 'Snapshot folder path is required';
                }
            });

            if (!snapshotFolder) {
                return; // User cancelled
            }

            // Get tables to replicate
            const tables = await ReplicationService.getInstance().getTables(connection, database);
            const selectedTables = await vscode.window.showQuickPick(
                tables.map(table => ({
                    label: table,
                    picked: true
                })),
                {
                    placeHolder: 'Select tables to replicate',
                    canPickMany: true
                }
            );

            if (!selectedTables || selectedTables.length === 0) {
                return; // User cancelled or no tables selected
            }

            // Create publication options
            const options: PublicationOptions = {
                name,
                type: typePick.value,
                database,
                snapshotFolder,
                articles: selectedTables.map(t => t.label)
            };

            // Show progress while creating publication
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Creating publication ${name}...`,
                    cancellable: false
                },
                async () => {
                    await ReplicationService.getInstance().createPublication(connection, options);
                }
            );

            // Show success message
            vscode.window.showInformationMessage(`Successfully created publication ${name}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create publication: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 