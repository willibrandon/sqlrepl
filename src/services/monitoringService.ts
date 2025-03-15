import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';
import { ReplicationLatency, ReplicationHealth, MonitoringConfig, ReplicationAlert, AgentStatus, TracerTokenResult, PublicationStats } from './interfaces/monitoringTypes';

/**
 * Service for monitoring SQL Server replication health and performance.
 * Provides real-time metrics, alerts, and status information.
 */
export class MonitoringService {
    private static instance: MonitoringService;
    private sqlService: SqlService;
    private pollingInterval?: NodeJS.Timeout;
    private tracerTokenInterval?: NodeJS.Timeout;
    private alerts: Map<string, ReplicationAlert>;
    private config: MonitoringConfig;
    private latencyHistory: Map<string, { timestamp: Date; latencySeconds: number }[]>;
    private _onHealthUpdate: vscode.EventEmitter<ReplicationHealth>;

    private constructor() {
        this.sqlService = SqlService.getInstance();
        this.alerts = new Map<string, ReplicationAlert>();
        this.latencyHistory = new Map<string, { timestamp: Date; latencySeconds: number }[]>();
        this._onHealthUpdate = new vscode.EventEmitter<ReplicationHealth>();
        
        // Default configuration
        this.config = {
            maxLatencyWarningThreshold: 300, // 5 minutes
            maxLatencyCriticalThreshold: 900, // 15 minutes
            maxPendingCommandsWarningThreshold: 1000,
            maxPendingCommandsCriticalThreshold: 5000,
            pollingIntervalMs: 60000, // 1 minute
            enableTracerTokens: true,
            tracerTokenIntervalMinutes: 15,
            historyRetentionCount: 100,
            alertRetentionHours: 24
        };
    }

    /**
     * Gets the singleton instance of MonitoringService.
     */
    public static getInstance(): MonitoringService {
        if (!MonitoringService.instance) {
            MonitoringService.instance = new MonitoringService();
        }
        return MonitoringService.instance;
    }

    /**
     * Event that fires when replication health status changes.
     */
    public get onHealthUpdate(): vscode.Event<ReplicationHealth> {
        return this._onHealthUpdate.event;
    }

    /**
     * Updates monitoring configuration.
     */
    public updateConfig(newConfig: Partial<MonitoringConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Restart polling with new interval if it changed
        if (newConfig.pollingIntervalMs && this.pollingInterval) {
            this.stopMonitoring();
            this.startMonitoring();
        }

        // Update tracer token monitoring
        if (newConfig.enableTracerTokens !== undefined || newConfig.tracerTokenIntervalMinutes !== undefined) {
            this.setupTracerTokenMonitoring();
        }
    }

    /**
     * Starts monitoring replication health.
     */
    public startMonitoring(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Initial check
        this.checkHealth();

        // Set up polling interval
        this.pollingInterval = setInterval(() => {
            this.checkHealth();
        }, this.config.pollingIntervalMs);

        // Set up tracer token monitoring
        this.setupTracerTokenMonitoring();
    }

    /**
     * Sets up tracer token monitoring if enabled
     */
    private setupTracerTokenMonitoring(): void {
        if (this.tracerTokenInterval) {
            clearInterval(this.tracerTokenInterval);
            this.tracerTokenInterval = undefined;
        }

        if (this.config.enableTracerTokens) {
            this.tracerTokenInterval = setInterval(() => {
                this.insertAndMonitorTracerTokens();
            }, this.config.tracerTokenIntervalMinutes * 60 * 1000);
        }
    }

