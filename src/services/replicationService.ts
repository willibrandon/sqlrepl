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
                distribution_db: string | null;
                directory: string | null;
                account: string | null;
                min_distretention: number;
                max_distretention: number;
                history_retention: number;
                is_distributor: boolean;
                is_publisher: boolean;
                is_subscriber: boolean;
                name: string | null;
            }>(connection, 'EXEC sp_get_distributor');

            const result = distInfo[0];
            
            return {
                isDistributor: result.is_distributor,
                isPublisher: result.is_publisher,
                distributionDb: result.distribution_db,
                workingDirectory: result.directory,
                remoteDist: {
                    isRemote: result.name !== null && result.name !== connection.serverName,
                    serverName: result.name
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
            // Check if server is a distributor
            const distributorResult = await this.sqlService.executeQuery<{ IsDistributor: number }>(connection, `
                SELECT SERVERPROPERTY('IsDistributor') as IsDistributor
            `);

            if (!distributorResult[0].IsDistributor) {
                console.log('Server is not marked as a distributor');
                return false;
            }

            // Check if distribution database exists and is properly configured
            const distributionDbResult = await this.sqlService.executeQuery<{ IsConfigured: number }>(connection, `
                IF EXISTS (
                    SELECT 1 
                    FROM sys.databases 
                    WHERE name = 'distribution'
                )
                AND EXISTS (
                    SELECT 1 
                    FROM [distribution].sys.tables 
                    WHERE name = 'MSdistribution_agents'
                )
                SELECT 1 as IsConfigured
                ELSE
                SELECT 0 as IsConfigured
            `);

            if (!distributionDbResult[0].IsConfigured) {
                console.log('Distribution database is not properly configured');
                return false;
            }

            // Check if the server is properly configured as its own distributor
            const serverConfigResult = await this.sqlService.executeQuery<{ IsConfigured: number }>(connection, `
                IF EXISTS (
                    SELECT 1 
                    FROM [distribution].dbo.MSdistributor_properties
                    WHERE property = 'installed'
                    AND CAST(value as int) = 1
                )
                AND EXISTS (
                    SELECT 1 
                    FROM [distribution].dbo.MSdistribution_agents
                )
                SELECT 1 as IsConfigured
                ELSE
                SELECT 0 as IsConfigured
            `);

            if (!serverConfigResult[0].IsConfigured) {
                console.log('Server distributor properties are not properly configured');
                return false;
            }

            console.log('Distributor validation successful');
            return true;
        } catch (error) {
            console.error('Failed to validate distributor:', error);
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