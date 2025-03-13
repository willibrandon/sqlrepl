import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';

export type ReplicationType = 'snapshot' | 'transactional';
export type SubscriptionType = 'push' | 'pull';

export interface PublicationOptions {
    name: string;
    type: ReplicationType;
    description?: string;
    snapshotFolder: string;
    database: string;
    articles: string[];
}

export interface SubscriptionOptions {
    publicationName: string;
    publisherServer: string;
    publisherDatabase: string;
    subscriberServer: string;
    subscriberDatabase: string;
    type: SubscriptionType;
    subscriptionName?: string;
    syncType: 'automatic' | 'immediate' | 'manual';
    loginForRemoteConnections?: string;
    passwordForRemoteConnections?: string;
}

export interface DistributorInfo {
    isDistributor: boolean;
    isPublisher: boolean;
    distributionDb: string | null;
    workingDirectory: string | null;
    remoteDist: {
        isRemote: boolean;
        serverName: string | null;
    };
}

export interface Publication {
    name: string;
    description: string;
    type: ReplicationType;
    status: string;
    immediate_sync: boolean;
    enabled_for_internet: boolean;
    allow_push: boolean;
    allow_pull: boolean;
    allow_anonymous: boolean;
    immediate_sync_ready: boolean;
    allow_sync_tran: boolean;
    database: string;
}

export interface Subscription {
    name: string;
    publication: string;
    publisher: string;
    publisherDb: string;
    subscriberDb: string;
    subscription_type: SubscriptionType;
    sync_type: string;
    status: string;
    last_sync?: Date;
}

export class ReplicationService {
    private static instance: ReplicationService;
    private sqlService: SqlService;

    private constructor() {
        this.sqlService = SqlService.getInstance();
    }

    public static getInstance(): ReplicationService {
        if (!ReplicationService.instance) {
            ReplicationService.instance = new ReplicationService();
        }
        return ReplicationService.instance;
    }

    public async getDistributorInfo(connection: SqlServerConnection): Promise<DistributorInfo> {
        try {
            // First check if server is configured as a distributor using sp_get_distributor
            const distInfo = await this.sqlService.executeQuery<{
                installed: boolean | number;
                'distribution server': string | null;
                'distribution db': string | null;
                'distribution db installed': boolean | number;
                'is distribution publisher': boolean | number;
                'has remote distribution publisher': boolean | number;
                directory: string | null;
            }>(connection, 'EXEC sp_get_distributor');

            const result = distInfo[0];
            console.log('sp_get_distributor result:', result);
            
            // Check if the value is either true or 1
            const isTrue = (value: boolean | number | undefined | null): boolean => {
                return value === true || value === 1;
            };
            
            return {
                isDistributor: isTrue(result.installed),
                isPublisher: isTrue(result['is distribution publisher']),
                distributionDb: result['distribution db'],
                workingDirectory: result.directory,
                remoteDist: {
                    isRemote: isTrue(result['has remote distribution publisher']),
                    serverName: result['distribution server']
                }
            };
        } catch (error) {
            console.error('Failed to get distributor info:', error);
            throw error;
        }
    }

    public async configureDistributor(
        connection: SqlServerConnection, 
        distributionDb: string = 'distribution',
        workingDirectory?: string
    ): Promise<void> {
        try {
            // Install distributor
            await this.sqlService.executeProcedure(connection, 'sp_adddistributor', {
                distributor: connection.serverName,
                password: null  // Local distributor doesn't need password
            });

            // Create distribution database
            await this.sqlService.executeProcedure(connection, 'sp_adddistributiondb', {
                database: distributionDb,
                security_mode: 1  // Windows Authentication
            });

            // Configure the server as its own publisher
            const defaultWorkingDir = workingDirectory || `\\\\${connection.serverName}\\repldata`;
            await this.sqlService.executeProcedure(connection, 'sp_adddistpublisher', {
                publisher: connection.serverName,
                distribution_db: distributionDb,
                working_directory: defaultWorkingDir,
                security_mode: 1  // Windows Authentication
            });
        } catch (error) {
            console.error('Failed to configure distributor:', error);
            throw error;
        }
    }

