# Configuration
param(
    [int]$Port = 1433
)

$SQL_PASSWORD = "YourStrong@Passw0rd"
$SA_PASSWORD = $SQL_PASSWORD
$TEST_USER = "testuser"
$TEST_PASSWORD = "Test@Password123"
$CONTAINER_NAME = "sqlserver-repl"
$HOST_PORT = $Port

# Colors for output
$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$NC = "`e[0m"

Write-Host "${GREEN}Setting up SQL Server container for development...${NC}"

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
}

# Check for existing container and remove it
$existingContainer = docker ps -aq -f name=$CONTAINER_NAME
if ($existingContainer) {
    Write-Host "Removing existing container..."
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
}

Write-Host "Pulling SQL Server 2022 image..."
docker pull mcr.microsoft.com/mssql/server:2022-latest

Write-Host "Starting SQL Server container..."
docker run `
    --platform linux/amd64 `
    -e "ACCEPT_EULA=Y" `
    -e "MSSQL_SA_PASSWORD=$SA_PASSWORD" `
    -e "MSSQL_ENABLE_HADR=1" `
    -e "MSSQL_AGENT_ENABLED=true" `
    -p ${HOST_PORT}:1433 `
    --name $CONTAINER_NAME `
    --hostname $CONTAINER_NAME `
    -d `
    mcr.microsoft.com/mssql/server:2022-latest

Write-Host "Creating replication directory in container..."
docker exec $CONTAINER_NAME mkdir -p /var/opt/mssql/ReplData
docker exec $CONTAINER_NAME chown mssql /var/opt/mssql/ReplData

Write-Host "Waiting for SQL Server to start..."
Write-Host "This may take a minute or two on first run..."

