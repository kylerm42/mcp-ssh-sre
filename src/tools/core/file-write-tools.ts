import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { posix } from "path";
import type { SSHExecutor } from "../../platforms/types.js";

const fileWriteActions = [
  "write_file",
  "append_file",
  "replace_in_file",
  "delete_file",
  "mkdir",
  "list_allowed_paths",
] as const;

/**
 * Normalize a POSIX path and check if it is covered by any allowlisted prefix.
 * Returns true if the path is permitted, false otherwise.
 */
function isPathAllowed(rawPath: string, allowedPaths: string[]): boolean {
  const normalized = posix.normalize(rawPath);
  return allowedPaths.some((prefix) => {
    // Ensure prefix comparison doesn't accidentally match partial dir names.
    // e.g. allowlist "/tmp" must not allow "/tmpfoo".
    const withSlash = prefix.endsWith("/") ? prefix : prefix + "/";
    return normalized === prefix || normalized.startsWith(withSlash);
  });
}

/**
 * Escape a string for safe interpolation inside a single-quoted shell argument.
 * Replaces each single-quote with: '\''
 */
function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function registerFileWriteTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Parse allowlist once at registration time
  const rawAllowedPaths = process.env.WRITE_ALLOWED_PATHS ?? "";
  const allowedPaths: string[] = rawAllowedPaths
    .split(":")
    .map((p) => p.trim().replace(/\/+$/, ""))
    .filter((p) => p.length > 0);

  server.tool(
    "file_write",
    "File write operations on the remote server. All mutating actions require the target path to be covered by an allowlisted prefix (WRITE_ALLOWED_PATHS). Actions: write_file, append_file, replace_in_file, delete_file, mkdir, list_allowed_paths. write_file supports encoding: 'utf8' (default) or 'base64' for binary file uploads up to 50MB.",
    {
      action: z.enum(fileWriteActions).describe("Action to perform"),
      path: z.string().optional().describe("Absolute remote path (required for all actions except list_allowed_paths)"),
      content: z.string().max(67_108_864).optional().describe("File content (required for write_file, append_file); for write_file with encoding 'base64', provide base64-encoded bytes (50MB source file limit)"),
      encoding: z.enum(["utf8", "base64"]).default("utf8").optional().describe("Content encoding for write_file: 'utf8' (default) or 'base64' for binary files up to 50MB"),
      oldString: z.string().min(1).optional().describe("Text to search for (required for replace_in_file; must be non-empty)"),
      newString: z.string().optional().describe("Replacement text (required for replace_in_file)"),
    },
    async (args) => {
      try {
        switch (args.action) {
          case "list_allowed_paths": {
            if (allowedPaths.length === 0) {
              return {
                content: [{ type: "text", text: "No write paths configured. Set WRITE_ALLOWED_PATHS on the MCP server." }],
              };
            }
            return {
              content: [{ type: "text", text: `Allowed write path prefixes:\n${allowedPaths.join("\n")}` }],
            };
          }

          case "write_file": {
            if (!args.path) {
              return { content: [{ type: "text", text: "Error: path is required for write_file" }], isError: true };
            }
            if (args.content === undefined) {
              return { content: [{ type: "text", text: "Error: content is required for write_file" }], isError: true };
            }
            if (!isPathAllowed(args.path, allowedPaths)) {
              return {
                content: [{ type: "text", text: `Error: path "${args.path}" is not under an allowed write prefix` }],
                isError: true,
              };
            }
            const escapedPath = shellEscape(args.path);
            if (args.encoding === "base64") {
              const escapedContent = shellEscape(args.content);
              await sshExecutor(`printf '%s' '${escapedContent}' | base64 -d > '${escapedPath}'`);
            } else {
              const escapedContent = shellEscape(args.content);
              await sshExecutor(`printf '%s' '${escapedContent}' | tee '${escapedPath}' > /dev/null`);
            }
            return { content: [{ type: "text", text: `Successfully wrote to "${args.path}"` }] };
          }

          case "append_file": {
            if (!args.path) {
              return { content: [{ type: "text", text: "Error: path is required for append_file" }], isError: true };
            }
            if (args.content === undefined) {
              return { content: [{ type: "text", text: "Error: content is required for append_file" }], isError: true };
            }
            if (!isPathAllowed(args.path, allowedPaths)) {
              return {
                content: [{ type: "text", text: `Error: path "${args.path}" is not under an allowed write prefix` }],
                isError: true,
              };
            }
            const escapedPath = shellEscape(args.path);
            const escapedContent = shellEscape(args.content);
            await sshExecutor(`printf '%s' '${escapedContent}' >> '${escapedPath}'`);
            return { content: [{ type: "text", text: `Successfully appended to "${args.path}"` }] };
          }

          case "replace_in_file": {
            if (!args.path) {
              return { content: [{ type: "text", text: "Error: path is required for replace_in_file" }], isError: true };
            }
            if (!args.oldString) {
              return { content: [{ type: "text", text: "Error: oldString is required for replace_in_file" }], isError: true };
            }
            if (args.newString === undefined) {
              return { content: [{ type: "text", text: "Error: newString is required for replace_in_file" }], isError: true };
            }
            if (!isPathAllowed(args.path, allowedPaths)) {
              return {
                content: [{ type: "text", text: `Error: path "${args.path}" is not under an allowed write prefix` }],
                isError: true,
              };
            }
            const escapedPath = shellEscape(args.path);
            const fileContent = await sshExecutor(`cat '${escapedPath}'`);
            if (!fileContent.includes(args.oldString)) {
              return {
                content: [{ type: "text", text: `Error: oldString not found in "${args.path}"` }],
                isError: true,
              };
            }
            const newContent = fileContent.replace(args.oldString, args.newString);
            const escapedNewContent = shellEscape(newContent);
            await sshExecutor(`printf '%s' '${escapedNewContent}' | tee '${escapedPath}' > /dev/null`);
            return { content: [{ type: "text", text: `Successfully replaced string in "${args.path}"` }] };
          }

          case "delete_file": {
            if (!args.path) {
              return { content: [{ type: "text", text: "Error: path is required for delete_file" }], isError: true };
            }
            if (!isPathAllowed(args.path, allowedPaths)) {
              return {
                content: [{ type: "text", text: `Error: path "${args.path}" is not under an allowed write prefix` }],
                isError: true,
              };
            }
            const escapedPath = shellEscape(args.path);
            await sshExecutor(`rm '${escapedPath}'`);
            return { content: [{ type: "text", text: `Successfully deleted "${args.path}"` }] };
          }

          case "mkdir": {
            if (!args.path) {
              return { content: [{ type: "text", text: "Error: path is required for mkdir" }], isError: true };
            }
            if (!isPathAllowed(args.path, allowedPaths)) {
              return {
                content: [{ type: "text", text: `Error: path "${args.path}" is not under an allowed write prefix` }],
                isError: true,
              };
            }
            const escapedPath = shellEscape(args.path);
            await sshExecutor(`mkdir -p '${escapedPath}'`);
            return { content: [{ type: "text", text: `Successfully created directory "${args.path}"` }] };
          }

          default:
            return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