    public async createPublication(connection: SqlServerConnection, options: PublicationOptions): Promise<void> {
        // Enable database for replication
        await this.sqlService.executeQuery(connection, `
            USE [${options.database}]
            
            EXEC sp_replicationdboption 
                @dbname = N'${options.database}', 
                @optname = N'publish', 
                @value = N'true'
        `);

        // Create the publication - keep it simple with minimal parameters
        await this.sqlService.executeProcedure(connection, 'sp_addpublication', {
            publication: options.name,
            description: options.description || '',
            sync_method: options.type === 'snapshot' ? 'native' : 'concurrent',
            status: 'active'
        });

        // Set the working directory for snapshot files
        await this.sqlService.executeProcedure(connection, 'sp_changepublication', {
            publication: options.name,
            property: 'alt_snapshot_folder',
            value: options.snapshotFolder
        });

        // Add articles - simplified parameters
        for (const article of options.articles) {
            await this.sqlService.executeProcedure(connection, 'sp_addarticle', {
                publication: options.name,
                article: article,
                source_owner: 'dbo',
                source_object: article,
                destination_table: article,
                destination_owner: 'dbo'
            });
        }
    }

    public async validateDistributor(connection: SqlServerConnection): Promise<boolean> {
        try {
            // First check using sp_get_distributor
            const distInfo = await this.getDistributorInfo(connection);
            console.log('Distributor info from sp_get_distributor:', distInfo);
            
            if (!distInfo.isDistributor) {
                console.log('Server is not marked as a distributor according to sp_get_distributor');
                return false;
            }
            
            // Now let's explicitly check the distribution database existence
            const distributionDbName = distInfo.distributionDb || 'distribution';
            const dbResult = await this.sqlService.executeQuery<{ DatabaseExists: number }>(connection, `
                SELECT CASE WHEN DB_ID(N'${distributionDbName}') IS NOT NULL THEN 1 ELSE 0 END AS DatabaseExists
            `);
            
            if (!dbResult[0].DatabaseExists) {
                console.log(`Distribution database '${distributionDbName}' does not exist`);
                return false;
            }
            
            console.log(`Distribution database '${distributionDbName}' exists`);
            
            // Check if the distribution database contains the required tables
            try {
                const tablesResult = await this.sqlService.executeQuery<{ TableExists: number }>(connection, `
                    USE [${distributionDbName}]
                    SELECT CASE WHEN 
                        OBJECT_ID('MSdistribution_agents') IS NOT NULL
                    THEN 1 ELSE 0 END AS TableExists
                `);
                
                if (!tablesResult[0].TableExists) {
                    console.log(`Distribution database '${distributionDbName}' does not contain required tables`);
                    return false;
                }
                
                console.log(`Distribution database '${distributionDbName}' contains required tables`);
            } catch (error) {
                console.log(`Error checking tables in distribution database: ${error}`);
                // Even if we can't check tables, we've verified the database exists and sp_get_distributor says we're a distributor
                // So we'll still return true
            }
            
            // If we get here, the distribution database exists and we're marked as a distributor
            return true;
        } catch (error) {
            console.error('Failed to validate distributor:', error);
            
            // If everything else failed, try a direct check for the distribution database
            try {
                const fallbackResult = await this.sqlService.executeQuery<{ DatabaseExists: number }>(connection, `
                    SELECT CASE WHEN DB_ID('distribution') IS NOT NULL THEN 1 ELSE 0 END AS DatabaseExists
                `);
                
                if (fallbackResult[0].DatabaseExists) {
                    console.log("Fallback check: 'distribution' database exists");
                    return true;
                }
            } catch (fallbackError) {
                console.error('Fallback validation also failed:', fallbackError);
            }
            
            return false;
        }
    }

