import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { PublicationService } from '../services/publicationService';
import { SubscriptionService } from '../services/subscriptionService';
import { SubscriptionOptions } from '../services/interfaces/subscriptionTypes';
import { FolderTreeItem, PublicationTreeItem, SubscriptionTreeItem } from '../features/treeItems';
import { SubscriptionType } from '../services/interfaces/replicationTypes';

export class SubscriptionCommands {
    private publicationService: PublicationService;
    private subscriptionService: SubscriptionService;

    constructor(private context: vscode.ExtensionContext) {
        this.publicationService = PublicationService.getInstance();
        this.subscriptionService = SubscriptionService.getInstance();
    }

    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.createSubscription', (node?: PublicationTreeItem | FolderTreeItem) => this.createSubscription(node)),
            vscode.commands.registerCommand('sqlrepl.reinitializeSubscription', (node?: SubscriptionTreeItem) => this.reinitializeSubscription(node)),
            vscode.commands.registerCommand('sqlrepl.dropSubscription', (node?: SubscriptionTreeItem) => this.dropSubscription(node))
        );
    }

    private async createSubscription(node?: PublicationTreeItem | FolderTreeItem): Promise<void> {
        try {
            let serverId: string | undefined;
            let publicationName: string | undefined;
            let publisherServer: string | undefined;
            let publisherDatabase: string | undefined;

            // If starting from a publication node, use that publication's info
            if (node instanceof PublicationTreeItem) {
                serverId = node.serverId;
                publicationName = node.publication.name;
                publisherServer = ConnectionService.getInstance(this.context).getConnection(serverId)?.serverName;
                publisherDatabase = node.publication.database;
            } 
            // If starting from subscriptions folder, we'll need to select a publication
            else if (node instanceof FolderTreeItem && node.type === 'subscriptions') {
                serverId = node.serverId;
            }

            // If we don't have a server ID, we need to get one
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
                    { placeHolder: 'Select SQL Server for subscription' }
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

            // If we don't have publication information, we need to get it
            if (!publicationName || !publisherServer || !publisherDatabase) {
                // First, ask the user to select a publisher
                const allConnections = ConnectionService.getInstance(this.context).getConnections();
                
                // Let user select publisher first
                const publisherPick = await vscode.window.showQuickPick(
                    allConnections.map(conn => ({
                        label: conn.serverName,
                        description: 'Publisher',
                        connection: conn
                    })),
                    { placeHolder: 'Select publisher server' }
                );
                
                if (!publisherPick) {
                    return; // User cancelled
                }
                
                const publisherConnection = publisherPick.connection;
                
                // Now get publications from the selected publisher
                try {
                    const publications = await this.publicationService.getPublications(publisherConnection);
                    
                    if (publications.length === 0) {
                        throw new Error(`No publications found on ${publisherConnection.serverName}. Please create a publication first.`);
                    }
                    
                    const publicationPick = await vscode.window.showQuickPick(
                        publications.map(pub => ({
                            label: pub.name,
                            description: `${pub.database} | ${pub.type}`,
                            detail: pub.description || '',
                            publication: pub
                        })),
                        { placeHolder: 'Select publication to subscribe to' }
                    );
                    
                    if (!publicationPick) {
                        return; // User cancelled
                    }
                    
                    publicationName = publicationPick.publication.name;
                    publisherServer = publisherConnection.serverName;
                    publisherDatabase = publicationPick.publication.database;
                } catch (error) {
                    console.error('Error getting publications:', error);
                    throw new Error(`Failed to get publications from ${publisherConnection.serverName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Get subscription type
            const typePick = await vscode.window.showQuickPick(
                [
                    { label: 'Push', description: 'Distribution agent runs at the distributor', value: 'push' as SubscriptionType },
                    { label: 'Pull', description: 'Distribution agent runs at the subscriber', value: 'pull' as SubscriptionType }
                ],
                { placeHolder: 'Select subscription type' }
            );

            if (!typePick) {
                return; // User cancelled
            }

            // Get subscriber database name
            const subscriberDb = await vscode.window.showInputBox({
                prompt: 'Enter subscriber database name',
                placeHolder: publisherDatabase,
                value: publisherDatabase,
                validateInput: text => {
                    return text ? null : 'Subscriber database name is required';
                }
            });

            if (!subscriberDb) {
                return; // User cancelled
            }

            // Get synchronization type
            const syncTypePick = await vscode.window.showQuickPick(
                [
                    { label: 'Immediate', description: 'Initialize subscription immediately', value: 'immediate' as const },
                    { label: 'Automatic', description: 'Initialize subscription when next snapshot is available', value: 'automatic' as const },
                    { label: 'Manual', description: 'Initialize subscription manually later', value: 'manual' as const }
                ],
                { placeHolder: 'Select synchronization type' }
            );

            if (!syncTypePick) {
                return; // User cancelled
            }

            // Ask about remote connections credentials if needed
            let loginForRemoteConnections: string | undefined;
            let passwordForRemoteConnections: string | undefined;

            const useRemoteAuth = await vscode.window.showQuickPick(
                [
                    { label: 'Use Windows Authentication', description: 'Use integrated security for remote connections', value: false },
                    { label: 'Use SQL Authentication', description: 'Provide SQL login credentials for remote connections', value: true }
                ],
                { placeHolder: 'Select authentication mode for remote connections' }
            );

            if (!useRemoteAuth) {
                return; // User cancelled
            }

            if (useRemoteAuth.value) {
                loginForRemoteConnections = await vscode.window.showInputBox({
                    prompt: 'Enter SQL login name for remote connections',
                    validateInput: text => {
                        return text ? null : 'Login name is required';
                    }
                });

                if (!loginForRemoteConnections) {
                    return; // User cancelled
                }

                passwordForRemoteConnections = await vscode.window.showInputBox({
                    prompt: 'Enter password for remote connections',
                    password: true,
                    validateInput: text => {
                        return text ? null : 'Password is required';
                    }
                });

                if (!passwordForRemoteConnections) {
                    return; // User cancelled
                }
            }

            // Create subscription options
            const options: SubscriptionOptions = {
                publicationName,
                publisherServer,
                publisherDatabase,
                subscriberServer: connection.serverName,
                subscriberDatabase: subscriberDb,
                type: typePick.value,
                syncType: syncTypePick.value,
                loginForRemoteConnections,
                passwordForRemoteConnections
            };

            // Show progress while creating subscription
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Creating subscription to ${publicationName}...`,
                    cancellable: false
                },
                async () => {
                    await this.subscriptionService.createSubscription(connection, options);
                }
            );

            // Show success message
            vscode.window.showInformationMessage(`Successfully created subscription to ${publicationName}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async reinitializeSubscription(node?: SubscriptionTreeItem): Promise<void> {
        try {
            if (!node) {
                vscode.window.showErrorMessage('No subscription selected');
                return;
            }

            const connection = ConnectionService.getInstance(this.context).getConnection(node.serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            const subscription = node.subscription;

            // Confirm reinitialization
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to reinitialize the subscription to ${subscription.publication}?`,
                { modal: true },
                'Yes', 'No'
            );

            if (confirm !== 'Yes') {
                return;
            }

            // Reinitialize the subscription
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Reinitializing subscription to ${subscription.publication}...`,
                    cancellable: false
                },
                async () => {
                    await this.subscriptionService.reinitializeSubscription(
                        connection,
                        subscription.publisher,
                        subscription.publisherDb,
                        subscription.publication,
                        connection.serverName,
                        subscription.subscriberDb
                    );
                }
            );

            // Show success message
            vscode.window.showInformationMessage(`Successfully reinitialized subscription to ${subscription.publication}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reinitialize subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async dropSubscription(node?: SubscriptionTreeItem): Promise<void> {
        try {
            if (!node) {
                vscode.window.showErrorMessage('No subscription selected');
                return;
            }

            const connection = ConnectionService.getInstance(this.context).getConnection(node.serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            const subscription = node.subscription;

            // Confirm drop
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to drop the subscription to ${subscription.publication}?`,
                { modal: true },
                'Yes', 'No'
            );

            if (confirm !== 'Yes') {
                return;
            }

            // Drop the subscription
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Dropping subscription to ${subscription.publication}...`,
                    cancellable: false
                },
                async () => {
                    await this.subscriptionService.dropSubscription(
                        connection,
                        subscription.publisher,
                        subscription.publisherDb,
                        subscription.publication,
                        connection.serverName,
                        subscription.subscriberDb,
                        subscription.subscription_type
                    );
                }
            );

            // Show success message
            vscode.window.showInformationMessage(`Successfully dropped subscription to ${subscription.publication}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 