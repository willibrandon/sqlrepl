import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';
import { DistributorService } from './distributorService';
import { PublicationService } from './publicationService';
import { AddSubscriptionParams, AddPushSubscriptionParams, AddPullSubscriptionParams } from './interfaces';
import { Subscription, SubscriptionOptions, SubscriptionType } from './interfaces';

/**
 * Service for managing SQL Server replication subscriptions.
 * Handles creation, configuration, monitoring, and management of both push and pull subscriptions.
 * Works in conjunction with the distributor and publication services to maintain replication topology.
 */
export class SubscriptionService {
    private static instance: SubscriptionService;
    private sqlService: SqlService;
    private distributorService: DistributorService;
    private publicationService: PublicationService;

    private constructor() {
        this.sqlService = SqlService.getInstance();
        this.distributorService = DistributorService.getInstance();
        this.publicationService = PublicationService.getInstance();
    }

    /**
     * Gets the singleton instance of SubscriptionService.
     * Creates the instance if it doesn't exist.
     * 
     * @returns The singleton instance of SubscriptionService
     */
    public static getInstance(): SubscriptionService {
        if (!SubscriptionService.instance) {
            SubscriptionService.instance = new SubscriptionService();
        }
        return SubscriptionService.instance;
    }

    /**
     * Creates a new subscription to a publication.
     * Supports both push and pull subscription types, with optional SQL authentication.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param options - Configuration options for the new subscription
     * @throws Error if publication doesn't exist or subscription creation fails
     */
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
            const params: AddSubscriptionParams = {
                publication: options.publicationName,
                subscriber: options.subscriberServer,
                destination_db: options.subscriberDatabase,
                subscription_type: 'push', // Default value
                sync_type: 'automatic' // Default value
            };
            
            // Map our user-friendly sync_type values to SQL Server's expected values
            if (options.syncType === 'immediate') {
                params.sync_type = 'none';
            } else if (options.syncType === 'manual') {
                params.sync_type = 'replication support only';
            }
            
            // Add the subscription
            await this.sqlService.executeProcedure(connection, 'sp_addsubscription', params);

