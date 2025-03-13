import { SqlService } from '../../services/sqlService';

describe('SqlService', () => {
  let sqlService: SqlService;

  beforeEach(() => {
    sqlService = SqlService.getInstance();
  });

  describe('getConnectionConfig', () => {
    it('should parse server and port correctly', async () => {
      const connection = {
        serverName: 'localhost,1433',
        authentication: 'sql' as const,
        username: 'sa',
        password: 'YourStrong@Passw0rd',
        database: 'TestDB'
      };

      // Using any here because getConnectionConfig is private
      // In a real scenario, we might want to make it protected or public for testing
      const config = (sqlService as any).getConnectionConfig(connection);

      expect(config.server).toBe('localhost');
      expect(config.port).toBe(1433);
      expect(config.database).toBe('TestDB');
      expect(config.user).toBe('sa');
      expect(config.password).toBe('YourStrong@Passw0rd');
      expect(config.options.trustServerCertificate).toBe(true);
      expect(config.options.encrypt).toBe(true);
    });

    it('should use default port when not specified', async () => {
      const connection = {
        serverName: 'localhost',
        authentication: 'sql' as const,
        username: 'sa',
        password: 'YourStrong@Passw0rd',
        database: 'TestDB'
      };

      const config = (sqlService as any).getConnectionConfig(connection);

      expect(config.server).toBe('localhost');
      expect(config.port).toBeUndefined();
    });

    it('should handle windows authentication', async () => {
      const connection = {
        serverName: 'localhost',
        authentication: 'windows' as const,
        database: 'TestDB'
      };

      const config = (sqlService as any).getConnectionConfig(connection);

      expect(config.options.trustedConnection).toBe(true);
      expect(config.user).toBeUndefined();
      expect(config.password).toBeUndefined();
    });
  });
}); 