import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';
import { ReplicationLatency, ReplicationHealth, MonitoringConfig, ReplicationAlert, AgentStatus, TracerTokenResult, PublicationStats } from './interfaces/monitoringTypes';
import { ConnectionService } from './connectionService';
import { AgentType } from './agentService';

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
            maxPendingCommandsWarningThreshold: 10000,
            maxPendingCommandsCriticalThreshold: 50000,
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
        
        // Restart monitoring with new config
        this.stopMonitoring();
        this.startMonitoring();
    }

    /**
     * Starts monitoring replication health.
     */
    public startMonitoring(): void {
        console.log('Starting monitoring service...');
        
        // Clear any existing intervals
        this.stopMonitoring();
        
        // Initial check
        void this.checkHealth();
        
        // Set up polling interval
        this.pollingInterval = setInterval(() => {
            void this.checkHealth();
        }, this.config.pollingIntervalMs);
        
        // Set up tracer token monitoring
        this.setupTracerTokenMonitoring();
    }

    /**
     * Sets up tracer token monitoring if enabled
     */
    private setupTracerTokenMonitoring(): void {
        if (this.config.enableTracerTokens) {
            this.tracerTokenInterval = setInterval(() => {
                void this.insertAndMonitorTracerTokens();
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
            const agents: AgentStatus[] = [];

            // Get publisher information using supported stored procedure
            const publishers = await this.sqlService.executeQuery<{
                publisher: string;
                publisher_db: string;
            }>(connection, `
                EXEC distribution.dbo.sp_replmonitorhelppublisher
            `);

            // Process each publisher
            for (const pub of publishers) {
                // Get publication info including agent status
                const publications = await this.sqlService.executeQuery<{
                    publication: string;
                    agent_name: string;
                    status: number;
                    warning: number;
                    subscriber: string;
                    subscriber_db: string;
                    publisher_db: string;
                    last_distsync: Date;
                    distribution_agent_job_id: string;
                    mergeagent_jobid: string;
                    last_agent_message: string;
                }>(connection, `
                    EXEC distribution.dbo.sp_replmonitorhelppublication 
                    @publisher = '${pub.publisher}',
                    @publisher_db = '${pub.publisher_db}'
                `);

                // Get distribution agent information
                const distAgents = await this.sqlService.executeQuery<{
                    agent_id: number;
                    name: string;
                    publication: string;
                    publisher_db: string;
                    job_id: string;
                    profile_id: number;
                    status: number;
                    start_time: Date;
                    duration: number;
                    last_message: string;
                    delivery_rate: number;
                    delivery_latency: number;
                    delivered_transactions: number;
                    delivered_commands: number;
                }>(connection, `
                    EXEC distribution.dbo.sp_replmonitorhelpsubscription
                    @publisher = '${pub.publisher}',
                    @publisher_db = '${pub.publisher_db}',
                    @publication_type = 0,
                    @mode = 0
                `);

                // Create agent entries for each publication
                for (const pubInfo of publications) {
                    // Create snapshot agent status
                    const snapshotAgentName = `${pubInfo.publisher_db} ${pubInfo.publication} Snapshot`;
                    agents.push({
                        name: snapshotAgentName,
                        type: this.mapAgentType(AgentType.SnapshotAgent),
                        status: this.mapStatus(pubInfo.status),
                        lastStartTime: undefined,
                        lastRunDuration: 0,
                        lastRunOutcome: this.mapRunOutcome(pubInfo.status),
                        errorMessage: pubInfo.last_agent_message || '',
                        performance: {
                            commandsPerSecond: 0,
                            averageLatency: 0,
                            memoryUsageMB: 0,
                            cpuUsagePercent: 0
                        }
                    });

                    // Create log reader agent status
                    const logReaderAgentName = `${pubInfo.publisher_db} Log Reader`;
                    agents.push({
                        name: logReaderAgentName,
                        type: this.mapAgentType(AgentType.LogReaderAgent),
                        status: this.mapStatus(pubInfo.status),
                        lastStartTime: undefined,
                        lastRunDuration: 0,
                        lastRunOutcome: this.mapRunOutcome(pubInfo.status),
                        errorMessage: pubInfo.last_agent_message || '',
                        performance: {
                            commandsPerSecond: 0,
                            averageLatency: 0,
                            memoryUsageMB: 0,
                            cpuUsagePercent: 0
                        }
                    });
                }

                // Add distribution agents
                for (const agent of distAgents) {
                    agents.push({
                        name: agent.name,
                        type: this.mapAgentType(AgentType.DistributionAgent),
                        status: this.mapStatus(agent.status),
                        lastStartTime: agent.start_time,
                        lastRunDuration: agent.duration,
                        lastRunOutcome: this.mapRunOutcome(agent.status),
                        errorMessage: agent.last_message || '',
                        performance: {
                            commandsPerSecond: agent.delivery_rate || 0,
                            averageLatency: agent.delivery_latency || 0,
                            memoryUsageMB: 0,
                            cpuUsagePercent: 0
                        }
                    });
                }

                // Run replication_agent_checkup to get additional agent info
                await this.sqlService.executeQuery(connection, `
                    EXEC sp_replication_agent_checkup
                `);
            }

            return agents;
        } catch (error) {
            console.error('Failed to get agent status:', error);
            return [];
        }
    }

    /**
     * Gets publication statistics
     */
    private async getPublicationStats(connection: SqlServerConnection): Promise<PublicationStats[]> {
        try {
            const publications = await this.sqlService.executeProcedure<{
                publisher: string;
                publisher_db: string;
                publication: string;
                publication_type: number;
                status: number;
                warning: number;
                pending_commands: number;
                retention_period: number;
                worst_latency: number;
                transaction_rate: number;
            }>(connection, 'distribution.dbo.sp_replmonitorhelppublication');

            return await Promise.all(publications.map(async pub => {
                try {
                    // Get subscription count using the correct column names
                    const subCount = await this.sqlService.executeQuery<{ count: number }>(connection, `
                        USE distribution
                        SELECT COUNT(*) as count
                        FROM dbo.MSsubscriptions s
                        WHERE publisher_db = '${pub.publisher_db}'
                        AND publication_id IN (
                            SELECT publication_id 
                            FROM dbo.MSpublications 
                            WHERE publisher_db = '${pub.publisher_db}'
                            AND publication = '${pub.publication}'
                        )
                    `);

                    // Get article count using the correct column names
                    const artCount = await this.sqlService.executeQuery<{ count: number }>(connection, `
                        USE distribution
                        SELECT COUNT(*) as count
                        FROM dbo.MSarticles a
                        WHERE publisher_db = '${pub.publisher_db}'
                        AND publication_id IN (
                            SELECT publication_id 
                            FROM dbo.MSpublications 
                            WHERE publisher_db = '${pub.publisher_db}'
                            AND publication = '${pub.publication}'
                        )
                    `);

                    return {
                        name: pub.publication,
                        subscriptionCount: subCount[0]?.count || 0,
                        articleCount: artCount[0]?.count || 0,
                        totalCommandsDelivered: pub.pending_commands || 0,
                        averageCommandSize: 0,
                        retentionPeriod: pub.retention_period,
                        transactionsPerSecond: pub.transaction_rate || 0
                    };
                } catch (error) {
                    console.error(`Failed to get counts for publication ${pub.publication}:`, error);
                    return {
                        name: pub.publication,
                        subscriptionCount: 0,
                        articleCount: 0,
                        totalCommandsDelivered: pub.pending_commands || 0,
                        averageCommandSize: 0,
                        retentionPeriod: pub.retention_period,
                        transactionsPerSecond: pub.transaction_rate || 0
                    };
                }
            }));
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
            const connectionService = ConnectionService.getInstance();
            const connections = connectionService.getConnections();
            
            for (const connection of connections) {
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
            const publications = await this.sqlService.executeQuery<{
                publisher: string;
                publisher_db: string;
                publication: string;
                publication_id: number;
            }>(connection, `
                EXEC distribution.dbo.sp_replmonitorhelppublication
            `);

            const results: TracerTokenResult[] = [];

            for (const pub of publications) {
                try {
                    // First set the database context to the publication database
                    await this.sqlService.executeQuery(connection, `USE ${pub.publisher_db}`);
                    
                    // Get the list of tracer tokens for this publication
                    // When running in the publisher database context, neither @publisher nor @publisher_db should be specified
                    const tracerTokens = await this.sqlService.executeQuery<{
                        tracer_id: number;
                        publisher_commit: Date;
                    }>(connection, `
                        EXEC sp_helptracertokens 
                        @publication = '${pub.publication}'
                    `);
                    
                    // Get the latest 5 tokens only (to avoid excessive processing)
                    const recentTokens = tracerTokens
                        .sort((a, b) => b.publisher_commit.getTime() - a.publisher_commit.getTime())
                        .slice(0, 5);
                    
                    // Process each token to get its latency info
                    for (const token of recentTokens) {
                        // When running in the publisher database context, neither @publisher nor @publisher_db should be specified
                        const tokenHistory = await this.sqlService.executeQuery<{
                            distributor_latency: number;
                            subscriber: string;
                            subscriber_db: string;
                            subscriber_latency: number;
                            overall_latency: number;
                        }>(connection, `
                            EXEC sp_helptracertokenhistory
                            @publication = '${pub.publication}',
                            @tracer_id = ${token.tracer_id}
                        `);
                        
                        // Map the results to our data model
                        for (const history of tokenHistory) {
                            results.push({
                                id: token.tracer_id.toString(),
                                publication: pub.publication,
                                publisherInsertTime: token.publisher_commit,
                                distributorInsertTime: new Date(token.publisher_commit.getTime() + (history.distributor_latency * 1000)),
                                subscriberInsertTime: new Date(token.publisher_commit.getTime() + (history.overall_latency * 1000)),
                                totalLatencySeconds: history.overall_latency,
                                subscriber: history.subscriber,
                                subscriberDb: history.subscriber_db
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Failed to get tracer tokens for publication ${pub.publication}:`, error);
                }
            }

            return results;
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
            const subscriptions = await this.sqlService.executeQuery<{
                publication: string;
                publisher_db: string;
                subscriber: string;
                subscriber_db: string;
                subscription_type: number;
                latency: number;
                last_distsync: Date;
                status: number;
                commands_in_distrib: number;
                estimated_time_to_completion: number;
            }>(connection, `
                EXEC distribution.dbo.sp_replmonitorhelpsubscription
                @publisher = @@SERVERNAME,
                @publication_type = 0,
                @mode = 0
            `);

            return subscriptions.map(sub => ({
                publication: sub.publication,
                subscriber: sub.subscriber,
                subscriberDb: sub.subscriber_db,
                latencySeconds: sub.latency,
                pendingCommandCount: sub.commands_in_distrib,
                estimatedTimeToCompletionSeconds: sub.estimated_time_to_completion,
                collectionTime: new Date(),
                latencyHistory: this.latencyHistory.get(`${sub.publication}-${sub.subscriber}-${sub.subscriber_db}`) || [],
                deliveryRate: 0
            }));
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
            const connectionService = ConnectionService.getInstance();
            const connections = connectionService.getConnections();
            console.log(`Checking health for ${connections.length} connections`);
            
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
                console.log(`Processing connection: ${connection.serverName}`);
                
                // Get agent status
                const agents = await this.getAgentStatus(connection);
                console.log(`Found ${agents.length} agents for ${connection.serverName}`);
                health.agents.push(...agents);

                // Update agent status summary
                for (const agent of agents) {
                    console.log(`Agent ${agent.name}: ${agent.status}`);
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

                // Get latency metrics
                const metrics = await this.getLatencyMetrics(connection);
                console.log(`Found ${metrics.length} latency metrics for ${connection.serverName}`);
                health.latencyMetrics.push(...metrics);

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
                    console.log(`Found ${tokens.length} tracer tokens for ${connection.serverName}`);
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
                console.log(`Found ${stats.length} publication stats for ${connection.serverName}`);
                health.publicationStats.push(...stats);
            }

            // Add current alerts to health status
            health.alerts = Array.from(this.alerts.values());
            console.log(`Total alerts: ${health.alerts.length}`);
            console.log('Final health status:', {
                status: health.status,
                agents: health.agents.length,
                metrics: health.latencyMetrics.length,
                tokens: health.tracerTokens.length,
                stats: health.publicationStats.length,
                agentStatus: health.agentStatus
            });

            // Emit health update event
            this._onHealthUpdate.fire(health);

            // Show notifications for new critical alerts
            health.alerts
                .filter(alert => alert.severity === 'Critical')
                .forEach(alert => {
                    void vscode.window.showErrorMessage(
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

    private mapStatus(status: number): AgentStatus['status'] {
        switch (status) {
            case 1: return 'Running';
            case 2: return 'Stopped';
            case 3: return 'Retrying';
            case 4: return 'Failed';
            case 5: return 'Completing';
            default: return 'Failed';
        }
    }

    private mapRunOutcome(status: number): 'Failed' | 'Succeeded' | 'Retry' | 'Cancelled' {
        switch (status) {
            case 1: // Running
            case 2: // Stopped
                return 'Succeeded';
            case 3: // Retrying
                return 'Retry';
            case 4: // Failed
                return 'Failed';
            case 5: // Completing
                return 'Succeeded';
            default:
                return 'Failed';
        }
    }

    private mapAgentType(type: AgentType): 'Snapshot' | 'LogReader' | 'Distribution' {
        switch (type) {
            case AgentType.SnapshotAgent: return 'Snapshot';
            case AgentType.LogReaderAgent: return 'LogReader';
            case AgentType.DistributionAgent: return 'Distribution';
            default: throw new Error(`Unknown agent type: ${type}`);
        }
    }
} 