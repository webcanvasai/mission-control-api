# Mission Control API Deployment

## Option 1: Systemd Service (Recommended for Linux)

### Install Service
```bash
# Copy service file to systemd
sudo cp mission-control-api.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable mission-control-api

# Start service
sudo systemctl start mission-control-api

# Check status
sudo systemctl status mission-control-api

# View logs
sudo journalctl -u mission-control-api -f
```

### Manage Service
```bash
# Stop
sudo systemctl stop mission-control-api

# Restart
sudo systemctl restart mission-control-api

# Disable (don't start on boot)
sudo systemctl disable mission-control-api
```

## Option 2: Docker

### Build and Run
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

### Docker Commands
```bash
# Check status
docker ps | grep mission-control

# View logs
docker logs mission-control-api -f

# Restart
docker restart mission-control-api

# Stop and remove
docker-compose down
```

## Option 3: PM2 (Alternative)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/server.js --name mission-control-api

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup

# Manage with PM2
pm2 status
pm2 logs mission-control-api
pm2 restart mission-control-api
pm2 stop mission-control-api
```

## Which One to Use?

- **Systemd**: Best for Linux servers, native integration, automatic restarts
- **Docker**: Easiest to manage, isolated environment, portable
- **PM2**: Good for Node.js-centric workflows, easy process management

## Testing

After starting the service:
```bash
# Check health endpoint
curl http://localhost:3001/api/health

# Check tickets endpoint
curl http://localhost:3001/api/tickets

# Watch logs for auto-grooming
# Create a new minimal ticket and watch for grooming trigger
```

## Auto-Grooming Verification

1. Start the API server (any method above)
2. Create a minimal ticket: `/home/chris/Kolenko/Mission Control/tickets/TICK-999.md`
3. Watch logs - should see grooming triggered within ~5 seconds
4. Check ticket file - should be expanded with full details
