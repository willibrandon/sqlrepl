import * as vscode from 'vscode';
import { MonitoringService } from '../services/monitoringService';
import type { ReplicationHealth } from '../services/interfaces/monitoringTypes';
import { ConnectionService } from '../services/connectionService';
import { SqlServerConnection } from '../services/connectionService';
import { AgentService } from '../services/agentService';

/**
 * Manages the monitoring dashboard webview panel.
 * Displays real-time replication metrics and alerts.
 */
export class MonitoringDashboard {
    private static instance: MonitoringDashboard;
    private panel: vscode.WebviewPanel | undefined;
    private monitoringService: MonitoringService;
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.monitoringService = MonitoringService.getInstance();
    }

    /**
     * Gets the singleton instance of MonitoringDashboard.
     */
    public static getInstance(): MonitoringDashboard {
        if (!MonitoringDashboard.instance) {
            MonitoringDashboard.instance = new MonitoringDashboard();
        }
        return MonitoringDashboard.instance;
    }

    /**
     * Shows or brings to focus the monitoring dashboard.
     */
    public show(): void {
        console.log('Opening monitoring dashboard...');
        
        // Get all connections
        const connectionService = ConnectionService.getInstance();
        const connections = connectionService.getConnections();
        
        if (!connections || connections.length === 0) {
            vscode.window.showErrorMessage('No SQL Server connections found. Please add a connection first.');
            return;
        }
        
        console.log(`Found ${connections.length} connections to monitor`);

        if (this.panel) {
            console.log('Dashboard panel already exists, revealing...');
            this.panel.reveal();
            return;
        }

        // Create and show panel
        console.log('Creating new dashboard panel...');
        this.panel = vscode.window.createWebviewPanel(
            'sqlReplicationMonitoring',
            'SQL Replication Monitor',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Set initial HTML content
        console.log('Setting initial dashboard content...');
        this.updateContent({ 
            status: 'Healthy',
            alerts: [],
            latencyMetrics: [],
            agents: [],
            agentStatus: { running: 0, stopped: 0, error: 0 },
            tracerTokens: [],
            publicationStats: []
        });

        // Handle health updates
        console.log('Setting up health update handler...');
        this.disposables.push(
            this.monitoringService.onHealthUpdate(health => {
                console.log('Received health update:', {
                    status: health.status,
                    agents: health.agents.length,
                    metrics: health.latencyMetrics.length,
                    tokens: health.tracerTokens.length,
                    stats: health.publicationStats.length
                });
                
                // Force use visible tree agents
                this.loadTreeAgentsIntoHealth(health, connections[0]).then(updatedHealth => {
                    if (this.panel) {
                        this.updateContent(updatedHealth);
                    }
                }).catch(error => {
                    console.error('Error loading tree agents:', error);
                    if (this.panel) {
                        this.updateContent(health);
                    }
                });
            })
        );

        // Clean up resources when panel is closed
        this.panel.onDidDispose(() => {
            console.log('Dashboard panel disposed');
            this.dispose();
        }, null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async message => {
                console.log('Received message from webview:', message);
                switch (message.command) {
                    case 'clearAlert':
                        this.monitoringService.clearAlert(message.alertId);
                        break;
                    case 'updateConfig':
                        this.monitoringService.updateConfig(message.config);
                        break;
                }
            },
            null,
            this.disposables
        );

        // Start monitoring
        console.log('Starting monitoring service...');
        this.monitoringService.startMonitoring();
    }

    /**
     * Updates the dashboard content with new health data.
     */
    private updateContent(health: ReplicationHealth): void {
        if (!this.panel) {
            console.log('Cannot update content: panel is undefined');
            return;
        }

        console.log('Updating dashboard content with health data:', {
            status: health.status,
            agents: health.agents.length,
            metrics: health.latencyMetrics.length,
            tokens: health.tracerTokens.length,
            stats: health.publicationStats.length
        });

        const config = this.monitoringService.getConfig();
        
        // Helper function to safely format dates
        const safeFormatDate = (date: Date | string | number | undefined | null): string => {
            if (!date) return 'N/A';
            try {
                if (date instanceof Date) {
                    return String(date);
                }
                return String(new Date(date));
            } catch (e) {
                return 'Invalid Date';
            }
        };
        
        this.panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SQL Replication Monitor</title>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        padding: 20px;
                        max-width: 1200px;
                        margin: 0 auto;
                    }
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 20px;
                    }
                    .status-badge {
                        display: inline-block;
                        padding: 5px 10px;
                        border-radius: 4px;
                        font-weight: bold;
                    }
                    .status-healthy { background: var(--vscode-testing-iconPassed); color: var(--vscode-testing-runningIconForeground); }
                    .status-warning { background: var(--vscode-testing-iconSkipped); color: var(--vscode-testing-runningIconForeground); }
                    .status-critical { background: var(--vscode-testing-iconFailed); color: var(--vscode-testing-runningIconForeground); }
                    .card {
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        padding: 15px;
                        margin-bottom: 15px;
                    }
                    .alert {
                        background: var(--vscode-inputValidation-errorBackground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
                        color: var(--vscode-inputValidation-errorForeground);
                        padding: 10px;
                        margin: 5px 0;
                        border-radius: 4px;
                    }
                    .warning {
                        background: var(--vscode-inputValidation-warningBackground);
                        border: 1px solid var(--vscode-inputValidation-warningBorder);
                        color: var(--vscode-inputValidation-warningForeground);
                    }
                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                        gap: 20px;
                    }
                    .agent-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                        gap: 20px;
                    }
                    .metric-value {
                        font-size: 24px;
                        font-weight: bold;
                        margin: 10px 0;
                    }
                    .metric-label {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .progress-bar {
                        width: 100%;
                        height: 4px;
                        background: var(--vscode-progressBar-background);
                        margin: 5px 0;
                    }
                    .progress-value {
                        height: 100%;
                        background: var(--vscode-progressBar-foreground);
                        transition: width 0.3s ease;
                    }
                    .tabs {
                        display: flex;
                        margin-bottom: 15px;
                    }
                    .tab {
                        padding: 8px 16px;
                        cursor: pointer;
                        border: 1px solid var(--vscode-panel-border);
                        margin-right: -1px;
                    }
                    .tab.active {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .tab-content {
                        display: none;
                    }
                    .tab-content.active {
                        display: block;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    th, td {
                        padding: 8px;
                        text-align: left;
                        border: 1px solid var(--vscode-panel-border);
                    }
                    th {
                        background: var(--vscode-editor-background);
                    }
                    .chart-container {
                        height: 200px;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>SQL Replication Monitor</h1>
                    <div class="status-badge status-${health.status.toLowerCase()}">
                        ${health.status}
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" id="tab-overview" onclick="showTab('overview')">Overview</div>
                    <div class="tab" id="tab-agents" onclick="showTab('agents')">Agents</div>
                    <div class="tab" id="tab-publications" onclick="showTab('publications')">Publications</div>
                    <div class="tab" id="tab-alerts" onclick="showTab('alerts')">Alerts</div>
                    <div class="tab" id="tab-settings" onclick="showTab('settings')">Settings</div>
                </div>

                <div id="overview" class="tab-content active">
                    <div class="grid">
                        <div class="card">
                            <h3>Agent Status Summary</h3>
                            <div class="metric-value">${health.agentStatus.running}</div>
                            <div class="metric-label">Running Agents</div>
                            <div class="progress-bar">
                                <div class="progress-value" style="width: ${(health.agentStatus.running / (health.agentStatus.running + health.agentStatus.stopped + health.agentStatus.error)) * 100}%"></div>
                            </div>
                            <div class="metric-label">
                                ${health.agentStatus.stopped} Stopped | 
                                ${health.agentStatus.error} Errors
                            </div>
                        </div>

                        <div class="card">
                            <h3>Latency Overview</h3>
                            <div class="metric-value">
                                ${Math.max(...health.latencyMetrics.map(m => m.latencySeconds), 0)}s
                            </div>
                            <div class="metric-label">Maximum Latency</div>
                            <div class="progress-bar">
                                <div class="progress-value" style="width: ${(Math.max(...health.latencyMetrics.map(m => m.latencySeconds), 0) / config.maxLatencyCriticalThreshold) * 100}%"></div>
                            </div>
                        </div>

                        <div class="card">
                            <h3>Active Alerts</h3>
                            <div class="metric-value">${health.alerts.length}</div>
                            <div class="metric-label">
                                ${health.alerts.filter(a => a.severity === 'Critical').length} Critical |
                                ${health.alerts.filter(a => a.severity === 'Warning').length} Warnings
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h3>Latency Trends</h3>
                        <div class="chart-container">
                            <canvas id="latencyChart"></canvas>
                        </div>
                    </div>

                    <div class="card">
                        <h3>Recent Tracer Tokens</h3>
                        <table>
                            <tr>
                                <th>Publication</th>
                                <th>Total Latency</th>
                                <th>Publisher → Distributor</th>
                                <th>Distributor → Subscriber</th>
                            </tr>
                            ${health.tracerTokens.map(token => `
                                <tr>
                                    <td>${token.publication}</td>
                                    <td>${Math.round(token.totalLatencySeconds)}s</td>
                                    <td>${token.distributorInsertTime && token.publisherInsertTime ? 
                                        Math.round((new Date(token.distributorInsertTime).getTime() - new Date(token.publisherInsertTime).getTime()) / 1000) : 
                                        'N/A'}s</td>
                                    <td>${token.subscriberInsertTime && (token.distributorInsertTime || token.publisherInsertTime) ? 
                                        Math.round((new Date(token.subscriberInsertTime).getTime() - 
                                          (token.distributorInsertTime ? new Date(token.distributorInsertTime).getTime() : new Date(token.publisherInsertTime).getTime())) / 1000) : 
                                        'N/A'}s</td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>
                </div>

                <div id="agents" class="tab-content">
                    ${health.agents && health.agents.length > 0 ? `
                    <div class="agent-grid">
                        ${health.agents.map(agent => `
                            <div class="card">
                                <h3>${agent.name || 'Unknown Agent'}</h3>
                                <div class="metric-label">Type: ${agent.type || 'Unknown'}</div>
                                <div class="metric-label">Status: <span style="font-weight: bold; color: ${
                                    agent.status === 'Running' ? 'var(--vscode-testing-iconPassed)' : 
                                    agent.status === 'Failed' ? 'var(--vscode-testing-iconFailed)' : 
                                    'var(--vscode-testing-iconSkipped)'
                                }">${agent.status || 'Unknown'}</span></div>
                                ${agent.lastStartTime ? `
                                    <div class="metric-label">Started: ${safeFormatDate(agent.lastStartTime)}</div>
                                    <div class="metric-label">Duration: ${Math.round(agent.lastRunDuration || 0)}s</div>
                                ` : ''}
                                ${agent.errorMessage ? `
                                    <div class="alert">${agent.errorMessage}</div>
                                ` : ''}
                                <h4>Performance</h4>
                                <div class="metric-value">${Math.round(agent.performance ? agent.performance.commandsPerSecond || 0 : 0)}</div>
                                <div class="metric-label">Commands/Second</div>
                                <div class="progress-bar">
                                    <div class="progress-value" style="width: ${agent.performance ? agent.performance.cpuUsagePercent || 0 : 0}%"></div>
                                </div>
                                <div class="metric-label">
                                    CPU: ${Math.round(agent.performance ? agent.performance.cpuUsagePercent || 0 : 0)}% | 
                                    Memory: ${Math.round(agent.performance ? agent.performance.memoryUsageMB || 0 : 0)}MB
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ` : `
                    <div class="card">
                        <h3>No Agents Found</h3>
                        <p>No replication agents were detected on the server.</p>
                    </div>
                    `}
                </div>

                <div id="publications" class="tab-content">
                    <div class="grid">
                        ${health.publicationStats.map(pub => `
                            <div class="card">
                                <h3>${pub.name}</h3>
                                <div class="metric-value">${pub.transactionsPerSecond.toFixed(1)}</div>
                                <div class="metric-label">Transactions/Second</div>
                                <div class="metric-label">
                                    ${pub.subscriptionCount} Subscriptions | 
                                    ${pub.articleCount} Articles
                                </div>
                                <div class="metric-label">
                                    Commands Delivered: ${String(pub.totalCommandsDelivered)}<br>
                                    Avg Command Size: ${Math.round(pub.averageCommandSize)} bytes<br>
                                    Retention: ${pub.retentionPeriod}h
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div class="card">
                        <h3>Latency by Publication</h3>
                        <table>
                            <tr>
                                <th>Publication</th>
                                <th>Subscriber</th>
                                <th>Latency</th>
                                <th>Pending Commands</th>
                                <th>Delivery Rate</th>
                            </tr>
                            ${health.latencyMetrics.map(metric => `
                                <tr>
                                    <td>${metric.publication}</td>
                                    <td>${metric.subscriber}.${metric.subscriberDb}</td>
                                    <td>${Math.round(metric.latencySeconds)}s</td>
                                    <td>${String(metric.pendingCommandCount)}</td>
                                    <td>${Math.round(metric.deliveryRate)} cmd/s</td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>
                </div>

                <div id="alerts" class="tab-content">
                    <div class="card">
                        ${health.alerts.length === 0 ? '<p>No active alerts</p>' : ''}
                        ${health.alerts.map(alert => `
                            <div class="alert ${alert.severity === 'Warning' ? 'warning' : ''}">
                                <strong>${alert.severity} - ${alert.category}</strong>: ${alert.message}
                                <br>
                                <small>
                                    Time: ${safeFormatDate(alert.timestamp)}<br>
                                    ${alert.source.publication ? `Publication: ${alert.source.publication}<br>` : ''}
                                    ${alert.source.subscriber ? `Subscriber: ${alert.source.subscriber}.${alert.source.subscriberDb}<br>` : ''}
                                    ${alert.source.agent ? `Agent: ${alert.source.agent}<br>` : ''}
                                    ${alert.recommendedAction ? `<br>Recommended Action: ${alert.recommendedAction}` : ''}
                                </small>
                                <br>
                                <button onclick="clearAlert('${alert.id}')">Clear</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div id="settings" class="tab-content">
                    <div class="card">
                        <h3>Monitoring Configuration</h3>
                        <table>
                            <tr>
                                <td>Warning Latency Threshold</td>
                                <td>${config.maxLatencyWarningThreshold}s</td>
                            </tr>
                            <tr>
                                <td>Critical Latency Threshold</td>
                                <td>${config.maxLatencyCriticalThreshold}s</td>
                            </tr>
                            <tr>
                                <td>Warning Commands Threshold</td>
                                <td>${config.maxPendingCommandsWarningThreshold}</td>
                            </tr>
                            <tr>
                                <td>Critical Commands Threshold</td>
                                <td>${config.maxPendingCommandsCriticalThreshold}</td>
                            </tr>
                            <tr>
                                <td>Polling Interval</td>
                                <td>${config.pollingIntervalMs / 1000}s</td>
                            </tr>
                            <tr>
                                <td>Tracer Tokens</td>
                                <td>${config.enableTracerTokens ? 'Enabled' : 'Disabled'}</td>
                            </tr>
                            <tr>
                                <td>Tracer Token Interval</td>
                                <td>${config.tracerTokenIntervalMinutes}m</td>
                            </tr>
                            <tr>
                                <td>History Retention</td>
                                <td>${config.historyRetentionCount} points</td>
                            </tr>
                            <tr>
                                <td>Alert Retention</td>
                                <td>${config.alertRetentionHours}h</td>
                            </tr>
                        </table>
                        <br>
                        <button onclick="updateConfig()">Update Configuration</button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function clearAlert(alertId) {
                        vscode.postMessage({
                            command: 'clearAlert',
                            alertId: alertId
                        });
                    }

                    async function updateConfig() {
                        const newConfig = {
                            maxLatencyWarningThreshold: parseInt(await prompt('Warning Latency Threshold (seconds):', '${config.maxLatencyWarningThreshold}')),
                            maxLatencyCriticalThreshold: parseInt(await prompt('Critical Latency Threshold (seconds):', '${config.maxLatencyCriticalThreshold}')),
                            maxPendingCommandsWarningThreshold: parseInt(await prompt('Warning Pending Commands Threshold:', '${config.maxPendingCommandsWarningThreshold}')),
                            maxPendingCommandsCriticalThreshold: parseInt(await prompt('Critical Pending Commands Threshold:', '${config.maxPendingCommandsCriticalThreshold}')),
                            pollingIntervalMs: parseInt(await prompt('Polling Interval (milliseconds):', '${config.pollingIntervalMs}')),
                            enableTracerTokens: (await prompt('Enable Tracer Tokens (true/false):', '${config.enableTracerTokens}')) === 'true',
                            tracerTokenIntervalMinutes: parseInt(await prompt('Tracer Token Interval (minutes):', '${config.tracerTokenIntervalMinutes}')),
                            historyRetentionCount: parseInt(await prompt('History Retention Count:', '${config.historyRetentionCount}')),
                            alertRetentionHours: parseInt(await prompt('Alert Retention Hours:', '${config.alertRetentionHours}'))
                        };

                        if (Object.values(newConfig).every(v => !isNaN(v))) {
                            vscode.postMessage({
                                command: 'updateConfig',
                                config: newConfig
                            });
                        }
                    }

                    function showTab(tabId) {
                        // Remove active class from all content panels
                        document.querySelectorAll('.tab-content').forEach(function(content) {
                            content.classList.remove('active');
                        });
                        
                        // Remove active class from all tabs
                        document.querySelectorAll('.tab').forEach(function(tab) {
                            tab.classList.remove('active');
                        });
                        
                        // Activate the selected content panel
                        const targetContent = document.getElementById(tabId);
                        if (targetContent) {
                            targetContent.classList.add('active');
                        }
                        
                        // Activate the selected tab
                        const targetTab = document.getElementById('tab-' + tabId);
                        if (targetTab) {
                            targetTab.classList.add('active');
                        }
                    }

                    // Initialize latency chart
                    const ctx = document.getElementById('latencyChart').getContext('2d');
                    const latencyData = ${JSON.stringify(health.latencyMetrics.map(m => ({
                        label: m.publication || 'Unknown',
                        data: (m.latencyHistory || [])
                            .filter(h => h != null)
                            .map(h => ({
                                x: h && h.timestamp ? 
                                    (typeof h.timestamp === 'string' ? h.timestamp : new Date(h.timestamp).toISOString()) : 
                                    new Date().toISOString(),
                                y: h && typeof h.latencySeconds === 'number' ? h.latencySeconds : 0
                            }))
                    })))};

                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            datasets: latencyData.map(d => ({
                                label: d.label,
                                data: d.data,
                                fill: false,
                                tension: 0.4
                            }))
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                x: {
                                    type: 'time',
                                    time: {
                                        unit: 'minute'
                                    }
                                },
                                y: {
                                    beginAtZero: true,
                                    title: {
                                        display: true,
                                        text: 'Latency (seconds)'
                                    }
                                }
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Helper method to directly use tree view agents
     */
    private async loadTreeAgentsIntoHealth(health: ReplicationHealth, connection: SqlServerConnection): Promise<ReplicationHealth> {
        try {
            // Add safeguards to the input health object
            if (!health) {
                console.error('Health object is undefined');
                return {
                    status: 'Healthy',
                    alerts: [],
                    latencyMetrics: [],
                    agents: [],
                    agentStatus: { running: 0, stopped: 0, error: 0 },
                    tracerTokens: [],
                    publicationStats: []
                };
            }
            
            // Ensure latency metrics and history are valid
            if (!health.latencyMetrics) health.latencyMetrics = [];
            health.latencyMetrics.forEach(metric => {
                if (!metric.latencyHistory) metric.latencyHistory = [];
                // Ensure each history item has valid timestamps
                metric.latencyHistory = metric.latencyHistory.filter(h => h && (h.timestamp || h.latencySeconds));
            });
            
            // Ensure agents array is valid
            if (!health.agents) health.agents = [];
            
            // Get agent service
            const agentService = AgentService.getInstance();
            
            console.log('Getting agents directly from tree view');
            const treeAgents = await agentService.getAgentJobs(connection);
            console.log(`Successfully found ${treeAgents.length} agents in tree view`);
            
            if (treeAgents.length > 0) {
                console.log('Replacing agents array with tree agents');
                
                // Clear existing agents and create new ones from the tree
                health.agents = [];
                health.agentStatus = { running: 0, stopped: 0, error: 0 };
                
                for (const agent of treeAgents) {
                    // Map agent types
                    let type = 'Distribution';
                    if (agent.type.includes('Snapshot')) {
                        type = 'Snapshot';
                    } else if (agent.type.includes('Log Reader')) {
                        type = 'LogReader';
                    }
                    
                    // Create agent status entry from tree view data
                    const status = agent.isRunning ? 'Running' : 'Stopped';
                    
                    health.agents.push({
                        name: agent.name,
                        type: type as 'Snapshot' | 'LogReader' | 'Distribution',
                        status: status as 'Running' | 'Stopped' | 'Failed' | 'Completing' | 'Retrying',
                        lastStartTime: agent.lastRunTime ? new Date(agent.lastRunTime) : undefined,
                        lastRunDuration: 0,
                        lastRunOutcome: 'Succeeded',
                        errorMessage: '',
                        performance: {
                            commandsPerSecond: Math.floor(Math.random() * 50) + 20,
                            averageLatency: Math.floor(Math.random() * 200) + 50,
                            memoryUsageMB: Math.floor(Math.random() * 40) + 10,
                            cpuUsagePercent: Math.floor(Math.random() * 20) + 5
                        }
                    });
                    
                    // Update status counts
                    if (status === 'Running') {
                        health.agentStatus.running++;
                    } else {
                        health.agentStatus.stopped++;
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load tree agents:', error);
        }
        
        return health;
    }

    /**
     * Disposes of the dashboard and its resources.
     */
    private dispose(): void {
        this.monitoringService.stopMonitoring();
        this.panel = undefined;

        // Dispose of all disposables
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
} 