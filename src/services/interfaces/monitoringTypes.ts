/**
 * Represents replication latency metrics for a publication/subscription.
 */
export interface ReplicationLatency {
    /** Name of the publication */
    publication: string;
    /** Name of the subscriber */
    subscriber: string;
    /** Name of the subscriber database */
    subscriberDb: string;
    /** Latency in seconds */
    latencySeconds: number;
    /** Number of commands waiting to be delivered */
    pendingCommandCount: number;
    /** Estimated time until delivery completion in seconds */
    estimatedTimeToCompletionSeconds: number;
    /** When the metrics were collected */
    collectionTime: Date;
    /** Historical latency data points for trending */
    latencyHistory: { timestamp: Date; latencySeconds: number }[];
    /** Delivery rate (commands/second) */
    deliveryRate: number;
}

/**
 * Represents detailed agent status information
 */
export interface AgentStatus {
    /** Agent name */
    name: string;
    /** Agent type (Snapshot, Log Reader, Distribution) */
    type: 'Snapshot' | 'LogReader' | 'Distribution';
    /** Current status */
    status: 'Running' | 'Stopped' | 'Failed' | 'Completing' | 'Retrying';
    /** Last run start time */
    lastStartTime?: Date;
    /** Last run duration in seconds */
    lastRunDuration?: number;
    /** Last run outcome */
    lastRunOutcome: 'Succeeded' | 'Failed' | 'Retry' | 'Cancelled';
    /** Error message if failed */
    errorMessage?: string;
    /** Performance metrics */
    performance: {
        /** Commands processed per second */
        commandsPerSecond: number;
        /** Average delivery latency in seconds */
        averageLatency: number;
        /** Memory usage in MB */
        memoryUsageMB: number;
        /** CPU usage percentage */
        cpuUsagePercent: number;
    };
}

/**
 * Represents the current state of replication health.
 */
export interface ReplicationHealth {
    /** Overall health status */
    status: 'Healthy' | 'Warning' | 'Critical';
    /** Any active alerts */
    alerts: ReplicationAlert[];
    /** Current latency metrics */
    latencyMetrics: ReplicationLatency[];
    /** Detailed agent status information */
    agents: AgentStatus[];
    /** Agent status summary */
    agentStatus: {
        /** Number of agents running */
        running: number;
        /** Number of agents stopped */
        stopped: number;
        /** Number of agents in error state */
        error: number;
    };
    /** Tracer token results */
    tracerTokens: TracerTokenResult[];
    /** Publication statistics */
    publicationStats: PublicationStats[];
}

/**
 * Represents a tracer token result
 */
export interface TracerTokenResult {
    /** Token ID */
    id: string;
    /** Publication name */
    publication: string;
    /** Publisher insert time */
    publisherInsertTime: Date;
    /** Distributor insert time */
    distributorInsertTime?: Date;
    /** Subscriber insert time */
    subscriberInsertTime?: Date;
    /** Total latency in seconds */
    totalLatencySeconds: number;
}

/**
 * Represents publication statistics
 */
export interface PublicationStats {
    /** Publication name */
    name: string;
    /** Number of subscriptions */
    subscriptionCount: number;
    /** Number of articles */
    articleCount: number;
    /** Total commands delivered */
    totalCommandsDelivered: number;
    /** Average command size in bytes */
    averageCommandSize: number;
    /** Retention period in hours */
    retentionPeriod: number;
    /** Transaction delivery rate */
    transactionsPerSecond: number;
}

/**
 * Configuration for monitoring thresholds.
 */
export interface MonitoringConfig {
    /** Maximum acceptable latency in seconds before warning */
    maxLatencyWarningThreshold: number;
    /** Maximum acceptable latency in seconds before critical */
    maxLatencyCriticalThreshold: number;
    /** Maximum acceptable pending commands before warning */
    maxPendingCommandsWarningThreshold: number;
    /** Maximum acceptable pending commands before critical */
    maxPendingCommandsCriticalThreshold: number;
    /** How often to poll for updates in milliseconds */
    pollingIntervalMs: number;
    /** Enable tracer token monitoring */
    enableTracerTokens: boolean;
    /** Tracer token insertion interval in minutes */
    tracerTokenIntervalMinutes: number;
    /** Number of historical data points to keep */
    historyRetentionCount: number;
    /** Alert retention period in hours */
    alertRetentionHours: number;
}

/**
 * Represents a replication alert
 */
export interface ReplicationAlert {
    /** Unique identifier */
    id: string;
    /** Alert severity */
    severity: 'Warning' | 'Critical';
    /** Alert message */
    message: string;
    /** When the alert was created */
    timestamp: Date;
    /** Source of the alert */
    source: {
        /** Publication name */
        publication?: string;
        /** Subscriber name */
        subscriber?: string;
        /** Subscriber database */
        subscriberDb?: string;
        /** Agent name */
        agent?: string;
    };
    /** Category of the alert */
    category: 'Latency' | 'Performance' | 'Error' | 'Configuration';
    /** Recommended action */
    recommendedAction?: string;
} 