import * as sql from 'mssql';
import { SqlServerConnection } from './connectionService';
import { ConnectionService } from './connectionService';

/**
 * Type for stored procedure parameters that can handle all SQL Server data types.
 * Provides flexibility for various parameter types while maintaining type safety.
 */
type SqlProcedureParams = {
    [key: string]: string | number | boolean | Date | Buffer | null | undefined;
};

/**
 * Service for managing SQL Server database connections and queries.
 * Provides connection pooling and query execution capabilities.
 */
export class SqlService {
    private static instance: SqlService;
    private pools: Map<string, sql.ConnectionPool>;

    protected constructor() {
        this.pools = new Map<string, sql.ConnectionPool>();
    }

    /**
     * Gets the singleton instance of SqlService.
     * Creates the instance if it doesn't exist.
     */
    public static getInstance(): SqlService {
        if (!SqlService.instance) {
            SqlService.instance = new SqlService();
        }
        return SqlService.instance;
    }

    /**
     * Creates a test instance of SqlService.
     * Used for unit testing to avoid singleton constraints.
     */
    public static createTestInstance(): SqlService {
        return new SqlService();
    }

    /**
     * Converts a connection specification into a mssql configuration object.
     * Handles both connection strings and SqlServerConnection objects.
     * 
     * @param connection - Connection string or SqlServerConnection object
     * @returns mssql configuration object
     * @throws Error if connection parameter is invalid
     */
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

    /**
     * Creates a new connection pool.
     * 
     * @param config - mssql configuration object
     * @returns Connected pool instance
     */
    public async createPool(config: sql.config): Promise<sql.ConnectionPool> {
        const pool = new sql.ConnectionPool(config);
        await pool.connect();
        return pool;
    }

    /**
     * Generates a unique key for connection pooling.
     * 
     * @param connection - Connection details
     * @returns Unique string key for the connection
     */
    private getPoolKey(connection: SqlServerConnection): string {
        return `${connection.serverName}_${connection.database || 'master'}_${connection.username || 'windows'}`;
    }

    /**
     * Gets or creates a connection pool for the specified connection.
     * 
     * @param connection - Connection details
     * @returns Connected pool instance
     * @throws Error if pool creation fails
     */
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

    /**
     * Executes a SQL query on the specified connection.
     * 
     * @param connection - Connection details
     * @param query - SQL query to execute
     * @returns Query results as an array of type T
     * @throws Error if query execution fails
     */
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

    /**
     * Executes a stored procedure on the specified connection.
     * 
     * @param connection - Connection details
     * @param procedure - Name of the stored procedure
     * @param params - Optional parameters for the stored procedure
     * @returns Procedure results as an array of type T
     * @throws Error if procedure execution fails
     */
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

    /**
     * Tests if a connection can be established.
     * Also detects and stores server OS information.
     * 
     * @param connection - Connection details to test
     * @returns True if connection succeeds
     */
    public async testConnection(connection: SqlServerConnection): Promise<boolean> {
        try {
            const pool = await this.getPool(connection);
            const result = await pool.request().query(`SELECT @@VERSION as version`);
            
            if (result.recordset.length > 0) {
                const versionString = result.recordset[0].version;
                console.log(`Version string for ${connection.serverName}:`, versionString);
                
                // Store version information
                connection.serverVersion = versionString.split('\n')[0].trim();
                
                // Detect OS type from version string
                let osType: 'Windows' | 'Linux' = 'Windows'; // Default to Windows
                
                if (versionString.includes('Linux') || 
                    versionString.includes('Ubuntu') || 
                    versionString.includes('Red Hat') || 
                    versionString.includes('RHEL') || 
                    versionString.includes('CentOS')) {
                    osType = 'Linux';
                    console.log(`Linux detected in version string: "${versionString}"`);
                } else {
                    console.log(`No Linux indicators found in version string: "${versionString}"`);
                }
                
                // Store OS information in the connection object
                connection.serverOs = osType;
                console.log(`Detected OS for ${connection.serverName}: ${connection.serverOs}`);
                console.log(`Detected Version for ${connection.serverName}: ${connection.serverVersion}`);
                
                // Debug connection object
                console.log('Updated connection object:', {
                    id: connection.id,
                    serverName: connection.serverName,
                    serverOs: connection.serverOs,
                    serverVersion: connection.serverVersion
                });
                
                // Update connection in the ConnectionService to persist OS info
                const connectionService = ConnectionService.getInstance();
                const updateResult = connectionService.updateConnection(connection.id, { 
                    serverOs: connection.serverOs,
                    serverVersion: connection.serverVersion
                });
                console.log(`Connection update result: ${updateResult ? 'success' : 'failed'}`);
                
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Connection test failed for ${connection.serverName}:`, error);
            return false;
        }
    }

    /**
     * Closes all active connection pools.
     * Should be called during cleanup or application shutdown.
     */
    public async closeAll(): Promise<void> {
        for (const pool of this.pools.values()) {
            await pool.close();
        }
        this.pools.clear();
    }
}
