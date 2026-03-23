import { Client } from "ssh2";
import * as fs from "fs";
import "dotenv/config";
import { logger } from "./logger.js";

/**
 * Minimal surface of the ssh2 Client that SSHConnectionManager actually uses.
 *
 * Typing `ssh` against this interface instead of the concrete Client class
 * keeps the type surface narrow and avoids pulling in any external type
 * declarations that could trigger exponential union expansion in tsc.
 */
interface NodeSSHClient {
  connect(config: Record<string, unknown>): Promise<unknown>;
  execCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  dispose(): void;
}

/**
 * Adapter that wraps ssh2's callback-based Client in the NodeSSHClient interface.
 */
class SSH2Adapter implements NodeSSHClient {
  private client: Client;

  constructor() {
    this.client = new Client();
  }

  connect(config: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.client.once('ready', () => resolve(undefined));
      this.client.once('error', (err: Error) => reject(err));

      const connectConfig: Record<string, unknown> = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
      };

      if (config.password) {
        connectConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connectConfig.privateKey = fs.readFileSync(config.privateKeyPath as string);
      }

      this.client.connect(connectConfig as unknown as Parameters<Client['connect']>[0]);
    });
  }

  execCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        stream.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        stream.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        stream.on('close', (code: number | null) => {
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            code,
          });
        });
      });
    });
  }

  dispose(): void {
    this.client.end();
  }
}

/**
 * SSH Connection Manager
 * Handles SSH connections to remote servers with auto-reconnect functionality
 */
export class SSHConnectionManager {
  private ssh: NodeSSHClient;
  private config: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
  };
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private baseBackoffMs: number = 1000;
  private commandTimeoutMs: number;
  private maxConsecutiveFailures: number;
  private consecutiveFailures: number = 0;
  private circuitBreakerOpen: boolean = false;

  constructor() {
    this.ssh = new SSH2Adapter();

    const host = process.env.SSH_HOST;
    const port = process.env.SSH_PORT ? parseInt(process.env.SSH_PORT) : 22;
    const username = process.env.SSH_USERNAME;
    const privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH;
    const password = process.env.SSH_PASSWORD;

    if (!host) throw new Error("SSH_HOST environment variable is required");
    if (!username) throw new Error("SSH_USERNAME environment variable is required");
    if (!privateKeyPath && !password) {
      throw new Error("Either SSH_PRIVATE_KEY_PATH or SSH_PASSWORD environment variable is required");
    }

    this.config = { host, port, username, privateKeyPath, password };

    this.commandTimeoutMs = process.env.COMMAND_TIMEOUT_MS
      ? parseInt(process.env.COMMAND_TIMEOUT_MS)
      : 15000;
    this.maxConsecutiveFailures = process.env.MAX_CONSECUTIVE_FAILURES
      ? parseInt(process.env.MAX_CONSECUTIVE_FAILURES)
      : 3;
  }

  async connect(): Promise<void> {
    try {
      await this.ssh.connect(this.config);
      this.connected = true;
      this.reconnectAttempts = 0;
      logger.info(`Successfully connected to ${this.config.host}`);
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to SSH server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
    }

    this.reconnectAttempts++;
    const backoffMs = this.baseBackoffMs * Math.pow(2, this.reconnectAttempts - 1);
    logger.warn(`Attempting to reconnect (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${backoffMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    await this.connect();
  }

  async executeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.circuitBreakerOpen) {
      throw new Error(
        `Circuit breaker is open after ${this.consecutiveFailures} consecutive failures. ` +
        `Please check server health or restart the MCP server to reset.`
      );
    }

    let timeoutId: NodeJS.Timeout | null = null;

    try {
      if (!this.connected) {
        await this.connect();
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`TIMEOUT: Command timed out after ${this.commandTimeoutMs}ms`));
        }, this.commandTimeoutMs);
      });

      const result = await Promise.race([
        this.ssh.execCommand(command),
        timeoutPromise,
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      this.consecutiveFailures = 0;
      this.circuitBreakerOpen = false;

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code ?? 0,
      };
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      this.consecutiveFailures++;

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.circuitBreakerOpen = true;
        logger.error(
          `Circuit breaker opened after ${this.consecutiveFailures} consecutive failures. ` +
          `Future commands will fail immediately until the MCP server is restarted.`
        );
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes("TIMEOUT:");
      const isConnection = errorMessage.toLowerCase().includes("connection");

      if (isTimeout) {
        throw new Error(
          `Command timed out after ${this.commandTimeoutMs}ms. ` +
          `The command may be hung or taking too long. ` +
          `Consider increasing COMMAND_TIMEOUT_MS if this is a long-running operation.`
        );
      }

      if (isConnection) {
        this.connected = false;
        throw new Error(
          `SSH connection lost: ${errorMessage}. ` +
          `The MCP server will attempt to reconnect on the next command. ` +
          `If this persists, check your network connection and SSH credentials.`
        );
      }

      throw new Error(`Failed to execute command: ${errorMessage}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.ssh.dispose();
      this.connected = false;
      logger.info("Disconnected from SSH server");
    }
  }
}
