# Yandex Cloud VM Management Setup

This backend includes automatic VM management for Yandex Cloud instances running vLLM.

## Features

1. **Auto-start on request**: When a request comes in, the backend checks if the VM is running. If not, it starts the VM and queues the request until both the VM and vLLM are healthy.

2. **Idle shutdown**: If no requests are received for 5 minutes, the VM is automatically stopped to save costs.

3. **Graceful shutdown**: When the backend is shutting down (SIGTERM/SIGINT), it stops the VM first before exiting.

## Setup Instructions

### 1. Create a Service Account in Yandex Cloud

1. Go to your Yandex Cloud Console
2. Navigate to IAM (Identity and Access Management)
3. Create a new service account
4. Grant the service account the following permissions:
   - `compute.admin` (or at minimum: `compute.instances.get`, `compute.instances.start`, `compute.instances.stop`)

### 2. Generate Service Account Key

1. In the service account details, click "Create new key"
2. Select "Create authorized key"
3. Choose JSON format
4. Download the key file
5. Save it as `yandex-cloud-key.json` in the project root directory
   - Or place it anywhere and update `YC_SERVICE_ACCOUNT_KEY_PATH` in `.env`

The key file should look like:
```json
{
  "id": "...",
  "service_account_id": "...",
  "created_at": "...",
  "key_algorithm": "RSA_2048",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}
```

### 3. Configure Environment Variables

Update your `.env` file with the following:

```bash
# Yandex Cloud VM Management
YC_VM_ENABLED=true
YC_VM_INSTANCE_ID=your-vm-instance-id
YC_SERVICE_ACCOUNT_KEY_PATH=./yandex-cloud-key.json
YC_VLLM_HEALTH_URL=http://your-vm-ip:8080/health
```

- `YC_VM_ENABLED`: Set to `true` to enable VM management
- `YC_VM_INSTANCE_ID`: Your Yandex Cloud VM instance ID
- `YC_SERVICE_ACCOUNT_KEY_PATH`: Path to your service account key file
- `YC_VLLM_HEALTH_URL`: URL to check vLLM health (typically `http://<vm-ip>:8080/health`)

### 4. Security Considerations

- **Never commit** the `yandex-cloud-key.json` file to version control
- Add it to `.gitignore`
- Store it securely and rotate the key periodically
- Use environment-specific service accounts (dev, staging, prod)

### 5. Testing

To test the VM management:

1. Ensure the VM is stopped initially
2. Start the backend: `npm start`
3. Send a request to any API endpoint
4. The backend will:
   - Detect the VM is stopped
   - Start the VM
   - Wait for it to be running
   - Wait for vLLM to be healthy
   - Process your request
5. Wait 5+ minutes with no requests
6. The VM will automatically stop

## How It Works

### Request Flow

1. Request arrives at the backend
2. VM middleware intercepts the request
3. Checks if VM is running and vLLM is healthy
4. If not ready:
   - Starts the VM
   - Polls until VM status is `RUNNING`
   - Polls vLLM health endpoint until healthy
   - Processes the queued request
5. If ready:
   - Processes the request immediately
   - Resets the 5-minute idle timer

### Idle Timer

- Tracks the last request time
- After 5 minutes of no requests, stops the VM
- Timer is reset on every request

### Graceful Shutdown

When you stop the backend (Ctrl+C or SIGTERM):
1. Backend receives shutdown signal
2. Stops the VM first
3. Closes all connections
4. Exits

## API Reference

The VM management uses the following Yandex Cloud APIs:

- **IAM Token**: `POST https://iam.api.cloud.yandex.net/iam/v1/tokens`
- **Get Instance**: `GET https://compute.api.cloud.yandex.net/compute/v1/instances/{instanceId}`
- **Start Instance**: `POST https://compute.api.cloud.yandex.net/compute/v1/instances/{instanceId}:start`
- **Stop Instance**: `POST https://compute.api.cloud.yandex.net/compute/v1/instances/{instanceId}:stop`

## Troubleshooting

### VM doesn't start
- Check service account permissions
- Verify the instance ID is correct
- Check Yandex Cloud console for VM errors
- Review backend logs for detailed error messages

### vLLM health check fails
- Ensure vLLM is running on the VM
- Verify the health URL is correct
- Check firewall rules allow access to port 8080
- Try accessing the health URL manually: `curl http://<vm-ip>:8080/health`

### VM doesn't stop on idle
- Check logs to verify idle timer is running
- Ensure no background requests are being made
- Verify the idle timeout (default: 5 minutes)

### VM doesn't stop on shutdown
- Check backend logs for shutdown errors
- Verify service account has stop permissions
- Increase shutdown timeout in `src/index.js` if needed (default: 15 seconds)

## Disabling VM Management

To disable VM management, set in `.env`:
```bash
YC_VM_ENABLED=false
```

The backend will work normally without VM management.
