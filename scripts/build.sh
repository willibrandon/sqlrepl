#!/bin/bash

# Function to display usage
show_usage() {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  -t, --test       Run tests after build"
    echo "  -d, --docker     Start Docker containers for tests"
    echo "  -h, --help       Show this help message"
}

# Default values
RUN_TESTS=false
USE_DOCKER=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--test)
            RUN_TESTS=true
            shift
            ;;
        -d|--docker)
            USE_DOCKER=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Print build info
echo "🔄 Starting build process..."
echo "Tests enabled: $RUN_TESTS"
echo "Docker enabled: $USE_DOCKER"

# Clean previous build
echo "🧹 Cleaning previous build..."
if [ -d "out" ]; then
    rm -rf out/
    echo "   Removed out/ directory"
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    if ! npm install; then
        echo "❌ Failed to install dependencies!"
        exit 1
    fi
    echo "   Dependencies installed successfully"
fi

# Run TypeScript compiler
echo "🔨 Building TypeScript..."
if ! npm run compile; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully!"

# Run tests if requested
if [ "$RUN_TESTS" = true ]; then
    if [ "$USE_DOCKER" = true ]; then
        echo "🐳 Starting Docker containers..."
        if ! docker-compose up -d; then
            echo "❌ Failed to start Docker containers!"
            exit 1
        fi

        echo "⏳ Waiting for SQL Server to be ready..."
        echo "   (This will take about 30 seconds)"
        sleep 30

        echo "🧪 Running tests..."
        if ! npm test; then
            echo "❌ Tests failed!"
            echo "🧹 Cleaning up Docker containers..."
            docker-compose down
            exit 1
        fi

        echo "🧹 Cleaning up Docker containers..."
        docker-compose down
    else
        echo "🧪 Running tests..."
        if ! npm test; then
            echo "❌ Tests failed!"
            exit 1
        fi
    fi
    echo "✅ Tests completed successfully!"
fi

echo "✨ All done! Build completed successfully!" 