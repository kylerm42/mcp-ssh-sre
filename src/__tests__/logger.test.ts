import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, type LogLevel } from "../logger.js";

describe("Logger", () => {
  let consoleErrorSpy: any;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Spy on console.error to capture log output
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Save original LOG_LEVEL
    originalEnv = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    // Restore console.error
    consoleErrorSpy.mockRestore();
    // Restore original LOG_LEVEL
    if (originalEnv !== undefined) {
      process.env.LOG_LEVEL = originalEnv;
    } else {
      delete process.env.LOG_LEVEL;
    }
    // Reset logger to default level
    logger.setLevel("info");
  });

  describe("Log Level Configuration", () => {
    it("should default to info level", () => {
      expect(logger.getLevel()).toBe("info");
    });

    it("should allow setting log level programmatically", () => {
      logger.setLevel("debug");
      expect(logger.getLevel()).toBe("debug");

      logger.setLevel("error");
      expect(logger.getLevel()).toBe("error");
    });

    it("should throw error for invalid log level", () => {
      expect(() => {
        logger.setLevel("invalid" as LogLevel);
      }).toThrow("Invalid log level");
    });
  });

  describe("Log Level Filtering", () => {
    it("should output all messages at debug level", () => {
      logger.setLevel("debug");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
    });

    it("should output info, warn, error at info level", () => {
      logger.setLevel("info");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[DEBUG]")
      );
    });

    it("should output warn and error at warn level", () => {
      logger.setLevel("warn");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[DEBUG]")
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("[INFO]")
      );
    });

    it("should output only errors at error level", () => {
      logger.setLevel("error");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]")
      );
    });

    it("should output nothing at silent level", () => {
      logger.setLevel("silent");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("Log Message Formatting", () => {
    it("should not include timestamp in log messages", () => {
      logger.setLevel("info");
      logger.info("test message");

      const logCall = consoleErrorSpy.mock.calls[0][0];
      // Should not start with timestamp
      expect(logCall).not.toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    });

    it("should include log level in messages", () => {
      logger.setLevel("debug");

      logger.debug("debug message");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[DEBUG]")
      );

      logger.info("info message");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[INFO]")
      );

      logger.warn("warn message");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[WARN]")
      );

      logger.error("error message");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]")
      );
    });

    it("should include the actual message content", () => {
      logger.setLevel("info");
      logger.info("test message content");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("test message content")
      );
    });

    it("should format complete log message correctly", () => {
      logger.setLevel("info");
      logger.info("test");

      const logCall = consoleErrorSpy.mock.calls[0][0];
      // Should match: [LEVEL] message
      expect(logCall).toBe("[INFO] test");
    });
  });

  describe("Output Channel", () => {
    it("should always use console.error for output", () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.setLevel("debug");
      logger.debug("test");
      logger.info("test");
      logger.warn("test");
      logger.error("test");

      // Should use console.error, not console.log
      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });
});
