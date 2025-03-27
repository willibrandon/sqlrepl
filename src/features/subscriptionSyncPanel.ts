import * as vscode from 'vscode';
import { AgentService, AgentType } from '../services/agentService';
import { ConnectionService } from '../services/connectionService';
import { Subscription } from '../services/interfaces/subscriptionTypes';
import { AgentJob } from '../services/agentService';

/**
 * Manages a webview panel that displays synchronization status for a subscription.
 * Shows real-time status of associated distribution agents and provides controls
 * for starting/stopping synchronization.
 */
export class SubscriptionSyncPanel {
    public static currentPanel: SubscriptionSyncPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _subscription: Subscription;
    private readonly _serverId: string;
    private _disposables: vscode.Disposable[] = [];
    private _agents: AgentJob[] = [];
    private _updateInterval: NodeJS.Timeout | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        subscription: Subscription,
        serverId: string
    ) {
        this._panel = panel;
        this._subscription = subscription;
        this._serverId = serverId;

        // Set initial content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._update();
            }
        }, null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                const agent = this._agents[0]; // Currently we only show one agent
                if (!agent) {
                    vscode.window.showErrorMessage('No distribution agent found for this subscription');
                    return;
                }

                const connection = ConnectionService.getInstance().getConnection(this._serverId);
                if (!connection) {
                    vscode.window.showErrorMessage('Server connection not found');
                    return;
                }

                try {
                    let history;
                    switch (message.command) {
                        case 'startAgent':
                            await AgentService.getInstance().startJob(connection, agent.id);
                            vscode.window.showInformationMessage(`Started synchronization for ${this._subscription.publication}`);
                            await this._update(); // Refresh the view
                            break;

                        case 'stopAgent':
                            await AgentService.getInstance().stopJob(connection, agent.id);
                            vscode.window.showInformationMessage(`Stopped synchronization for ${this._subscription.publication}`);
                            await this._update(); // Refresh the view
                            break;

                        case 'viewHistory':
                            history = await AgentService.getInstance().getJobHistory(connection, agent.id);
                            this._showHistoryView(history);
                            break;
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to ${message.command}: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            },
            null,
            this._disposables
        );

        // Start periodic updates
        this._startUpdates();
    }

    /**
     * Creates and shows a new subscription sync panel, or reveals an existing one.
     * @param subscription The subscription to show sync status for
     * @param serverId The ID of the server containing the subscription
     * @param context The extension context
     */
    public static show(subscription: Subscription, serverId: string, _context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SubscriptionSyncPanel.currentPanel) {
            SubscriptionSyncPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'subscriptionSync',
            `Sync Status: ${subscription.publication}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SubscriptionSyncPanel.currentPanel = new SubscriptionSyncPanel(panel, subscription, serverId);
    }

    /**
     * Starts periodic updates of the sync status.
     */
    private _startUpdates() {
        // Update every 5 seconds
        this._updateInterval = setInterval(() => {
            this._update();
        }, 5000);
    }

    /**
     * Updates the webview content with current sync status.
     */
    private async _update() {
        // Get the connection
        const connection = ConnectionService.getInstance().getConnection(this._serverId);
        if (!connection) {
            this._panel.webview.html = this._getHtmlForError('Server connection not found');
            return;
        }

        try {
            // Get associated distribution agents
            this._agents = await AgentService.getInstance().getAgentJobs(connection);
            
            // For pull subscriptions, the agent runs at the subscriber
            // For push subscriptions, the agent runs at the distributor
            // We need to adjust our filtering based on the subscription type
            const isPull = this._subscription.subscription_type?.toLowerCase() === 'pull';
            
            this._agents = this._agents.filter(agent => {
                if (agent.type !== AgentType.DistributionAgent) {
                    return false;
                }

                // For pull subscriptions, we're looking at the subscriber side
                if (isPull) {
                    return agent.publication === this._subscription.publication &&
                           agent.publisherDb === this._subscription.publisherDb &&
                           agent.publisher === this._subscription.publisher;
                }
                
                // For push subscriptions, we're looking at the distributor side
                return agent.publication === this._subscription.publication &&
                       agent.publisherDb === this._subscription.publisherDb &&
                       agent.subscriber === this._subscription.subscriber &&
                       agent.subscriberDb === this._subscription.subscriberDb;
            });

            // Update the webview content
            this._panel.webview.html = this._getHtmlForContent();
        } catch (error) {
            this._panel.webview.html = this._getHtmlForError(
                `Failed to get agent status: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Generates the HTML for the webview content.
     */
    private _getHtmlForContent(): string {
        const agents = this._agents.map(agent => {
            const statusIcon = agent.isRunning ? '⟳' : agent.enabled ? '●' : '○';
            const statusText = agent.isRunning ? 'Running' : agent.enabled ? 'Idle' : 'Disabled';
            const lastRun = agent.lastRunTime 
                ? agent.lastRunTime.toLocaleString()
                : 'Never';
            
            return `
                <div class="agent-status ${agent.isRunning ? 'running' : agent.enabled ? 'idle' : 'disabled'}">
                    <h3>${statusIcon} ${agent.name}</h3>
                    <div class="status-details">
                        <p><strong>Status:</strong> ${statusText}</p>
                        <p><strong>Last Run:</strong> ${lastRun}</p>
                        <p><strong>Last Outcome:</strong> ${agent.lastRunOutcome || 'N/A'}</p>
                        <p><strong>Next Run:</strong> ${agent.nextRunTime ? agent.nextRunTime.toLocaleString() : 'Not Scheduled'}</p>
                    </div>
                    <div class="agent-controls">
                        ${agent.isRunning 
                            ? '<button onclick="stopAgent()">Stop Synchronization</button>'
                            : '<button onclick="startAgent()">Start Synchronization</button>'
                        }
                        <button onclick="viewHistory()">View History</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Subscription Synchronization Status</title>
                <style>
                    body {
                        padding: 20px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .agent-status {
                        margin-bottom: 20px;
                        padding: 15px;
                        border-radius: 5px;
                        background-color: var(--vscode-editor-background);
                    }
                    .agent-status.running {
                        border-left: 4px solid var(--vscode-terminal-ansiGreen);
                    }
                    .agent-status.idle {
                        border-left: 4px solid var(--vscode-terminal-ansiYellow);
                    }
                    .agent-status.disabled {
                        border-left: 4px solid var(--vscode-terminal-ansiRed);
                    }
                    .status-details {
                        margin: 10px 0;
                    }
                    .agent-controls {
                        margin-top: 15px;
                    }
                    button {
                        padding: 8px 12px;
                        margin-right: 8px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <h2>Synchronization Status: ${this._subscription.publication}</h2>
                <div class="subscription-info">
                    <p><strong>Publisher:</strong> ${this._subscription.publisher}</p>
                    <p><strong>Publisher Database:</strong> ${this._subscription.publisherDb}</p>
                    <p><strong>Subscriber Database:</strong> ${this._subscription.subscriberDb}</p>
                    <p><strong>Type:</strong> ${this._subscription.subscription_type}</p>
                </div>
                <div class="agents">
                    ${this._agents.length > 0 ? agents : '<p>No distribution agents found for this subscription.</p>'}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function startAgent() {
                        vscode.postMessage({ command: 'startAgent' });
                    }
                    
                    function stopAgent() {
                        vscode.postMessage({ command: 'stopAgent' });
                    }
                    
                    function viewHistory() {
                        vscode.postMessage({ command: 'viewHistory' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Generates error HTML content.
     */
    private _getHtmlForError(error: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    .error {
                        color: var(--vscode-errorForeground);
                        padding: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <h2>Error</h2>
                    <p>${error}</p>
                </div>
            </body>
            </html>
        `;
    }

    /**
     * Shows a new webview panel with the agent's job history.
     */
    private _showHistoryView(history: Array<{ runDate: Date; stepName: string; status: string; runDuration: string; message: string; }>) {
        const panel = vscode.window.createWebviewPanel(
            'agentHistory',
            `History: ${this._subscription.publication}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        const historyHtml = history.map(entry => `
            <div class="history-entry ${entry.status.toLowerCase()}">
                <div class="history-header">
                    <span class="date">${entry.runDate.toLocaleString()}</span>
                    <span class="status">${entry.status}</span>
                    <span class="duration">${entry.runDuration}</span>
                </div>
                <div class="step-name">${entry.stepName}</div>
                ${entry.message ? `<div class="message">${entry.message}</div>` : ''}
            </div>
        `).join('');

        panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 20px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .history-entry {
                        margin-bottom: 15px;
                        padding: 10px;
                        border-radius: 5px;
                        background-color: var(--vscode-editor-background);
                    }
                    .history-entry.succeeded {
                        border-left: 4px solid var(--vscode-terminal-ansiGreen);
                    }
                    .history-entry.failed {
                        border-left: 4px solid var(--vscode-terminal-ansiRed);
                    }
                    .history-entry.in.progress {
                        border-left: 4px solid var(--vscode-terminal-ansiYellow);
                    }
                    .history-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 8px;
                        font-size: 0.9em;
                    }
                    .step-name {
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    .message {
                        font-size: 0.9em;
                        white-space: pre-wrap;
                        margin-top: 5px;
                        padding: 5px;
                        background-color: var(--vscode-textBlockQuote-background);
                        border-radius: 3px;
                    }
                    .status {
                        font-weight: bold;
                    }
                    .status.succeeded {
                        color: var(--vscode-terminal-ansiGreen);
                    }
                    .status.failed {
                        color: var(--vscode-terminal-ansiRed);
                    }
                </style>
            </head>
            <body>
                <h2>Job History: ${this._subscription.publication}</h2>
                <div class="history-container">
                    ${history.length > 0 ? historyHtml : '<p>No history available.</p>'}
                </div>
            </body>
            </html>
        `;
    }

    /**
     * Disposes of the panel and cleans up resources.
     */
    public dispose() {
        SubscriptionSyncPanel.currentPanel = undefined;

        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
} 