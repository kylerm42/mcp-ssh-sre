import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all advanced Docker debugging tools with the MCP server
 * All tools are READ-ONLY for safe inspection of Docker containers
 */
export function registerDockerAdvancedTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: docker container env - Show container environment variables
  server.tool(
    "docker container env",
    "Show container environment variables.",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' ${args.container}`;

        // Apply filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        const result = output.trim() || "No environment variables found.";

        return {
          content: [
            {
              type: "text",
              text: `Environment Variables - ${args.container}:\n\n${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving environment variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: docker top - Show processes inside container
  server.tool(
    "docker top",
    "Show processes running inside a container (PID, user, command).",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker top ${args.container}`;

        // Apply filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Processes in Container - ${args.container}:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving container processes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: docker health check all - Health status of all containers
  server.tool(
    "docker health check all",
    "Show health status of all containers (healthy/unhealthy/no healthcheck).",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const command = "docker ps -a --format json";

        const output = await sshExecutor(command);

        // Parse JSON lines
        const lines = output
          .trim()
          .split("\n")
          .filter((line) => line.trim());

        if (lines.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No containers found.",
              },
            ],
          };
        }

        const containers = lines.map((line) => JSON.parse(line));

        // Format health check information
        const healthInfo = containers
          .map((c) => {
            const health = c.Status.includes("(healthy)")
              ? "healthy"
              : c.Status.includes("(unhealthy)")
              ? "unhealthy"
              : c.Status.includes("(health: starting)")
              ? "starting"
              : "no healthcheck";

            return `Name: ${c.Names}\nState: ${c.State}\nHealth: ${health}\nStatus: ${c.Status}\n`;
          })
          .join("\n---\n\n");

        // Apply filters to formatted text
        const filtered = applyFiltersToText(`Container Health Status (${containers.length} containers):\n\n${healthInfo}`, args);

        return {
          content: [
            {
              type: "text",
              text: filtered,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving health status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: docker logs aggregate - Search logs across multiple containers
  server.tool(
    "docker logs aggregate",
    "Search pattern across logs of all running containers.",
    {
      pattern: z.string().describe("Pattern to search (case-insensitive)"),
      lines: z.number().optional().default(100).describe("Lines per container (default: 100)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const lines = args.lines ?? 100;

        // First, get list of running containers
        const listCommand = "docker ps --format '{{.Names}}'";
        const containerList = await sshExecutor(listCommand);

        const containers = containerList
          .trim()
          .split("\n")
          .filter((name) => name.trim());

        if (containers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No running containers found.",
              },
            ],
          };
        }

        // Search logs in each container
        const results: string[] = [];
        for (const container of containers) {
          try {
            const logCommand = `docker logs --tail ${lines} ${container} 2>&1 | grep -i '${args.pattern}' || true`;
            const logOutput = await sshExecutor(logCommand);

            if (logOutput.trim()) {
              results.push(`=== ${container} ===\n${logOutput.trim()}\n`);
            }
          } catch (error) {
            // Skip containers that error (might be stopped or permission issues)
            continue;
          }
        }

        const resultText = results.length === 0
          ? `No matches found for pattern "${args.pattern}" in any container logs (searched ${containers.length} containers).`
          : `Log Search Results for "${args.pattern}" (found in ${results.length} of ${containers.length} containers):\n\n${results.join("\n")}`;

        // Apply filters to result
        const filtered = applyFiltersToText(resultText, args);

        return {
          content: [
            {
              type: "text",
              text: filtered,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error aggregating logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
