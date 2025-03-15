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
$sqlCommands = @"
-- Enable contained database authentication
sp_configure 'contained database authentication', 1;
RECONFIGURE;
GO

-- Create test database
CREATE DATABASE TestDB;
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

-- Create user and assign permissions
CREATE USER $TEST_USER FOR LOGIN $TEST_USER;
GO
ALTER ROLE db_owner ADD MEMBER $TEST_USER;
GO

-- Create test table
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

$sqlCommands | docker exec -i $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U sa `
    -P "$SA_PASSWORD" `
    -N `
    -C

# Verify setup
$verifyResult = docker exec $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd `
    -S localhost,1433 `
    -U $TEST_USER `
    -P "$TEST_PASSWORD" `
    -N `
    -C `
    -d TestDB `
    -Q "SELECT COUNT(*) FROM TestTable;"

if ($verifyResult -match "2") {
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
    exit 1
}

Write-Host "`n${GREEN}Useful commands:${NC}"
Write-Host "- View container logs: docker logs $CONTAINER_NAME"
Write-Host "- Stop container: docker stop $CONTAINER_NAME"
Write-Host "- Start container: docker start $CONTAINER_NAME"
Write-Host "- Remove container: docker rm $CONTAINER_NAME"
Write-Host "- Connect to container: docker exec -it $CONTAINER_NAME /opt/mssql-tools18/bin/sqlcmd -S localhost,1433 -U sa -P `"$SA_PASSWORD`" -N -C" 