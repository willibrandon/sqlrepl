import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';

/**
 * Enumeration of SQL Server replication agent types.
 * Each type represents a different replication process component.
 */
export enum AgentType {
    /** Handles initial synchronization and schema/data snapshots */
    SnapshotAgent = 'Snapshot Agent',
    
    /** Monitors transaction log for changes to be replicated */
    LogReaderAgent = 'Log Reader Agent',
    
    /** Moves transactions from distributor to subscribers */
    DistributionAgent = 'Distribution Agent',
    
    /** Handles bidirectional synchronization for merge replication */
    MergeAgent = 'Merge Agent'
}

/**
 * Represents a SQL Server replication agent job.
 * Contains configuration and status information for a replication agent.
 */
export interface AgentJob {
    /** Unique identifier for the agent job */
    id: string;

    /** Name of the agent job */
    name: string;

    /** Description of the agent's purpose */
    description: string;

    /** Type of replication agent */
    type: AgentType;

    /** Whether the agent job is enabled */
    enabled: boolean;

    /** Whether the agent is currently executing */
    isRunning: boolean;

    /** When the agent last executed */
    lastRunTime?: Date;

    /** Outcome of the last execution */
    lastRunOutcome?: string;

    /** When the agent is scheduled to run next */
    nextRunTime?: Date;

    /** Name of the publishing server */
    publisher?: string;

    /** Name of the publisher database */
    publisherDb?: string;

    /** Name of the publication */
    publication?: string;

    /** Name of the subscribing server */
    subscriber?: string;

    /** Name of the subscriber database */
    subscriberDb?: string;
}

/**
 * Represents a historical execution record of an agent job.
 * Contains details about a specific execution instance.
 */
export interface JobHistory {
    /** Unique identifier for the history record */
    id: string;

    /** When the job executed */
    runDate: Date;

    /** Name of the job step that executed */
    stepName: string;

    /** Outcome status of the execution */
    status: string;

    /** Detailed message about the execution */
    message: string;

    /** How long the job ran */
    runDuration: string;
}

/**
 * Service for managing SQL Server replication agents.
 * Provides functionality to monitor, start, stop, and query agent status.
 */
export class AgentService {
    private static instance: AgentService;
    private sqlService: SqlService;

    private constructor() {
        this.sqlService = SqlService.getInstance();
    }

    /**
     * Gets the singleton instance of AgentService.
     * Creates the instance if it doesn't exist.
     */
    public static getInstance(): AgentService {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }

