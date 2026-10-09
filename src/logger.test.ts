import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Logger, type LogEvent } from "./logger.js";

describe("Logger", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  it("Token not set: falls back to console output safely", async () => {
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const consoleCalls: { level: string; args: unknown[] }[] = [];
    console.info = (...args: unknown[]) => {
      consoleCalls.push({ level: "info", args });
    };
    console.warn = (...args: unknown[]) => {
      consoleCalls.push({ level: "warn", args });
    };
    console.error = (...args: unknown[]) => {
      consoleCalls.push({ level: "error", args });
    };

    const testLogger = new Logger("tigers-test", {
      token: undefined,
      flushIntervalMs: 0,
    });

    testLogger.info("info test message", { key: "value1" });
    testLogger.warn("warn test message", { key: "value2" });
    testLogger.error("error test message", new Error("test failure"), { key: "value3" });

    await testLogger.flush();

    expect(consoleCalls.length).toBe(3);
    expect(consoleCalls[0].level).toBe("info");
    expect(String(consoleCalls[0].args[0])).toMatch(/info test message/);
    expect(consoleCalls[0].args[1]).toEqual({ key: "value1" });

    expect(consoleCalls[1].level).toBe("warn");
    expect(String(consoleCalls[1].args[0])).toMatch(/warn test message/);
    expect(consoleCalls[1].args[1]).toEqual({ key: "value2" });

    expect(consoleCalls[2].level).toBe("error");
    expect(String(consoleCalls[2].args[0])).toMatch(/error test message/);
    expect((consoleCalls[2].args[1] as Error).message).toBe("test failure");
    expect(consoleCalls[2].args[2]).toEqual({ key: "value3" });

    expect(fetchCalled).toBe(false);
  });

  it("Token set: sends structured logs to Axiom ingest API", async () => {
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};

    const captured: { url?: string; options?: RequestInit } = {};

    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      captured.url = input.toString();
      captured.options = init;
      return Promise.resolve(new Response(JSON.stringify({ ingested: 3 }), { status: 200 }));
    };

    const testLogger = new Logger("tigers", {
      token: "xapt-test-token-12345",
      dataset: "personal-apps",
      flushIntervalMs: 0,
    });

    testLogger.info("Application started", { version: "1.0.0" });
    testLogger.warn("Low memory warning", { freeMem: 1024 });
    const sampleError = new Error("Something went wrong");
    testLogger.error("Task execution failed", sampleError, { taskId: "task-99" });

    await testLogger.flush();

    expect(captured.url).toBe("https://api.axiom.co/v1/datasets/personal-apps/ingest");
    const options = captured.options;
    expect(options?.method).toBe("POST");

    const headers = options?.headers as Record<string, string>;
    expect(headers?.["Authorization"]).toBe("Bearer xapt-test-token-12345");
    expect(headers?.["Content-Type"]).toBe("application/json");

    const bodyEvents = JSON.parse(options?.body as string) as LogEvent[];
    expect(bodyEvents.length).toBe(3);

    expect(bodyEvents[0].app).toBe("tigers");
    expect(bodyEvents[0].level).toBe("info");
    expect(bodyEvents[0].message).toBe("Application started");
    expect(bodyEvents[0].data).toEqual({ version: "1.0.0" });
    expect(bodyEvents[0]._time).toBeDefined();
    expect(bodyEvents[0].timestamp).toBeDefined();

    expect(bodyEvents[1].app).toBe("tigers");
    expect(bodyEvents[1].level).toBe("warn");
    expect(bodyEvents[1].message).toBe("Low memory warning");
    expect(bodyEvents[1].data).toEqual({ freeMem: 1024 });

    expect(bodyEvents[2].app).toBe("tigers");
    expect(bodyEvents[2].level).toBe("error");
    expect(bodyEvents[2].message).toBe("Task execution failed");
    expect(bodyEvents[2].data).toEqual({ taskId: "task-99" });
    const errObj = bodyEvents[2].error as Record<string, unknown>;
    expect(errObj).toBeDefined();
    expect(errObj.name).toBe("Error");
    expect(errObj.message).toBe("Something went wrong");
    expect(errObj.stack).toBeDefined();
  });

  it("Environment variables resolution and fallback", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const originalToken = process.env.AXIOM_TOKEN;
    const originalDataset = process.env.AXIOM_DATASET;

    try {
      process.env.AXIOM_TOKEN = "";
      process.env.AXIOM_DATASET = "personal-apps";

      const envLogger1 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger1.info("This should not be fetched");
      await envLogger1.flush();
      expect(capturedUrl).toBe("");

      process.env.AXIOM_TOKEN = "my-env-token";
      delete process.env.AXIOM_DATASET;

      const envLogger2 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger2.info("Testing default dataset");
      await envLogger2.flush();
      expect(capturedUrl).toBe("https://api.axiom.co/v1/datasets/personal-apps/ingest");
      expect(capturedHeaders["Authorization"]).toBe("Bearer my-env-token");

      process.env.AXIOM_DATASET = "custom-dataset";
      const envLogger3 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger3.info("Testing custom dataset");
      await envLogger3.flush();
      expect(capturedUrl).toBe("https://api.axiom.co/v1/datasets/custom-dataset/ingest");
    } finally {
      if (originalToken !== undefined) {
        process.env.AXIOM_TOKEN = originalToken;
      } else {
        delete process.env.AXIOM_TOKEN;
      }
      if (originalDataset !== undefined) {
        process.env.AXIOM_DATASET = originalDataset;
      } else {
        delete process.env.AXIOM_DATASET;
      }
    }
  });

  it("Safe handling on Axiom fetch error", async () => {
    let consoleErrorCalled = false;
    console.error = () => {
      consoleErrorCalled = true;
    };

    globalThis.fetch = () => {
      return Promise.reject(new Error("Network connection lost"));
    };

    const errorLogger = new Logger("tigers", {
      token: "valid-token",
      flushIntervalMs: 0,
    });
    errorLogger.info("Failing log message");

    await errorLogger.flush();
    expect(consoleErrorCalled).toBe(true);
  });

  it("Batch queue flushes multiple events in one payload", async () => {
    console.info = () => {};

    let batchBody: LogEvent[] = [];
    globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
      batchBody = JSON.parse(init?.body as string) as LogEvent[];
      return Promise.resolve(new Response(JSON.stringify({ ingested: batchBody.length }), { status: 200 }));
    };

    const batchLogger = new Logger("tigers", {
      token: "test-token",
      dataset: "personal-apps",
      flushIntervalMs: 0,
    });

    for (let i = 0; i < 5; i++) {
      batchLogger.info(`Log event ${i}`, { index: i });
    }

    await batchLogger.flush();

    expect(batchBody.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(batchBody[i].message).toBe(`Log event ${i}`);
      expect(batchBody[i].data).toEqual({ index: i });
      expect(batchBody[i].app).toBe("tigers");
    }
  });
});
