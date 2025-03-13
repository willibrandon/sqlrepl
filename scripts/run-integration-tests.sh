#!/bin/bash

# Exit on error
set -e

# Source our setup script to get the variables
source ./scripts/setup-sqlserver.sh

# Run integration tests with the connection string from setup
echo "Running integration tests..."
TEST_CONNECTION_STRING="Server=localhost,$HOST_PORT;Database=TestDB;User Id=$TEST_USER;Password=$TEST_PASSWORD;TrustServerCertificate=True" \
npm run test:integration 