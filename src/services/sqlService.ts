import * as sql from 'mssql/msnodesqlv8';
import { SqlServerConnection } from './connectionService';

export class SqlService {
    private static instance: SqlService;
    private pools: Map<string, sql.ConnectionPool>;

    private constructor() {
        this.pools = new Map<string, sql.ConnectionPool>();
    }

    public static getInstance(): SqlService {
        if (!SqlService.instance) {
            SqlService.instance = new SqlService();
        }
        return SqlService.instance;
    }

    private getConnectionConfig(connection: SqlServerConnection): sql.config {
        console.log('Attempting to connect with server:', connection.serverName);

        // Build a connection string for ODBC Driver 17
        let connectionString = `Driver={ODBC Driver 17 for SQL Server};Server=${connection.serverName};Database=${connection.database || 'master'};`;
        
        // Add authentication details
        if (connection.authentication === 'windows') {
            connectionString += 'Trusted_Connection=yes;';
        } else {
            connectionString += `Uid=${connection.username};Pwd=${connection.password};`;
        }
        
        // Enable secure connections
        connectionString += 'TrustServerCertificate=yes;';
        
        console.log('Connection string (masked):', 
            connectionString.replace(/Pwd=[^;]*/, 'Pwd=***'));

        // Create a properly typed config object
        const config: sql.config = {
            server: connection.serverName, // Required for the type
            database: connection.database || 'master', // Required for the type
            driver: 'msnodesqlv8',
            options: {
                trustedConnection: connection.authentication === 'windows',
                trustServerCertificate: true
            } as any // Use type assertion to allow the connectionString property
        };
        
        // Add the connectionString as a custom property
        (config as any).connectionString = connectionString;
        
        return config;
    }

    private getPoolKey(connection: SqlServerConnection): string {
        return `${connection.serverName}_${connection.database || 'master'}_${connection.username || 'windows'}`;
    }

    private async getPool(connection: SqlServerConnection): Promise<sql.ConnectionPool> {
        const key = this.getPoolKey(connection);
        
        if (!this.pools.has(key)) {
            try {
                const config = this.getConnectionConfig(connection);
                console.log('Creating pool with config:', 
                    JSON.stringify({
                        ...config,
                        connectionString: (config as any).connectionString?.replace(/Pwd=[^;]*/, 'Pwd=***')
                    }, null, 2));
                
                // Force using the native msnodesqlv8 driver
                const pool = new sql.ConnectionPool(config);
                console.log('Connecting to pool...');
                await pool.connect();
                this.pools.set(key, pool);
                console.log(`Connected successfully to ${connection.serverName}`);
            } catch (error) {
                console.error(`Failed to connect to ${connection.serverName}:`, error);
                throw error;
            }
        }

        return this.pools.get(key)!;
    }

    public async executeQuery<T>(connection: SqlServerConnection, query: string): Promise<T[]> {
        try {
            const pool = await this.getPool(connection);
            const result = await pool.request().query(query);
            return result.recordset;
        } catch (error) {
            console.error(`Failed to execute query on ${connection.serverName}:`, error);
            throw error;
        }
    }

    public async executeProcedure<T>(
        connection: SqlServerConnection, 
        procedure: string, 
        params?: { [key: string]: any }
    ): Promise<T[]> {
        try {
            const pool = await this.getPool(connection);
            const request = pool.request();

            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    request.input(key, value);
                });
            }

            const result = await request.execute(procedure);
            return result.recordset;
        } catch (error) {
            console.error(`Failed to execute procedure ${procedure} on ${connection.serverName}:`, error);
            throw error;
        }
    }

    public async testConnection(connection: SqlServerConnection): Promise<boolean> {
        try {
            const pool = await this.getPool(connection);
            const result = await pool.request().query('SELECT @@VERSION as version');
            return result.recordset.length > 0;
        } catch (error) {
            console.error(`Connection test failed for ${connection.serverName}:`, error);
            return false;
        }
    }

    public async closeAll(): Promise<void> {
        for (const pool of this.pools.values()) {
            await pool.close();
        }
        this.pools.clear();
    }
}
