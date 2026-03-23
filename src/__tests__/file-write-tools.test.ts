import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerFileWriteTools } from "../tools/core/file-write-tools.js";

// Mock fs/promises so unlink doesn't hit the real filesystem
vi.mock("fs", () => ({
  promises: {
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("File Write Tools", () => {
  let mockServer: any;
  let mockSSHExecutor: any;
  let mockSshManager: any;
  let registeredTools: Map<string, any>;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.WRITE_ALLOWED_PATHS;
    process.env.WRITE_ALLOWED_PATHS = "/mnt/user/appdata:/tmp";

    registeredTools = new Map();
    mockServer = {
      tool: vi.fn((name: string, description: string, schema: any, handler: any) => {
        registeredTools.set(name, { name, description, schema, handler });
      }),
    };
    mockSSHExecutor = vi.fn();
    mockSshManager = {
      putFile: vi.fn(),
    };

    registerFileWriteTools(mockServer as any, mockSSHExecutor, mockSshManager as any);
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.WRITE_ALLOWED_PATHS;
    } else {
      process.env.WRITE_ALLOWED_PATHS = savedEnv;
    }
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  describe("Tool Registration", () => {
    it("should register exactly 1 tool named file_write", () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has("file_write")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // list_allowed_paths
  // -------------------------------------------------------------------------

  describe("action=list_allowed_paths", () => {
    it("should return configured paths when WRITE_ALLOWED_PATHS is set", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "list_allowed_paths" });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("/mnt/user/appdata");
      expect(result.content[0].text).toContain("/tmp");
    });

    it("should return no-config message when WRITE_ALLOWED_PATHS is unset", async () => {
      // Re-register with empty env var
      delete process.env.WRITE_ALLOWED_PATHS;
      const localTools = new Map<string, any>();
      const localServer = {
        tool: vi.fn((name: string, _desc: string, _schema: any, handler: any) => {
          localTools.set(name, { handler });
        }),
      };
      registerFileWriteTools(localServer as any, mockSSHExecutor, mockSshManager as any);
      const tool = localTools.get("file_write");
      const result = await tool.handler({ action: "list_allowed_paths" });
      expect(result.content[0].text).toContain("No write paths configured");
    });
  });

  // -------------------------------------------------------------------------
  // Allowlist rejection for each mutating action
  // -------------------------------------------------------------------------

  describe("Allowlist rejection", () => {
    const disallowedPath = "/etc/passwd";

    it("write_file — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "write_file", path: disallowedPath, content: "data" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });

    it("append_file — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "append_file", path: disallowedPath, content: "data" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });

    it("replace_in_file — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "replace_in_file",
        path: disallowedPath,
        oldString: "old",
        newString: "new",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });

    it("delete_file — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "delete_file", path: disallowedPath });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });

    it("mkdir — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "mkdir", path: disallowedPath });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });

    it("upload_file — rejects path outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "upload_file", path: disallowedPath, stageId: "/tmp/stage-abc" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });
  });

  // -------------------------------------------------------------------------
  // Path traversal
  // -------------------------------------------------------------------------

  describe("Path traversal", () => {
    it("rejects traversal path that normalizes outside allowlist", async () => {
      const tool = registeredTools.get("file_write");
      const traversalPath = "/mnt/user/appdata/../../etc/passwd";
      const result = await tool.handler({ action: "write_file", path: traversalPath, content: "evil" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not under an allowed write prefix");
    });
  });

  // -------------------------------------------------------------------------
  // write_file
  // -------------------------------------------------------------------------

  describe("action=write_file", () => {
    it("should write file with correct SSH command", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "write_file", path: "/tmp/test.txt", content: "hello world" });
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("tee")
      );
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("printf")
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully wrote");
    });

    it("should propagate sshExecutor errors as isError", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("SSH failed"));
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "write_file", path: "/tmp/test.txt", content: "data" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SSH failed");
    });
  });

  // -------------------------------------------------------------------------
  // append_file
  // -------------------------------------------------------------------------

  describe("action=append_file", () => {
    it("should append with correct SSH command", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "append_file", path: "/tmp/test.txt", content: "appended" });
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringMatching(/printf.*>>/)
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully appended");
    });
  });

  // -------------------------------------------------------------------------
  // replace_in_file
  // -------------------------------------------------------------------------

  describe("action=replace_in_file", () => {
    it("should read file, replace string, and write back", async () => {
      mockSSHExecutor
        .mockResolvedValueOnce("hello old world") // cat
        .mockResolvedValueOnce(""); // tee write-back
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "replace_in_file",
        path: "/tmp/config.txt",
        oldString: "old",
        newString: "new",
      });
      expect(mockSSHExecutor).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully replaced");
    });

    it("should return error when oldString not found in file", async () => {
      mockSSHExecutor.mockResolvedValueOnce("no match here");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "replace_in_file",
        path: "/tmp/config.txt",
        oldString: "missing",
        newString: "replacement",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("oldString not found");
    });
  });

  // -------------------------------------------------------------------------
  // delete_file
  // -------------------------------------------------------------------------

  describe("action=delete_file", () => {
    it("should delete file with correct SSH command", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "delete_file", path: "/tmp/old.txt" });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining("rm"));
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully deleted");
    });
  });

  // -------------------------------------------------------------------------
  // mkdir
  // -------------------------------------------------------------------------

  describe("action=mkdir", () => {
    it("should create directory with correct SSH command", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "mkdir", path: "/tmp/newdir" });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining("mkdir -p"));
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully created directory");
    });
  });

  // -------------------------------------------------------------------------
  // upload_file
  // -------------------------------------------------------------------------

  describe("action=upload_file", () => {
    it("should call sshManager.putFile with correct args and attempt cleanup on success", async () => {
      const { promises: fsMock } = await import("fs");
      mockSshManager.putFile.mockResolvedValue(undefined);

      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "upload_file",
        path: "/tmp/uploaded.bin",
        stageId: "/tmp/stage-abc123",
      });

      expect(mockSshManager.putFile).toHaveBeenCalledWith("/tmp/stage-abc123", "/tmp/uploaded.bin");
      expect(fsMock.unlink).toHaveBeenCalledWith("/tmp/stage-abc123");
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully uploaded");
    });

    it("should attempt cleanup even when putFile throws", async () => {
      const { promises: fsMock } = await import("fs");
      mockSshManager.putFile.mockRejectedValue(new Error("SFTP transfer failed"));

      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "upload_file",
        path: "/tmp/uploaded.bin",
        stageId: "/tmp/stage-abc123",
      });

      expect(fsMock.unlink).toHaveBeenCalledWith("/tmp/stage-abc123");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SFTP transfer failed");
    });
  });
});