    /**
     * Retrieves all replication agent jobs for a SQL Server instance.
     * Queries both system tables and replication metadata for comprehensive agent information.
     * 
     * @param connection - Connection to the SQL Server instance
     * @returns Array of agent jobs with their current status
     */
    public async getAgentJobs(connection: SqlServerConnection): Promise<AgentJob[]> {
        try {
            console.log("Getting agent jobs using sp_help_job");
            
            // First get all replication jobs from sysjobs
            const replicationJobs = await this.sqlService.executeQuery<{
                job_id: string;
                name: string;
                enabled: number;
                description: string;
                category_name: string;
            }>(connection, `
                SELECT 
                    CONVERT(NVARCHAR(50), j.job_id) AS job_id,
                    j.name,
                    j.enabled,
                    j.description,
                    c.name AS category_name
                FROM msdb.dbo.sysjobs j
                JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
                WHERE c.name IN ('REPL-Distribution', 'REPL-LogReader', 'REPL-Snapshot')
                ORDER BY j.name
            `);

            if (!replicationJobs || replicationJobs.length === 0) {
                console.log('No replication jobs found in sysjobs table, trying alternative methods');
                
                // Fall back to other methods if no jobs found directly
                let allAgentJobs: AgentJob[] = [];
                
                // Try to get log reader agents
                try {
                    const logReaderAgents = await this.getLogReaderAgents(connection);
                    allAgentJobs = allAgentJobs.concat(logReaderAgents);
                    console.log(`Found ${logReaderAgents.length} log reader agents`);
                } catch (error) {
                    console.error('Error getting log reader agents:', error);
                }
    
                // Try to get distribution agents
                try {
                    const distributionAgents = await this.getDistributionAgents(connection);
                    allAgentJobs = allAgentJobs.concat(distributionAgents);
                    console.log(`Found ${distributionAgents.length} distribution agents`);
                } catch (error) {
                    console.error('Error getting distribution agents:', error);
                }
    
                // Try to get snapshot agents as well
                try {
                    const snapshotAgents = await this.getSnapshotAgents(connection);
                    allAgentJobs = allAgentJobs.concat(snapshotAgents);
                    console.log(`Found ${snapshotAgents.length} snapshot agents`);
                } catch (error) {
                    console.error('Error getting snapshot agents:', error);
                }
                
                console.log(`Returning ${allAgentJobs.length} total agent jobs from secondary methods`);
                return allAgentJobs;
            }
            
            console.log(`Found ${replicationJobs.length} replication jobs from sysjobs query`);
            
            // Get detailed status for each job using sp_help_job
            const agentJobs: AgentJob[] = [];
            
            for (const job of replicationJobs) {
                try {
                    const jobStatus = await this.sqlService.executeQuery<{
                        current_execution_status: number;
                        last_run_date: number;
                        last_run_time: number;
                        last_run_outcome: number;
                        next_scheduled_run_date: number;
                        next_scheduled_run_time: number;
                    }>(connection, `
                        EXEC msdb.dbo.sp_help_job
                        @job_id = '${job.job_id}',
                        @job_aspect = 'JOB'
                    `);

                    if (jobStatus && jobStatus.length > 0) {
                        const status = jobStatus[0];
                        
                        // Determine agent type based strictly on category
                        let type: AgentType;
                        const category = (job.category_name || '').toLowerCase();
                        
                        if (category.includes('logreader')) {
                            type = AgentType.LogReaderAgent;
                        } else if (category.includes('snapshot')) {
                            type = AgentType.SnapshotAgent;
                        } else if (category.includes('distribution')) {
                            type = AgentType.DistributionAgent;
                        } else {
                            console.log(`Unknown agent category: ${job.category_name}, defaulting to Distribution`);
                            type = AgentType.DistributionAgent;
                        }
                        
                        // Parse last run date/time
                        let lastRunTime: Date | undefined;
                        if (status.last_run_date > 0) {
                            lastRunTime = this.parseSqlDateTime(status.last_run_date, status.last_run_time);
                        }
                        
                        // Parse next run date/time
                        let nextRunTime: Date | undefined;
                        if (status.next_scheduled_run_date > 0) {
                            nextRunTime = this.parseSqlDateTime(status.next_scheduled_run_date, status.next_scheduled_run_time);
                        }
                        
                        // Determine if job is running (1 = executing)
                        const isRunning = status.current_execution_status === 1;
                        
                        // Map last run outcome
                        let lastRunOutcome: string;
                        switch (status.last_run_outcome) {
                            case 0: lastRunOutcome = 'Failed'; break;
                            case 1: lastRunOutcome = 'Succeeded'; break;
                            case 2: lastRunOutcome = 'Retry'; break;
                            case 3: lastRunOutcome = 'Canceled'; break;
                            default: lastRunOutcome = 'Unknown';
                        }
                        
                        // Parse publication info from job name
                        let publisher: string | undefined;
                        let publisherDb: string | undefined;
                        let publication: string | undefined;
                        let subscriber: string | undefined;
                        let subscriberDb: string | undefined;
                        
                        // Jobs typically follow naming patterns we can parse
                        if (type === AgentType.LogReaderAgent) {
                            // Log Reader format typically: LS-{publisher}-{publisher_db}
                            const parts = job.name.split('-');
                            if (parts.length >= 3 && parts[0] === 'LS') {
                                publisher = parts[1];
                                publisherDb = parts[2];
                            }
                        } else if (type === AgentType.DistributionAgent) {
                            // Distribution format typically has subscriber and publication info
                            // Example: {publisher}-{publisher_db}-{publication}-{subscriber}-{subscriber_db}
                            const parts = job.name.split('-');
                            if (parts.length >= 2) {
                                // Make reasonable guesses, but these can vary by installation
                                publisher = parts[0];
                                if (parts.length >= 3) {
                                    publisherDb = parts[1];
                                    publication = parts[2];
                                }
                                if (parts.length >= 5) {
                                    subscriber = parts[3];
                                    subscriberDb = parts[4];
                                }
                            }
                        } else if (type === AgentType.SnapshotAgent) {
                            // Snapshot format typically: {publisher}-{publisher_db}-{publication}
                            const parts = job.name.split('-');
                            if (parts.length >= 3) {
                                publisher = parts[0];
                                publisherDb = parts[1];
                                publication = parts[2];
                            }
                        }
                        
                        agentJobs.push({
                            id: job.job_id,
                            name: job.name,
                            description: job.description || `Replication ${type}`,
                            type,
                            enabled: job.enabled === 1,
                            isRunning,
                            lastRunTime,
                            lastRunOutcome,
                            nextRunTime,
                            publisher,
                            publisherDb,
                            publication,
                            subscriber,
                            subscriberDb
                        });
                    }
                } catch (jobError) {
                    console.error(`Error getting status for job ${job.job_id}:`, jobError);
                }
            }
            
            console.log(`Processed ${agentJobs.length} agent jobs`);
            return agentJobs;
        } catch (error) {
            console.error('Failed to get agent jobs:', error);
            return [];
        }
    }

