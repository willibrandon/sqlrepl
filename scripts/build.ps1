# Function to display usage
function Show-Usage {
    Write-Host "Usage: .\build.ps1 [options]"
    Write-Host "Options:"
    Write-Host "  -RunTests     Run tests after build"
    Write-Host "  -UseDocker    Start Docker containers for tests"
    Write-Host "  -Help         Show this help message"
}

param(
    [switch]$RunTests,
    [switch]$UseDocker,
    [switch]$Help
)

if ($Help) {
    Show-Usage
    exit 0
}

# Clean previous build
Write-Host "🧹 Cleaning previous build..."
if (Test-Path "out") {
    Remove-Item -Recurse -Force "out"
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies!"
        exit 1
    }
}

# Run TypeScript compiler
Write-Host "🔨 Building TypeScript..."
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!"
    exit 1
}

Write-Host "✅ Build completed successfully!"

# Run tests if requested
if ($RunTests) {
    if ($UseDocker) {
        Write-Host "🐳 Starting Docker containers..."
        docker-compose up -d
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Failed to start Docker containers!"
            exit 1
        }

        Write-Host "⏳ Waiting for SQL Server to be ready..."
        Start-Sleep -Seconds 30

        Write-Host "🧪 Running tests..."
        npm test

        Write-Host "🧹 Cleaning up Docker containers..."
        docker-compose down
    }
    else {
        Write-Host "🧪 Running tests..."
        npm test
    }
} 