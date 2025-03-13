import * as sql from 'mssql';
import { SqlServerConnection } from './connectionService';

// Type for stored procedure parameters that can handle all SQL Server data types
type SqlProcedureParams = {
    [key: string]: string | number | boolean | Date | Buffer | null | undefined;
};

export class SqlService {
    private static instance: SqlService;
    private pools: Map<string, sql.ConnectionPool>;

    protected constructor() {
        this.pools = new Map<string, sql.ConnectionPool>();
    }

    public static getInstance(): SqlService {
        if (!SqlService.instance) {
            SqlService.instance = new SqlService();
        }
        return SqlService.instance;
    }

    // For testing purposes
    public static createTestInstance(): SqlService {
        return new SqlService();
    }

    // Made protected for testing
    protected getConnectionConfig(connection: SqlServerConnection | string): sql.config {
        // First check if connection is undefined
        if (!connection) {
            throw new Error('Connection parameter cannot be undefined');
        }

        let config: sql.config;

        // Check string first since it's our most common case for testing
        if (typeof connection === 'string') {
            // Parse connection string
            const params = new Map<string, string>();
            connection.split(';').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value) {
                    params.set(key.trim().toLowerCase(), value.trim());
                }
            });

            // Create connection config from string
            const serverAndPort = (params.get('server') || '').split(',');
            const server = serverAndPort[0];
            const port = serverAndPort[1] ? parseInt(serverAndPort[1], 10) : undefined;

            console.log('Attempting to connect with server:', server);

            config = {
                server,
                port,
                database: params.get('database') || 'master',
                user: params.get('user id'),
                password: params.get('password'),
                options: {
                    trustServerCertificate: params.get('trustservercertificate')?.toLowerCase() === 'true',
                    encrypt: true,
                    enableArithAbort: true
                }
            };
        } else if ('serverName' in connection && typeof connection.serverName === 'string') {
            // Handle SqlServerConnection object with type guard for serverName
            console.log('Attempting to connect with server:', connection.serverName);

            // Split server name and port if provided in format server,port
            const [server, port] = connection.serverName.split(',');

            // Create a cross-platform compatible config
            config = {
                server: server,
                port: port ? parseInt(port, 10) : undefined,
                database: connection.database || 'master',
                options: {
                    trustServerCertificate: true,
                    encrypt: true,
                    port: port ? parseInt(port, 10) : undefined,
                    enableArithAbort: true
                }
            };

            // Add authentication details
            if (connection.authentication === 'windows') {
                config.options = {
                    ...config.options,
                    trustedConnection: true
                };
            } else {
                config.user = connection.username;
                config.password = connection.password;
            }
        } else {
            throw new Error('Invalid connection parameter: must be either a connection string or SqlServerConnection object');
        }

        // Log the config (with masked password)
        const maskedConfig = {
            ...config,
            password: '***'
        };
        console.log('Connection config (masked):', JSON.stringify(maskedConfig, null, 2));

        return config;
    }

    // Made public for testing
    public async createPool(config: sql.config): Promise<sql.ConnectionPool> {
        const pool = new sql.ConnectionPool(config);
        await pool.connect();
        return pool;
    }

    private getPoolKey(connection: SqlServerConnection): string {
        return `${connection.serverName}_${connection.database || 'master'}_${connection.username || 'windows'}`;
    }

    private async getPool(connection: SqlServerConnection): Promise<sql.ConnectionPool> {
        const key = this.getPoolKey(connection);
        
        if (!this.pools.has(key)) {
            try {
                const config = this.getConnectionConfig(connection);
                console.log('Creating pool...');
                
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
        params?: SqlProcedureParams
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