    /**
     * Retrieves Log Reader Agent jobs for publisher databases.
     * 
     * @param connection - Connection to the SQL Server instance
     * @returns Array of Log Reader Agent jobs
     */
    private async getLogReaderAgents(connection: SqlServerConnection): Promise<AgentJob[]> {
        const agents: AgentJob[] = [];
        try {
            // Get publisher databases on this server
            const replDbs = await this.sqlService.executeQuery<{
                dbname: string;
                publisher: string;
                distribution_db: string;
            }>(connection, `
                EXEC sp_helpreplicationdb
                @type = 'publication'
            `);

            if (!replDbs || replDbs.length === 0) {
                console.log('No publication databases found for log reader agents');
                return [];
            }

            // For each publisher database, get log reader agent info if available
            for (const db of replDbs) {
                // Skip if dbname is null or undefined
                if (!db.dbname) {
                    console.log('Skipping database with undefined name');
                    continue;
                }
                
                try {
                    console.log(`Checking for log reader agent in database: ${db.dbname}`);
                    
                    // Get the log reader agent for this database
                    const logReaderInfo = await this.sqlService.executeQuery<{
                        job_id: string;
                        name: string;
                        job_login: string;
                        profile_id: number;
                        active_start_time: number;
                        active_end_time: number;
                        job_step: string;
                    }>(connection, `
                        DECLARE @job_id UNIQUEIDENTIFIER
                        SELECT @job_id = job_id 
                        FROM msdb.dbo.sysjobs j
                        JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
                        WHERE 
                            c.name = 'REPL-LogReader' 
                            AND j.name LIKE 'LS-%'
                            AND j.name LIKE '%${db.dbname}%'

                        -- Only return if we found a valid job_id
                        IF @job_id IS NOT NULL
                        BEGIN
                            SELECT 
                                CONVERT(NVARCHAR(50), @job_id) AS job_id,
                                j.name,
                                COALESCE(s.subsystem, '') AS job_step,
                                COALESCE(j.enabled, 0) AS enabled,
                                COALESCE(c.name, '') AS category_name,
                                COALESCE(j.description, '') AS description,
                                COALESCE(sj.last_run_date, 0) AS last_run_date,
                                COALESCE(sj.last_run_time, 0) AS last_run_time,
                                COALESCE(sj.last_run_outcome, 0) AS last_run_outcome,
                                COALESCE(ja.start_execution_date, NULL) AS is_running
                            FROM msdb.dbo.sysjobs j
                            LEFT JOIN msdb.dbo.sysjobsteps s ON j.job_id = s.job_id AND s.step_id = 1
                            LEFT JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
                            LEFT JOIN msdb.dbo.sysjobservers sj ON j.job_id = sj.job_id
                            LEFT JOIN msdb.dbo.sysjobactivity ja ON j.job_id = ja.job_id
                            WHERE j.job_id = @job_id
                        END
                    `);

                    if (logReaderInfo && logReaderInfo.length > 0) {
                        const job = logReaderInfo[0];
                        console.log(`Found log reader agent job: ${job.name}`);
                        
                        // Parse last run date/time
                        let lastRunTime: Date | undefined;
                        let lastRunOutcome = 'Unknown';
                        
                        try {
                            // Get job status using sp_help_job (more reliable for job status)
                            const jobStatus = await this.sqlService.executeQuery<{
                                last_run_date: number;
                                last_run_time: number;
                                last_run_outcome: number;
                                current_execution_status: number;
                            }>(connection, `
                                EXEC msdb.dbo.sp_help_job
                                @job_id = '${job.job_id}'
                            `);
                            
                            if (jobStatus && jobStatus.length > 0) {
                                const status = jobStatus[0];
                                
                                if (status.last_run_date > 0) {
                                    lastRunTime = this.parseSqlDateTime(status.last_run_date, status.last_run_time);
                                }
                                
                                // Map last run outcome
                                switch (status.last_run_outcome) {
                                    case 0: lastRunOutcome = 'Failed'; break;
                                    case 1: lastRunOutcome = 'Succeeded'; break;
                                    case 2: lastRunOutcome = 'Retry'; break;
                                    case 3: lastRunOutcome = 'Canceled'; break;
                                    default: lastRunOutcome = 'Unknown';
                                }
                                
                                // Determine if job is running
                                const isRunning = status.current_execution_status > 0;
                                
                                agents.push({
                                    id: job.job_id,
                                    name: job.name,
                                    description: `Log Reader Agent for database ${db.dbname}`,
                                    type: AgentType.LogReaderAgent,
                                    enabled: true, // Assume enabled if found
                                    isRunning,
                                    lastRunTime,
                                    lastRunOutcome,
                                    publisher: connection.serverName,
                                    publisherDb: db.dbname
                                });
                            }
                        } catch (jobError) {
                            console.error(`Error getting status for log reader job ${job.job_id}:`, jobError);
                        }
                    }
                } catch (dbError) {
                    console.error(`Error getting log reader for database ${db.dbname}:`, dbError);
                }
            }
        } catch (error) {
            console.error('Error in getLogReaderAgents:', error);
        }
        return agents;
    }

