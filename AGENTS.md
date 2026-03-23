# Agent Guidelines for MCP SSH SRE

## Project Overview

An MCP (Model Context Protocol) server providing read-only server monitoring tools via SSH. Built with TypeScript, using the `@modelcontextprotocol/sdk`, Zod for validation, and Vitest for testing.

**Key Principles:**
- Read-only operations (no destructive commands)
- Multi-platform support (Unraid, Linux, etc.)
- Comprehensive output filtering system
- Platform abstraction layer
- Stdio transport for direct integration with MCP clients

## Build, Lint, and Test Commands

### Build
```bash
bun run build              # TypeScript compilation to dist/
```

### Development
```bash
bun run dev                # Run stdio server with Bun (hot reload)
```

### Production
```bash
bun run start              # Run compiled stdio server
```

### Testing
```bash
bun run test               # Run all tests once (Vitest)
bun run test:watch         # Run tests in watch mode
bun run test:ui            # Launch Vitest UI

# Run a single test file
bunx vitest run src/__tests__/docker-tools.test.ts

# Run tests matching a pattern
bunx vitest run -t "Docker Tools"
```

**Test Expectations:**
- All tests should pass (178 tests as of v2.1.0)
- Tests mock SSH executor and MCP server
- Use `vi.fn()` for mocking, not manual mock implementations

## TypeScript Configuration

**Compiler Settings:**
- Target: ES2022
- Module: ES2022 (ESM only, `.js` extensions in imports)
- Strict mode enabled
- Source maps and declarations generated

**Key Points:**
- All imports must include `.js` extension (not `.ts`)
- Use `type` imports for type-only imports when possible
- Files go in `src/`, build output in `dist/`

## Code Style and Conventions

### File Organization

```
src/
├── platforms/           # Platform-specific code
│   ├── types.ts        # Platform interfaces
│   ├── registry.ts     # Platform registration
│   ├── linux/          # Generic Linux
│   └── unraid/         # Unraid-specific
├── tools/core/         # Core tool modules (10 modules)
│   └── index.ts        # Central export
├── __tests__/          # Colocated test files
├── filters.ts          # Output filtering system
├── ssh-manager.ts      # SSH connection management
├── tool-loader.ts      # Tool registration logic
└── index.ts            # Stdio transport entry
```

### Import Style

**Correct:**
```typescript
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "../../filters.js";
import type { SSHExecutor } from "../types.js";
```

**Notes:**
- Use double quotes for imports
- Always include `.js` extension for local imports
- Use `type` imports for type-only imports
- Group imports: external packages → internal modules → types

### Naming Conventions

**Variables/Functions:** camelCase
```typescript
const sshExecutor: SSHExecutor = ...;
async function registerDockerTools(...) { }
```

**Types/Interfaces:** PascalCase
```typescript
interface Platform { }
type SSHExecutor = ...;
```

**Constants:** camelCase or SCREAMING_SNAKE_CASE for true constants
```typescript
const dockerActions = ["list_containers", ...] as const;
const MAX_RECONNECT_ATTEMPTS = 5;
```

**Files:** kebab-case
```typescript
ssh-manager.ts
docker-tools.ts
container-topology-tools.ts
```

### Type Annotations

**Always annotate:**
- Function parameters
- Function return types
- Exported variables
- Complex object literals

**Example:**
```typescript
export function registerDockerTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // ...
}

async function executeCommand(cmd: string): Promise<string> {
  // ...
}
```

### Error Handling

**Pattern 1: Return error in MCP response**
```typescript
if (!args.container) {
  return { 
    content: [{ type: "text", text: "Error: container required" }], 
    isError: true 
  };
}
```

**Pattern 2: Try-catch with fallback**
```typescript
try {
  const output = await sshExecutor(cmd);
  return { content: [{ type: "text", text: output }] };
} catch (error) {
  return { 
    content: [{ type: "text", text: `Error: ${error.message}` }], 
    isError: true 
  };
}
```

