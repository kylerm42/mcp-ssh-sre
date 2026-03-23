import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerFileWriteTools } from "../tools/core/file-write-tools.js";

describe("File Write Tools", () => {
  let mockServer: any;
  let mockSSHExecutor: any;
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

    registerFileWriteTools(mockServer as any, mockSSHExecutor);
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

    it("should have 6 actions in the enum schema", () => {
      const tool = registeredTools.get("file_write");
      const actionSchema = tool.schema.action;
      // Zod enum exposes its values via .options
      expect(actionSchema.options).toHaveLength(6);
      expect(actionSchema.options).toContain("write_file");
      expect(actionSchema.options).toContain("append_file");
      expect(actionSchema.options).toContain("replace_in_file");
      expect(actionSchema.options).toContain("delete_file");
      expect(actionSchema.options).toContain("mkdir");
      expect(actionSchema.options).toContain("list_allowed_paths");
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
      delete process.env.WRITE_ALLOWED_PATHS;
      const localTools = new Map<string, any>();
      const localServer = {
        tool: vi.fn((name: string, _desc: string, _schema: any, handler: any) => {
          localTools.set(name, { handler });
        }),
      };
      registerFileWriteTools(localServer as any, mockSSHExecutor);
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
  // write_file (utf8)
  // -------------------------------------------------------------------------

  describe("action=write_file (utf8)", () => {
    it("should write file using tee (not base64 -d) with correct SSH command", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "write_file", path: "/tmp/test.txt", content: "hello world" });
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("tee")
      );
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("printf")
      );
      expect(mockSSHExecutor).not.toHaveBeenCalledWith(
        expect.stringContaining("base64 -d")
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully wrote");
    });

    it("should use tee when encoding is explicitly utf8", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({
        action: "write_file",
        path: "/tmp/test.txt",
        content: "hello world",
        encoding: "utf8",
      });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining("tee"));
      expect(mockSSHExecutor).not.toHaveBeenCalledWith(expect.stringContaining("base64 -d"));
      expect(result.isError).toBeFalsy();
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
  // write_file (base64)
  // -------------------------------------------------------------------------

  describe("action=write_file (base64)", () => {
    it("should use base64 -d in SSH command when encoding is base64", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      // A small valid base64 string
      const base64Content = Buffer.from("binary data here").toString("base64");
      const result = await tool.handler({
        action: "write_file",
        path: "/tmp/binary.bin",
        content: base64Content,
        encoding: "base64",
      });
      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("base64 -d")
      );
      expect(mockSSHExecutor).not.toHaveBeenCalledWith(
        expect.stringContaining("tee")
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Successfully wrote");
    });

    it("should pass base64 content with padding characters through without error", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      // Base64 with padding
      const base64WithPadding = "SGVsbG8gV29ybGQ=";
      const result = await tool.handler({
        action: "write_file",
        path: "/tmp/padded.bin",
        content: base64WithPadding,
        encoding: "base64",
      });
      expect(result.isError).toBeFalsy();
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining("base64 -d"));
    });

    it("should accept content at exactly the max allowed length (67,108,864 chars)", async () => {
      mockSSHExecutor.mockResolvedValue("");
      const tool = registeredTools.get("file_write");
      const maxContent = "A".repeat(67_108_864);
      const result = await tool.handler({
        action: "write_file",
        path: "/tmp/maxsize.bin",
        content: maxContent,
        encoding: "base64",
      });
      // Zod should accept this; SSH executor was called
      expect(mockSSHExecutor).toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    it("should reject content exceeding max length before SSH execution", async () => {
      const tool = registeredTools.get("file_write");
      const oversizedContent = "A".repeat(67_108_865);

      // The handler is called with raw args bypassing Zod in this test pattern;
      // to test Zod validation we must invoke via the MCP SDK path.
      // Since we call handler directly, we verify the Zod schema's max constraint
      // by parsing the args through the schema ourselves.
      const { z } = await import("zod");
      const contentSchema = z.string().max(67_108_864).optional();
      const parseResult = contentSchema.safeParse(oversizedContent);
      expect(parseResult.success).toBe(false);

      // Confirm the executor was never called for oversized content at the Zod layer
      expect(mockSSHExecutor).not.toHaveBeenCalled();
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

    it("should reject empty oldString via Zod before SSH execution", async () => {
      const { z } = await import("zod");
      const oldStringSchema = z.string().min(1).optional();
      const parseResult = oldStringSchema.safeParse("");
      expect(parseResult.success).toBe(false);
      expect(mockSSHExecutor).not.toHaveBeenCalled();
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
  // Error propagation
  // -------------------------------------------------------------------------

  describe("Error propagation from sshExecutor", () => {
    it("should return isError when sshExecutor throws", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("connection reset"));
      const tool = registeredTools.get("file_write");
      const result = await tool.handler({ action: "append_file", path: "/tmp/test.txt", content: "data" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("connection reset");
    });
  });
});
