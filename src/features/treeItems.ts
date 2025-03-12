import * as vscode from 'vscode';
import { SqlServerConnection } from '../services/connectionService';

export type TreeItemType = 'server' | 'publications' | 'subscriptions' | 'agents';

export class ServerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly connection: SqlServerConnection,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(connection.serverName, collapsibleState);
        this.tooltip = `${connection.serverName}${connection.database ? ` (${connection.database})` : ''}`;
        this.description = connection.authentication === 'windows' ? 'Windows Auth' : 'SQL Auth';
        this.contextValue = 'server';
        this.iconPath = new vscode.ThemeIcon('server');
    }
}

export class FolderTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: TreeItemType,
        public readonly serverId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        
        // Set appropriate icon based on type
        switch (type) {
            case 'publications':
                this.iconPath = new vscode.ThemeIcon('database');
                break;
            case 'subscriptions':
                this.iconPath = new vscode.ThemeIcon('repo-clone');
                break;
            case 'agents':
                this.iconPath = new vscode.ThemeIcon('pulse');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
} 