**Pattern 3: Silent fallback for optional operations**
```typescript
try {
  const sensors = await sshExecutor("sensors 2>/dev/null || echo 'not available'");
  output += sensors;
} catch { 
  output += "Could not get system temps\n"; 
}
```

**Never:**
- Throw unhandled errors from tool handlers
- Log to stdout (reserved for MCP protocol)
- Expose SSH credentials or sensitive data in errors

### Logging Standards

**Always use the logger utility** (`src/logger.ts`) for diagnostic output:

```typescript
import { logger } from "../logger.js";

// Debug: Detailed information for troubleshooting
logger.debug("Platform registry initialized with 2 platforms");
logger.debug(`Loading platform tool module: ${module.name}`);

// Info: General informational messages
logger.info("Successfully connected to 192.168.1.72");
logger.info("MCP SSH SRE Server (stdio) ready");

// Warn: Warning conditions (recoverable issues)
logger.warn("Could not establish initial SSH connection");
logger.warn("Attempting to reconnect (attempt 1/5)");

// Error: Error conditions (failures)
logger.error("Circuit breaker opened after 3 consecutive failures");
logger.error("Fatal error: SSH connection failed");
```

**Log Levels:**
- `debug`: Very detailed information (platform detection scores, tool loading)
- `info`: Normal operational messages (startup, connections, shutdown)
- `warn`: Warnings and recoverable issues (reconnects, fallbacks)
- `error`: Errors and failures (circuit breaker, fatal errors)
- `silent`: No output (useful for testing or production silence)

**Important:**
- All logs go to stderr (stdout is reserved for MCP JSON-RPC protocol)
- Log format: `[LEVEL] message` (no timestamp - allows proxy to add its own)
- Default log level is `info` (controlled by `LOG_LEVEL` environment variable)
- Tool handlers should NOT use logger for normal operations (only for debugging/errors)
- Use logger in infrastructure code: connection management, platform detection, tool loading

### Tool Registration Pattern

All tools follow this structure:

```typescript
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "../../filters.js";
import type { SSHExecutor } from "../types.js";

const toolActions = ["action1", "action2"] as const;

export function registerMyTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "tool_name",
    "Tool description. Actions: action1, action2.",
    {
      action: z.enum(toolActions).describe("Action"),
      param: z.string().optional().describe("Parameter"),
      ...outputFiltersSchema.shape,  // Always include filters
    },
    async (args) => {
      try {
        switch (args.action) {
          case "action1": {
            let cmd = "some command";
            cmd = applyFilters(cmd, args);  // Apply filters to command
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
          }
          // ... other actions
        }
      } catch (error) {
        return { 
          content: [{ type: "text", text: `Error: ${error}` }], 
          isError: true 
        };
      }
    }
  );
}
```

### Output Filtering

**Always support filters** using `outputFiltersSchema`:
- `grep`: Pattern matching
- `head/tail`: Limit lines
- `sort`: Sort output
- `uniq`: Remove duplicates
- `wc`: Count lines/words/chars

**Apply filters:**
```typescript
// For commands (applies shell pipeline)
let cmd = applyFilters("docker logs container", args);

// For pre-formatted text (applies client-side)
const formatted = applyFiltersToText(text, args);
```

## Platform Architecture

### Adding New Platforms

1. Create `src/platforms/<platform>/index.ts`:
```typescript
import type { Platform } from "../types.js";

export const myPlatform: Platform = {
  id: "my-platform",
  displayName: "My Platform",
  capabilities: { ... },
  paths: { ... },
  async detect(executor) {
    // Return 0-100 confidence score
  },
  getToolModules() {
    return [
      { name: "my-tools", register: registerMyTools },
    ];
  },
};
```

2. Register in `src/platforms/index.ts`:
```typescript
platformRegistry.register(myPlatform);
```

