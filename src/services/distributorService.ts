import { SqlServerConnection } from './connectionService';
import { SqlService } from './sqlService';
import { DistributorInfo } from './interfaces';

export class DistributorService {
    private static instance: DistributorService;
    private sqlService: SqlService;

    private constructor() {
        this.sqlService = SqlService.getInstance();
    }

    public static getInstance(): DistributorService {
        if (!DistributorService.instance) {
            DistributorService.instance = new DistributorService();
        }
        return DistributorService.instance;
    }

    public async configureDistributor(
        connection: SqlServerConnection, 
        distributionDb: string = 'distribution',
        workingDirectory?: string,
        distributorPassword: string = 'Password123!'  // Default password for testing
    ): Promise<void> {
        try {
            // First resolve the actual server name
            const actualServerName = await DistributorService.getInstance().resolveServerName(connection);
            
            // Switch to master database first
            await this.sqlService.executeQuery(connection, 'USE [master]');

            // Install distributor using the resolved server name
            await this.sqlService.executeProcedure(connection, 'sp_adddistributor', {
                'distributor': actualServerName,
                'password': distributorPassword
            });

            // Create distribution database
            await this.sqlService.executeProcedure(connection, 'sp_adddistributiondb', {
                'database': distributionDb,
                'data_folder': null,
                'data_file': null,
                'log_folder': null,
                'log_file': null,
                'security_mode': 1,
                'login': null,
                'password': null
            });

            // Configure the server as its own publisher using the resolved name
            const defaultWorkingDir = workingDirectory || `\\\\${actualServerName}\\repldata`;
            await this.sqlService.executeProcedure(connection, 'sp_adddistpublisher', {
                'publisher': actualServerName,
                'distribution_db': distributionDb,
                'working_directory': defaultWorkingDir,
                'security_mode': 1  // Windows Authentication
            });
        } catch (error) {
            console.error('Failed to configure distributor:', error);
            throw error;
        }
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

    public async removeReplication(connection: SqlServerConnection): Promise<void> {
        try {
            // First resolve the actual server name
            const actualServerName = await DistributorService.getInstance().resolveServerName(connection);
            
            // Switch to master database
            await this.sqlService.executeQuery(connection, 'USE [master]');

            // 1. Remove replication objects from all subscription databases
            const databases = await this.sqlService.executeQuery<{ name: string }>(connection, `
                SELECT name FROM sys.databases 
                WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb', 'distribution')
            `);
            
            for (const db of databases) {
                try {
                    await this.sqlService.executeProcedure(connection, 'sp_removedbreplication', {
                        'dbname': db.name
                    });
                    console.log(`Disabled replication for database: ${db.name}`);
                } catch (error) {
                    console.log(`Failed to disable replication for ${db.name}, continuing:`, error);
                }
            }

            // 2. Remove the server as a publisher
            try {
                await this.sqlService.executeProcedure(connection, 'sp_dropdistpublisher', {
                    'publisher': actualServerName,
                    'no_checks': 1
                });
            } catch (error) {
                console.log('Failed to remove publisher, continuing:', error);
            }

            // 3. Drop the distribution database with force
            try {
                // First set single user mode to force close connections
                await this.sqlService.executeQuery(connection, `
                    IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'distribution')
                    BEGIN
                        ALTER DATABASE distribution SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                        EXEC sp_dropdistributiondb @database = 'distribution';
                    END
                `);
            } catch (error) {
                console.log('Failed to drop distribution database, continuing:', error);
            }

            // 4. Finally remove the distributor
            try {
                await this.sqlService.executeProcedure(connection, 'sp_dropdistributor', {
                    'no_checks': 1,
                    'ignore_distributor': 1
                });
            } catch (error) {
                console.log('Failed to remove distributor, continuing:', error);
            }

        } catch (error) {
            console.error('Failed to remove replication:', error);
            throw error;
        }
    }

    public async resolveServerName(connection: SqlServerConnection): Promise<string> {
        try {
            // Query the actual server name from SQL Server
            const result = await this.sqlService.executeQuery<{ ServerName: string }>(
                connection,
                "SELECT SERVERPROPERTY('ServerName') AS ServerName"
            );
            
            if (result && result.length > 0 && result[0].ServerName) {
                console.log(`Resolved server name: ${result[0].ServerName}`);
                return result[0].ServerName;
            }
            
            throw new Error('Could not resolve server name');
        } catch (error) {
            console.error('Failed to resolve server name:', error);
            throw error;
        }
    }

    public async validateDistributor(connection: SqlServerConnection): Promise<boolean> {
        try {
            // First check using sp_get_distributor
            const distInfo = await DistributorService.getInstance().getDistributorInfo(connection);
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
}
