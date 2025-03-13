import { SqlService } from '../../services/sqlService';
import { SqlServerConnection } from '../../services/connectionService';
import * as sql from 'mssql';

// Create a type that exposes the protected method for testing
type SqlServiceWithProtected = SqlService & {
  getConnectionConfig(connection: SqlServerConnection): sql.config;
};

describe('SqlService', () => {
  let sqlService: SqlService;

  beforeEach(() => {
    sqlService = SqlService.getInstance();
  });

  describe('getConnectionConfig', () => {
    it('should parse server and port correctly', async () => {
      const connection: SqlServerConnection = {
        id: 'test-connection',
        serverName: 'localhost,1433',
        authentication: 'sql',
        username: 'sa',
        password: 'YourStrong@Passw0rd',
        database: 'TestDB'
      };

      const config = (sqlService as SqlServiceWithProtected).getConnectionConfig(connection);

      expect(config.server).toBe('localhost');
      expect(config.port).toBe(1433);
      expect(config.database).toBe('TestDB');
      expect(config.user).toBe('sa');
      expect(config.password).toBe('YourStrong@Passw0rd');
      expect(config.options!.trustServerCertificate).toBe(true);
      expect(config.options!.encrypt).toBe(true);
    });

    it('should use default port when not specified', async () => {
      const connection: SqlServerConnection = {
        id: 'test-connection',
        serverName: 'localhost',
        authentication: 'sql',
        username: 'sa',
        password: 'YourStrong@Passw0rd',
        database: 'TestDB'
      };

      const config = (sqlService as SqlServiceWithProtected).getConnectionConfig(connection);

      expect(config.server).toBe('localhost');
      expect(config.port).toBeUndefined();
    });

    it('should handle windows authentication', async () => {
      const connection: SqlServerConnection = {
        id: 'test-connection',
        serverName: 'localhost',
        authentication: 'windows',
        database: 'TestDB'
      };

      const config = (sqlService as SqlServiceWithProtected).getConnectionConfig(connection);

      expect(config.options!.trustedConnection).toBe(true);
      expect(config.user).toBeUndefined();
      expect(config.password).toBeUndefined();
    });
  });
}); 