    /**
     * Stops monitoring replication health.
     */
    public stopMonitoring(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = undefined;
        }
        if (this.tracerTokenInterval) {
            clearInterval(this.tracerTokenInterval);
            this.tracerTokenInterval = undefined;
        }
    }

    /**
     * Gets detailed agent status information.
     */
    private async getAgentStatus(connection: SqlServerConnection): Promise<AgentStatus[]> {
        try {
            const agents = await this.sqlService.executeQuery<{
                name: string;
                type: string;
                status: number;
                start_time: Date;
                duration: number;
                last_outcome: number;
                error_message: string;
                commands_per_sec: number;
                avg_latency: number;
                memory_mb: number;
                cpu_percent: number;
            }>(connection, `
                USE msdb;
                SELECT 
                    j.name,
                    CASE 
                        WHEN j.name LIKE '%snapshot%' THEN 'Snapshot'
                        WHEN j.name LIKE '%logreader%' THEN 'LogReader'
                        WHEN j.name LIKE '%distribution%' THEN 'Distribution'
                    END as type,
                    ja.run_status as status,
                    ja.start_execution_date as start_time,
                    DATEDIFF(second, ja.start_execution_date, ISNULL(ja.stop_execution_date, GETDATE())) as duration,
                    jh.run_status as last_outcome,
                    jh.message as error_message,
                    p.commands_per_sec,
                    p.avg_latency,
                    p.memory_mb,
                    p.cpu_percent
                FROM sysjobs j
                LEFT JOIN sysjobactivity ja ON j.job_id = ja.job_id
                LEFT JOIN sysjobhistory jh ON j.job_id = jh.job_id
                CROSS APPLY (
                    SELECT 
                        AVG(delivered_commands) as commands_per_sec,
                        AVG(delivery_latency) as avg_latency,
                        AVG(memory_usage) as memory_mb,
                        AVG(cpu_usage) as cpu_percent
                    FROM distribution.dbo.MSrepl_performance_monitoring
                    WHERE agent_id = j.job_id
                    AND collection_time > DATEADD(minute, -5, GETDATE())
                ) p
                WHERE j.category_id = 2 -- Replication category
            `);

            return agents.map(a => ({
                name: a.name,
                type: a.type as 'Snapshot' | 'LogReader' | 'Distribution',
                status: this.mapAgentStatus(a.status),
                lastStartTime: a.start_time,
                lastRunDuration: a.duration,
                lastRunOutcome: this.mapAgentOutcome(a.last_outcome),
                errorMessage: a.error_message,
                performance: {
                    commandsPerSecond: a.commands_per_sec,
                    averageLatency: a.avg_latency,
                    memoryUsageMB: a.memory_mb,
                    cpuUsagePercent: a.cpu_percent
                }
            }));
        } catch (error) {
            console.error('Failed to get agent status:', error);
            return [];
        }
    }

    /**
     * Maps agent status codes to status strings
     */
    private mapAgentStatus(status: number): AgentStatus['status'] {
        switch (status) {
            case 1: return 'Running';
            case 2: return 'Retrying';
            case 3: return 'Completing';
            case 4: return 'Failed';
            default: return 'Stopped';
        }
    }

    /**
     * Maps agent outcome codes to outcome strings
     */
    private mapAgentOutcome(outcome: number): AgentStatus['lastRunOutcome'] {
        switch (outcome) {
            case 1: return 'Succeeded';
            case 0: return 'Failed';
            case 2: return 'Retry';
            case 3: return 'Cancelled';
            default: return 'Failed';
        }
    }

    /**
     * Gets publication statistics
     */
    private async getPublicationStats(connection: SqlServerConnection): Promise<PublicationStats[]> {
        try {
            return await this.sqlService.executeQuery<PublicationStats>(connection, `
                USE distribution;
                SELECT 
                    p.publication_name as name,
                    COUNT(DISTINCT s.subscription_id) as subscriptionCount,
                    COUNT(DISTINCT pa.article_id) as articleCount,
                    SUM(ds.delivered_commands) as totalCommandsDelivered,
                    AVG(ds.average_command_size) as averageCommandSize,
                    MAX(p.retention) as retentionPeriod,
                    AVG(ds.delivery_rate) as transactionsPerSecond
                FROM MSpublications p
                LEFT JOIN MSsubscriptions s ON p.publication_id = s.publication_id
                LEFT JOIN MSarticles pa ON p.publication_id = pa.publication_id
                LEFT JOIN MSdistribution_status ds ON p.publication_id = ds.publication_id
                GROUP BY p.publication_name
            `);
        } catch (error) {
            console.error('Failed to get publication stats:', error);
            return [];
        }
    }

    /**
     * Inserts and monitors tracer tokens
     */
    private async insertAndMonitorTracerTokens(): Promise<void> {
        try {
            const connections = vscode.workspace.getConfiguration('sqlReplication').get<SqlServerConnection[]>('connections', []);
            
            for (const connection of connections) {
                // Insert new tracer tokens for each publication
                const publications = await this.sqlService.executeQuery<{ publication_id: number }>(
                    connection,
                    'SELECT publication_id FROM distribution.dbo.MSpublications'
                );

                for (const pub of publications) {
                    await this.sqlService.executeQuery(
                        connection,
                        `EXEC sp_posttracertoken @publication_id = ${pub.publication_id}`
                    );
                }
            }
        } catch (error) {
            console.error('Failed to insert tracer tokens:', error);
        }
    }

    /**
     * Gets tracer token results
     */
    private async getTracerTokenResults(connection: SqlServerConnection): Promise<TracerTokenResult[]> {
        try {
            const tokens = await this.sqlService.executeQuery<{
                tracer_id: string;
                publication_name: string;
                publisher_commit: Date;
                distributor_commit: Date;
                subscriber_commit: Date;
            }>(connection, `
                USE distribution;
                SELECT 
                    t.tracer_id,
                    p.publication_name,
                    t.publisher_commit,
                    t.distributor_commit,
                    t.subscriber_commit
                FROM MSpublications p
                JOIN MStracer_tokens t ON p.publication_id = t.publication_id
                WHERE t.publisher_commit > DATEADD(hour, -1, GETDATE())
            `);

            return tokens.map(t => ({
                id: t.tracer_id,
                publication: t.publication_name,
                publisherInsertTime: t.publisher_commit,
                distributorInsertTime: t.distributor_commit,
                subscriberInsertTime: t.subscriber_commit,
                totalLatencySeconds: Math.round(
                    (t.subscriber_commit?.getTime() - t.publisher_commit.getTime()) / 1000
                )
            }));
        } catch (error) {
            console.error('Failed to get tracer token results:', error);
            return [];
        }
    }

    /**
     * Gets current replication latency metrics.
     */
    private async getLatencyMetrics(connection: SqlServerConnection): Promise<ReplicationLatency[]> {
        try {
            const metrics = await this.sqlService.executeQuery<{
                publication: string;
                subscriber: string;
                subscriber_db: string;
                latency: number;
                pending_commands: number;
                estimated_completion: number;
                delivery_rate: number;
            }>(connection, `
                USE distribution;
                SELECT 
                    p.publication_name as publication,
                    s.subscriber_server as subscriber,
                    s.subscriber_db,
                    DATEDIFF(second, MIN(entry_time), GETDATE()) as latency,
                    COUNT(*) as pending_commands,
                    CASE 
                        WHEN COUNT(*) > 0 AND AVG(DATEDIFF(second, entry_time, GETDATE())) > 0 
                        THEN COUNT(*) * AVG(DATEDIFF(second, entry_time, GETDATE())) / 60.0 
                        ELSE 0 
                    END as estimated_completion,
                    AVG(ds.delivery_rate) as delivery_rate
                FROM MSdistribution_history h
                JOIN MSdistribution_agents a ON h.agent_id = a.id
                JOIN MSpublications p ON a.publication_id = p.publication_id
                JOIN MSsubscriptions s ON a.subscription_id = s.subscription_id
                LEFT JOIN MSdistribution_status ds ON p.publication_id = ds.publication_id
                WHERE h.delivered_transactions = 0
                GROUP BY p.publication_name, s.subscriber_server, s.subscriber_db
            `);

            const result: ReplicationLatency[] = [];

            for (const metric of metrics) {
                const key = `${metric.publication}-${metric.subscriber}-${metric.subscriber_db}`;
                let history = this.latencyHistory.get(key) || [];
                
                // Add new data point
                history.push({
                    timestamp: new Date(),
                    latencySeconds: metric.latency
                });

                // Trim history to retain only the configured number of points
                if (history.length > this.config.historyRetentionCount) {
                    history = history.slice(-this.config.historyRetentionCount);
                }

                this.latencyHistory.set(key, history);

                result.push({
                    publication: metric.publication,
                    subscriber: metric.subscriber,
                    subscriberDb: metric.subscriber_db,
                    latencySeconds: metric.latency,
                    pendingCommandCount: metric.pending_commands,
                    estimatedTimeToCompletionSeconds: metric.estimated_completion,
                    collectionTime: new Date(),
                    latencyHistory: [...history],
                    deliveryRate: metric.delivery_rate
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to get latency metrics:', error);
            return [];
        }
    }

    /**
     * Checks overall replication health and generates alerts.
     */
    private async checkHealth(): Promise<void> {
        try {
            const connections = vscode.workspace.getConfiguration('sqlReplication').get<SqlServerConnection[]>('connections', []);
            const health: ReplicationHealth = {
                status: 'Healthy',
                alerts: [],
                latencyMetrics: [],
                agents: [],
                agentStatus: { running: 0, stopped: 0, error: 0 },
                tracerTokens: [],
                publicationStats: []
            };

            // Clean up old alerts
            const cutoff = new Date(Date.now() - (this.config.alertRetentionHours * 60 * 60 * 1000));
            for (const [key, alert] of this.alerts.entries()) {
                if (alert.timestamp < cutoff) {
                    this.alerts.delete(key);
                }
            }

            for (const connection of connections) {
                // Get latency metrics
                const metrics = await this.getLatencyMetrics(connection);
                health.latencyMetrics.push(...metrics);

                // Get agent status
                const agents = await this.getAgentStatus(connection);
                health.agents.push(...agents);

                // Update agent status summary
                for (const agent of agents) {
                    if (agent.status === 'Running') {
                        health.agentStatus.running++;
                    } else if (agent.status === 'Failed') {
                        health.agentStatus.error++;
                        this.createAlert('Critical', `Agent ${agent.name} failed: ${agent.errorMessage}`, {
                            agent: agent.name
                        }, 'Error', 'Check the agent error log and restart the agent if necessary.');
                        health.status = 'Critical';
                    } else {
                        health.agentStatus.stopped++;
                    }

                    // Check agent performance
                    if (agent.performance.cpuUsagePercent > 90) {
                        this.createAlert('Warning', `High CPU usage (${agent.performance.cpuUsagePercent}%) for agent ${agent.name}`, {
                            agent: agent.name
                        }, 'Performance', 'Consider optimizing the publication or scaling up the server resources.');
                    }
                }

                // Check metrics against thresholds
                for (const metric of metrics) {
                    if (metric.latencySeconds > this.config.maxLatencyCriticalThreshold) {
                        this.createAlert('Critical', `High replication latency (${Math.round(metric.latencySeconds / 60)} minutes) for publication ${metric.publication}`, {
                            publication: metric.publication,
                            subscriber: metric.subscriber,
                            subscriberDb: metric.subscriberDb
                        }, 'Latency', 'Check network connectivity and agent status. Consider reducing the publication load.');
                        health.status = 'Critical';
                    } else if (metric.latencySeconds > this.config.maxLatencyWarningThreshold) {
                        this.createAlert('Warning', `Elevated replication latency (${Math.round(metric.latencySeconds / 60)} minutes) for publication ${metric.publication}`, {
                            publication: metric.publication,
                            subscriber: metric.subscriber,
                            subscriberDb: metric.subscriberDb
                        }, 'Latency', 'Monitor the situation and prepare to take action if latency continues to increase.');
                        health.status = health.status === 'Critical' ? 'Critical' : 'Warning';
                    }

                    if (metric.pendingCommandCount > this.config.maxPendingCommandsCriticalThreshold) {
                        this.createAlert('Critical', `High number of pending commands (${metric.pendingCommandCount}) for publication ${metric.publication}`, {
                            publication: metric.publication,
                            subscriber: metric.subscriber,
                            subscriberDb: metric.subscriberDb
                        }, 'Performance', 'Check for blocking processes at the subscriber and consider increasing agent resources.');
                        health.status = 'Critical';
                    } else if (metric.pendingCommandCount > this.config.maxPendingCommandsWarningThreshold) {
                        this.createAlert('Warning', `Elevated number of pending commands (${metric.pendingCommandCount}) for publication ${metric.publication}`, {
                            publication: metric.publication,
                            subscriber: metric.subscriber,
                            subscriberDb: metric.subscriberDb
                        }, 'Performance', 'Monitor command backlog and prepare to scale resources if needed.');
                        health.status = health.status === 'Critical' ? 'Critical' : 'Warning';
                    }
                }

                // Get tracer token results
                if (this.config.enableTracerTokens) {
                    const tokens = await this.getTracerTokenResults(connection);
                    health.tracerTokens.push(...tokens);

                    // Check tracer token latency
                    for (const token of tokens) {
                        if (token.totalLatencySeconds > this.config.maxLatencyCriticalThreshold) {
                            this.createAlert('Critical', `High tracer token latency (${Math.round(token.totalLatencySeconds / 60)} minutes) for publication ${token.publication}`, {
                                publication: token.publication
                            }, 'Latency', 'Investigate replication bottlenecks and consider optimization.');
                        }
                    }
                }

                // Get publication statistics
                const stats = await this.getPublicationStats(connection);
                health.publicationStats.push(...stats);
            }

            // Add current alerts to health status
            health.alerts = Array.from(this.alerts.values());

            // Emit health update event
            this._onHealthUpdate.fire(health);

            // Show notifications for new critical alerts
            health.alerts
                .filter(alert => alert.severity === 'Critical')
                .forEach(alert => {
                    vscode.window.showErrorMessage(
                        `${alert.message}\n${alert.recommendedAction || ''}`
                    );
                });
        } catch (error) {
            console.error('Failed to check replication health:', error);
        }
    }

    /**
     * Creates a new alert if one doesn't already exist for the same issue.
     */
    private createAlert(
        severity: 'Warning' | 'Critical',
        message: string,
        source: { publication?: string; subscriber?: string; subscriberDb?: string; agent?: string; },
        category: ReplicationAlert['category'],
        recommendedAction?: string
    ): void {
        const key = `${severity}-${source.publication}-${source.subscriber}-${source.subscriberDb}-${source.agent}`;
        
        if (!this.alerts.has(key)) {
            const alert: ReplicationAlert = {
                id: uuidv4(),
                severity,
                message,
                timestamp: new Date(),
                source,
                category,
                recommendedAction
            };
            this.alerts.set(key, alert);
        }
    }

    /**
     * Clears an alert by ID.
     * 
     * @param alertId - ID of the alert to clear
     */
    public clearAlert(alertId: string): void {
        for (const [key, alert] of this.alerts.entries()) {
            if (alert.id === alertId) {
                this.alerts.delete(key);
                break;
            }
        }
    }

    /**
     * Gets the current monitoring configuration.
     */
    public getConfig(): MonitoringConfig {
        return { ...this.config };
    }
} 