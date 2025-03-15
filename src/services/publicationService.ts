import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';
import { DistributorService } from './distributorService';
import { PublicationOptions, Publication, RawPublication, ReplicationType } from './interfaces';

export class PublicationService {
    private static instance: PublicationService;
    private sqlService: SqlService;
    private distributorService: DistributorService;

    private constructor() {
        this.sqlService = SqlService.getInstance();
        this.distributorService = DistributorService.getInstance();
    }

    public static getInstance(): PublicationService {
        if (!PublicationService.instance) {
            PublicationService.instance = new PublicationService();
        }
        
        return PublicationService.instance;
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

        // Create a Snapshot Agent job for the publication (this was missing)
        await this.sqlService.executeProcedure(connection, 'sp_addpublication_snapshot', {
            publication: options.name,
            publisher_security_mode: 1  // Windows Authentication
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

    public async getPublications(connection: SqlServerConnection): Promise<Publication[]> {
        try {
            // First resolve the actual server name
            const actualServerName = await this.distributorService.resolveServerName(connection);
            
            // First validate the distributor to ensure we can query publications
            const isDistributorValid = await this.distributorService.validateDistributor(connection);
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
            console.log(`Found ${databases.length} user databases on ${actualServerName}`);
            
            const allPublications: Publication[] = [];
            
            // Query publications from each database
            for (const dbName of databases) {
                try {
                    console.log(`Checking publications in database: ${dbName}`);
                    
                    const dbPublications = await this.sqlService.executeQuery<RawPublication>(connection, `
                        USE [${dbName}]
                        EXEC sp_helppublication
                    `) || [];
                    
                    // Add database name to each publication for reference
                    const publicationsWithDb = dbPublications.map(pub => {
                        // Determine type based on 'replication frequency' (with spaces in SQL column name)
                        // 0 = Transactional, 1 = Snapshot
                        let type: ReplicationType;
                        
                        // IMPORTANT: The SQL column name is 'replication frequency' with a space
                        //            replication frequency=0 means Transactional
                        //            replication frequency=1 means Snapshot
                        if (pub['replication frequency'] === 0) {
                            type = 'transactional';
                            console.log(`Publication ${pub.name} is TRANSACTIONAL (replication frequency=0)`);
                        } else {
                            type = 'snapshot';
                            console.log(`Publication ${pub.name} is SNAPSHOT (replication frequency=${pub['replication frequency']})`);
                        }
                        
                        const publication: Publication = {
                            name: pub.name,
                            description: pub.description,
                            type: type,
                            status: pub.status,
                            immediate_sync: pub.immediate_sync,
                            enabled_for_internet: pub.enabled_for_internet,
                            allow_push: pub.allow_push,
                            allow_pull: pub.allow_pull,
                            allow_anonymous: pub.allow_anonymous,
                            immediate_sync_ready: pub.immediate_sync_ready,
                            allow_sync_tran: pub.allow_sync_tran,
                            database: dbName
                        };
                        
                        return publication;
                    });
                    
                    allPublications.push(...publicationsWithDb);
                    console.log(`Found ${dbPublications.length} publications in database ${dbName}`);
                } catch (error) {
                    console.log(`Error checking publications in ${dbName}: ${error}`);
                    // Continue with next database
                }
            }

            console.log(`Retrieved ${allPublications.length} total publications from ${actualServerName}`);
            return allPublications;
        } catch (error) {
            console.error('Failed to get publications:', error);
            return [];
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
}