    /**
     * Retrieves Distribution Agent jobs for publications.
     * 
     * @param connection - Connection to the SQL Server instance
     * @returns Array of Distribution Agent jobs
     */
    private async getDistributionAgents(connection: SqlServerConnection): Promise<AgentJob[]> {
        const agents: AgentJob[] = [];
        try {
            // Attempt to use the distribution database and check if this server is a distributor
            try {
                console.log('Checking if server is a distributor');
                const distribStatus = await this.sqlService.executeQuery<{
                    installed: number;
                    distribution_db: string;
                }>(connection, `EXEC sp_get_distributor`);
                
                if (!distribStatus || distribStatus.length === 0 || !distribStatus[0].installed) {
                    console.log('Server is not configured as a distributor');
                    return []; // Not a distributor
                }
                
                const distributionDb = distribStatus[0].distribution_db;
                if (!distributionDb) {
                    console.log('No distribution database found');
                    return [];
                }
                
                console.log(`Server is a distributor with database: ${distributionDb}`);
                
                // Make sure the distribution database exists
                const dbExists = await this.sqlService.executeQuery<{ exists: number }>(connection, `
                    SELECT CASE WHEN DB_ID('${distributionDb}') IS NOT NULL THEN 1 ELSE 0 END AS exists
                `);
                
                if (!dbExists || dbExists.length === 0 || !dbExists[0].exists) {
                    console.log(`Distribution database '${distributionDb}' does not exist`);
                    return [];
                }
            } catch (error) {
                console.log('Error checking distributor status:', error);
                // Not a distributor
                return [];
            }

            // Get all publications on this server
            try {
                console.log('Querying for publications in distribution database');
                const publications = await this.sqlService.executeQuery<{
                    publisher: string;
                    publisher_db: string;
                    publication: string;
                }>(connection, `
                    -- Get publications from the distributor
                    USE distribution
                    EXEC sp_helppublication
                `);

                if (!publications || publications.length === 0) {
                    console.log('No publications found in distribution database');
                    return [];
                }
                
                console.log(`Found ${publications.length} publications in distribution database`);

                // For each publication, get the distribution agents
                for (const pub of publications) {
                    // Skip if any required fields are missing
                    if (!pub.publisher || !pub.publisher_db || !pub.publication) {
                        console.log('Skipping publication with missing required fields');
                        continue;
                    }
                    
                    try {
                        console.log(`Checking distribution agents for publication: ${pub.publication}`);
                        
                        // Get subscriptions to find distribution agents
                        const subscriptions = await this.sqlService.executeQuery<{
                            subscriber: string;
                            subscriber_db: string;
                            status: number;
                        }>(connection, `
                            USE distribution
                            EXEC sp_helpsubscription
                            @publisher = '${pub.publisher}',
                            @publisher_db = '${pub.publisher_db}',
                            @publication = '${pub.publication}',
                            @show_push = 1,
                            @show_pull = 0
                        `);

                        if (subscriptions && subscriptions.length > 0) {
                            console.log(`Found ${subscriptions.length} subscriptions for publication ${pub.publication}`);
                            
                            for (const sub of subscriptions) {
                                // Skip if subscriber info is missing
                                if (!sub.subscriber || !sub.subscriber_db) {
                                    console.log('Skipping subscription with missing subscriber details');
                                    continue;
                                }
                                
                                console.log(`Checking distribution agent for subscription from ${pub.publisher_db} to ${sub.subscriber_db}`);
                                
                                // Find the distribution agent job
                                const jobInfo = await this.sqlService.executeQuery<{
                                    job_id: string;
                                    name: string;
                                    enabled: number;
                                    description: string;
                                    current_execution_status: number;
                                    last_run_date: number;
                                    last_run_time: number;
                                    last_run_outcome: number;
                                }>(connection, `
                                    DECLARE @job_id UNIQUEIDENTIFIER
                                    SELECT @job_id = j.job_id
                                    FROM msdb.dbo.sysjobs j
                                    JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
                                    WHERE 
                                        c.name = 'REPL-Distribution' 
                                        AND j.name LIKE '%${pub.publication}%' 
                                        AND j.name LIKE '%${sub.subscriber}%'
                                        AND j.name LIKE '%${sub.subscriber_db}%'

                                    -- Only return if we found a valid job_id
                                    IF @job_id IS NOT NULL
                                    BEGIN
                                        EXEC msdb.dbo.sp_help_job
                                        @job_id = @job_id
                                    END
                                `);

                                if (jobInfo && jobInfo.length > 0) {
                                    const job = jobInfo[0];
                                    console.log(`Found distribution agent job: ${job.name}`);
                                    
                                    // Parse last run date/time
                                    let lastRunTime: Date | undefined;
                                    if (job.last_run_date > 0) {
                                        lastRunTime = this.parseSqlDateTime(job.last_run_date, job.last_run_time);
                                    }
                                    
                                    // Map last run outcome
                                    let lastRunOutcome: string;
                                    switch (job.last_run_outcome) {
                                        case 0: lastRunOutcome = 'Failed'; break;
                                        case 1: lastRunOutcome = 'Succeeded'; break;
                                        case 2: lastRunOutcome = 'Retry'; break;
                                        case 3: lastRunOutcome = 'Canceled'; break;
                                        default: lastRunOutcome = 'Unknown';
                                    }
                                    
                                    // Determine if job is running
                                    const isRunning = job.current_execution_status > 0;
                                    
                                    agents.push({
                                        id: job.job_id,
                                        name: job.name,
                                        description: job.description || `Distribution Agent for ${pub.publication} from ${pub.publisher_db} to ${sub.subscriber_db}`,
                                        type: AgentType.DistributionAgent,
                                        enabled: job.enabled === 1,
                                        isRunning,
                                        lastRunTime,
                                        lastRunOutcome,
                                        publisher: pub.publisher,
                                        publisherDb: pub.publisher_db,
                                        publication: pub.publication,
                                        subscriber: sub.subscriber,
                                        subscriberDb: sub.subscriber_db
                                    });
                                }
                            }
                        }
                    } catch (pubError) {
                        console.error(`Error getting distribution agents for publication ${pub.publication}:`, pubError);
                    }
                }
            } catch (error) {
                console.error('Error querying publications in distribution database:', error);
            }
        } catch (error) {
            console.error('Error in getDistributionAgents:', error);
        }
        return agents;
    }