    public async getTables(connection: SqlServerConnection, database: string): Promise<string[]> {
        const result = await this.sqlService.executeQuery<{ TableName: string }>(connection, `
            USE [${database}]
            SELECT t.name AS TableName
            FROM sys.tables t
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.is_ms_shipped = 0
              AND s.name = 'dbo'
              AND t.name NOT LIKE 'sys%'
              AND t.name NOT LIKE 'MS%'
              AND t.name NOT IN (
                'sysdiagrams',
                'dtproperties',
                'syscategories',
                'syscolumns',
                'syscomments',
                'sysconstraints',
                'sysdepends',
                'sysfilegroups',
                'sysfiles',
                'sysfiles1',
                'sysforeignkeys',
                'sysfulltextcatalogs',
                'sysindexes',
                'sysindexkeys',
                'sysmembers',
                'sysobjects',
                'syspermissions',
                'sysprotects',
                'sysreferences',
                'systypes',
                'sysusers'
              )
            ORDER BY t.name
        `);
        return result.map(r => r.TableName);
    }

    public async getPublications(connection: SqlServerConnection): Promise<Publication[]> {
        try {
            // First validate the distributor to ensure we can query publications
            const isDistributorValid = await this.validateDistributor(connection);
            if (!isDistributorValid) {
                console.log('Server is not a valid distributor, cannot retrieve publications');
                return [];
            }

            // Get all user databases
            const databasesResult = await this.sqlService.executeQuery<{ name: string }>(connection, `
                SELECT name FROM sys.databases 
                WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb', 'distribution')
                AND state = 0 -- Online databases only
                ORDER BY name
            `) || [];
            
            const databases = databasesResult.map(db => db.name);
            console.log(`Found ${databases.length} user databases on ${connection.serverName}`);
            
            const allPublications: Publication[] = [];
            
            // Query publications from each database
            for (const dbName of databases) {
                try {
                    console.log(`Checking publications in database: ${dbName}`);
                    
                    const dbPublications = await this.sqlService.executeQuery<Publication>(connection, `
                        USE [${dbName}]
                        EXEC sp_helppublication
                    `) || [];
                    
                    // Add database name to each publication for reference
                    const publicationsWithDb = dbPublications.map(pub => ({
                        ...pub,
                        database: dbName
                    }));
                    
                    allPublications.push(...publicationsWithDb);
                    console.log(`Found ${dbPublications.length} publications in database ${dbName}`);
                } catch (error) {
                    console.log(`Error checking publications in ${dbName}: ${error}`);
                    // Continue with next database
                }
            }

            console.log(`Retrieved ${allPublications.length} total publications from ${connection.serverName}`);
            return allPublications;
        } catch (error) {
            console.error('Failed to get publications:', error);
            return [];
        }
    }

