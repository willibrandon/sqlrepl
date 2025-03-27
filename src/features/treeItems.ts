import * as vscode from 'vscode';
import { SqlServerConnection } from '../services/connectionService';
import { Publication } from '../services/interfaces/publicationTypes';
import { Subscription } from '../services/interfaces/subscriptionTypes';
import { AgentJob, AgentType } from '../services/agentService';

/** Type representing the different kinds of items that can appear in the replication tree view */
export type TreeItemType = 'server' | 'publications' | 'subscriptions' | 'agents' | 'publication' | 'subscription' | 'agent';

/**
 * Represents a SQL Server instance in the tree view.
 * Displays server name, authentication type, and database information.
 */
export class ServerTreeItem extends vscode.TreeItem {
    constructor(
        /** The connection details for this server */
        public readonly connection: SqlServerConnection,
        /** Whether this item can be expanded */
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        // Add OS indicator to the label for Linux servers
        const displayName = connection.serverOs === 'Linux'
            ? `${connection.serverName} [Linux]`
            : connection.serverName;
        
        super(displayName, collapsibleState);
        
        // Add OS and version info to tooltip if available
        const osInfo = connection.serverOs ? `\nOS: ${connection.serverOs}` : '';
        const versionInfo = connection.serverVersion ? `\nVersion: ${connection.serverVersion}` : '';
        this.tooltip = `${connection.serverName}${connection.database ? ` (${connection.database})` : ''}${osInfo}${versionInfo}`;
        
        // Show authentication type in description
        this.description = connection.authentication === 'windows' ? 'Windows Auth' : 'SQL Auth';
        this.contextValue = 'server';
        
        // Choose different color and icon based on OS type
        if (connection.serverOs === 'Linux') {
            // Use Linux-specific icon
            this.iconPath = new vscode.ThemeIcon('terminal-linux');
            // Add Linux-specific color to make it stand out more
            this.resourceUri = vscode.Uri.parse('file://linux-server');
        } else {
            // Default server icon for Windows or unknown OS
            this.iconPath = new vscode.ThemeIcon('server');
        }
    }
}

/**
 * Represents a folder node in the tree view that groups related items.
 * Can be a publications, subscriptions, or agents folder.
 */
export class FolderTreeItem extends vscode.TreeItem {
    constructor(
        /** Display name of the folder */
        public readonly label: string,
        /** Type of items contained in this folder */
        public readonly type: TreeItemType,
        /** ID of the server this folder belongs to */
        public readonly serverId: string,
        /** Whether this folder can be expanded */
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

/**
 * Represents a publication in the tree view.
 * Displays publication details including name, type, status, and configuration.
 * Uses different icons based on publication type (transactional vs snapshot).
 */
export class PublicationTreeItem extends vscode.TreeItem {
    constructor(
        /** The publication details */
        public readonly publication: Publication,
        /** ID of the server this publication belongs to */
        public readonly serverId: string,
        /** Whether this publication can be expanded */
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(publication.name, collapsibleState);
        
        // Create a detailed tooltip with all available information
        const tooltipLines = [
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
        ];
        this.tooltip = tooltipLines.join('\n');
        
        // Create a concise but informative description
        this.description = `${publication.database} | ${publication.type} (${publication.status})`;
        this.contextValue = 'publication';
        
        // Choose icon based on publication type
        const iconName = publication.type.toLowerCase() === 'transactional' ? 'database' : 'file-binary';
        this.iconPath = new vscode.ThemeIcon(iconName);
    }
}

/**
 * Represents a subscription in the tree view.
 * Displays subscription details including publisher, subscriber, and type information.
 * Uses different icons based on subscription type (push vs pull).
 */
export class SubscriptionTreeItem extends vscode.TreeItem {
    constructor(
        /** The subscription details */
        public readonly subscription: Subscription,
        /** ID of the server this subscription belongs to */
        public readonly serverId: string,
        /** Whether this subscription can be expanded */
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        // Create a more descriptive name if the subscription name is not available
        const displayName = subscription.name || `${subscription.publication}_${subscription.subscriberDb}`;
        super(displayName, collapsibleState);

        // Create a detailed tooltip with all available information
        const tooltipLines = [
            `Publication: ${subscription.publication}`,
            `Publisher: ${subscription.publisher || 'Unknown'}`,
            `Publisher DB: ${subscription.publisherDb || 'Unknown'}`,
            `Subscriber DB: ${subscription.subscriberDb || 'Unknown'}`,
            `Type: ${subscription.subscription_type || 'Unknown'}`,
            `Sync Type: ${subscription.sync_type || 'Unknown'}`,
            `Status: ${subscription.status || 'Unknown'}`
        ];
        this.tooltip = tooltipLines.join('\n');

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

/**
 * Represents a replication agent in the tree view.
 * Displays agent details including status, last run time, and outcome.
 * Uses different icons based on agent type (snapshot, log reader, distribution, merge).
 * Provides contextual information about the agent's current state (running vs idle).
 */
export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        /** The agent job details */
        public readonly agent: AgentJob,
        /** ID of the server this agent belongs to */
        public readonly serverId: string,
        /** Whether this agent can be expanded */
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(agent.name, collapsibleState);
        
        // Determine agent-specific status
        const statusIcon = agent.isRunning ? '⟳' : agent.enabled ? '●' : '○';
        const statusText = agent.isRunning ? 'Running' : agent.enabled ? 'Idle' : 'Disabled';
        
        // Create a detailed tooltip with all available information
        const tooltipLines = [
            `Agent: ${agent.name}`,
            `Type: ${agent.type}`,
            `Status: ${statusText}`,
            `Enabled: ${agent.enabled ? 'Yes' : 'No'}`,
            `Last Run: ${agent.lastRunTime ? agent.lastRunTime.toLocaleString() : 'Never'}`,
            `Last Outcome: ${agent.lastRunOutcome || 'Unknown'}`,
            `Next Run: ${agent.nextRunTime ? agent.nextRunTime.toLocaleString() : 'Not Scheduled'}`,
            `Publisher: ${agent.publisher || 'Unknown'}`,
            `Publisher DB: ${agent.publisherDb || 'Unknown'}`,
            `Publication: ${agent.publication || 'Unknown'}`
        ];
        
        if (agent.subscriber) {
            tooltipLines.push(`Subscriber: ${agent.subscriber}`);
        }
        
        if (agent.subscriberDb) {
            tooltipLines.push(`Subscriber DB: ${agent.subscriberDb}`);
        }
        
        tooltipLines.push(`Description: ${agent.description}`);
        
        this.tooltip = tooltipLines.join('\n');
        
        // Create a concise description with status and last run info
        const lastRun = agent.isRunning
            ? (agent.lastRunTime 
                ? `Running since ${agent.lastRunTime.toLocaleString()}`
                : 'Running')
            : (agent.lastRunTime 
                ? `Last: ${agent.lastRunTime.toLocaleString()} (${agent.lastRunOutcome})`
                : 'Never Run');
        
        this.description = `${statusIcon} ${lastRun}`;
        this.contextValue = agent.isRunning ? 'agent-running' : 'agent-idle';
        
        // Choose icon based on agent type
        let iconName: string;
        switch (agent.type) {
            case AgentType.SnapshotAgent:
                iconName = 'file-binary';
                break;
            case AgentType.LogReaderAgent:
                iconName = 'book';
                break;
            case AgentType.DistributionAgent:
                iconName = 'package';
                break;
            case AgentType.MergeAgent:
                iconName = 'git-merge';
                break;
            default:
                iconName = 'pulse';
        }
        
        this.iconPath = new vscode.ThemeIcon(iconName);
    }
}