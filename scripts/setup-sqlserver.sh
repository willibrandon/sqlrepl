#!/bin/bash

# Configuration
SQL_PASSWORD="YourStrong@Passw0rd"
SA_PASSWORD=$SQL_PASSWORD
TEST_USER="testuser"
TEST_PASSWORD="Test@Password123"
CONTAINER_NAME="sqlserver-repl"
HOST_PORT=1433
SQLCMD_PATH="/opt/mssql-tools18/bin/sqlcmd"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up SQL Server container for development...${NC}"

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
    -p $HOST_PORT:1433 \
    --name $CONTAINER_NAME \
    --hostname $CONTAINER_NAME \
    -d \
    mcr.microsoft.com/mssql/server:2022-latest

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

# Create test database and enable replication
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

-- Create test database
CREATE DATABASE TestDB;
GO

-- Enable replication
sp_configure 'show advanced options', 1;
RECONFIGURE;
GO
sp_configure 'replication xps', 1;
RECONFIGURE;
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

-- Create user and assign permissions
CREATE USER ${TEST_USER} FOR LOGIN ${TEST_USER};
GO
ALTER ROLE db_owner ADD MEMBER ${TEST_USER};
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
EOF

# Verify setup
if docker exec $CONTAINER_NAME $SQLCMD_PATH \
    -S localhost,1433 \
    -U $TEST_USER \
    -P "$TEST_PASSWORD" \
    -N \
    -C \
    -d TestDB \
    -Q "SELECT COUNT(*) FROM TestTable;" | grep -q "2"
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