    /**
     * Retrieves Snapshot Agent jobs for publications.
     * 
     * @param connection - Connection to the SQL Server instance
     * @returns Array of Snapshot Agent jobs
     */
    private async getSnapshotAgents(connection: SqlServerConnection): Promise<AgentJob[]> {
        const agents: AgentJob[] = [];
        try {
            // Get publisher databases on this server
            const replDbs = await this.sqlService.executeQuery<{
                dbname: string;
                publisher: string;
                distribution_db: string;
            }>(connection, `
                EXEC sp_helpreplicationdb
                @type = 'publication'
            `);

            if (!replDbs || replDbs.length === 0) {
                console.log('No publication databases found for snapshot agents');
                return [];
            }

            // For each publisher database, get publications
            for (const db of replDbs) {
                // Skip if dbname is null or undefined
                if (!db.dbname) {
                    console.log('Skipping database with undefined name');
                    continue;
                }
                
                try {
                    console.log(`Checking for snapshot agents in database: ${db.dbname}`);
                    
                    // Get publications in this database to find snapshot agents
                    await this.sqlService.executeQuery(connection, `USE [${db.dbname}]`);
                    const publications = await this.sqlService.executeQuery<{
                        name: string;
                        publisher: string;
                        publisher_db: string;
                    }>(connection, `
                        EXEC sp_helppublication
                    `);

                    if (publications && publications.length > 0) {
                        for (const pub of publications) {
                            // Skip if publication name is undefined
                            if (!pub.name) {
                                console.log('Skipping publication with undefined name');
                                continue;
                            }
                            
                            console.log(`Checking for snapshot agent for publication: ${pub.name}`);
                            
                            // Find the snapshot agent job
                            const jobInfo = await this.sqlService.executeQuery<{
                                job_id: string;
                                name: string;
                                enabled: number;
                                description: string;
                                current_execution_status: number;
                                last_run_date: number;
                                last_run_time: number;
                                last_run_outcome: number;
                            }>(connection, `
                                DECLARE @job_id UNIQUEIDENTIFIER
                                SELECT @job_id = j.job_id
                                FROM msdb.dbo.sysjobs j
                                JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
                                WHERE 
                                    c.name = 'REPL-Snapshot' 
                                    AND j.name LIKE '%${pub.name}%'
                                    AND j.name LIKE '%${db.dbname}%'

                                -- Only return if we found a valid job_id
                                IF @job_id IS NOT NULL
                                BEGIN
                                    EXEC msdb.dbo.sp_help_job
                                    @job_id = @job_id
                                END
                            `);

                            if (jobInfo && jobInfo.length > 0) {
                                const job = jobInfo[0];
                                console.log(`Found snapshot agent job: ${job.name}`);
                                
                                // Parse last run date/time
                                let lastRunTime: Date | undefined;
                                if (job.last_run_date > 0) {
                                    lastRunTime = this.parseSqlDateTime(job.last_run_date, job.last_run_time);
                                }
                                
                                // Map last run outcome
                                let lastRunOutcome: string;
                                switch (job.last_run_outcome) {
                                    case 0: lastRunOutcome = 'Failed'; break;
                                    case 1: lastRunOutcome = 'Succeeded'; break;
                                    case 2: lastRunOutcome = 'Retry'; break;
                                    case 3: lastRunOutcome = 'Canceled'; break;
                                    default: lastRunOutcome = 'Unknown';
                                }
                                
                                // Determine if job is running
                                const isRunning = job.current_execution_status > 0;
                                
                                agents.push({
                                    id: job.job_id,
                                    name: job.name,
                                    description: job.description || `Snapshot Agent for publication ${pub.name} in ${db.dbname}`,
                                    type: AgentType.SnapshotAgent,
                                    enabled: job.enabled === 1,
                                    isRunning,
                                    lastRunTime,
                                    lastRunOutcome,
                                    publisher: pub.publisher || connection.serverName,
                                    publisherDb: pub.publisher_db || db.dbname,
                                    publication: pub.name
                                });
                            }
                        }
                    }
                } catch (dbError) {
                    console.error(`Error getting snapshot agents for database ${db.dbname}:`, dbError);
                }
            }
        } catch (error) {
            console.error('Error in getSnapshotAgents:', error);
        }
        return agents;
    }

