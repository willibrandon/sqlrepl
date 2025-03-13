import * as vscode from 'vscode';
import { ConnectionService } from '../services/connectionService';
import { AgentService } from '../services/agentService';
import { AgentTreeItem } from '../features/treeItems';

interface JobHistoryEntry {
    runDate: Date;
    stepName: string;
    status: 'Succeeded' | 'Failed' | 'In Progress' | string;
    runDuration: string;
    message: string;
}

export class AgentCommands {
    constructor(private context: vscode.ExtensionContext) {}

    registerCommands(): void {
        // Register commands
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.startAgent', this.startAgent.bind(this)),
            vscode.commands.registerCommand('sqlrepl.stopAgent', this.stopAgent.bind(this)),
            vscode.commands.registerCommand('sqlrepl.viewAgentHistory', this.viewAgentHistory.bind(this))
        );
    }

    private async startAgent(node?: AgentTreeItem): Promise<void> {
        if (!node) {
            vscode.window.showErrorMessage('Please select an agent to start');
            return;
        }

        try {
            const connection = ConnectionService.getInstance(this.context).getConnection(node.serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            // Check if the job is already running
            if (node.agent.isRunning) {
                vscode.window.showInformationMessage(`Agent ${node.agent.name} is already running`);
                return;
            }

            // Start the agent job
            const agentService = AgentService.getInstance();
            const success = await agentService.startJob(connection, node.agent.id);

            if (success) {
                vscode.window.showInformationMessage(`Started agent: ${node.agent.name}`);
                // Refresh the tree view to update the agent status
                vscode.commands.executeCommand('sqlrepl.refreshTree');
            } else {
                vscode.window.showErrorMessage(`Failed to start agent: ${node.agent.name}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error starting agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async stopAgent(node?: AgentTreeItem): Promise<void> {
        if (!node) {
            vscode.window.showErrorMessage('Please select an agent to stop');
            return;
        }

        try {
            const connection = ConnectionService.getInstance(this.context).getConnection(node.serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            // Check if the job is running
            if (!node.agent.isRunning) {
                vscode.window.showInformationMessage(`Agent ${node.agent.name} is not currently running`);
                return;
            }

            // Confirm before stopping
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to stop the agent: ${node.agent.name}?`,
                { modal: true },
                'Yes', 'No'
            );
            
            if (confirm !== 'Yes') {
                return;
            }

            // Stop the agent job
            const agentService = AgentService.getInstance();
            const success = await agentService.stopJob(connection, node.agent.id);

            if (success) {
                vscode.window.showInformationMessage(`Stopped agent: ${node.agent.name}`);
                // Refresh the tree view to update the agent status
                vscode.commands.executeCommand('sqlrepl.refreshTree');
            } else {
                vscode.window.showErrorMessage(`Failed to stop agent: ${node.agent.name}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error stopping agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async viewAgentHistory(node?: AgentTreeItem): Promise<void> {
        if (!node) {
            vscode.window.showErrorMessage('Please select an agent to view history');
            return;
        }

        try {
            const connection = ConnectionService.getInstance(this.context).getConnection(node.serverId);
            if (!connection) {
                throw new Error('Server connection not found');
            }

            // Get job history
            const agentService = AgentService.getInstance();
            const history = await agentService.getJobHistory(connection, node.agent.id);

            if (history.length === 0) {
                vscode.window.showInformationMessage(`No history found for agent: ${node.agent.name}`);
                return;
            }

            // Create webview panel to display history
            const panel = vscode.window.createWebviewPanel(
                'agentHistory',
                `History: ${node.agent.name}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            // Create HTML content for the webview
            panel.webview.html = this.getHistoryWebviewContent(node.agent.name, node.agent.type, history);
        } catch (error) {
            vscode.window.showErrorMessage(`Error viewing agent history: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getHistoryWebviewContent(agentName: string, agentType: string, history: JobHistoryEntry[]): string {
        // Format the history entries as a table
        const tableRows = history.map(entry => {
            // Determine status color
            let statusClass = 'status-unknown';
            if (entry.status === 'Succeeded') {
                statusClass = 'status-success';
            } else if (entry.status === 'Failed') {
                statusClass = 'status-failed';
            } else if (entry.status === 'In Progress') {
                statusClass = 'status-running';
            }

            return `
                <tr>
                    <td>${entry.runDate.toLocaleString()}</td>
                    <td>${entry.stepName}</td>
                    <td class="${statusClass}">${entry.status}</td>
                    <td>${entry.runDuration}</td>
                    <td class="message">${this.escapeHtml(entry.message)}</td>
                </tr>
            `;
        }).join('');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Agent History: ${agentName}</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        padding: 0 20px;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    h1 {
                        color: var(--vscode-editor-foreground);
                    }
                    .header {
                        margin-bottom: 20px;
                        padding-bottom: 10px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .agent-type {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th {
                        text-align: left;
                        padding: 8px;
                        border-bottom: 2px solid var(--vscode-panel-border);
                        color: var(--vscode-editor-foreground);
                    }
                    td {
                        padding: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        vertical-align: top;
                    }
                    .status-success {
                        color: #4CAF50;
                    }
                    .status-failed {
                        color: #F44336;
                    }
                    .status-running {
                        color: #2196F3;
                    }
                    .status-unknown {
                        color: #9E9E9E;
                    }
                    .message {
                        font-family: monospace;
                        white-space: pre-wrap;
                        max-width: 600px;
                        word-break: break-word;
                    }
                    .refresh-button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 12px;
                        cursor: pointer;
                        margin-top: 10px;
                    }
                    .refresh-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>${agentName}</h1>
                    <div class="agent-type">${agentType}</div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Date/Time</th>
                            <th>Step</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </body>
            </html>
        `;
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
} 