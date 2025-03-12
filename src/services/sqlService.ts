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
        const baseConfig: sql.config = {
            server: connection.serverName,
            database: connection.database || 'master',
            options: {
                trustServerCertificate: true, // For development only
                encrypt: true
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        };

        if (connection.authentication === 'windows') {
            return {
                ...baseConfig,
                options: {
                    ...baseConfig.options,
                    trustedConnection: true
                }
            };
        } else {
            return {
                ...baseConfig,
                user: connection.username,
                password: connection.password
            };
        }
    }

    private async getPool(connection: SqlServerConnection): Promise<sql.ConnectionPool> {
        const key = `${connection.serverName}_${connection.database || 'master'}_${connection.username || 'windows'}`;
        
        if (!this.pools.has(key)) {
            const pool = new sql.ConnectionPool(this.getConnectionConfig(connection));
            await pool.connect();
            this.pools.set(key, pool);
        }

        return this.pools.get(key)!;
    }

    public async executeQuery<T>(connection: SqlServerConnection, query: string): Promise<T[]> {
        const pool = await this.getPool(connection);
        const result = await pool.request().query(query);
        return result.recordset;
    }

    public async executeProcedure<T>(
        connection: SqlServerConnection, 
        procedure: string, 
        params?: { [key: string]: any }
    ): Promise<T[]> {
        const pool = await this.getPool(connection);
        const request = pool.request();

        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                request.input(key, value);
            });
        }

        const result = await request.execute(procedure);
        return result.recordset;
    }

    public async testConnection(connection: SqlServerConnection): Promise<boolean> {
        try {
            const pool = await this.getPool(connection);
            const result = await pool.request().query('SELECT @@VERSION as version');
            return result.recordset.length > 0;
        } catch (error) {
            console.error('Connection test failed:', error);
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