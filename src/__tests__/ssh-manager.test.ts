import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from 'ssh2';

// Mock ssh2
vi.mock('ssh2');

// Mock dotenv
vi.mock('dotenv/config', () => ({}));

// Mock fs (used by SSH2Adapter when reading private key files)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock-private-key')),
}));

describe('SSHConnectionManager', () => {
  let mockClient: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set up test environment variables — explicitly clear SSH_PASSWORD so
    // real .env values don't bleed in when testing key-based auth paths.
    process.env.SSH_HOST = 'test-host';
    process.env.SSH_PORT = '22';
    process.env.SSH_USERNAME = 'test-user';
    process.env.SSH_PRIVATE_KEY_PATH = '/path/to/key';
    delete process.env.SSH_PASSWORD;

    // Create mock Client instance with ssh2's callback-based interface
    mockClient = {
      connect: vi.fn(),
      exec: vi.fn(),
      sftp: vi.fn(),
      end: vi.fn(),
      once: vi.fn(),
      on: vi.fn(),
    };

    // Default: connect triggers 'ready' immediately
    mockClient.once.mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'ready') {
        setImmediate(() => listener());
      }
      return mockClient;
    });

    // Default: exec resolves with stdout='test output', stderr='', code=0
    mockClient.exec.mockImplementation(
      (_cmd: string, callback: (err: Error | undefined, stream: any) => void) => {
        const stream = {
          stdout: {
            on: vi.fn().mockImplementation((event: string, listener: (chunk: Buffer) => void) => {
              if (event === 'data') {
                setImmediate(() => listener(Buffer.from('test output')));
              }
            }),
          },
          stderr: {
            on: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, listener: (code: number | null) => void) => {
            if (event === 'close') {
              setImmediate(() => listener(0));
            }
          }),
        };
        callback(undefined, stream);
      }
    );

    // Mock Client constructor
    vi.mocked(Client).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should throw error if SSH_HOST is missing', async () => {
      delete process.env.SSH_HOST;

      // Dynamically import to trigger constructor with new env
      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('SSH_HOST environment variable is required');
    });

    it('should throw error if SSH_USERNAME is missing', async () => {
      delete process.env.SSH_USERNAME;

      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('SSH_USERNAME environment variable is required');
    });

    it('should throw error if neither SSH_PRIVATE_KEY_PATH nor SSH_PASSWORD is provided', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      delete process.env.SSH_PASSWORD;

      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('Either SSH_PRIVATE_KEY_PATH or SSH_PASSWORD environment variable is required');
    });

    it('should accept SSH_PASSWORD instead of SSH_PRIVATE_KEY_PATH', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      process.env.SSH_PASSWORD = 'test-password';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      expect(() => new SSHConnectionManager()).not.toThrow();
    });
  });

  describe('connect', () => {
    it('should connect successfully with private key', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'test-host',
          port: 22,
          username: 'test-user',
          privateKey: expect.any(Buffer),
        })
      );
      expect(manager.isConnected()).toBe(true);
    });

    it('should connect successfully with password', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      process.env.SSH_PASSWORD = 'test-password';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'test-host',
          port: 22,
          username: 'test-user',
          password: 'test-password',
        })
      );
    });

    it('should handle connection failure', async () => {
      mockClient.once.mockImplementation((event: string, listener: (err: Error) => void) => {
        if (event === 'error') {
          setImmediate(() => listener(new Error('Connection failed')));
        }
        return mockClient;
      });

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await expect(manager.connect()).rejects.toThrow('Failed to connect to SSH server: Connection failed');
      expect(manager.isConnected()).toBe(false);
    });

    it('should use custom port if provided', async () => {
      process.env.SSH_PORT = '2222';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ port: 2222 })
      );
    });
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('ls -la');

      expect(mockClient.exec).toHaveBeenCalledWith('ls -la', expect.any(Function));
      expect(result).toEqual({
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      });
    });

    it('should handle command with stderr', async () => {
      mockClient.exec.mockImplementationOnce(
        (_cmd: string, callback: (err: Error | undefined, stream: any) => void) => {
          const stream = {
            stdout: {
              on: vi.fn(),
            },
            stderr: {
              on: vi.fn().mockImplementation((event: string, listener: (chunk: Buffer) => void) => {
                if (event === 'data') {
                  setImmediate(() => listener(Buffer.from('error message')));
                }
              }),
            },
            on: vi.fn().mockImplementation((event: string, listener: (code: number | null) => void) => {
              if (event === 'close') {
                setImmediate(() => listener(1));
              }
            }),
          };
          callback(undefined, stream);
        }
      );

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('failing-command');

      expect(result).toEqual({
        stdout: '',
        stderr: 'error message',
        exitCode: 1,
      });
    });

    it('should auto-connect if not connected', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      const result = await manager.executeCommand('ls');

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.exec).toHaveBeenCalledWith('ls', expect.any(Function));
      expect(result.stdout).toBe('test output');
    });

    it('should handle null exit code', async () => {
      mockClient.exec.mockImplementationOnce(
        (_cmd: string, callback: (err: Error | undefined, stream: any) => void) => {
          const stream = {
            stdout: {
              on: vi.fn().mockImplementation((event: string, listener: (chunk: Buffer) => void) => {
                if (event === 'data') {
                  setImmediate(() => listener(Buffer.from('output')));
                }
              }),
            },
            stderr: {
              on: vi.fn(),
            },
            on: vi.fn().mockImplementation((event: string, listener: (code: number | null) => void) => {
              if (event === 'close') {
                setImmediate(() => listener(null));
              }
            }),
          };
          callback(undefined, stream);
        }
      );

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('test');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      await manager.disconnect();

      expect(mockClient.end).toHaveBeenCalled();
      expect(manager.isConnected()).toBe(false);
    });

    it('should not error if already disconnected', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await expect(manager.disconnect()).resolves.not.toThrow();
      expect(mockClient.end).not.toHaveBeenCalled();
    });
  });
});
