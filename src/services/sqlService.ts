import * as sql from 'mssql';
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

        // Split server name and port if provided in format server,port
        const [server, port] = connection.serverName.split(',');

        // Create a cross-platform compatible config
        const config: sql.config = {
            server: server,
            port: port ? parseInt(port, 10) : undefined,  // Ensure base 10 parsing
            database: connection.database || 'master',
            options: {
                trustServerCertificate: true, // For development/testing
                encrypt: true, // For security
                port: port ? parseInt(port, 10) : undefined,  // Also set port in options
                enableArithAbort: true // Add this for better compatibility
            }
        };

        // Add authentication details
        if (connection.authentication === 'windows') {
            config.options = {
                ...config.options,
                trustedConnection: true,
                enableArithAbort: true
            };
        } else {
            config.user = connection.username;
            config.password = connection.password;
        }

        // Log the config (with masked password)
        const maskedConfig = {
            ...config,
            password: '***'
        };
        console.log('Connection config (masked):', JSON.stringify(maskedConfig, null, 2));

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
