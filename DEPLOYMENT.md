# Deployment Guide

## Prerequisites

- Linux server with SSH access enabled
- SSH key pair for passwordless authentication
- Node.js 18+ (for local development only, not required for npm installation)

## NPM Installation (Recommended)

The simplest way to use MCP SSH SRE is via npx with Claude Desktop:

### 1. Create SSH Key

Generate a dedicated SSH key for the MCP server:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa_mcp -C "mcp-ssh-sre"
```

### 2. Deploy Key to Server

Copy the public key to your server:

```bash
ssh-copy-id -i ~/.ssh/id_rsa_mcp.pub mcp-readonly@server.local
```

### 3. Configure Claude Desktop

Add to your Claude Desktop configuration file:

**Configuration file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "unraid": {
      "command": "npx",
      "args": ["-y", "@kylerm42/mcp-ssh-sre"],
      "env": {
        "SSH_HOST": "unraid.local",
        "SSH_USERNAME": "mcp-readonly",
        "SSH_PRIVATE_KEY_PATH": "~/.ssh/id_rsa_mcp"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

After saving the configuration, restart Claude Desktop to load the MCP server.

### SSH Key Path Configuration

The `SSH_PRIVATE_KEY_PATH` environment variable supports:

- **Tilde expansion:** `~/.ssh/id_rsa_mcp` (recommended)
- **Absolute paths:** `/Users/kyle/.ssh/id_rsa_mcp`
- **Relative paths:** Not supported, use absolute or tilde paths

**Platform-specific paths:**

| Platform | Example Path |
|----------|--------------|
| macOS | `~/.ssh/id_rsa_mcp` |
| Linux | `~/.ssh/id_rsa_mcp` |
| Windows | `C:\\Users\\username\\.ssh\\id_rsa_mcp` (absolute path required) |

**Note:** Windows users should use absolute paths as tilde expansion may not work consistently.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SSH_HOST` | Yes | - | Server hostname or IP |
| `SSH_PORT` | No | 22 | SSH port |
| `SSH_USERNAME` | Yes | - | SSH username |
| `SSH_PRIVATE_KEY_PATH` | Yes* | - | Path to SSH private key |
| `SSH_PASSWORD` | No | - | SSH password (if not using key) |
| `COMMAND_TIMEOUT_MS` | No | 15000 | Command timeout (milliseconds) |
| `MAX_CONSECUTIVE_FAILURES` | No | 3 | Circuit breaker threshold |

*Either `SSH_PRIVATE_KEY_PATH` or `SSH_PASSWORD` is required.

## Local Development

For contributors working on the codebase:

### Installation

```bash
git clone https://github.com/ohare93/mcp-ssh-sre.git
cd mcp-ssh-sre
npm install
npm run build
```

### Configuration

Create a `.env` file:

```bash
SSH_HOST=server.local
SSH_PORT=22
SSH_USERNAME=mcp-readonly
SSH_PRIVATE_KEY_PATH=~/.ssh/id_rsa_mcp
```

### Running

```bash
# Stdio mode (for local MCP clients)
npm start

# Development mode with auto-reload
npm run dev

# Run tests
npm test
```

### Claude Desktop Configuration (Local Development)

For testing local changes before publishing:

```json
{
  "mcpServers": {
    "ssh-sre-dev": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ssh-sre/dist/index.js"],
      "env": {
        "SSH_HOST": "server.local",
        "SSH_USERNAME": "mcp-readonly",
        "SSH_PRIVATE_KEY_PATH": "~/.ssh/id_rsa_mcp"
      }
    }
  }
}
```

## Security Setup

### Create a Read-Only User

Create a dedicated SSH user with minimal permissions:

```bash
# On server as root
useradd -m -s /bin/bash mcp-readonly
passwd mcp-readonly

# Add to docker group (if Docker monitoring needed)
usermod -aG docker mcp-readonly
```

**Security recommendations:**
- Use a dedicated user, not root
- Disable password login (key authentication only)
- Consider using SSH `ForceCommand` to restrict commands
- Monitor SSH logs for unauthorized access attempts

### Generate and Deploy SSH Key

```bash
# On your local machine
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa_mcp -C "mcp-ssh-sre"

# Copy public key to server
ssh-copy-id -i ~/.ssh/id_rsa_mcp.pub mcp-readonly@server.local

# Test connection
ssh -i ~/.ssh/id_rsa_mcp mcp-readonly@server.local
```

### Restrict SSH Access (Optional)

Add to server's `/etc/ssh/sshd_config`:

```
Match User mcp-readonly
    PermitRootLogin no
    PasswordAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
```

Then restart SSH:
```bash
systemctl restart sshd
```

## Troubleshooting

### Connection Failures

**Error: "Could not connect to SSH server"**

1. Verify SSH key permissions:
   ```bash
   chmod 600 ~/.ssh/id_rsa_mcp
   ```

2. Test SSH connection manually:
   ```bash
   ssh -i ~/.ssh/id_rsa_mcp mcp-readonly@server.local
   ```

3. Check server SSH logs:
   ```bash
   tail -f /var/log/auth.log  # Debian/Ubuntu
   tail -f /var/log/secure    # RHEL/CentOS
   ```

**Error: "Private key not found"**

Verify the path in your Claude Desktop configuration:
- Use absolute paths or tilde expansion
- Check file exists: `ls -l ~/.ssh/id_rsa_mcp`
- Ensure proper permissions: `chmod 600 ~/.ssh/id_rsa_mcp`

### Command Timeouts

If commands are timing out, increase the timeout:

```json
{
  "mcpServers": {
    "unraid": {
      "env": {
        "COMMAND_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

### Platform Detection Issues

The server auto-detects your platform (Unraid, generic Linux, etc.) at startup. If detection fails:

1. Check Claude Desktop logs for detection errors
2. Verify SSH user has permissions to read `/etc/os-release`
3. File an issue with your platform details

## Network Security

- MCP SSH SRE uses stdio transport, so it runs locally on the machine running Claude Desktop
- SSH credentials are never exposed to Claude's API or transmitted over the network
- All SSH connections are direct from your machine to your server
- No OAuth or HTTP server required

## Security Checklist

- [ ] Created dedicated SSH user (not root)
- [ ] Generated unique SSH key pair
- [ ] SSH key has correct permissions (600)
- [ ] Password authentication disabled for SSH user
- [ ] Tested SSH connection before configuring Claude Desktop
- [ ] SSH user has minimal permissions (read-only where possible)
- [ ] Monitoring SSH logs for unauthorized access attempts
