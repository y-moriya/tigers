export interface LogEvent {
  _time: string;
  timestamp: string;
  app: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
  error?: Record<string, unknown> | string;
}

export interface LoggerOptions {
  dataset?: string;
  token?: string;
  url?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

function serializeError(err: unknown): Record<string, unknown> | string | undefined {
  if (err === undefined || err === null) {
    return undefined;
  }
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    for (const key of Object.getOwnPropertyNames(err)) {
      if (!(key in serialized)) {
        serialized[key] = (err as unknown as Record<string, unknown>)[key];
      }
    }
    return serialized;
  }
  if (typeof err === "object") {
    try {
      JSON.stringify(err);
      return err as Record<string, unknown>;
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export class Logger {
  readonly appName: string;
  private queue: LogEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private options: LoggerOptions;
  private batchSize: number;
  private flushIntervalMs: number;

  constructor(appName: string, options: LoggerOptions = {}) {
    this.appName = appName;
    this.options = options;
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
  }

  private safeGetEnv(key: string): string | undefined {
    try {
      return Deno.env.get(key);
    } catch {
      return undefined;
    }
  }

  private getToken(): string | undefined {
    const token = this.options.token ?? this.safeGetEnv("AXIOM_TOKEN");
    if (!token || token.trim() === "") {
      return undefined;
    }
    return token.trim();
  }

  private getDataset(): string {
    const dataset = this.options.dataset ?? this.safeGetEnv("AXIOM_DATASET");
    if (!dataset || dataset.trim() === "") {
      return "personal-apps";
    }
    return dataset.trim();
  }

  private outputConsole(
    level: "info" | "warn" | "error",
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
  ): void {
    const prefix = `[${this.appName}] [${level.toUpperCase()}] ${message}`;
    if (level === "error") {
      if (error !== undefined && data !== undefined) {
        console.error(prefix, error, data);
      } else if (error !== undefined) {
        console.error(prefix, error);
      } else if (data !== undefined) {
        console.error(prefix, data);
      } else {
        console.error(prefix);
      }
    } else if (level === "warn") {
      if (data !== undefined) {
        console.warn(prefix, data);
      } else {
        console.warn(prefix);
      }
    } else {
      if (data !== undefined) {
        console.info(prefix, data);
      } else {
        console.info(prefix);
      }
    }
  }

  private enqueue(
    level: "info" | "warn" | "error",
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
  ): void {
    const token = this.getToken();
    if (!token) {
      return;
    }

    const now = new Date().toISOString();
    const event: LogEvent = {
      _time: now,
      timestamp: now,
      app: this.appName,
      level,
      message,
    };

    if (data !== undefined) {
      event.data = data;
    }

    const serializedErr = serializeError(error);
    if (serializedErr !== undefined) {
      event.error = serializedErr;
    }

    this.queue.push(event);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch(() => {});
    } else if (this.flushTimer === null && this.flushIntervalMs > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch(() => {});
      }, this.flushIntervalMs);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.outputConsole("info", message, undefined, data);
    this.enqueue("info", message, undefined, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.outputConsole("warn", message, undefined, data);
    this.enqueue("warn", message, undefined, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.outputConsole("error", message, error, data);
    this.enqueue("error", message, error, data);
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const token = this.getToken();
    if (!token) {
      this.queue = [];
      return;
    }

    const eventsToSend = [...this.queue];
    this.queue = [];

    try {
      const dataset = this.getDataset();
      const url = this.options.url ?? `https://api.axiom.co/v1/datasets/${dataset}/ingest`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventsToSend),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        console.error(
          `[${this.appName}] Failed to send logs to Axiom: HTTP ${res.status} ${res.statusText}`,
          errorBody,
        );
      }
    } catch (err) {
      console.error(`[${this.appName}] Error sending logs to Axiom:`, err);
    }
  }
}

export const logger = new Logger("tigers");