    public async createSubscription(connection: SqlServerConnection, options: SubscriptionOptions): Promise<void> {
        try {
            // First verify the publication exists
            const publicationExists = await this.sqlService.executeQuery<{ PublicationExists: number }>(connection, `
                USE [${options.publisherDatabase}]
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM syspublications WHERE name = '${options.publicationName}'
                ) THEN 1 ELSE 0 END AS PublicationExists
            `);

            if (!publicationExists[0].PublicationExists) {
                throw new Error(`Publication ${options.publicationName} does not exist in ${options.publisherDatabase}`);
            }

            // Create the subscriber database if it doesn't exist
            await this.sqlService.executeQuery(connection, `
                IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = '${options.subscriberDatabase}')
                BEGIN
                    CREATE DATABASE [${options.subscriberDatabase}]
                END
            `);

            // Set up parameters for sp_addsubscription
            const params: any = {
                publication: options.publicationName,
                subscriber: options.subscriberServer,
                destination_db: options.subscriberDatabase,
                subscription_type: options.type === 'push' ? 'push' : 'pull'
            };
            
            // Map our user-friendly sync_type values to SQL Server's expected values
            if (options.syncType === 'immediate') {
                // Use none for immediate initialization
                params.sync_type = 'none';
            } else if (options.syncType === 'manual') {
                // Use replication support only for manual initialization
                params.sync_type = 'replication support only';
            } else {
                // Default is 'automatic'
                params.sync_type = 'automatic';
            }
            
            // Add the subscription
            await this.sqlService.executeProcedure(connection, 'sp_addsubscription', params);

            // Add the subscription agent job based on type
            if (options.type === 'push') {
                // For push subscriptions
                const pushParams: any = {
                    publication: options.publicationName,
                    subscriber: options.subscriberServer,
                    subscriber_db: options.subscriberDatabase
                };
                
                // Only add security params if using SQL auth
                if (options.loginForRemoteConnections) {
                    pushParams.job_login = options.loginForRemoteConnections;
                    pushParams.job_password = options.passwordForRemoteConnections;
                    pushParams.subscriber_security_mode = 0; // SQL auth
                }
                
                await this.sqlService.executeProcedure(connection, 'sp_addpushsubscription_agent', pushParams);
            } else {
                // For pull subscriptions
                const pullParams: any = {
                    publication: options.publicationName,
                    publisher: options.publisherServer,
                    publisher_db: options.publisherDatabase
                };
                
                // Only add security params if using SQL auth
                if (options.loginForRemoteConnections) {
                    pullParams.job_login = options.loginForRemoteConnections;
                    pullParams.job_password = options.passwordForRemoteConnections;
                    pullParams.publisher_security_mode = 0; // SQL auth
                }
                
                await this.sqlService.executeProcedure(connection, 'sp_addpullsubscription_agent', pullParams);
            }
        } catch (error) {
            console.error('Failed to create subscription:', error);
            throw error;
        }
    }

