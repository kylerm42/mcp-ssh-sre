#!/usr/bin/env node

/**
 * MCP SSH SRE Server - CLI Entry Point
 * 
 * This script serves as the npm package entry point for the MCP SSH SRE server.
 * It imports and executes the compiled stdio server from dist/index.js.
 * 
 * Configuration is handled entirely through environment variables.
 * See README.md for required environment variables.
 */

import("../dist/index.js").catch((error) => {
  console.error("Failed to start MCP SSH SRE server:", error);
  process.exit(1);
});
