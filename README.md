# LLM Communicator Server

A modern Node.js + Koa server for routing prompts to custom LLM APIs with flexible configuration.

## Features

- **Flexible LLM API Integration**: Route prompts to any custom LLM API (vLLM, OpenAI-compatible, etc.)
- **Yandex Cloud VM Management**: Auto-start/stop VMs with idle timeout and request queuing
- **API Key Authentication**: Secure API access with configurable API keys
- **Streaming Support**: Real-time token streaming with cancellation support
- **Multiple Endpoints**: Support for simple prompts, chat completions, and batch processing
- **Rate Limiting**: Built-in rate limiting to prevent abuse
- **Health Checks**: Comprehensive health check endpoints for monitoring
- **Security**: CORS, Helmet, API key auth, and other security middleware
- **Remote Deployment Ready**: Configured for deployment on remote hosts with firewall setup
- **Logging**: Structured logging with Winston
- **Error Handling**: Centralized error handling with detailed error responses

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` with your configuration:
```env
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Authentication - Generate secure API keys for your clients
API_KEYS=your-secret-api-key-1,your-secret-api-key-2

# vLLM API Configuration
CUSTOM_API_URL=http://localhost:8000/v1
CUSTOM_API_KEY=your-vllm-api-key
CUSTOM_API_MODEL=your-model-name
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Basic Endpoints

- `GET /api` - API information
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed health check with LLM API status

### Prompt Endpoints

**Note:** All endpoints (except health checks) require authentication via API key.

#### Authentication

Provide your API key using one of these methods:

**Option 1: Authorization Header (Bearer Token)**
```bash
Authorization: Bearer your-secret-api-key
```

**Option 2: x-api-key Header**
```bash
x-api-key: your-secret-api-key
```

#### Simple Prompt
```bash
POST /api/prompts
Content-Type: application/json
Authorization: Bearer your-secret-api-key

{
  "prompt": "What is the capital of France?",
  "maxTokens": 100,
  "temperature": 0.7
}
```

#### Chat Completion
```bash
POST /api/prompts/chat
Content-Type: application/json
x-api-key: your-secret-api-key

{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"}
  ],
  "maxTokens": 100,
  "temperature": 0.7
}
```

#### Streaming Chat Completion

Enable streaming for real-time token generation (compatible with vLLM streaming):

```bash
POST /api/prompts/chat
Content-Type: application/json
x-api-key: your-secret-api-key

{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Write a story about AI."}
  ],
  "maxTokens": 500,
  "temperature": 0.7,
  "stream": true
}
```

**Response:** Server-Sent Events (SSE) stream

**Cancellation:** Simply close the connection to cancel the streaming request. The server will automatically abort the vLLM request.

#### Batch Prompts
```bash
POST /api/prompts/batch
Content-Type: application/json

{
  "prompts": [
    {"prompt": "Question 1", "maxTokens": 100},
    {"prompt": "Question 2", "maxTokens": 100}
  ]
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `HOST` | Server host (use 0.0.0.0 for remote access) | 0.0.0.0 |
| `NODE_ENV` | Environment (development/production) | development |
| `LOG_LEVEL` | Logging level | info |
| `API_KEYS` | Comma-separated list of valid API keys | required |
| `CORS_ORIGINS` | Allowed CORS origins | * |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | true |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms | 900000 |
| `CUSTOM_API_URL` | Your LLM API URL (e.g., vLLM) | required |
| `CUSTOM_API_KEY` | Your LLM API key | required |
| `CUSTOM_API_MODEL` | Default model name | default-model |
| `REQUEST_TIMEOUT_MS` | Request timeout | 30000 |
| `YC_VM_ENABLED` | Enable Yandex Cloud VM management | false |
| `YC_VM_INSTANCE_ID` | Yandex Cloud VM instance ID | - |
| `YC_SERVICE_ACCOUNT_KEY_PATH` | Path to service account key file | - |
| `YC_VLLM_HEALTH_URL` | vLLM health check URL | - |
| `YC_VM_STOP_ON_SHUTDOWN` | Stop VM when backend shuts down | true |
| `YC_VM_IDLE_TIMEOUT_MS` | VM idle timeout in milliseconds | 300000 (5 min) |
| `YC_VM_SHUTDOWN_GRACE_PERIOD_MS` | Wait time for requests before VM stop | 30000 (30 sec) |

## Yandex Cloud VM Management

The backend can automatically manage Yandex Cloud VMs running vLLM:

- **Auto-start on request**: Starts the VM when a request arrives and queues requests until ready
- **Idle shutdown**: Stops the VM after inactivity to save costs (controlled by `YC_VM_IDLE_TIMEOUT_MS`)
- **Graceful shutdown**: Waits for active requests to complete before stopping the VM (controlled by `YC_VM_SHUTDOWN_GRACE_PERIOD_MS`)
- **Optional shutdown**: Optionally stops the VM before backend shutdown (controlled by `YC_VM_STOP_ON_SHUTDOWN`)

See [YANDEX_CLOUD_SETUP.md](./YANDEX_CLOUD_SETUP.md) for detailed setup instructions.

## Remote Deployment with vLLM

### 1. Server Setup (Ubuntu 22.04)

Deploy the backend on a remote host with vLLM:

```bash
# Clone the repository
git clone <your-repo-url>
cd llm-communicator

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your vLLM URL and API keys