    public async getSubscriptions(connection: SqlServerConnection): Promise<Subscription[]> {
        try {
            // Get all user databases
            const databasesResult = await this.sqlService.executeQuery<{ name: string }>(connection, `
                SELECT name FROM sys.databases 
                WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb', 'distribution')
                AND state = 0 -- Online databases only
                ORDER BY name
            `) || [];
            
            const databases = databasesResult.map(db => db.name);
            console.log(`Found ${databases.length} user databases to check for subscriptions on ${connection.serverName}`);
            
            const allSubscriptions: Subscription[] = [];
            
            // First, try to get subscription info directly from the distribution database
            // This is the most reliable source for subscription information
            try {
                const distInfo = await this.getDistributorInfo(connection);
                if (distInfo.isDistributor && distInfo.distributionDb) {
                    console.log(`Checking distribution database '${distInfo.distributionDb}' for subscriptions`);
                    
                    // Query the distribution tables for comprehensive subscription info
                    const distSubscriptions = await this.sqlService.executeQuery<{
                        publication: string;
                        publisher_db: string;
                        subscriber_name: string;
                        subscriber_db: string;
                        subscription_type: number;
                        status: string;
                        last_updated: Date;
                    }>(connection, `
                        USE [${distInfo.distributionDb}]
                        SELECT 
                            p.name as publication,
                            a.publisher_db,
                            s.subscriber_name,
                            s.subscriber_db,
                            s.subscription_type,
                            CASE 
                                WHEN agent.runstatus = 1 THEN 'Running'
                                WHEN agent.runstatus = 2 THEN 'Succeeded'
                                WHEN agent.runstatus = 3 THEN 'Idle'
                                WHEN agent.runstatus = 4 THEN 'Retry'
                                WHEN agent.runstatus = 5 THEN 'Failed'
                                ELSE 'Unknown'
                            END as status,
                            agent.time as last_updated
                        FROM MSdistribution_agents agent
                        JOIN MSsubscriptions s ON agent.subscriber_id = s.subscriber_id
                        JOIN MSarticles a ON s.article_id = a.article_id
                        JOIN MSpublications p ON s.publication_id = p.publication_id
                        WHERE p.publisher_id = (SELECT publisher_id FROM MSpublishers WHERE name = '${connection.serverName}')
                    `) || [];
                    
                    if (distSubscriptions.length > 0) {
                        const mappedDistSubscriptions = distSubscriptions.map(sub => ({
                            name: `${sub.publication}_${sub.subscriber_db}`,
                            publication: sub.publication,
                            publisher: connection.serverName,
                            publisherDb: sub.publisher_db,
                            subscriberDb: sub.subscriber_db,
                            subscription_type: sub.subscription_type === 0 ? 'push' : 'pull' as SubscriptionType,
                            sync_type: 'automatic', // Default
                            status: sub.status,
                            last_sync: sub.last_updated
                        }));
                        
                        allSubscriptions.push(...mappedDistSubscriptions);
                        console.log(`Found ${distSubscriptions.length} subscriptions in distribution database`);
                    } else {
                        console.log("No subscriptions found in MSdistribution_agents, trying alternative query");
                        
                        // If the above query finds nothing, try a simpler approach
                        const simpleDistSubscriptions = await this.sqlService.executeQuery<{
                            name: string;
                            publisher_db: string;
                            subscriber_db: string;
                            subscription_type: number;
                        }>(connection, `
                            USE [${distInfo.distributionDb}]
                            SELECT DISTINCT
                                p.name,
                                a.publisher_db,
                                s.subscriber_db,
                                s.subscription_type
                            FROM MSsubscriptions s
                            JOIN MSarticles a ON s.article_id = a.article_id
                            JOIN MSpublications p ON s.publication_id = p.publication_id
                            WHERE p.publisher_id = (SELECT publisher_id FROM MSpublishers WHERE name = '${connection.serverName}')
                        `) || [];
                        
                        if (simpleDistSubscriptions.length > 0) {
                            const mappedSimpleDistSubscriptions = simpleDistSubscriptions.map(sub => ({
                                name: `${sub.name}_${sub.subscriber_db}`,
                                publication: sub.name,
                                publisher: connection.serverName,
                                publisherDb: sub.publisher_db,
                                subscriberDb: sub.subscriber_db,
                                subscription_type: sub.subscription_type === 0 ? 'push' : 'pull' as SubscriptionType,
                                sync_type: 'automatic',
                                status: 'Active' // Default to active since we can see it in the distribution database
                            }));
                            
                            allSubscriptions.push(...mappedSimpleDistSubscriptions);
                            console.log(`Found ${simpleDistSubscriptions.length} subscriptions using alternative query`);
                        }
                    }
                }
            } catch (error) {
                console.log(`Error checking distribution database for subscriptions: ${error}`);
                // Continue with the sp_help* methods as fallback
            }
            
            // Only if we still have no subscriptions, try the sp_help* methods
            if (allSubscriptions.length === 0) {
                // Query subscriptions using the appropriate stored procedures
                for (const dbName of databases) {
                    try {
                        console.log(`Checking subscriptions in database: ${dbName}`);
                        
                        // Check for subscriptions using sp_helpsubscription stored procedure
                        await this.sqlService.executeQuery(connection, `USE [${dbName}]`);
                        
                        // First try sp_helpsubscription for push subscriptions (database as publisher)
                        try {
                            const subscriptions = await this.sqlService.executeQuery<{
                                publisher: string;
                                publisher_db: string;
                                publication: string;
                                independent_agent: boolean | number;
                                subscription_type: string;
                                distributor: string;
                                subscriber: string;
                                subscriber_db: string;
                                status: string;
                            }>(connection, `EXEC sp_helpsubscription`) || [];
                            
                            if (subscriptions.length > 0) {
                                const mappedSubscriptions = subscriptions.map(sub => {
                                    // Safely convert subscription_type to lowercase, default to 'push' if undefined
                                    const subType = typeof sub.subscription_type === 'string' ? 
                                        sub.subscription_type.toLowerCase() as SubscriptionType : 'push';
                                    
                                    return {
                                        name: `${sub.publication}_${sub.subscriber_db}`,
                                        publication: sub.publication,
                                        publisher: sub.publisher || connection.serverName,
                                        publisherDb: sub.publisher_db || dbName,
                                        subscriberDb: sub.subscriber_db,
                                        subscription_type: subType,
                                        sync_type: 'automatic', // Default since sp_helpsubscription doesn't return this
                                        status: sub.status || 'Active'
                                    };
                                });
                                
                                allSubscriptions.push(...mappedSubscriptions);
                                console.log(`Found ${subscriptions.length} subscriptions in database ${dbName} using sp_helpsubscription`);
                            }
                        } catch (error: any) {
                            // Ignore "not enabled for publication" errors since they're expected
                            if (error.message && error.message.includes('not enabled for publication')) {
                                console.log(`Database ${dbName} is not enabled for publication - skipping`);
                            } else {
                                console.log(`Error with sp_helpsubscription in ${dbName}: ${error}`);
                            }
                        }
                        
                        // Next try sp_helppullsubscription for pull subscriptions (database as subscriber)
                        try {
                            const pullSubscriptions = await this.sqlService.executeQuery<{
                                publisher: string;
                                publisher_db: string;
                                publication: string;
                                subscription_type: string;
                                sync_type: string;
                                status: string;
                            }>(connection, `EXEC sp_helppullsubscription`) || [];
                            
                            if (pullSubscriptions.length > 0) {
                                const mappedPullSubscriptions = pullSubscriptions.map(sub => ({
                                    name: `${sub.publication}_${dbName}`,
                                    publication: sub.publication,
                                    publisher: sub.publisher,
                                    publisherDb: sub.publisher_db,
                                    subscriberDb: dbName,
                                    subscription_type: 'pull' as SubscriptionType,
                                    sync_type: sub.sync_type || 'automatic',
                                    status: sub.status || 'Active'
                                }));
                                
                                allSubscriptions.push(...mappedPullSubscriptions);
                                console.log(`Found ${pullSubscriptions.length} pull subscriptions in database ${dbName}`);
                            }
                        } catch (error: any) {
                            // Ignore expected errors for databases not configured as subscribers
                            if (error.message && error.message.includes('not enabled for publication')) {
                                console.log(`Database ${dbName} is not enabled as a subscriber - skipping`);
                            } else {
                                console.log(`Error with sp_helppullsubscription in ${dbName}: ${error}`);
                            }
                        }
                        
                    } catch (error) {
                        console.log(`Error checking subscriptions in ${dbName}: ${error}`);
                        // Continue with next database
                    }
                }
            }

            console.log(`Retrieved ${allSubscriptions.length} total subscriptions from ${connection.serverName}`);
            return allSubscriptions;
        } catch (error) {
            console.error('Failed to get subscriptions:', error);
            return [];
        }
    }

