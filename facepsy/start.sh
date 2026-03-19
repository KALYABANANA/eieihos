#!/bin/bash

echo "========================================"
echo "   FacePsy Web - Starting Services"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Function to check if port is in use
check_port() {
    lsof -i :$1 > /dev/null 2>&1
    return $?
}

# Start Backend
echo -e "\n${YELLOW}[1/2] Starting Backend...${NC}"
cd "$PROJECT_DIR/backend"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt -q

if check_port 8000; then
    echo -e "${RED}Port 8000 already in use${NC}"
else
    echo "Starting FastAPI server on port 8000..."
    uvicorn main:app --host 0.0.0.0 --port 8000 &
    BACKEND_PID=$!
    sleep 2
    echo -e "${GREEN}Backend started (PID: $BACKEND_PID)${NC}"
fi

# Start Frontend
echo -e "\n${YELLOW}[2/2] Starting Frontend...${NC}"
cd "$PROJECT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

if check_port 3000; then
    echo -e "${RED}Port 3000 already in use${NC}"
else
    echo "Starting Next.js server on port 3000..."
    npm run dev &
    FRONTEND_PID=$!
    sleep 3
    echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID)${NC}"
fi

echo -e "\n${GREEN}========================================"
echo "   FacePsy Web is running!"
echo "========================================"
echo -e "   Frontend: http://localhost:3000"
echo -e "   Backend:  http://localhost:8000"
echo -e "========================================${NC}"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user interrupt
wait
