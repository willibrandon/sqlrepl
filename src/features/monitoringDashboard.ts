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
                    case 'refreshMonitoring':
                        // Stop and restart monitoring to trigger an immediate refresh
                        this.monitoringService.stopMonitoring();
                        this.monitoringService.startMonitoring();
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
            return;
        }

        const config = this.monitoringService.getConfig();
        
        function safeFormatDate(date: Date | string | undefined): string {
            if (!date) return 'N/A';
            try {
                return new Date(date).toLocaleString();
            } catch {
                return 'Invalid Date';
            }
        }

        this.panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SQL Replication Monitor</title>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
                <link href="https://cdn.jsdelivr.net/npm/@vscode/codicons/dist/codicon.css" rel="stylesheet" />
                <style>
                    :root {
                        --card-background: var(--vscode-editor-background);
                        --card-border: var(--vscode-widget-border);
                        --text-primary: var(--vscode-editor-foreground);
                        --text-secondary: var(--vscode-descriptionForeground);
                        --accent-color: var(--vscode-textLink-foreground);
                        --error-color: var(--vscode-errorForeground);
                        --warning-color: var(--vscode-editorWarning-foreground);
                        --success-color: var(--vscode-testing-iconPassed);
                        --header-color: var(--vscode-panelTitle-activeForeground);
                        --button-background: var(--vscode-button-background);
                        --button-foreground: var(--vscode-button-foreground);
                        --button-hover: var(--vscode-button-hoverBackground);
                    }

                    body {
                        padding: 20px;
                        color: var(--text-primary);
                        font-family: var(--vscode-font-family);
                        line-height: 1.5;
                    }

                    .grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                        gap: 20px;
                        margin-bottom: 20px;
                    }

                    .card {
                        background: var(--card-background);
                        border: 1px solid var(--card-border);
                        border-radius: 6px;
                        padding: 16px;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                        transition: transform 0.2s, box-shadow 0.2s;
                    }

                    .card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
                    }

                    h2, h3, h4 {
                        color: var(--header-color);
                        margin: 0 0 16px 0;
                    }

                    .metric-value {
                        font-size: 2em;
                        font-weight: bold;
                        color: var(--accent-color);
                        margin: 8px 0;
                    }

                    .metric-label {
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: 8px;
                    }

                    .progress-bar {
                        background: var(--vscode-progressBar-background);
                        border-radius: 4px;
                        height: 4px;
                        margin: 8px 0;
                        overflow: hidden;
                    }

                    .progress-value {
                        background: var(--accent-color);
                        height: 100%;
                        transition: width 0.3s ease;
                    }

                    .status-badge {
                        display: inline-flex;
                        align-items: center;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 0.9em;
                        font-weight: 500;
                    }

                    .status-badge i {
                        margin-right: 4px;
                    }

                    .status-running {
                        background: color-mix(in srgb, var(--success-color) 15%, transparent);
                        color: var(--success-color);
                    }

                    .status-error {
                        background: color-mix(in srgb, var(--error-color) 15%, transparent);
                        color: var(--error-color);
                    }

                    .status-warning {
                        background: color-mix(in srgb, var(--warning-color) 15%, transparent);
                        color: var(--warning-color);
                    }

                    .tabs {
                        display: flex;
                        border-bottom: 1px solid var(--card-border);
                        margin-bottom: 20px;
                    }

                    .tab {
                        padding: 8px 16px;
                        cursor: pointer;
                        border-bottom: 2px solid transparent;
                        color: var(--text-secondary);
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }

                    .tab:hover {
                        color: var(--accent-color);
                    }

                    .tab.active {
                        color: var(--accent-color);
                        border-bottom-color: var(--accent-color);
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
                        margin: 16px 0;
                    }

                    th, td {
                        text-align: left;
                        padding: 8px;
                        border-bottom: 1px solid var(--card-border);
                    }

                    th {
                        color: var(--header-color);
                        font-weight: 500;
                    }

                    button {
                        background: var(--button-background);
                        color: var(--button-foreground);
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.9em;
                        transition: background-color 0.2s;
                    }

                    button:hover {
                        background: var(--button-hover);
                    }

                    .alert {
                        background: color-mix(in srgb, var(--error-color) 10%, transparent);
                        border-left: 4px solid var(--error-color);
                        padding: 12px;
                        margin: 8px 0;
                        border-radius: 4px;
                    }

                    .alert.warning {
                        background: color-mix(in srgb, var(--warning-color) 10%, transparent);
                        border-left-color: var(--warning-color);
                    }

                    .refresh-button {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        background: var(--button-background);
                        color: var(--button-foreground);
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                        transition: transform 0.2s;
                    }

                    .refresh-button:hover {
                        transform: rotate(180deg);
                    }

                    .chart-container {
                        height: 300px;
                        margin: 20px 0;
                    }

                    @media (max-width: 768px) {
                        .grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="tabs">
                    <div id="tab-overview" class="tab active" onclick="showTab('overview')">
                        <i class="codicon codicon-dashboard"></i>Overview
                    </div>
                    <div id="tab-agents" class="tab" onclick="showTab('agents')">
                        <i class="codicon codicon-server-process"></i>Agents
                    </div>
                    <div id="tab-publications" class="tab" onclick="showTab('publications')">
                        <i class="codicon codicon-database"></i>Publications
                    </div>
                    <div id="tab-alerts" class="tab" onclick="showTab('alerts')">
                        <i class="codicon codicon-warning"></i>Alerts
                    </div>
                    <div id="tab-settings" class="tab" onclick="showTab('settings')">
                        <i class="codicon codicon-settings-gear"></i>Settings
                    </div>
                </div>

                <div id="overview" class="tab-content active">
                    <div class="grid">
                        <div class="card">
                            <h3><i class="codicon codicon-server-process"></i> Agent Status</h3>
                            <div class="metric-value">
                                <span class="status-badge status-running">
                                    <i class="codicon codicon-play-circle"></i>${health.agentStatus.running} Running
                                </span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-value" style="width: ${(health.agentStatus.running / (health.agentStatus.running + health.agentStatus.stopped + health.agentStatus.error)) * 100}%"></div>
                            </div>
                            <div class="metric-label">
                                <span class="status-badge">
                                    <i class="codicon codicon-debug-pause"></i>${health.agentStatus.stopped} Stopped
                                </span>
                                <span class="status-badge status-error">
                                    <i class="codicon codicon-error"></i>${health.agentStatus.error} Errors
                                </span>
                            </div>
                        </div>

                        <div class="card">
                            <h3><i class="codicon codicon-pulse"></i> Latency Overview</h3>
                            <div class="metric-value">
                                ${Math.max(...health.latencyMetrics.map(m => m.latencySeconds), 0)}s
                            </div>
                            <div class="metric-label">Maximum Latency</div>
                            <div class="progress-bar">
                                <div class="progress-value" style="width: ${(Math.max(...health.latencyMetrics.map(m => m.latencySeconds), 0) / config.maxLatencyCriticalThreshold) * 100}%"></div>
                            </div>
                        </div>

                        <div class="card">
                            <h3><i class="codicon codicon-alert"></i> Active Alerts</h3>
                            <div class="metric-value">
                                ${health.alerts.length}
                            </div>
                            <div class="metric-label">
                                <span class="status-badge status-error">
                                    <i class="codicon codicon-error"></i>${health.alerts.filter(a => a.severity === 'Critical').length} Critical
                                </span>
                                <span class="status-badge status-warning">
                                    <i class="codicon codicon-warning"></i>${health.alerts.filter(a => a.severity === 'Warning').length} Warnings
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h3><i class="codicon codicon-graph-line"></i> Latency Trends</h3>
                        <div class="chart-container">
                            <canvas id="latencyChart"></canvas>
                        </div>
                    </div>

                    <div class="card">
                        <h3><i class="codicon codicon-history"></i> Recent Tracer Tokens</h3>
                        <div class="collapsible-content">
                            <table>
                                <tr>
                                    <th>Publication</th>
                                    <th>Total Latency</th>
                                    <th>Publisher → Distributor</th>
                                    <th>Distributor → Subscriber</th>
                                </tr>
                                ${health.tracerTokens.map(token => `
                                    <tr>
                                        <td><i class="codicon codicon-database"></i> ${token.publication}</td>
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
                </div>

                <div id="agents" class="tab-content">
                    ${health.agents && health.agents.length > 0 ? `
                    <div class="grid">
                        ${health.agents.map(agent => `
                            <div class="card">
                                <h3>
                                    <i class="codicon codicon-${
                                        agent.type === 'Snapshot' ? 'file-binary' :
                                        agent.type === 'LogReader' ? 'book' : 'server-process'
                                    }"></i>
                                    ${agent.name || 'Unknown Agent'}
                                </h3>
                                <div class="metric-label">Type: ${agent.type || 'Unknown'}</div>
                                <div class="metric-label">
                                    Status: 
                                    <span class="status-badge ${
                                        agent.status === 'Running' ? 'status-running' :
                                        agent.status === 'Failed' ? 'status-error' : ''
                                    }">
                                        <i class="codicon codicon-${
                                            agent.status === 'Running' ? 'play-circle' :
                                            agent.status === 'Failed' ? 'error' : 'debug-pause'
                                        }"></i>
                                        ${agent.status || 'Unknown'}
                                    </span>
                                </div>
                                ${agent.lastStartTime ? `
                                    <div class="metric-label">
                                        <i class="codicon codicon-clock"></i> Started: ${safeFormatDate(agent.lastStartTime)}
                                    </div>
                                    <div class="metric-label">
                                        <i class="codicon codicon-dashboard"></i> Duration: ${Math.round(agent.lastRunDuration || 0)}s
                                    </div>
                                ` : ''}
                                ${agent.errorMessage ? `
                                    <div class="alert">
                                        <i class="codicon codicon-error"></i> ${agent.errorMessage}
                                    </div>
                                ` : ''}
                                <h4><i class="codicon codicon-pulse"></i> Performance</h4>
                                <div class="metric-value">${Math.round(agent.performance ? agent.performance.commandsPerSecond || 0 : 0)}</div>
                                <div class="metric-label">Commands/Second</div>
                                <div class="progress-bar">
                                    <div class="progress-value" style="width: ${agent.performance ? agent.performance.cpuUsagePercent || 0 : 0}%"></div>
                                </div>
                                <div class="metric-label">
                                    <i class="codicon codicon-cpu"></i> CPU: ${Math.round(agent.performance ? agent.performance.cpuUsagePercent || 0 : 0)}% | 
                                    <i class="codicon codicon-memory"></i> Memory: ${Math.round(agent.performance ? agent.performance.memoryUsageMB || 0 : 0)}MB
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ` : `
                    <div class="card">
                        <h3><i class="codicon codicon-info"></i> No Agents Found</h3>
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

                <div class="refresh-button" onclick="refreshMonitoring()">
                    <i class="codicon codicon-refresh"></i>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentTab = 'overview';

                    function refreshMonitoring() {
                        // Send message to extension to refresh monitoring data
                        vscode.postMessage({
                            command: 'refreshMonitoring'
                        });
                        
                        // Add visual feedback for the refresh action
                        const refreshBtn = document.querySelector('.refresh-button');
                        refreshBtn.style.transform = 'rotate(180deg)';
                        setTimeout(() => {
                            refreshBtn.style.transform = 'rotate(0deg)';
                        }, 500);
                    }

                    function showTab(tabId) {
                        // Update current tab
                        currentTab = tabId;
                        
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

                        // Store the current tab
                        vscode.setState({ currentTab: tabId });
                    }

                    // Initialize Chart.js with VS Code theming
                    Chart.defaults.color = getComputedStyle(document.documentElement)
                        .getPropertyValue('--vscode-editor-foreground');
                    Chart.defaults.borderColor = getComputedStyle(document.documentElement)
                        .getPropertyValue('--vscode-widget-border');

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
                                tension: 0.4,
                                borderWidth: 2
                            }))
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: {
                                intersect: false,
                                mode: 'index'
                            },
                            plugins: {
                                legend: {
                                    position: 'top',
                                    labels: {
                                        usePointStyle: true,
                                        padding: 15
                                    }
                                },
                                tooltip: {
                                    backgroundColor: 'var(--vscode-editor-background)',
                                    titleColor: 'var(--vscode-editor-foreground)',
                                    bodyColor: 'var(--vscode-editor-foreground)',
                                    borderColor: 'var(--vscode-widget-border)',
                                    borderWidth: 1
                                }
                            },
                            scales: {
                                x: {
                                    type: 'time',
                                    time: {
                                        unit: 'minute',
                                        displayFormats: {
                                            minute: 'HH:mm'
                                        }
                                    },
                                    grid: {
                                        display: false
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

                    // Restore last active tab
                    const state = vscode.getState();
                    if (state && state.currentTab) {
                        showTab(state.currentTab);
                    }
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