    public async reinitializeSubscription(
        connection: SqlServerConnection,
        publisher: string,
        publisherDb: string,
        publication: string,
        subscriber: string,
        subscriberDb: string
    ): Promise<void> {
        try {
            // Execute the sp_reinitsubscription procedure 
            await this.sqlService.executeProcedure(connection, 'sp_reinitsubscription', {
                publication: publication,
                subscriber: subscriber,
                destination_db: subscriberDb,
                publisher: publisher,
                publisher_db: publisherDb,
                noexec: 0  // Actually execute the reinit
            });
        } catch (error) {
            console.error('Failed to reinitialize subscription:', error);
            throw error;
        }
    }

    public async dropSubscription(
        connection: SqlServerConnection, 
        publisher: string,
        publisherDb: string,
        publication: string,
        subscriber: string,
        subscriberDb: string,
        type: SubscriptionType
    ): Promise<void> {
        try {
            // For push subscriptions, use sp_dropsubscription
            // For pull subscriptions, use sp_droppullsubscription
            if (type === 'push') {
                await this.sqlService.executeProcedure(connection, 'sp_dropsubscription', {
                    publication: publication,
                    subscriber: subscriber,
                    destination_db: subscriberDb,
                    article: 'all'  // Drop all articles
                });
            } else {
                await this.sqlService.executeProcedure(connection, 'sp_droppullsubscription', {
                    publisher: publisher,
                    publisher_db: publisherDb,
                    publication: publication
                });
            }
        } catch (error) {
            console.error('Failed to drop subscription:', error);
            throw error;
        }
    }
} 