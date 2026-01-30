import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import { SSHConnectionManager } from "./ssh-manager.js";
import { initializePlatforms, platformRegistry, Platform } from "./platforms/index.js";
import { loadTools } from "./tool-loader.js";
import { logger } from "./logger.js";

// Re-export for backward compatibility
export { SSHConnectionManager };

/**
 * Main server function
 */
async function main() {
  // Initialize SSH connection manager
  const sshManager = new SSHConnectionManager();

  try {
    // Establish initial connection
    logger.info("Connecting to SSH server...");
    await sshManager.connect();
    logger.info("SSH connection established");
  } catch (error) {
    logger.warn(`Could not establish initial SSH connection: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn("Server will attempt to connect when first command is executed");
  }

  // Initialize platform registry
  logger.debug("Initializing platform registry...");
  initializePlatforms();

  // Create SSH executor adapter for tool modules
  // Converts SSHConnectionManager's full response to simple stdout string
  const sshExecutor = async (command: string): Promise<string> => {
    const result = await sshManager.executeCommand(command);
    if (result.exitCode !== 0 && result.stderr) {
      const cmdPreview = command.length > 100 ? command.substring(0, 100) + "..." : command;
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmdPreview}\n${result.stderr}`);
    }
    return result.stdout;
  };

  // Detect platform
  logger.debug("Detecting platform...");
  let detectedPlatform: Platform;
  try {
    detectedPlatform = await platformRegistry.detect(sshExecutor);
    logger.info(`Detected platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
  } catch (error) {
    logger.warn(`Platform detection failed: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn("Falling back to generic Linux platform");
    const fallback = platformRegistry.get("linux");
    if (!fallback) {
      throw new Error("Platform detection failed and no fallback platform available");
    }
    detectedPlatform = fallback;
  }

  // Create MCP server
  logger.debug("Initializing MCP server...");
  const server = new McpServer({
    name: "mcp-ssh-sre",
    version: "2.1.2",
    description: "Read-only SSH-based server monitoring and management tools with platform auto-detection (Unraid, Linux). Provides Docker, system, network, storage, and hardware monitoring capabilities.",
  });

  // Load tools for detected platform
  logger.debug("Loading tools for platform...");
  loadTools(server, sshExecutor, detectedPlatform);
  logger.debug("All MCP tools registered");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully...");
    await sshManager.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully...");
    await sshManager.disconnect();
    process.exit(0);
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`MCP SSH SRE Server (stdio) ready`);
  logger.info(`Platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
}

// Start the server only if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch((error) => {
    logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
