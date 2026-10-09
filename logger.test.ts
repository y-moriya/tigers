import {
  assertEquals,
  assertExists,
  assertMatch,
} from "jsr:@std/assert";
import { Logger, type LogEvent } from "./logger.ts";

Deno.test("Logger - Token not set: falls back to console output safely", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

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

  try {
    const testLogger = new Logger("tigers-test", {
      token: undefined,
      flushIntervalMs: 0,
    });

    testLogger.info("info test message", { key: "value1" });
    testLogger.warn("warn test message", { key: "value2" });
    testLogger.error("error test message", new Error("test failure"), { key: "value3" });

    await testLogger.flush();

    // Verify console was called
    assertEquals(consoleCalls.length, 3);
    assertEquals(consoleCalls[0].level, "info");
    assertMatch(String(consoleCalls[0].args[0]), /info test message/);
    assertEquals(consoleCalls[0].args[1], { key: "value1" });

    assertEquals(consoleCalls[1].level, "warn");
    assertMatch(String(consoleCalls[1].args[0]), /warn test message/);
    assertEquals(consoleCalls[1].args[1], { key: "value2" });

    assertEquals(consoleCalls[2].level, "error");
    assertMatch(String(consoleCalls[2].args[0]), /error test message/);
    assertEquals((consoleCalls[2].args[1] as Error).message, "test failure");
    assertEquals(consoleCalls[2].args[2], { key: "value3" });

    // Verify fetch was never called
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
});

Deno.test("Logger - Token set: sends structured logs to Axiom ingest API", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  // Suppress console output during test
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};

  const captured: { url?: string; options?: RequestInit } = {};

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    captured.url = input.toString();
    captured.options = init;
    return Promise.resolve(new Response(JSON.stringify({ ingested: 3 }), { status: 200 }));
  };

  try {
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

    // Verify URL & headers
    assertEquals(captured.url, "https://api.axiom.co/v1/datasets/personal-apps/ingest");
    const options = captured.options;
    assertEquals(options?.method, "POST");

    const headers = options?.headers as Record<string, string>;
    assertEquals(headers?.["Authorization"], "Bearer xapt-test-token-12345");
    assertEquals(headers?.["Content-Type"], "application/json");

    // Verify payload
    const bodyEvents = JSON.parse(options?.body as string) as LogEvent[];
    assertEquals(bodyEvents.length, 3);

    // Event 1: info
    assertEquals(bodyEvents[0].app, "tigers");
    assertEquals(bodyEvents[0].level, "info");
    assertEquals(bodyEvents[0].message, "Application started");
    assertEquals(bodyEvents[0].data, { version: "1.0.0" });
    assertExists(bodyEvents[0]._time);
    assertExists(bodyEvents[0].timestamp);

    // Event 2: warn
    assertEquals(bodyEvents[1].app, "tigers");
    assertEquals(bodyEvents[1].level, "warn");
    assertEquals(bodyEvents[1].message, "Low memory warning");
    assertEquals(bodyEvents[1].data, { freeMem: 1024 });

    // Event 3: error
    assertEquals(bodyEvents[2].app, "tigers");
    assertEquals(bodyEvents[2].level, "error");
    assertEquals(bodyEvents[2].message, "Task execution failed");
    assertEquals(bodyEvents[2].data, { taskId: "task-99" });
    const errObj = bodyEvents[2].error as Record<string, unknown>;
    assertExists(errObj);
    assertEquals(errObj.name, "Error");
    assertEquals(errObj.message, "Something went wrong");
    assertExists(errObj.stack);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
});

