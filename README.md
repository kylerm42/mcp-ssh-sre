# MCP SSH SRE

An MCP server providing read-only server monitoring tools to AI assistants. Runs predefined diagnostic commands over SSH and passes only the results to the LLM - your server credentials and shell are never exposed.

## Quick Start

Install via npm and add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "unraid": {
      "command": "npx",
      "args": ["-y", "@kylerm42/mcp-ssh-sre"],
      "env": {
        "SSH_HOST": "unraid.local",
        "SSH_USERNAME": "root",
        "SSH_PRIVATE_KEY_PATH": "~/.ssh/id_rsa_mcp"
      }
    }
  }
}
```

**For Docker Container Deployment (running on target server):**

If running this MCP server inside a Docker container on the same server it monitors, use `172.17.0.1` (Docker bridge gateway) as the SSH host:

```json
{
  "mcpServers": {
    "unraid": {
      "command": "npx",
      "args": ["-y", "@kylerm42/mcp-ssh-sre"],
      "env": {
        "SSH_HOST": "172.17.0.1",
        "SSH_USERNAME": "root",
        "SSH_PRIVATE_KEY_PATH": "/root/.ssh/id_rsa_mcp"
      }
    }
  }
}
```

Mount SSH keys into the container and ensure the container can reach the host via Docker's bridge network.

See [DEPLOYMENT.md](DEPLOYMENT.md) for SSH key setup, configuration options, and alternative installation methods.

## Claude Desktop Configuration

After setting up SSH keys (see [DEPLOYMENT.md](DEPLOYMENT.md)), add this configuration to your Claude Desktop settings:

**Location:** 
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
        "SSH_USERNAME": "root",
        "SSH_PRIVATE_KEY_PATH": "~/.ssh/id_rsa_mcp",
        "SSH_PORT": "22",
        "COMMAND_TIMEOUT_MS": "15000"
      }
    }
  }
}
```

**Required environment variables:**
- `SSH_HOST` - Your server hostname, IP address, or `172.17.0.1` (for Docker containers on same host)
- `SSH_USERNAME` - SSH username (typically `root` for Unraid)
- `SSH_PRIVATE_KEY_PATH` - Path to SSH private key (supports `~/` tilde expansion)

**Optional environment variables:**
- `SSH_PORT` - SSH port (default: 22)
- `COMMAND_TIMEOUT_MS` - Command timeout in milliseconds (default: 15000)
- `MAX_CONSECUTIVE_FAILURES` - Circuit breaker threshold (default: 3)

After saving the configuration, restart Claude Desktop to load the MCP server.

## Why Use This?

Managing a Linux server involves SSH-ing in, running commands, correlating logs, and interpreting metrics. This MCP server lets AI assistants do that work using natural language.

**Ask questions like:**

- "Why is my Plex container crashing?"
- "Is my array healthy and are there any drives showing signs of failure?"
- "Which containers are consuming the most resources?"
- "Help me debug network connectivity between my nginx and database containers"

Instead of manually running `docker logs`, `smartctl`, `docker inspect`, and correlating outputs, your AI assistant does it in seconds.

## Supported Platforms

| Platform | Status | Tools |
|----------|--------|-------|
| **Unraid** | Full support | 12 modules (10 core + 2 Unraid-specific) |
| **Generic Linux** | Full support | 10 core modules |
| **TrueNAS** | Untested (PRs welcome) | Core tools should work |
| **Proxmox** | Untested (PRs welcome) | Core tools should work |

The server auto-detects your platform at startup and loads appropriate tools.

## Features

- **12 tool modules with 79+ actions** for comprehensive server management
- **Stdio transport** - Direct integration with Claude Desktop and MCP clients
- **Read-only by design** - Zero risk of accidental modifications
- **Docker management** - Logs, stats, environment, ports, network topology
- **Storage & array** - Parity checks, SMART data, temperatures, mover logs (Unraid)
- **Health diagnostics** - Aggregated status with automatic issue detection
- **System monitoring** - Processes, disk I/O, network connections
- **Log analysis** - Search across containers and system logs
- **VM management** - List, inspect, VNC details, libvirt logs
- **Security auditing** - Port scanning, login monitoring, permission audits

## Why SSH Instead of Platform APIs?

| Feature | APIs | SSH |
|---------|------|-----|
| Docker container logs | ❌ | ✅ |
| SMART disk health data | ❌ | ✅ |
| Real-time CPU/load averages | ❌ | ✅ |
| Network bandwidth monitoring | ❌ | ✅ |
| Process monitoring (ps/top) | ❌ | ✅ |
| Log file analysis | ❌ | ✅ |

SSH provides unrestricted access to system tools without API rate limiting.

## Architecture

```
src/
├── platforms/
│   ├── linux/        # Generic Linux (baseline)
│   └── unraid/       # Unraid-specific tools
├── tools/core/       # 10 core tool modules
└── index.ts          # Stdio transport entry point
```

### Adding New Platforms

1. Create `src/platforms/<platform>/index.ts` implementing `Platform`
2. Add detection logic
3. Create platform-specific tool modules
4. Register in `src/platforms/index.ts`

## Write Capabilities

In addition to read-only monitoring tools, the server includes a `file_write` tool for making changes to remote files.

### Actions

| Action | Description |
|---|---|
| `write_file` | Create or overwrite a file; supports `encoding: "base64"` for binary content |
| `append_file` | Append text content to an existing file |
| `replace_in_file` | Search-and-replace within a file; errors if `oldString` not found |
| `delete_file` | Delete a file |
| `mkdir` | Create a directory including intermediate parents |
| `list_allowed_paths` | Return the configured write allowlist |

### Binary File Support

`write_file` accepts an optional `encoding` parameter (`"utf8"` by default, or `"base64"`). When `encoding: "base64"` is set, the server decodes the content on the remote host via `base64 -d` and writes the raw bytes to the target path. This supports binary files up to 50MB (pre-encoding).

Example tool call:
```json
{
  "action": "write_file",
  "path": "/mnt/user/appdata/app/cert.pem",
  "content": "<base64-encoded content>",
  "encoding": "base64"
}
```

### Write Allowlist

All mutating actions require the target path to be covered by a prefix configured in the `WRITE_ALLOWED_PATHS` environment variable. The server rejects any path not matching an allowlisted prefix.

```
WRITE_ALLOWED_PATHS=/mnt/user/appdata,/tmp/agent-scratch
```

Multiple prefixes are comma-separated. If `WRITE_ALLOWED_PATHS` is not set, all write operations are rejected. Use the `list_allowed_paths` action to query the effective allowlist at runtime.

## Development

```bash
bun run dev      # Development with auto-reload
bun run test     # Run tests
bun run build    # Build for production
```

## License

ISC

## Installation & Distribution

**Published Package:**
- npm: `@kylerm42/mcp-ssh-sre` (GitHub Packages)
- Install: `npx @kylerm42/mcp-ssh-sre@latest`

**Deployment Options:**
1. **Direct execution** via `npx` (recommended for Claude Desktop)
2. **Docker container** deployment (for running on target server with multi-mcp-proxy)

## Support

For issues and questions, open an issue on the [GitHub repository](https://github.com/kylerm42/mcp-ssh-sre).