### Platform Tool Modules

- **Core tools** (`src/tools/core/`): Always loaded on any platform
- **Platform tools** (`src/platforms/*/`): Loaded only on detected platform
- Detection runs on startup, falls back to generic Linux

## Testing Guidelines

### Test Structure
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMyTools } from '../tools/core/my-tools.js';

describe('My Tools', () => {
  let mockServer: any;
  let mockSSHExecutor: any;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    registeredTools = new Map();
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools.set(name, { name, description, schema, handler });
      }),
    };
    mockSSHExecutor = vi.fn();
    registerMyTools(mockServer as any, mockSSHExecutor);
  });

  it('should register tool', () => {
    expect(mockServer.tool).toHaveBeenCalledTimes(1);
    expect(registeredTools.has('my_tool')).toBe(true);
  });

  it('should handle action', async () => {
    mockSSHExecutor.mockResolvedValue('output');
    const tool = registeredTools.get('my_tool');
    const result = await tool.handler({ action: 'test' });
    expect(result.content[0].text).toContain('output');
  });
});
```

### Test Patterns

- Mock `server.tool()` to capture registrations
- Mock `sshExecutor` with `vi.fn()`
- Test tool registration count
- Test each action separately
- Test error cases (missing params, command failures)
- Verify correct SSH commands are executed

## Environment Variables

Required for SSH connection (see `.env.example`):
- `SSH_HOST`: Target server hostname/IP
- `SSH_USERNAME`: SSH user
- `SSH_PRIVATE_KEY_PATH` or `SSH_PASSWORD`: Authentication

Optional:
- `SSH_PORT`: SSH port (default: 22)
- `COMMAND_TIMEOUT_MS`: Command timeout (default: 15000)
- `MAX_CONSECUTIVE_FAILURES`: Circuit breaker threshold (default: 3)
- `LOG_LEVEL`: Logging verbosity - `debug`, `info`, `warn`, `error`, `silent` (default: `info`)
- `NODE_ENV`: Set to 'test' to disable auto-start

## Accuracy and Verification

- **Always count before claiming**: Never state tool counts or numbers without actually counting them first (e.g., use `grep -c` to count `server.tool()` calls)
- **Be precise and consistent**: If documentation says "85 tools" and README says "86 tools", count the actual number and fix all inconsistencies
- **Verify arithmetic**: When removing N tools from X total, actually verify the result instead of guessing

### Removing Features

When removing tools or features:
1. Count the actual number of tools being removed
2. Count the current total across all files
3. Calculate the new total: current - removed = new
4. Update ALL documentation consistently:
   - `AGENTS.md` - tool count
   - `README.md` - tool count
   - Test files - expected counts
   - Tool registration tests

## Version Bumping Workflow

After bumping the version:

1. **Update version in these files:**
   - `package.json` - version field
   - `src/index.ts` - McpServer version (if version is specified)

2. **Build and test:**
   - Run `bun run build && bun run test`
   - Verify all tests pass

3. **Build and publish Docker image (if applicable):**
   - Build with both version tag and latest:
     ```bash
     docker build -t your-registry.com/your-org/mcp-ssh-sre:{version} -t your-registry.com/your-org/mcp-ssh-sre:latest .
     ```
   - Push both tags to registry:
     ```bash
     docker push your-registry.com/your-org/mcp-ssh-sre:{version}
     docker push your-registry.com/your-org/mcp-ssh-sre:latest
     ```
   - **Retry on network timeout**: If `docker push` fails due to network timeout, retry — the issue is likely transient

4. **Update deployment configuration:**
   - Update your deployment config file (e.g., `compose.yaml` or Kubernetes manifest)
   - Update the `image:` tag to match the new version

## Testing MCP Functionality

When testing the deployed MCP server, use the MCP tools (e.g., `mcp__unraid-ssh__*`) to verify functionality. Test various filter combinations to ensure the filtering system works correctly.
