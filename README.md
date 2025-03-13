# SQL Server Replication Extension for VS Code

A Visual Studio Code extension that provides comprehensive SQL Server Replication management capabilities directly within your IDE.

## Features (Planned)

- Support for all replication types (Snapshot, Transactional, Merge, Peer-to-Peer)
- Intuitive wizards for publication and subscription management
- Real-time monitoring and alerting
- Security and authentication management
- Performance optimization tools

## Requirements

- Visual Studio Code 1.85.0 or higher
- SQL Server 2016 or higher (for full feature support)
- Node.js 16.x or higher (for development)

## Installation

*Coming soon to VS Code Marketplace*

## Development Setup

1. Clone this repository
2. Run `npm install`
3. Open in VS Code
4. Press F5 to start debugging

## Development

### Prerequisites

- Node.js 20 or later
- Visual Studio Code
- Docker (for running tests)

### Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

### Running Tests

#### With Docker (Recommended)

The project uses Docker to run SQL Server for integration tests. This ensures a consistent test environment across all development machines.

1. Start the SQL Server container and set up the test database:
```bash
docker-compose up -d
```

2. Wait for the container to be healthy (usually takes about 30 seconds):
```bash
docker-compose ps
```

3. Run the tests:
```bash
npm test
```

4. When you're done, stop the container:
```bash
docker-compose down
```

#### Troubleshooting Tests

If you encounter issues:

1. Check if SQL Server is running:
```bash
docker-compose ps
```

2. View SQL Server logs:
```bash
docker-compose logs sqlserver
```

3. Reset the test environment:
```bash
docker-compose down
docker-compose up -d
```

### Building

The project includes build scripts for both Unix-like systems and Windows. These scripts handle TypeScript compilation and optionally run tests.

#### Unix/macOS (build.sh)

```bash
# Just build
./scripts/build.sh

# Build and run tests
./scripts/build.sh --test

# Build and run tests with Docker
./scripts/build.sh --test --docker

# Show help
./scripts/build.sh --help
```

#### Windows (build.ps1)

```powershell
# Just build
.\scripts\build.ps1

# Build and run tests
.\scripts\build.ps1 -RunTests

# Build and run tests with Docker
.\scripts\build.ps1 -RunTests -UseDocker

# Show help
.\scripts\build.ps1 -Help
```

The build process:
1. Cleans the previous build
2. Installs dependencies if needed
3. Compiles TypeScript to JavaScript
4. Optionally runs tests (with or without Docker)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- SQL Server Replication documentation and community
- VS Code Extension development community 