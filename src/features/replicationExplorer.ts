import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ReplicationService } from '../services/replicationService';
import { ServerTreeItem, FolderTreeItem, PublicationTreeItem, SubscriptionTreeItem } from './treeItems';

export class ReplicationExplorer implements vscode.TreeDataProvider<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | undefined | null | void> = new vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem): Promise<(ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem)[]> {
        if (!element) {
            // Root level - show servers
            const connections = ConnectionService.getInstance(this.context).getConnections();
            return connections.map(conn => new ServerTreeItem(conn, vscode.TreeItemCollapsibleState.Collapsed));
        }

        if (element instanceof ServerTreeItem) {
            // Server level - show folders
            return [
                new FolderTreeItem('Publications', 'publications', element.connection.id, vscode.TreeItemCollapsibleState.Collapsed),
                new FolderTreeItem('Subscriptions', 'subscriptions', element.connection.id, vscode.TreeItemCollapsibleState.Collapsed),
                new FolderTreeItem('Agents', 'agents', element.connection.id, vscode.TreeItemCollapsibleState.Collapsed)
            ];
        }

        if (element instanceof FolderTreeItem) {
            // Folder level - handle different folder types
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (!connection) {
                return [];
            }

            if (element.type === 'publications') {
                // Show publications for this server
                try {
                    const publications = await ReplicationService.getInstance().getPublications(connection);
                    return publications.map(pub => new PublicationTreeItem(pub, element.serverId));
                } catch (error) {
                    console.error('Failed to get publications for tree view:', error);
                    return [];
                }
            } else if (element.type === 'subscriptions') {
                // Show subscriptions for this server
                try {
                    const subscriptions = await ReplicationService.getInstance().getSubscriptions(connection);
                    return subscriptions.map(sub => new SubscriptionTreeItem(sub, element.serverId));
                } catch (error) {
                    console.error('Failed to get subscriptions for tree view:', error);
                    return [];
                }
            }

            // For other folder types, return empty array for now
            return [];
        }

        return [];
    }

    getParent(element: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem): vscode.ProviderResult<ServerTreeItem | FolderTreeItem> {
        if (element instanceof FolderTreeItem) {
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (connection) {
                return new ServerTreeItem(connection, vscode.TreeItemCollapsibleState.Collapsed);
            }
        }

        if (element instanceof PublicationTreeItem) {
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (connection) {
                return new FolderTreeItem('Publications', 'publications', element.serverId, vscode.TreeItemCollapsibleState.Collapsed);
            }
        }

        if (element instanceof SubscriptionTreeItem) {
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (connection) {
                return new FolderTreeItem('Subscriptions', 'subscriptions', element.serverId, vscode.TreeItemCollapsibleState.Collapsed);
            }
        }

        return null;
    }
} 