Deno.test("Logger - Environment variables resolution and fallback", async () => {
  const originalFetch = globalThis.fetch;

  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  const hasEnvPermission = (await Deno.permissions.query({ name: "env" })).state === "granted";

  if (hasEnvPermission) {
    const originalToken = Deno.env.get("AXIOM_TOKEN");
    const originalDataset = Deno.env.get("AXIOM_DATASET");

    try {
      // 1. When AXIOM_TOKEN is empty string, do not send to Axiom
      Deno.env.set("AXIOM_TOKEN", "");
      Deno.env.set("AXIOM_DATASET", "personal-apps");

      const envLogger1 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger1.info("This should not be fetched");
      await envLogger1.flush();
      assertEquals(capturedUrl, "");

      // 2. When AXIOM_TOKEN is set and AXIOM_DATASET is not set, defaults to personal-apps
      Deno.env.set("AXIOM_TOKEN", "my-env-token");
      Deno.env.delete("AXIOM_DATASET");

      const envLogger2 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger2.info("Testing default dataset");
      await envLogger2.flush();
      assertEquals(capturedUrl, "https://api.axiom.co/v1/datasets/personal-apps/ingest");
      assertEquals(capturedHeaders["Authorization"], "Bearer my-env-token");

      // 3. When custom AXIOM_DATASET is set
      Deno.env.set("AXIOM_DATASET", "custom-dataset");
      const envLogger3 = new Logger("tigers", { flushIntervalMs: 0 });
      envLogger3.info("Testing custom dataset");
      await envLogger3.flush();
      assertEquals(capturedUrl, "https://api.axiom.co/v1/datasets/custom-dataset/ingest");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken !== undefined) {
        Deno.env.set("AXIOM_TOKEN", originalToken);
      } else {
        Deno.env.delete("AXIOM_TOKEN");
      }
      if (originalDataset !== undefined) {
        Deno.env.set("AXIOM_DATASET", originalDataset);
      } else {
        Deno.env.delete("AXIOM_DATASET");
      }
    }
  } else {
    // When run without env permissions, verify default options and safe fallback
    try {
      // Empty token option
      const optLogger1 = new Logger("tigers", { token: "", dataset: "personal-apps", flushIntervalMs: 0 });
      optLogger1.info("This should not be fetched");
      await optLogger1.flush();
      assertEquals(capturedUrl, "");

      // Valid token and custom dataset
      const optLogger2 = new Logger("tigers", { token: "my-token", dataset: "custom-dataset", flushIntervalMs: 0 });
      optLogger2.info("Testing custom dataset option");
      await optLogger2.flush();
      assertEquals(capturedUrl, "https://api.axiom.co/v1/datasets/custom-dataset/ingest");
      assertEquals(capturedHeaders["Authorization"], "Bearer my-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

Deno.test("Logger - Safe handling on Axiom fetch error", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  let consoleErrorCalled = false;
  console.error = () => {
    consoleErrorCalled = true;
  };

  globalThis.fetch = () => {
    return Promise.reject(new Error("Network connection lost"));
  };

  try {
    const errorLogger = new Logger("tigers", {
      token: "valid-token",
      flushIntervalMs: 0,
    });
    errorLogger.info("Failing log message");

    // flush() should not throw
    await errorLogger.flush();
    assertEquals(consoleErrorCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

Deno.test("Logger - Batch queue flushes multiple events in one payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  console.info = () => {};

  let batchBody: LogEvent[] = [];
  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    batchBody = JSON.parse(init?.body as string) as LogEvent[];
    return Promise.resolve(new Response(JSON.stringify({ ingested: batchBody.length }), { status: 200 }));
  };

  try {
    const batchLogger = new Logger("tigers", {
      token: "test-token",
      dataset: "personal-apps",
      flushIntervalMs: 0,
    });

    for (let i = 0; i < 5; i++) {
      batchLogger.info(`Log event ${i}`, { index: i });
    }

    await batchLogger.flush();

    assertEquals(batchBody.length, 5);
    for (let i = 0; i < 5; i++) {
      assertEquals(batchBody[i].message, `Log event ${i}`);
      assertEquals(batchBody[i].data, { index: i });
      assertEquals(batchBody[i].app, "tigers");
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
  }
});