    /**
     * Starts execution of a replication agent job.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param jobId - ID of the job to start
     * @returns True if the job was started successfully
     */
    public async startJob(connection: SqlServerConnection, jobId: string): Promise<boolean> {
        try {
            // First check if the job is already running using sp_help_job
            const jobStatus = await this.sqlService.executeQuery<{
                current_execution_status: number;
            }>(connection, `
                EXEC msdb.dbo.sp_help_job
                @job_id = '${jobId}',
                @job_aspect = 'JOB'
            `);

            if (jobStatus && jobStatus.length > 0 && jobStatus[0].current_execution_status === 1) {
                console.log(`Job ${jobId} is already running`);
                throw new Error('Job is already running');
            }

            // Start the job using supported stored procedure
            await this.sqlService.executeProcedure(connection, 'msdb.dbo.sp_start_job', {
                job_id: jobId
            });
            return true;
        } catch (error) {
            console.error(`Failed to start job ${jobId}:`, error);
            throw error; // Re-throw to preserve the error message
        }
    }

    /**
     * Stops execution of a replication agent job.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param jobId - ID of the job to stop
     * @returns True if the job was stopped successfully
     */
    public async stopJob(connection: SqlServerConnection, jobId: string): Promise<boolean> {
        try {
            // Stop the job using supported stored procedure
            await this.sqlService.executeProcedure(connection, 'msdb.dbo.sp_stop_job', {
                job_id: jobId
            });
            return true;
        } catch (error) {
            console.error(`Failed to stop job ${jobId}:`, error);
            return false;
        }
    }

