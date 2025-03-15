#!/bin/bash

# Show usage information
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -t, --test     Run tests after build"
    echo "  -d, --docker   Start Docker containers for tests"
    echo "  -h, --help     Show this help message"
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

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run compile
BUILD_EXIT_CODE=$?

if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo "❌ Build failed!"
    exit $BUILD_EXIT_CODE
fi

echo "✅ Build completed successfully!"

# Run tests if enabled
if [ "$RUN_TESTS" = true ]; then
    # Start Docker if enabled
    if [ "$USE_DOCKER" = true ]; then
        echo "🐳 Setting up Docker containers..."
        if ! ./scripts/setup-sqlserver.sh; then
            echo "❌ Failed to setup Docker containers!"
            exit 1
        fi
        echo "✅ Docker containers ready"
    fi

    echo "🧪 Running tests..."
    
    # Run integration tests first
    npm run test:integration
    INTEGRATION_TEST_EXIT_CODE=$?
    
    # Run extension tests
    npm run test:extension
    EXTENSION_TEST_EXIT_CODE=$?
    
    # Check if any tests failed
    if [ $INTEGRATION_TEST_EXIT_CODE -ne 0 ] || [ $EXTENSION_TEST_EXIT_CODE -ne 0 ]; then
        echo "❌ Tests failed!"
        exit 1
    fi
    
    echo "✅ All tests passed!"
fi

exit 0 