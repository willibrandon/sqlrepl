import { SqlService } from '../../services/sqlService';
import type { ConnectionPool } from 'mssql';

class TestSqlService extends SqlService {
    constructor() {
        super();
    }

    public parseConnectionString(connectionString: string) {
        return this.getConnectionConfig(connectionString);
    }
}

describe('SqlService Integration Tests', () => {
    let sqlService: TestSqlService;
    let pool: ConnectionPool | null;

    // Use environment variable for connection string
    const TEST_CONNECTION_STRING = process.env.TEST_CONNECTION_STRING || 'Server=localhost;Database=TestDB;User Id=testuser;Password=Test@Password123;TrustServerCertificate=True';

    beforeAll(() => {
        sqlService = new TestSqlService();
        // Log the connection string being used (with password masked)
        const maskedConnectionString = TEST_CONNECTION_STRING.replace(/Password=[^;]+/, 'Password=***');
        console.log('Using connection string:', maskedConnectionString);
    });

    afterEach(async () => {
        // Clean up pool after each test
        if (pool) {
            await pool.close();
            pool = null;
        }
    });

    it('should parse connection string correctly', () => {
        const config = sqlService.parseConnectionString(TEST_CONNECTION_STRING);
        expect(config).toBeDefined();
        expect(config.server).toBe('localhost');
        expect(config.database).toBe('TestDB');
        expect(config.user).toBe('testuser');
        expect(config.options).toBeDefined();
        expect(config.options?.trustServerCertificate).toBe(true);
        expect(config.options?.encrypt).toBe(true);
        expect(config.options?.enableArithAbort).toBe(true);
    });

    it('should connect to SQL Server', async () => {
        const config = sqlService.parseConnectionString(TEST_CONNECTION_STRING);
        pool = await sqlService.createPool(config);
        
        const result = await pool.request().query('SELECT @@VERSION as version');
        expect(result.recordset).toHaveLength(1);
        expect(result.recordset[0].version).toContain('Microsoft SQL Server');
    });

    it('should query test table', async () => {
        const config = sqlService.parseConnectionString(TEST_CONNECTION_STRING);
        pool = await sqlService.createPool(config);
        
        const result = await pool.request().query('SELECT COUNT(*) as count FROM TestTable');
        expect(result.recordset).toHaveLength(1);
        expect(result.recordset[0].count).toBe(2); // We expect 2 records from setup
    });

    it('should handle failed connections gracefully', async () => {
        const badConfig = sqlService.parseConnectionString(
            'Server=nonexistent,1433;Database=TestDB;User Id=bad;Password=wrong;TrustServerCertificate=True'
        );

        await expect(sqlService.createPool(badConfig)).rejects.toThrow();
    });
}); 