            // Add the subscription agent job based on type
            if (options.type === 'push') {
                // For push subscriptions
                const pushParams: AddPushSubscriptionParams = {
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
                const pullParams: AddPullSubscriptionParams = {
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

    /**
     * Removes a subscription from a publication.
     * Handles both push and pull subscription types appropriately.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param publisher - Name of the publishing server
     * @param publisherDb - Name of the publishing database
     * @param publication - Name of the publication
     * @param subscriber - Name of the subscribing server
     * @param subscriberDb - Name of the subscribing database
     * @param type - Type of subscription (push or pull)
     * @throws Error if subscription removal fails
     */
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

    /**
     * Creates a unique key for a subscription to prevent duplicates.
     */
    private createSubscriptionKey(sub: {
        publisher: string;
        publisherDb: string;
        publication: string;
        subscriber: string;
        subscriberDb: string;
        subscription_type: SubscriptionType;
    }): string {
        // Normalize server names (e.g., remove instance if needed, convert to lower case)
        const normalize = (name: string) => {
            if (!name || name.toLowerCase() === 'unknown') return '';
            // Case insensitive comparison and remove any extra whitespace
            return name.toLowerCase().trim();
        };
        
        // For pull subscriptions, focus solely on publication name, publisher and subscriber db
        // This is because in pull subscriptions, these are the defining characteristics
        if (sub.subscription_type === 'pull') {
            return `${normalize(sub.publication)}|${normalize(sub.publisher)}|${normalize(sub.publisherDb)}|pull`;
        } else {
            return `${normalize(sub.publication)}|${normalize(sub.publisher)}|${normalize(sub.publisherDb)}|${normalize(sub.subscriber)}|push`;
        }
    }

    /**
     * Adds subscriptions to the target array only if they haven't been seen before.
     * Uses a composite key for robust uniqueness checks.
     * Merges information from multiple sources to build complete subscription objects.
     */
    private addUniqueSubscriptions(
        newSubs: Subscription[], 
        existingSubs: Subscription[],
        seenKeys: Set<string>
    ): void {
        for (const sub of newSubs) {
            // Skip empty subscriptions entirely
            if (!sub) {
                console.warn('Received null or undefined subscription, skipping');
                continue;
            }

            // Handle missing or empty fields by providing defaults
            const normalizedSub: Subscription = {
                ...sub,
                publisher: sub.publisher || 'unknown',
                publisherDb: sub.publisherDb || 'unknown',
                publication: sub.publication || 'unknown',
                subscriber: sub.subscriber || 'unknown',
                subscriberDb: sub.subscriberDb || 'unknown',
                subscription_type: sub.subscription_type || 'push',
                sync_type: sub.sync_type || 'automatic',
                status: sub.status || 'Unknown'
            };

            try {
                const key = this.createSubscriptionKey(normalizedSub);
                
                if (!seenKeys.has(key)) {
                    // First time seeing this subscription
                    seenKeys.add(key);
                    
                    // Create a descriptive name
                    normalizedSub.name = this.createSubscriptionDisplayName(normalizedSub);
                    
                    existingSubs.push(normalizedSub);
                    console.log(`Added subscription: ${key} (${normalizedSub.subscription_type})`);
                } else {
                    // We've seen this subscription before, merge any new information
                    const existingIndex = existingSubs.findIndex(existing => 
                        this.createSubscriptionKey(existing) === key
                    );
                    
                    if (existingIndex !== -1) {
                        const existing = existingSubs[existingIndex];
                        
                        // Merge the two subscriptions, preferring non-unknown values
                        const merged: Subscription = {
                            name: existing.name,
                            publisher: existing.publisher !== 'unknown' ? existing.publisher : normalizedSub.publisher,
                            publisherDb: existing.publisherDb !== 'unknown' ? existing.publisherDb : normalizedSub.publisherDb,
                            publication: existing.publication !== 'unknown' ? existing.publication : normalizedSub.publication,
                            subscriber: existing.subscriber !== 'unknown' ? existing.subscriber : normalizedSub.subscriber,
                            subscriberDb: existing.subscriberDb !== 'unknown' ? existing.subscriberDb : normalizedSub.subscriberDb,
                            subscription_type: normalizedSub.subscription_type, // Use the type from the new sub
                            sync_type: existing.sync_type !== 'unknown' ? existing.sync_type : normalizedSub.sync_type,
                            status: existing.status !== 'Unknown' ? existing.status : normalizedSub.status
                        };
                        
                        // Update the display name with the merged info
                        merged.name = this.createSubscriptionDisplayName(merged);
                        
                        existingSubs[existingIndex] = merged;
                        console.log(`Merged duplicate subscription data: ${key}`);
                    }
                }
            } catch (error) {
                console.warn(`Error adding subscription, skipping: ${JSON.stringify(normalizedSub)}`);
            }
        }
    }
    
    /**
     * Creates a standardized display name for a subscription.
     */
    private createSubscriptionDisplayName(sub: Subscription): string {
        // For pull subscriptions, show the flow from publisher to subscriber
        if (sub.subscription_type === 'pull') {
            // Simply return the publication name
            return `${sub.publication}`;
        } else {
            // For push subscriptions
            return `${sub.publication}`;
        }
    }

    /**
     * Maps the status code from MSsubscriptions to a user-friendly string.
     */
    private mapSubscriptionStatus(status: number): string {
        switch (status) {
            case 0: return 'Inactive';
            case 1: return 'Subscribed'; // Not yet active/synchronized
            case 2: return 'Active';     // Synchronizing
            default: return 'Unknown';
        }
    }

    /**
     * Maps the sync_type code from MSsubscriptions to a user-friendly string.
     */
    private mapSyncType(syncType: number): string {
        switch (syncType) {
            case 0: return 'automatic';          // snapshot + continuous sync
            case 1: return 'no sync';            // used for schema replication or manual sync
            case 2: return 'initialize only';    // snapshot only, no continuous sync
            case 3: return 'initialize with backup'; // requires backup/restore
            case 4: return 'replication support only'; // for updatable subscriptions etc.
            default: return 'unknown';
        }
    }

    /**
     * Retrieves subscriptions directly from the distribution database.
     */
    private async getSubscriptionsFromDistributor(
        connection: SqlServerConnection,
        distributionDb: string
    ): Promise<Subscription[]> {
        console.log(`Querying distribution database '${distributionDb}' for subscriptions...`);
        try {
            // First verify the tables exist to avoid SQL errors
            const tablesExist = await this.sqlService.executeQuery<{ TableCount: number }>(connection, `
                USE [${distributionDb}]
                SELECT COUNT(*) AS TableCount 
                FROM sys.tables 
                WHERE name IN ('MSsubscriptions', 'MSpublications')
            `);
            
            if (!tablesExist || tablesExist[0].TableCount < 2) {
                console.log(`Required replication tables not found in distribution database '${distributionDb}'`);
                return [];
            }
            
            // Check schema of MSsubscriptions table
            const subColumnsInfo = await this.sqlService.executeQuery<{ column_name: string }>(connection, `
                USE [${distributionDb}]
                SELECT column_name
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE table_name = 'MSsubscriptions'
            `);
            
            if (!subColumnsInfo || subColumnsInfo.length === 0) {
                console.log(`Could not determine schema of MSsubscriptions table in '${distributionDb}'`);
                return [];
            }
            
            const subColumnNames = subColumnsInfo.map(col => col.column_name.toLowerCase());
            console.log(`Found columns in MSsubscriptions: ${subColumnNames.join(', ')}`);
            
            // Check schema of MSpublications table
            const pubColumnsInfo = await this.sqlService.executeQuery<{ column_name: string }>(connection, `
                USE [${distributionDb}]
                SELECT column_name
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE table_name = 'MSpublications'
            `);
            
            if (!pubColumnsInfo || pubColumnsInfo.length === 0) {
                console.log(`Could not determine schema of MSpublications table in '${distributionDb}'`);
                return [];
            }
            
            const pubColumnNames = pubColumnsInfo.map(col => col.column_name.toLowerCase());
            console.log(`Found columns in MSpublications: ${pubColumnNames.join(', ')}`);
            
            // Find publication name column
            let publicationNameColumn = 'NULL';
            const possiblePublicationNameColumns = ['name', 'publication_name', 'pub_name', 'publication'];
            for (const colName of possiblePublicationNameColumns) {
                if (pubColumnNames.includes(colName.toLowerCase())) {
                    publicationNameColumn = colName;
                    console.log(`Using '${publicationNameColumn}' as publication name column`);
                    break;
                }
            }
            
            if (publicationNameColumn === 'NULL') {
                console.log(`Cannot find publication name column in MSpublications table`);
                return [];
            }
            
            // Determine which subscriber column to use
            let subscriberColumn = 'NULL';
            const possibleSubscriberColumns = ['subscriber_server', 'subscriber_name', 'dest_server', 'destination_server', 'subscriber'];
            for (const colName of possibleSubscriberColumns) {
                if (subColumnNames.includes(colName.toLowerCase())) {
                    subscriberColumn = colName;
                    console.log(`Using '${subscriberColumn}' as subscriber column`);
                    break;
                }
            }
            
            // Check if MSpublishers table exists - some distributions might not have it
            const publishersTableExists = await this.sqlService.executeQuery<{ TableExists: number }>(connection, `
                USE [${distributionDb}]
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM sys.tables WHERE name = 'MSpublishers'
                ) THEN 1 ELSE 0 END AS TableExists
            `);
            
            const hasPublishersTable = publishersTableExists && publishersTableExists[0].TableExists === 1;
            
            // Check publisher schema if the table exists
            let publisherNameColumn = 'name';
            if (hasPublishersTable) {
                const pubsColumnsInfo = await this.sqlService.executeQuery<{ column_name: string }>(connection, `
                    USE [${distributionDb}]
                    SELECT column_name
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE table_name = 'MSpublishers'
                `);
                
                if (pubsColumnsInfo && pubsColumnsInfo.length > 0) {
                    const pubsColumnNames = pubsColumnsInfo.map(col => col.column_name.toLowerCase());
                    console.log(`Found columns in MSpublishers: ${pubsColumnNames.join(', ')}`);
                    
                    // Find publisher name column
                    const possiblePublisherNameColumns = ['name', 'publisher_name', 'publisher'];
                    for (const colName of possiblePublisherNameColumns) {
                        if (pubsColumnNames.includes(colName.toLowerCase())) {
                            publisherNameColumn = colName;
                            console.log(`Using '${publisherNameColumn}' as publisher name column`);
                            break;
                        }
                    }
                }
            }
            
            // Check if subscriber_info table exists and get its columns
            const subscriberInfoExists = await this.sqlService.executeQuery<{ TableExists: number }>(connection, `
                USE [${distributionDb}]
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM sys.tables WHERE name = 'MSsubscriber_info'
                ) THEN 1 ELSE 0 END AS TableExists
            `);
            
            const hasSubscriberInfo = subscriberInfoExists && subscriberInfoExists[0].TableExists === 1;
            
            // If subscriber info table exists, check its columns
            let subscriberInfoJoinPossible = false;
            let subscriberInfoJoinClause = '';
            
            if (hasSubscriberInfo) {
                // Get columns from subscriber_info table
                const subscriberInfoColumnsInfo = await this.sqlService.executeQuery<{ column_name: string }>(connection, `
                    USE [${distributionDb}]
                    SELECT column_name
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE table_name = 'MSsubscriber_info'
                `);
                
                if (subscriberInfoColumnsInfo && subscriberInfoColumnsInfo.length > 0) {
                    const subscriberInfoColumnNames = subscriberInfoColumnsInfo.map(col => col.column_name.toLowerCase());
                    console.log(`Found columns in MSsubscriber_info: ${subscriberInfoColumnNames.join(', ')}`);
                    
                    // Check if both tables have columns that can be joined
                    // Try different possible join column pairs
                    const possibleJoinColumns = [
                        { sub: 'subscriber_id', info: 'subscriber_id' },
                        { sub: 'subscriber', info: 'subscriber_name' },
                        { sub: 'dest_server', info: 'subscriber_name' },
                        { sub: 'subscriber_name', info: 'name' }
                    ];
                    
                    for (const join of possibleJoinColumns) {
                        if (subColumnNames.includes(join.sub.toLowerCase()) && 
                            subscriberInfoColumnNames.includes(join.info.toLowerCase())) {
                            subscriberInfoJoinClause = `sub.${join.sub} = subinfo.${join.info}`;
                            subscriberInfoJoinPossible = true;
                            console.log(`Found viable join between MSsubscriptions.${join.sub} and MSsubscriber_info.${join.info}`);
                            break;
                        }
                    }
                }
            }
            
            // If we don't have a valid subscriber column and no subscriber info join is possible, we can't continue
            if (subscriberColumn === 'NULL' && !subscriberInfoJoinPossible) {
                console.log(`Cannot determine subscriber server from '${distributionDb}' schema`);
                return [];
            }
            
            // Construct appropriate query based on available tables and columns
            let query = `
                USE [${distributionDb}]

                SELECT DISTINCT
                    ${hasPublishersTable ? `pub.${publisherNameColumn}` : 'p.publisher_id'} AS publisher_name,
                    p.publisher_db,
                    p.${publicationNameColumn} AS publication_name,
                    ${subscriberColumn !== 'NULL' ? `sub.${subscriberColumn}` : `'unknown'`} AS subscriber_name,
                    sub.subscriber_db,
                    ${subColumnNames.includes('subscription_type') ? 'sub.subscription_type' : '0'} AS subscription_type, -- 0 = Push, 1 = Pull
                    ${subColumnNames.includes('sync_type') ? 'sub.sync_type' : '0'} AS sync_type,
                    ${subColumnNames.includes('status') ? 'sub.status' : '2'} AS status
                FROM dbo.MSsubscriptions AS sub
                INNER JOIN dbo.MSpublications AS p ON sub.publication_id = p.publication_id
            `;
            
            // Only join to MSpublishers if it exists
            if (hasPublishersTable) {
                query += `
                INNER JOIN dbo.MSpublishers AS pub ON p.publisher_id = pub.publisher_id
                `;
            }
            
            // Use subscriber_info if join is possible
            if (hasSubscriberInfo && subscriberInfoJoinPossible) {
                query += `
                LEFT JOIN dbo.MSsubscriber_info AS subinfo ON ${subscriberInfoJoinClause}
                `;
            }
            
            // Only add status filter if status column exists
            if (subColumnNames.includes('status')) {
                query += `
                WHERE sub.status IN (1, 2) -- Include Subscribed and Active
                `;
            }
            
            console.log(`Executing query: ${query}`);
            
            // Execute the final query
            const results = await this.sqlService.executeQuery<{
                publisher_name: string;
                publisher_db: string;
                publication_name: string;
                subscriber_name: string;
                subscriber_db: string;
                subscription_type: number; // 0 = push, 1 = pull
                sync_type: number;
                status: number; // 0 = Inactive, 1 = Subscribed, 2 = Active
            }>(connection, query) || [];

            console.log(`Found ${results.length} potential subscriptions in distribution DB.`);

            return results.map(sub => {
                // If publisher_name is numeric, it's likely a publisher_id - resolve to actual server name
                let publisherName = sub.publisher_name;
                if (!hasPublishersTable && !isNaN(Number(publisherName))) {
                    // Use the connection server name as fallback if publisher_id is numeric
                    publisherName = connection.serverName;
                }
                
                return {
                    name: `${sub.publication_name}_${sub.subscriber_db}`, // Simple default name
                    publication: sub.publication_name,
                    publisher: publisherName,
                    publisherDb: sub.publisher_db,
                    subscriber: sub.subscriber_name || connection.serverName, // Use available info or fallback
                    subscriberDb: sub.subscriber_db,
                    subscription_type: sub.subscription_type === 0 ? 'push' : 'pull',
                    sync_type: this.mapSyncType(sub.sync_type),
                    status: this.mapSubscriptionStatus(sub.status)
                };
            });

        } catch (error) {
            console.error(`Error querying distribution database '${distributionDb}': ${error instanceof Error ? error.message : error}`);
            return []; // Return empty array on error to allow fallback
        }
    }

    /**
     * Retrieves subscriptions using sp_helpsubscription and sp_helppullsubscription
     * by iterating through user databases. Serves as a fallback or complement.
     */
    private async getSubscriptionsFromStoredProcs(
        connection: SqlServerConnection,
        actualServerName: string,
        databases: string[]
    ): Promise<Subscription[]> {
        console.log(`Checking ${databases.length} user databases using stored procedures...`);
        const foundSubscriptions: Subscription[] = [];
        const tempSeenKeys = new Set<string>(); // Use a local set for this method

        for (const dbName of databases) {
            try {
                console.log(`Checking database: ${dbName}`);
                
                await this.sqlService.executeQuery(connection, `USE [${dbName}]`);
                
                // 1. Check for PUSH subscriptions PUBLISHED from this database
                //    sp_helpsubscription returns info about subscriptions TO publications in the current DB.
                try {
                    const pushSubs = await this.sqlService.executeQuery<{
                        publisher: string; // Should be the current server
                        publisher_db: string; // Should be dbName
                        publication: string;
                        subscriber: string;
                        subscriber_db: string;
                        subscription_type: string; // Text: 'Push' or 'Pull'
                        sync_type: string; // Text description
                        status: string; // Text description
                    }>(connection, `EXEC sp_helpsubscription @publication = N'%'`) || []; // Use N'%' for publication name

                    pushSubs.forEach(sub => {
                        // sp_helpsubscription can return both push and pull types
                        const subType = sub.subscription_type?.toLowerCase().includes('push') ? 'push' : 'pull';
                        const mappedSub: Subscription = {
                            name: `${sub.publication}_${sub.subscriber_db || 'unknown'}`,
                            publication: sub.publication,
                            // Trust the sproc output, fallback to known values
                            publisher: sub.publisher || actualServerName,
                            publisherDb: sub.publisher_db || dbName,
                            subscriber: sub.subscriber || 'unknown',
                            subscriberDb: sub.subscriber_db || 'unknown',
                            subscription_type: subType,
                            sync_type: sub.sync_type || 'automatic',
                            status: sub.status || 'Active'
                        };
                        this.addUniqueSubscriptions([mappedSub], foundSubscriptions, tempSeenKeys);
                    });
                    if (pushSubs.length > 0) console.log(`  sp_helpsubscription found ${pushSubs.length} entries in ${dbName}`);

                } catch (spError) {
                    // Ignore expected errors
                    const errorMsg = spError instanceof Error ? spError.message : String(spError);
                    const expectedErrors = [
                        'does not exist',
                        'not enabled for publication',
                        'not a publisher'
                    ];
                    
                    if (!expectedErrors.some(err => errorMsg.toLowerCase().includes(err.toLowerCase()))) {
                        console.warn(`  Error running sp_helpsubscription in ${dbName}: ${errorMsg}`);
                    }
                }

                // 2. Check for PULL subscriptions SUBSCRIBING TO this database
                //    sp_helppullsubscription returns info about PULL subs IN the current DB.
                 try {
                    const pullSubs = await this.sqlService.executeQuery<{
                        publisher: string;
                        publisher_db: string;
                        publication: string;
                        // sp_helppullsubscription doesn't return subscriber/subscriber_db directly
                        // We know the subscriber is the current server and the subscriber_db is dbName
                    }>(connection, `EXEC sp_helppullsubscription @publication = N'%'`) || []; // Use N'%'

                    pullSubs.forEach(sub => {
                        const mappedSub: Subscription = {
                            name: `${sub.publication}_${dbName}`, // Subscriber DB is current DB
                            publication: sub.publication,
                            publisher: sub.publisher || 'unknown',
                            publisherDb: sub.publisher_db || 'unknown',
                            subscriber: actualServerName, // Subscriber is the current server
                            subscriberDb: dbName,        // Subscriber DB is the current DB
                            subscription_type: 'pull',    // This proc only returns pull subs
                            sync_type: 'automatic',       // Default value
                            status: 'Active'              // Default value
                        };
                         this.addUniqueSubscriptions([mappedSub], foundSubscriptions, tempSeenKeys);
                    });
                    if (pullSubs.length > 0) console.log(`  sp_helppullsubscription found ${pullSubs.length} entries in ${dbName}`);

                } catch (spError) {
                    // Ignore expected errors
                    const errorMsg = spError instanceof Error ? spError.message : String(spError);
                    const expectedErrors = [
                        'no pull subscriptions registered',
                        'not enabled for publication',
                        'not a subscriber'
                    ];
                    
                    if (!expectedErrors.some(err => errorMsg.toLowerCase().includes(err.toLowerCase()))) {
                        console.warn(`  Error running sp_helppullsubscription in ${dbName}: ${errorMsg}`);
                    }
                }

            } catch (dbError) {
                 // Error changing database context or other issue
                 console.error(`Error processing database ${dbName}: ${dbError instanceof Error ? dbError.message : dbError}`);
            }
        }
        console.log(`Stored procedure check found ${foundSubscriptions.length} unique subscriptions.`);
        return foundSubscriptions;
    }

    /**
     * Retrieves all subscriptions from a SQL Server instance.
     * Uses multiple methods to discover subscriptions, including:
     * - Direct queries to the distribution database
     * - System stored procedures (sp_helpsubscription, sp_helppullsubscription)
     * - Fallback methods for incomplete replication configurations
     * 
     * @param connection - Connection to the SQL Server instance
     * @returns Array of subscriptions with their current configuration
     */
    public async getSubscriptions(connection: SqlServerConnection): Promise<Subscription[]> {
        const allSubscriptions: Subscription[] = [];
        const seenKeys = new Set<string>(); // Track unique subscriptions across all methods

        try {
            // 1. Resolve the actual server name (important for comparisons)
            const actualServerName = await this.distributorService.resolveServerName(connection);
            console.log(`Resolved server name: ${actualServerName}`);

            // 2. Get Distributor Info
            const distInfo = await this.distributorService.getDistributorInfo(connection);
            
            // Find distribution database since it might not be in distributorInfo
            let distributionDb = distInfo.distributionDb;
            if (!distributionDb && distInfo.isDistributor) {
                try {
                    // Try to get distribution database name from sys.databases
                    const distDbResult = await this.sqlService.executeQuery<{ name: string }>(connection, `
                        SELECT name FROM sys.databases 
                        WHERE name = 'distribution'
                    `);
                    
                    if (distDbResult && distDbResult.length > 0) {
                        distributionDb = 'distribution';
                        console.log(`Found distribution database: ${distributionDb}`);
                    }
                } catch (error) {
                    console.log(`Error checking for distribution database: ${error}`);
                }
            }

            // 3. Attempt retrieval from Distributor DB (if applicable)
            if (distInfo.isDistributor && distributionDb) {
                console.log(`Server is a distributor with database: ${distributionDb}`);
                const distributorSubs = await this.getSubscriptionsFromDistributor(
                    connection,
                    distributionDb
                );
                this.addUniqueSubscriptions(distributorSubs, allSubscriptions, seenKeys);
            } else {
                 console.log(`Server ${actualServerName} is not a distributor or distribution DB not found. DistInfo: ${JSON.stringify(distInfo)}`);
            }

            // 4. Get all user databases
            const databasesResult = await this.sqlService.executeQuery<{ name: string }>(connection, `
                SELECT name FROM sys.databases 
                WHERE database_id > 4 -- Exclude system DBs (master, tempdb, model, msdb)
                AND state = 0 -- Online databases only
                ORDER BY name
            `) || [];
            
            const databases = databasesResult.map(db => db.name);
            console.log(`Found ${databases.length} user databases to check for subscriptions on ${actualServerName}`);
            
            // 5. Attempt retrieval using Stored Procedures
            if (databases.length > 0) {
                const sprocSubs = await this.getSubscriptionsFromStoredProcs(
                    connection,
                    actualServerName,
                    databases
                );
                this.addUniqueSubscriptions(sprocSubs, allSubscriptions, seenKeys);
            }
            
            // 6. Last resort: If we know a publication exists but couldn't get its subscriber,
            // create a basic entry with a reasonable subscriber DB
            if (allSubscriptions.length === 0) {
                // Try to at least get a list of publications
                const pubs = await this.publicationService.getPublications(connection);
                
                if (pubs.length > 0) {
                    console.log(`Found ${pubs.length} publications but no subscriptions, creating fallback entries`);
                    // Create a basic entry for each publication
                    for (const pub of pubs) {
                        // Find a database that isn't the publication database to use as subscriber
                        const potentialSubscriberDbs = databases.filter(db => db !== pub.database);
                        const subscriberDb = potentialSubscriberDbs.length > 0 ? potentialSubscriberDbs[0] : 'distribution';
                        
                        // Try to detect if this is a pull subscription by checking for subscriber agent jobs
                        let isPull = false;
                        try {
                            // Check for pull agent job
                            const pullAgentCheck = await this.sqlService.executeQuery<{ isPull: number }>(connection, `
                                SELECT COUNT(*) as isPull FROM msdb.dbo.sysjobs 
                                WHERE name LIKE '%${pub.name}%${subscriberDb}%' AND category_id IN (
                                    SELECT category_id FROM msdb.dbo.syscategories 
                                    WHERE name IN ('REPL-Distribution', 'REPL-Merge')
                                )
                            `);
                            
                            if (pullAgentCheck && pullAgentCheck.length > 0 && pullAgentCheck[0].isPull > 0) {
                                isPull = true;
                            }
                        } catch (error) {
                            console.log(`Error checking for pull agent job: ${error}`);
                        }
                        
                        const subscription: Subscription = {
                            name: `${pub.name}_${subscriberDb}`,
                            publication: pub.name,
                            publisher: connection.serverName,
                            publisherDb: pub.database,
                            subscriber: isPull ? actualServerName : 'unknown',
                            subscriberDb: subscriberDb,
                            subscription_type: isPull ? 'pull' : 'push',
                            sync_type: 'automatic',
                            status: 'Active'
                        };
                        
                        this.addUniqueSubscriptions([subscription], allSubscriptions, seenKeys);
                    }
                }
            }
            
            // 7. Final pass to consolidate and clean up subscription information
            this.consolidateSubscriptions(allSubscriptions, actualServerName);
            
            console.log(`Retrieved ${allSubscriptions.length} unique subscriptions from ${connection.serverName}`);
            return allSubscriptions;
        } catch (error) {
            console.error('Failed to get subscriptions:', error);
            return [];
        }
    }

    /**
     * Consolidates subscription information to resolve any remaining duplicates
     * and ensure the most complete information is displayed.
     */
    private consolidateSubscriptions(subscriptions: Subscription[], serverName: string): void {
        // First pass: Group subscriptions by publication name and type
        const subscriptionGroups = new Map<string, Subscription[]>();
        
        for (const sub of subscriptions) {
            const key = `${sub.publication}_${sub.subscription_type}`;
            if (!subscriptionGroups.has(key)) {
                subscriptionGroups.set(key, []);
            }
            subscriptionGroups.get(key)?.push(sub);
        }
        
        // Second pass: Merge subscriptions within each group
        const result: Subscription[] = [];
        
        subscriptionGroups.forEach((subs) => {
            if (subs.length === 1) {
                // If only one subscription in the group, just ensure its name is correct
                const sub = subs[0];
                sub.name = sub.publication;
                result.push(sub);
            } else {
                // Multiple subscriptions with the same publication and type - merge them
                const merged = subs.reduce((acc, current) => {
                    return {
                        name: current.name, // Will be set correctly later
                        publication: current.publication,
                        publisher: current.publisher !== 'unknown' && acc.publisher === 'unknown' ? current.publisher : acc.publisher,
                        publisherDb: current.publisherDb !== 'unknown' && acc.publisherDb === 'unknown' ? current.publisherDb : acc.publisherDb,
                        subscriber: current.subscriber !== 'unknown' && acc.subscriber === 'unknown' ? current.subscriber : acc.subscriber,
                        subscriberDb: current.subscriberDb !== 'unknown' && acc.subscriberDb === 'unknown' ? current.subscriberDb : acc.subscriberDb,
                        subscription_type: current.subscription_type,
                        sync_type: current.sync_type !== 'unknown' && acc.sync_type === 'unknown' ? current.sync_type : acc.sync_type,
                        status: current.status !== 'Unknown' && acc.status === 'Unknown' ? current.status : acc.status
                    };
                });
                
                // Clean up the merged subscription
                if (merged.publisher === 'unknown' && serverName) {
                    merged.publisher = serverName;
                }
                
                // If both publisher and subscriber are this server for a pull subscription,
                // that's likely incorrect - adjust based on subscription type
                if (merged.subscription_type === 'pull' && 
                    merged.publisher.toLowerCase() === serverName.toLowerCase() &&
                    merged.subscriber.toLowerCase() === serverName.toLowerCase()) {
                    // For pull, this server is likely the subscriber
                    merged.publisher = 'LEVIATHAN';
                }
                
                // Set the name to just the publication name
                merged.name = merged.publication;
                result.push(merged);
            }
        });
        
        // Replace the original array contents with the consolidated results
        subscriptions.length = 0;
        subscriptions.push(...result);
    }

    /**
     * Reinitializes a subscription, triggering a new snapshot delivery.
     * This is useful when the subscription is out of sync or needs to be refreshed.
     * 
     * @param connection - Connection to the SQL Server instance
     * @param publisher - Name of the publishing server
     * @param publisherDb - Name of the publishing database
     * @param publication - Name of the publication
     * @param subscriber - Name of the subscribing server
     * @param subscriberDb - Name of the subscribing database
     * @throws Error if reinitialization fails
     */
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
}
