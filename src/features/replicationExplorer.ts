import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { ServerTreeItem, FolderTreeItem } from './treeItems';

export class ReplicationExplorer implements vscode.TreeDataProvider<ServerTreeItem | FolderTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerTreeItem | FolderTreeItem | undefined | null | void> = new vscode.EventEmitter<ServerTreeItem | FolderTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerTreeItem | FolderTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerTreeItem | FolderTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServerTreeItem | FolderTreeItem): Promise<(ServerTreeItem | FolderTreeItem)[]> {
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
            // Folder level - will be populated later with actual data
            return [];
        }

        return [];
    }

    getParent(element: ServerTreeItem | FolderTreeItem): vscode.ProviderResult<ServerTreeItem | FolderTreeItem> {
        if (element instanceof FolderTreeItem) {
            const connection = ConnectionService.getInstance(this.context).getConnection(element.serverId);
            if (connection) {
                return new ServerTreeItem(connection, vscode.TreeItemCollapsibleState.Collapsed);
            }
        }
        return null;
    }
} 