#!/bin/bash

# Parse command line arguments for port
while getopts "p:" opt; do
  case $opt in
    p) HOST_PORT="$OPTARG"
    ;;
    \?) echo "Invalid option -$OPTARG" >&2
    ;;
  esac
done

# Configuration
SQL_PASSWORD="YourStrong@Passw0rd"
SA_PASSWORD=$SQL_PASSWORD
TEST_USER="testuser"
TEST_PASSWORD="Test@Password123"
CONTAINER_NAME="sqlserver-repl"
HOST_PORT=${HOST_PORT:-1433}  # Use provided port or default to 1433
SQLCMD_PATH="/opt/mssql-tools18/bin/sqlcmd"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up SQL Server container for development on port ${HOST_PORT}...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Check for Rosetta installation
if [ "$(uname -m)" = "arm64" ]; then
    echo "Checking Rosetta installation..."
    if ! /usr/bin/pgrep -q oahd; then
        echo "Installing Rosetta..."
        softwareupdate --install-rosetta --agree-to-license
    fi
fi

# Stop and remove existing container if it exists
if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo "Removing existing container..."
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
fi

echo "Pulling SQL Server 2022 image..."
docker pull mcr.microsoft.com/mssql/server:2022-latest

echo "Starting SQL Server container..."
docker run \
    --platform linux/amd64 \
    -e "ACCEPT_EULA=Y" \
    -e "MSSQL_SA_PASSWORD=$SA_PASSWORD" \
    -e "MSSQL_ENABLE_HADR=1" \
    -e "MSSQL_AGENT_ENABLED=true" \
    -p $HOST_PORT:1433 \
    --name $CONTAINER_NAME \
    --hostname $CONTAINER_NAME \
    -d \
    mcr.microsoft.com/mssql/server:2022-latest

echo "Creating replication directory in container..."
docker exec $CONTAINER_NAME mkdir -p /var/opt/mssql/ReplData
docker exec $CONTAINER_NAME chown mssql /var/opt/mssql/ReplData

echo "Waiting for SQL Server to start..."
echo "This may take a minute or two on first run..."

# Wait for SQL Server to be ready
for i in {1..60}; do
    echo -e "\nAttempting connection (try $i)..."
    
    # Show SQL Server process status
    echo "SQL Server process:"
    docker exec $CONTAINER_NAME ps aux | grep sqlservr || true
    
    # Show recent logs
    echo "Recent logs:"
    docker logs $CONTAINER_NAME --tail 5
    
    # Try connection
    if docker exec $CONTAINER_NAME $SQLCMD_PATH \
        -S localhost,1433 \
        -U sa \
        -P "$SA_PASSWORD" \
        -N \
        -C \
        -Q "SELECT @@VERSION" 2>&1
    then
        echo -e "${GREEN}SQL Server is ready!${NC}"
        break
    fi
    
    if [ $i -eq 60 ]; then
        echo -e "${RED}Timed out waiting for SQL Server${NC}"
        echo "Full logs:"
        docker logs $CONTAINER_NAME
        exit 1
    fi
    
    sleep 1
done

# Basic configuration
echo "Configuring SQL Server..."
docker exec -i $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U sa \
    -P "$SA_PASSWORD" \
    -N \
    -C << EOF
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

-- Check and start SQL Server Agent if not running
DECLARE @agent_status int
EXEC master.dbo.xp_servicecontrol N'QUERYSTATE', N'SQLServerAGENT', @agent_status OUTPUT
IF @agent_status <> 4  -- 4 means running
BEGIN
    EXEC master.dbo.xp_servicecontrol N'START', N'SQLServerAGENT'
END
GO
EOF

echo "Waiting for SQL Server Agent to start..."
sleep 5

# Create databases and users
echo "Creating databases and users..."
docker exec -i $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U sa \
    -P "$SA_PASSWORD" \
    -N \
    -C << EOF
-- Create test databases
CREATE DATABASE TestDB;
CREATE DATABASE TestDB2;
GO

-- Drop existing login and user if they exist
USE TestDB;
GO
IF EXISTS (SELECT * FROM sys.database_principals WHERE name = '${TEST_USER}')
    DROP USER ${TEST_USER};
GO
IF EXISTS (SELECT * FROM sys.server_principals WHERE name = '${TEST_USER}')
    DROP LOGIN ${TEST_USER};
GO

-- Create login with explicit password policy settings
CREATE LOGIN ${TEST_USER} WITH 
    PASSWORD = '${TEST_PASSWORD}',
    CHECK_POLICY = OFF,
    CHECK_EXPIRATION = OFF;
GO

-- Create user and assign permissions in both databases
CREATE USER ${TEST_USER} FOR LOGIN ${TEST_USER};
GO
ALTER ROLE db_owner ADD MEMBER ${TEST_USER};
GO

USE TestDB2;
GO
CREATE USER ${TEST_USER} FOR LOGIN ${TEST_USER};
GO
ALTER ROLE db_owner ADD MEMBER ${TEST_USER};
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
EOF

echo "Waiting for databases to be ready..."
sleep 5

# Configure distributor
echo "Configuring distributor..."
docker exec -i $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U sa \
    -P "$SA_PASSWORD" \
    -N \
    -C << EOF
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
EOF

echo "Waiting for distributor to be ready..."
sleep 10

# Configure publications and subscriptions
echo "Configuring publications and subscriptions..."
docker exec -i $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U sa \
    -P "$SA_PASSWORD" \
    -N \
    -C << EOF
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

-- Start snapshot agents
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
EOF

echo "Waiting for replication setup to complete..."
sleep 10

# Verify setup
echo "Verifying setup..."
if docker exec $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U $TEST_USER \
    -P "$TEST_PASSWORD" \
    -N \
    -C \
    -d TestDB \
    -Q "SELECT COUNT(*) FROM TestTable;" | grep -q "2" && \
   docker exec $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U sa \
    -P "$SA_PASSWORD" \
    -N \
    -C \
    -Q "SELECT COUNT(*) FROM distribution.dbo.MSpublications;" | grep -q "2"
then
    echo -e "${GREEN}SQL Server setup completed successfully!${NC}"
    echo -e "${YELLOW}Connection Details:${NC}"
    echo -e "Server: localhost,$HOST_PORT"
    echo -e "Database: TestDB"
    echo -e "Test User: $TEST_USER / $TEST_PASSWORD"
    echo -e "SA User: sa / $SA_PASSWORD"
    echo -e "\n${GREEN}Connection string:${NC}"
    echo -e "Server=localhost,$HOST_PORT;Database=TestDB;User Id=$TEST_USER;Password=$TEST_PASSWORD;TrustServerCertificate=True"
else
    echo -e "${RED}Setup verification failed${NC}"
    exit 1
fi

echo -e "\n${GREEN}Useful commands:${NC}"
echo "- View container logs: docker logs $CONTAINER_NAME"
echo "- Stop container: docker stop $CONTAINER_NAME"
echo "- Start container: docker start $CONTAINER_NAME"
echo "- Remove container: docker rm $CONTAINER_NAME"
echo "- Connect to container: docker exec -it $CONTAINER_NAME $SQLCMD_PATH -S localhost,1433 -U sa -P \"$SA_PASSWORD\" -N -C" 