# Wait for SQL Server to be ready
for ($i = 1; $i -le 60; $i++) {
    Write-Host "`nAttempting connection (try $i)..."
    
    # Show SQL Server process status
    Write-Host "SQL Server process:"
    docker exec $CONTAINER_NAME ps aux | Select-String sqlservr
    
    # Show recent logs
    Write-Host "Recent logs:"
    docker logs $CONTAINER_NAME --tail 5
    
    # Try connection
    $connectionTest = docker exec $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
        -S localhost,1433 `
        -U sa `
        -P "$SA_PASSWORD" `
        -N `
        -C `
        -Q "SELECT @@VERSION" 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "${GREEN}SQL Server is ready!${NC}"
        break
    }
    
    if ($i -eq 60) {
        Write-Host "${RED}Timed out waiting for SQL Server${NC}"
        Write-Host "Full logs:"
        docker logs $CONTAINER_NAME
        exit 1
    }
    
    Start-Sleep -Seconds 1
}

# Create test database and enable replication
Write-Host "Configuring SQL Server..."

# First batch: Basic configuration
$sqlCommands1 = @"
-- Enable contained database authentication
sp_configure 'contained database authentication', 1;
RECONFIGURE;
GO

-- Enable replication and agent
sp_configure 'show advanced options', 1;
RECONFIGURE;
GO
sp_configure 'replication xps', 1;
RECONFIGURE;
GO
sp_configure 'agent xps', 1;
RECONFIGURE;
GO

-- Start SQL Server Agent
EXEC master.dbo.xp_servicecontrol 'START', 'SQLServerAGENT';
GO
"@

Write-Host "Applying basic configuration..."
$sqlCommands1 | docker exec -i $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C

Write-Host "Waiting for SQL Server Agent to start..."
Start-Sleep -Seconds 5

# Second batch: Create databases and users
$sqlCommands2 = @"
-- Create test databases
CREATE DATABASE TestDB;
CREATE DATABASE TestDB2;
GO

-- Drop existing login and user if they exist
USE TestDB;
GO
IF EXISTS (SELECT * FROM sys.database_principals WHERE name = '$TEST_USER')
    DROP USER $TEST_USER;
GO
IF EXISTS (SELECT * FROM sys.server_principals WHERE name = '$TEST_USER')
    DROP LOGIN $TEST_USER;
GO

-- Create login with explicit password policy settings
CREATE LOGIN $TEST_USER WITH 
    PASSWORD = '$TEST_PASSWORD',
    CHECK_POLICY = OFF,
    CHECK_EXPIRATION = OFF;
GO

-- Create user and assign permissions in both databases
CREATE USER $TEST_USER FOR LOGIN $TEST_USER;
GO
ALTER ROLE db_owner ADD MEMBER $TEST_USER;
GO

USE TestDB2;
GO
CREATE USER $TEST_USER FOR LOGIN $TEST_USER;
GO
ALTER ROLE db_owner ADD MEMBER $TEST_USER;
GO

-- Create test table in TestDB
USE TestDB;
GO
CREATE TABLE TestTable (
    ID INT PRIMARY KEY IDENTITY(1,1),
    Name NVARCHAR(100),
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

-- Insert test data
INSERT INTO TestTable (Name) VALUES ('Test Record 1'), ('Test Record 2');
GO
"@

Write-Host "Creating databases and users..."
$sqlCommands2 | docker exec -i $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C

Write-Host "Waiting for databases to be ready..."
Start-Sleep -Seconds 5

# Third batch: Configure distributor
$sqlCommands3 = @"
-- Configure Distributor
USE master;
GO
EXEC sp_adddistributor @distributor = @@SERVERNAME, @password = 'Password123!';
GO
EXEC sp_adddistributiondb @database = 'distribution';
GO

-- Create master key for distribution database
USE distribution;
GO
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'MasterKey123!';
END
GO

EXEC sp_adddistpublisher 
    @publisher = @@SERVERNAME, 
    @distribution_db = 'distribution',
    @working_directory = N'/var/opt/mssql/ReplData',
    @security_mode = 1;
GO
"@

Write-Host "Configuring distributor..."
$sqlCommands3 | docker exec -i $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C

Write-Host "Waiting for distributor to be ready..."
Start-Sleep -Seconds 10

# Fourth batch: Configure publications
$sqlCommands4 = @"
-- Enable TestDB for replication
USE TestDB;
GO
EXEC sp_replicationdboption @dbname = N'TestDB', 
    @optname = N'publish', 
    @value = N'true';
GO

-- Create snapshot publication
EXEC sp_addpublication 
    @publication = N'SnapshotPub',
    @description = N'Snapshot publication of TestTable',
    @sync_method = N'native',
    @retention = 0,
    @allow_push = N'true',
    @allow_pull = N'true',
    @allow_anonymous = N'false',
    @enabled_for_internet = N'false',
    @snapshot_in_defaultfolder = N'true',
    @compress_snapshot = N'false',
    @repl_freq = N'snapshot',
    @status = N'active',
    @independent_agent = N'true';
GO

-- Add snapshot article with corrected type and schema options
EXEC sp_addarticle 
    @publication = N'SnapshotPub',
    @article = N'TestTable',
    @source_owner = N'dbo',
    @source_object = N'TestTable',
    @type = N'logbased',
    @description = NULL,
    @creation_script = NULL,
    @pre_creation_cmd = N'drop',
    @schema_option = 0x000000000803509D,
    @identityrangemanagementoption = N'manual',
    @destination_table = N'TestTable',
    @destination_owner = N'dbo',
    @vertical_partition = N'false'
GO

-- Create transactional publication
EXEC sp_addpublication 
    @publication = N'TransPub',
    @description = N'Transactional publication of TestTable',
    @sync_method = N'concurrent',
    @retention = 0,
    @allow_push = N'true',
    @allow_pull = N'true',
    @allow_anonymous = N'false',
    @enabled_for_internet = N'false',
    @snapshot_in_defaultfolder = N'true',
    @compress_snapshot = N'false',
    @repl_freq = N'continuous',
    @status = N'active',
    @independent_agent = N'true';
GO

-- Add transactional article
EXEC sp_addarticle 
    @publication = N'TransPub',
    @article = N'TestTable',
    @source_owner = N'dbo',
    @source_object = N'TestTable',
    @type = N'logbased',
    @description = NULL,
    @creation_script = NULL,
    @pre_creation_cmd = N'drop',
    @schema_option = 0x80030F3,
    @identityrangemanagementoption = N'manual',
    @destination_table = N'TestTable',
    @destination_owner = N'dbo';
GO

-- Create snapshot agents for both publications
EXEC sp_addpublication_snapshot 
    @publication = N'SnapshotPub',
    @frequency_type = 1,
    @frequency_interval = 1,
    @frequency_relative_interval = 1,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 1,
    @frequency_subday_interval = 1;
GO

EXEC sp_addpublication_snapshot 
    @publication = N'TransPub',
    @frequency_type = 1,
    @frequency_interval = 1,
    @frequency_relative_interval = 1,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 1,
    @frequency_subday_interval = 1;
GO

-- Create subscriptions
-- Snapshot subscription
EXEC sp_addsubscription 
    @publication = N'SnapshotPub',
    @subscriber = @@SERVERNAME,
    @destination_db = N'TestDB2',
    @subscription_type = N'Push',
    @sync_type = N'automatic',
    @article = N'all',
    @update_mode = N'read only';
GO

EXEC sp_addpushsubscription_agent 
    @publication = N'SnapshotPub',
    @subscriber = @@SERVERNAME,
    @subscriber_db = N'TestDB2',
    @frequency_type = 1,
    @frequency_interval = 1,
    @frequency_relative_interval = 1,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 1,
    @frequency_subday_interval = 1;
GO

-- Transactional subscription
EXEC sp_addsubscription 
    @publication = N'TransPub',
    @subscriber = @@SERVERNAME,
    @destination_db = N'TestDB2',
    @subscription_type = N'Push',
    @sync_type = N'automatic',
    @article = N'all',
    @update_mode = N'read only';
GO

EXEC sp_addpushsubscription_agent 
    @publication = N'TransPub',
    @subscriber = @@SERVERNAME,
    @subscriber_db = N'TestDB2',
    @frequency_type = 1,
    @frequency_interval = 1,
    @frequency_relative_interval = 1,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 1,
    @frequency_subday_interval = 1;
GO

-- Start snapshot agents (corrected job names)
DECLARE @snapshot_job1 nvarchar(255)
DECLARE @snapshot_job2 nvarchar(255)

SELECT @snapshot_job1 = name from msdb.dbo.sysjobs 
WHERE name LIKE 'sqlserver-repl-TestDB-SnapshotPub%';

SELECT @snapshot_job2 = name from msdb.dbo.sysjobs 
WHERE name LIKE 'sqlserver-repl-TestDB-TransPub%';

IF @snapshot_job1 IS NOT NULL
    EXEC msdb.dbo.sp_start_job @job_name = @snapshot_job1;

IF @snapshot_job2 IS NOT NULL
    EXEC msdb.dbo.sp_start_job @job_name = @snapshot_job2;
GO
"@

Write-Host "Configuring publications and subscriptions..."
$sqlCommands4 | docker exec -i $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C

Write-Host "Waiting for replication setup to complete..."
Start-Sleep -Seconds 10

# Verify setup with multiple checks
Write-Host "Verifying setup..."

# Check TestDB
$verifyResult1 = docker exec $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U $TEST_USER `
    -P "$TEST_PASSWORD" `
    -N `
    -C `
    -d TestDB `
    -Q "SELECT COUNT(*) FROM TestTable;"

# Check publications
$verifyResult2 = docker exec $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C `
    -Q "SELECT COUNT(*) FROM distribution.dbo.MSpublications;"

if ($verifyResult1 -match "2" -and $verifyResult2 -match "2") {
    Write-Host "${GREEN}SQL Server setup completed successfully!${NC}"
    Write-Host "${YELLOW}Connection Details:${NC}"
    Write-Host "Server: localhost,$HOST_PORT"
    Write-Host "Database: TestDB"
    Write-Host "Test User: $TEST_USER / $TEST_PASSWORD"
    Write-Host "SA User: sa / $SA_PASSWORD"
    Write-Host "`n${GREEN}Connection string:${NC}"
    Write-Host "Server=localhost,$HOST_PORT;Database=TestDB;User Id=$TEST_USER;Password=$TEST_PASSWORD;TrustServerCertificate=True"
} else {
    Write-Host "${RED}Setup verification failed${NC}"
    Write-Host "TestDB verification result: $verifyResult1"
    Write-Host "Publications verification result: $verifyResult2"
    exit 1
}

Write-Host "`n${GREEN}Useful commands:${NC}"
Write-Host "- View container logs: docker logs $CONTAINER_NAME"
Write-Host "- Stop container: docker stop $CONTAINER_NAME"
Write-Host "- Start container: docker start $CONTAINER_NAME"
Write-Host "- Remove container: docker rm $CONTAINER_NAME"
Write-Host "- Connect to container: docker exec -it $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd -S localhost,1433 -U sa -P `"$SA_PASSWORD`" -N -C" 