# Set up firewall (Ubuntu 22.04)
chmod +x scripts/setup-firewall.sh
sudo ./scripts/setup-firewall.sh 3000

# Start the server
npm start
```

### 2. vLLM Configuration

The server is compatible with vLLM's OpenAI-compatible API. Configure your `.env`:

```env
CUSTOM_API_URL=http://localhost:8000/v1
CUSTOM_API_KEY=your-vllm-api-key
CUSTOM_API_MODEL=your-model-name
```

### 3. Client Configuration

From your client hosts, connect to the server:

```bash
# Using curl (non-streaming)
curl -X POST http://your-server-ip:8000/api/prompts/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-api-key" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "maxTokens": 100
  }'

# Using curl (streaming)
curl -X POST http://your-server-ip:8000/api/prompts/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-api-key" \
  -N \
  -d '{
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "maxTokens": 500,
    "stream": true
  }'

# Using JavaScript (with streaming)
const response = await fetch('http://your-server-ip:8000/api/prompts/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-secret-api-key'
  },
  body: JSON.stringify({
    messages: [{role: 'user', content: 'Hello!'}],
    stream: true
  })
});

const reader = response.body.getReader();
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}

# Cancel streaming by aborting the fetch
const controller = new AbortController();
fetch(url, { signal: controller.signal, ... });
// Cancel anytime: controller.abort();
```

**Example Clients:** See `scripts/example-streaming-client.js` and `scripts/example-streaming-client.py` for complete working examples.

### 4. Firewall Setup

The `scripts/setup-firewall.sh` script configures UFW for secure remote access:

- Installs and configures UFW
- Allows SSH (port 22) to prevent lockout
- Allows application port (default: 3000)
- Denies all other incoming traffic
- See `scripts/README.md` for details

## Security Considerations

1. **API Keys**: Generate strong, unique API keys for each client
2. **CORS**: Configure `CORS_ORIGINS` to restrict allowed origins
3. **HTTPS**: Use a reverse proxy (nginx, Caddy) with SSL/TLS in production
4. **Firewall**: Always run the firewall setup script on production servers
5. **Rate Limiting**: Adjust rate limits based on your use case
6. **Environment**: Never commit `.env` files to version control

## Streaming & Cancellation

The backend fully supports **real-time streaming** from vLLM with **request cancellation**:

- **Streaming**: Set `"stream": true` to receive tokens in real-time via Server-Sent Events
- **Cancellation**: Close the connection to cancel - the server automatically aborts the vLLM request
- **Examples**: See `scripts/example-streaming-client.js` and `scripts/example-streaming-client.py`
- **Guide**: See `docs/STREAMING.md` for detailed documentation

```javascript
// Cancel streaming by closing connection
const controller = new AbortController();
fetch(url, { signal: controller.signal, body: JSON.stringify({ stream: true }) });
controller.abort(); // Cancels the request
```

## Project Structure

```
├── src/
│   ├── config/          # Configuration files
│   ├── middleware/      # Custom middleware (auth, rate limiting, etc.)
│   ├── providers/       # LLM provider abstraction
│   ├── routes/          # API routes
│   ├── utils/           # Utility functions
│   ├── app.js          # Koa app setup
│   └── index.js        # Server entry point
├── scripts/
│   ├── setup-firewall.sh         # UFW firewall configuration script
│   ├── example-client.js         # Basic client example
│   ├── example-client.py         # Basic client example (Python)
│   ├── example-streaming-client.js # Streaming client example
│   ├── example-streaming-client.py # Streaming client example (Python)
│   └── README.md                 # Scripts documentation
├── docs/
│   └── STREAMING.md     # Streaming & cancellation guide
├── .env                # Environment variables (gitignored)
├── .env.example        # Example environment file
└── package.json        # Dependencies
```

## License

MIT