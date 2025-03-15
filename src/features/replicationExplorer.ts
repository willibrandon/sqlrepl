import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { PublicationService } from '../services/publicationService';
import { SubscriptionService } from '../services/subscriptionService';
import { AgentService } from '../services/agentService';
import { ServerTreeItem, FolderTreeItem, PublicationTreeItem, SubscriptionTreeItem, AgentTreeItem } from './treeItems';

export class ReplicationExplorer implements vscode.TreeDataProvider<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void> = new vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private publicationService: PublicationService;
    private subscriptionService: SubscriptionService;

    constructor(private context: vscode.ExtensionContext) {
        this.publicationService = PublicationService.getInstance();
        this.subscriptionService = SubscriptionService.getInstance();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem): Promise<(ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem)[]> {
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
                    const publications = await this.publicationService.getPublications(connection);
                    return publications.map(pub => new PublicationTreeItem(pub, element.serverId));
                } catch (error) {
                    console.error('Failed to get publications for tree view:', error);
                    return [];
                }
            } else if (element.type === 'subscriptions') {
                // Show subscriptions for this server
                try {
                    const subscriptions = await this.subscriptionService.getSubscriptions(connection);
                    return subscriptions.map(sub => new SubscriptionTreeItem(sub, element.serverId));
                } catch (error) {
                    console.error('Failed to get subscriptions for tree view:', error);
                    return [];
                }
            } else if (element.type === 'agents') {
                // Show agents for this server
                try {
                    const agents = await AgentService.getInstance().getAgentJobs(connection);
                    return agents.map(agent => new AgentTreeItem(agent, element.serverId));
                } catch (error) {
                    console.error('Failed to get agents for tree view:', error);
                    return [];
                }
            }

            // For other folder types, return empty array for now
            return [];
        }

        return [];
    }

    getParent(element: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem): vscode.ProviderResult<ServerTreeItem | FolderTreeItem> {
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

        if (element instanceof AgentTreeItem) {
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (connection) {
                return new FolderTreeItem('Agents', 'agents', element.serverId, vscode.TreeItemCollapsibleState.Collapsed);
            }
        }

        return null;
    }
} 