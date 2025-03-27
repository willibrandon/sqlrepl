import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { PublicationService } from '../services/publicationService';
import { SubscriptionService } from '../services/subscriptionService';
import { AgentService } from '../services/agentService';
import { ServerTreeItem, FolderTreeItem, PublicationTreeItem, SubscriptionTreeItem, AgentTreeItem } from './treeItems';

/**
 * Provides a tree data provider for SQL Server replication components in VS Code.
 * Implements a hierarchical view of servers, publications, subscriptions, and replication agents.
 * The tree structure is:
 * - Server
 *   - Publications Folder
 *     - Publication Items
 *   - Subscriptions Folder
 *     - Subscription Items
 *   - Agents Folder
 *     - Agent Items
 */
export class ReplicationExplorer implements vscode.TreeDataProvider<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void> = new vscode.EventEmitter<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void>();
    
    /** Event that fires when the tree data changes, triggering a refresh of the view */
    readonly onDidChangeTreeData: vscode.Event<ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private publicationService: PublicationService;
    private subscriptionService: SubscriptionService;

    /**
     * Creates a new instance of the ReplicationExplorer.
     * @param context - The VS Code extension context used for managing connections
     */
    constructor(private context: vscode.ExtensionContext) {
        this.publicationService = PublicationService.getInstance();
        this.subscriptionService = SubscriptionService.getInstance();
    }

    /**
     * Refreshes the tree view by firing the change event.
     * This will cause VS Code to request new data for the entire tree.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Expands all nodes in the tree view.
     * @param treeView - The VS Code TreeView to expand
     */
    async expandAll(treeView: vscode.TreeView<any>): Promise<void> {
        // Get all root nodes (server nodes)
        const connections = ConnectionService.getInstance(this.context).getConnections();
        const serverNodes = connections.map(conn => new ServerTreeItem(conn, vscode.TreeItemCollapsibleState.Expanded));
        
        // Expand each server node
        for (const serverNode of serverNodes) {
            await treeView.reveal(serverNode, { expand: true });
            
            // Get folder nodes for each server
            const folderNodes = [
                new FolderTreeItem('Publications', 'publications', serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded),
                new FolderTreeItem('Subscriptions', 'subscriptions', serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded),
                new FolderTreeItem('Agents', 'agents', serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded)
            ];
            
            // Expand each folder node
            for (const folderNode of folderNodes) {
                await treeView.reveal(folderNode, { expand: true, select: false });
                
                // For each folder type, get and expand its children
                if (folderNode.type === 'publications') {
                    try {
                        const publications = await this.publicationService.getPublications(serverNode.connection);
                        for (const pub of publications) {
                            const pubNode = new PublicationTreeItem(pub, serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded);
                            await treeView.reveal(pubNode, { expand: true, select: false });
                        }
                    } catch (error) {
                        console.error('Failed to expand publications:', error);
                    }
                } else if (folderNode.type === 'subscriptions') {
                    try {
                        const subscriptions = await this.subscriptionService.getSubscriptions(serverNode.connection);
                        for (const sub of subscriptions) {
                            const subNode = new SubscriptionTreeItem(sub, serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded);
                            await treeView.reveal(subNode, { expand: true, select: false });
                        }
                    } catch (error) {
                        console.error('Failed to expand subscriptions:', error);
                    }
                } else if (folderNode.type === 'agents') {
                    try {
                        const agents = await AgentService.getInstance().getAgentJobs(serverNode.connection);
                        for (const agent of agents) {
                            const agentNode = new AgentTreeItem(agent, serverNode.connection.id, vscode.TreeItemCollapsibleState.Expanded);
                            await treeView.reveal(agentNode, { expand: true, select: false });
                        }
                    } catch (error) {
                        console.error('Failed to expand agents:', error);
                    }
                }
            }
        }
        
        // Refresh the tree view to ensure all nodes are properly expanded
        this.refresh();
    }

    /**
     * Gets the tree item for the given element.
     * Required by VS Code's TreeDataProvider interface.
     * @param element - The element to get the tree item for
     * @returns The VS Code TreeItem for display
     */
    getTreeItem(element: ServerTreeItem | FolderTreeItem | PublicationTreeItem | SubscriptionTreeItem | AgentTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Gets the children for a given element in the tree.
     * - Root level returns server nodes
     * - Server level returns folder nodes (Publications, Subscriptions, Agents)
     * - Folder level returns the appropriate items based on folder type
     * 
     * @param element - The element to get children for, undefined for root
     * @returns Promise resolving to an array of tree items
     */
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

    /**
     * Gets the parent item for a given element in the tree.
     * This enables VS Code to implement features like "Reveal in Explorer".
     * 
     * @param element - The element to get the parent for
     * @returns The parent tree item, or null if the element is at the root
     */
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
