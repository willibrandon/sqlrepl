import * as vscode from 'vscode';
import { SqlServerConnection } from '../services/connectionService';
import { Publication, Subscription } from '../services/replicationService';

export type TreeItemType = 'server' | 'publications' | 'subscriptions' | 'agents' | 'publication' | 'subscription';

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

export class PublicationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly publication: Publication,
        public readonly serverId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(publication.name, collapsibleState);
        
        // Create a detailed tooltip with all available information
        this.tooltip = [
            `Publication: ${publication.name}`,
            `Database: ${publication.database}`,
            `Type: ${publication.type}`,
            `Status: ${publication.status}`,
            `Description: ${publication.description || 'None'}`,
            `Immediate Sync: ${publication.immediate_sync ? 'Yes' : 'No'}`,
            `Allow Push: ${publication.allow_push ? 'Yes' : 'No'}`,
            `Allow Pull: ${publication.allow_pull ? 'Yes' : 'No'}`,
            `Allow Anonymous: ${publication.allow_anonymous ? 'Yes' : 'No'}`,
            `Immediate Sync Ready: ${publication.immediate_sync_ready ? 'Yes' : 'No'}`,
            `Allow Sync Tran: ${publication.allow_sync_tran ? 'Yes' : 'No'}`,
            `Enabled For Internet: ${publication.enabled_for_internet ? 'Yes' : 'No'}`
        ].join('\n');
        
        // Create a concise but informative description
        this.description = `${publication.database} | ${publication.type} (${publication.status})`;
        this.contextValue = 'publication';
        
        // Choose icon based on publication type
        const iconName = publication.type.toLowerCase() === 'transactional' ? 'database' : 'file-binary';
        this.iconPath = new vscode.ThemeIcon(iconName);
    }
}

export class SubscriptionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly subscription: Subscription,
        public readonly serverId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        // Create a more descriptive name if the subscription name is not available
        const displayName = subscription.name || `${subscription.publication}_${subscription.subscriberDb}`;
        super(displayName, collapsibleState);

        // Create a detailed tooltip with all available information
        this.tooltip = [
            `Publication: ${subscription.publication}`,
            `Publisher: ${subscription.publisher || 'Unknown'}`,
            `Publisher DB: ${subscription.publisherDb || 'Unknown'}`,
            `Subscriber DB: ${subscription.subscriberDb || 'Unknown'}`,
            `Type: ${subscription.subscription_type || 'Unknown'}`,
            `Sync Type: ${subscription.sync_type || 'Unknown'}`,
            `Status: ${subscription.status || 'Unknown'}`
        ].join('\n');

        // Create a concise but informative description
        const publisher = subscription.publisher || 'Unknown';
        const publisherDb = subscription.publisherDb || 'Unknown';
        const subscriberDb = subscription.subscriberDb || 'Unknown';
        const type = subscription.subscription_type || 'Unknown';
        this.description = `${publisher}/${publisherDb} → ${subscriberDb} (${type})`;
        
        this.contextValue = 'subscription';
        
        // Choose icon based on subscription type, default to 'arrow-right' if type is unknown
        let iconName = 'arrow-right';
        if (subscription.subscription_type) {
            iconName = subscription.subscription_type.toLowerCase() === 'push' ? 'arrow-down' : 'arrow-up';
        }
        this.iconPath = new vscode.ThemeIcon(iconName);
    }
} 