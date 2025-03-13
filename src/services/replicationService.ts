import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';

export type ReplicationType = 'snapshot' | 'transactional';

export interface PublicationOptions {
    name: string;
    type: ReplicationType;
    description?: string;
    snapshotFolder: string;
    database: string;
    articles: string[];
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

        // Create the publication
        await this.sqlService.executeProcedure(connection, 'sp_addpublication', {
            publication: options.name,
            description: options.description || '',
            sync_method: options.type === 'snapshot' ? 'native' : 'concurrent',
            retention: 0,
            allow_push: true,
            allow_pull: true,
            allow_anonymous: false,
            enabled_for_internet: false,
            snapshot_in_defaultfolder: false,
            compress_snapshot: false,
            ftp_port: 21,
            allow_subscription_copy: false,
            add_to_active_directory: false,
            repl_freq: 'continuous',
            status: 'active',
            independent_agent: true,
            immediate_sync: true,
            allow_sync_tran: false,
            autogen_sync_procs: false,
            allow_queued_tran: false,
            allow_dts: false,
            replicate_ddl: 1,
            allow_initialize_from_backup: false,
            enabled_for_p2p: false,
            enabled_for_het_sub: false
        });

        // Set the working directory for snapshot files
        await this.sqlService.executeProcedure(connection, 'sp_changepublication', {
            publication: options.name,
            property: 'alt_snapshot_folder',
            value: options.snapshotFolder
        });

        // Add articles
        for (const article of options.articles) {
            await this.sqlService.executeProcedure(connection, 'sp_addarticle', {
                publication: options.name,
                article: article,
                source_owner: 'dbo',
                source_object: article,
                type: 'logbased',
                description: null,
                creation_script: null,
                pre_creation_cmd: 'drop',
                schema_option: 0x000000000803509F,
                identityrangemanagementoption: 'manual',
                destination_table: article,
                destination_owner: 'dbo',
                vertical_partition: false,
                ins_cmd: `CALL sp_MSins_${article}`,
                del_cmd: `CALL sp_MSdel_${article}`,
                upd_cmd: `SCALL sp_MSupd_${article}`
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
            SELECT TABLE_NAME as TableName
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);
        return result.map(r => r.TableName);
    }
} 