    /**
     * Retrieves execution history for a replication agent job.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param jobId - ID of the job to get history for
     * @param maxRows - Maximum number of history records to return (default: 50)
     * @returns Array of job history records
     */
    public async getJobHistory(connection: SqlServerConnection, jobId: string, maxRows: number = 50): Promise<JobHistory[]> {
        try {
            // Query for job history using the supported stored procedure
            const history = await this.sqlService.executeQuery<{
                instance_id: number;
                step_id: number;
                step_name: string;
                run_date: number;
                run_time: number;
                run_duration: number;
                run_status: number;
                message: string;
            }>(connection, `
                EXEC msdb.dbo.sp_help_jobhistory
                @job_id = '${jobId}',
                @mode = 'FULL',
                @oldest_first = 0
            `);

            // Apply the maxRows limit to the results
            const limitedHistory = history.slice(0, maxRows);

            return limitedHistory.map(h => {
                // Parse date and time
                const runDate = this.parseSqlDateTime(h.run_date, h.run_time);
                
                // Format duration (milliseconds in SQL Server)
                const durationHours = Math.floor(h.run_duration / 10000);
                const durationMinutes = Math.floor((h.run_duration % 10000) / 100);
                const durationSeconds = h.run_duration % 100;
                const runDuration = `${durationHours}:${durationMinutes.toString().padStart(2, '0')}:${durationSeconds.toString().padStart(2, '0')}`;
                
                // Map status code to text
                let status: string;
                switch (h.run_status) {
                    case 0: status = 'Failed'; break;
                    case 1: status = 'Succeeded'; break;
                    case 2: status = 'Retry'; break;
                    case 3: status = 'Canceled'; break;
                    case 4: status = 'In Progress'; break;
                    default: status = 'Unknown';
                }

                return {
                    id: h.instance_id.toString(),
                    runDate,
                    stepName: h.step_name || `Step ${h.step_id}`,
                    status,
                    message: h.message || '',
                    runDuration
                };
            });
        } catch (error) {
            console.error(`Failed to get job history for ${jobId}:`, error);
            return [];
        }
    }

    /**
     * Parses SQL Server date and time integers into a JavaScript Date.
     * 
     * @param datePart - SQL Server date in YYYYMMDD format
     * @param timePart - SQL Server time in HHMMSS format
     * @returns JavaScript Date object
     */
    private parseSqlDateTime(datePart: number, timePart: number): Date {
        // SQL Server date format: YYYYMMDD
        const year = Math.floor(datePart / 10000);
        const month = Math.floor((datePart % 10000) / 100) - 1; // JS months are 0-based
        const day = datePart % 100;
        
        // SQL Server time format: HHMMSS
        const hours = Math.floor(timePart / 10000);
        const minutes = Math.floor((timePart % 10000) / 100);
        const seconds = timePart % 100;
        
        return new Date(year, month, day, hours, minutes, seconds);
    }
} 