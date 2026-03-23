declare module 'ssh2' {
  interface ConnectConfig {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: Buffer | string;
  }

  interface ExecOptions {
    env?: Record<string, string>;
  }

  interface ClientChannel {
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    on(event: 'close', listener: (code: number | null, signal: string | null) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  interface SFTPWrapper {
    fastPut(localPath: string, remotePath: string, callback: (err: Error | undefined) => void): void;
  }

  class Client {
    connect(config: ConnectConfig): void;
    exec(command: string, callback: (err: Error | undefined, channel: ClientChannel) => void): void;
    exec(command: string, options: ExecOptions, callback: (err: Error | undefined, channel: ClientChannel) => void): void;
    sftp(callback: (err: Error | undefined, sftp: SFTPWrapper) => void): void;
    end(): void;
    on(event: 'ready', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: 'ready', listener: () => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
  }
}
