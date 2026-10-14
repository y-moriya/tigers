import { DOMParser } from "linkedom";
import {
  TodoistApi,
  TodoistRequestError,
} from "@doist/todoist-api-typescript";
import { logger } from "./logger.js";

const TIGERS1_LIVE_LIST_URL = "https://hanshintigers.jp/news/media/live.html";
const TIGERS2_LIVE_LIST_URL = "https://hanshintigers.jp/news/media/farmlive.html";
const TIGERS_LIVE_LIST_SELECTOR = "div.media-list.clearfix";
const DESCRIPTION_URL_PREFIX = "https:";

export interface LiveInfo {
  date: string;
  broadcastType: string;
  broadcaster: string;
  label: string;
  timetable: string;
  descriptionUrl: string;
  descriptionDetail: string;
  isFarm: boolean;
}

export interface Env {
  TODOIST_API_TOKEN?: string;
  TODOIST_TIGERS_PROJECT_ID?: string;
  RUN_MAIN_PROCESS?: string;
  TORA_TV?: string;
  AXIOM_DATASET?: string;
  AXIOM_TOKEN?: string;
}

export async function getEachLiveInfo(
  isFarm: boolean,
  liveElement: any,
  fetchDetail = false,
): Promise<LiveInfo[]> {
  const date = liveElement.querySelector("div.air-date")?.textContent.trim()
    .replace(/\s+/g, " ");
  const result: LiveInfo[] = [];

  const trs = liveElement.querySelectorAll("table.basic-table > tbody > tr");
  for (const tr of trs) {
    const trElement = tr;

    const broadcastType = trElement?.querySelector("td:nth-child(1)")
      ?.textContent ?? "";

    const broadcaster = trElement?.querySelector("td:nth-child(2)")
      ?.textContent ?? "";

    const label = trElement?.querySelector("td.timetable > img")
      ?.getAttribute("alt") ?? "";

    const timetable = trElement?.querySelector("td.timetable")?.textContent ?? "";

    const href = trElement?.querySelector("td:nth-child(4) > a")?.getAttribute("href");
    if (!href) continue;
    const descriptionUrl = DESCRIPTION_URL_PREFIX + href;

    let descriptionDetail = "";
    if (fetchDetail) {
      try {
        const descriptionRes = await fetch(descriptionUrl);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const descriptionHtml = await descriptionRes.text();

        const descriptionDoc = new DOMParser().parseFromString(
          descriptionHtml,
          "text/html",
        );
        const detailNote = descriptionDoc?.querySelector("p.media-detail-note");
        const rawDetail = detailNote?.textContent ?? detailNote?.innerText ?? "";
        descriptionDetail = rawDetail.replaceAll("\n", " ");
      } catch (err) {
        logger.warn("Failed to fetch description detail", {
          descriptionUrl,
          error: String(err),
        });
      }
    }

    const liveInfo: LiveInfo = {
      date: date ?? "",
      broadcastType,
      broadcaster,
      label,
      timetable,
      descriptionUrl,
      descriptionDetail,
      isFarm,
    };

    logger.info("Fetched live info", {
      date: liveInfo.date,
      broadcastType: liveInfo.broadcastType,
      broadcaster: liveInfo.broadcaster,
      label: liveInfo.label,
      timetable: liveInfo.timetable,
      descriptionUrl: liveInfo.descriptionUrl,
      isFarm: liveInfo.isFarm,
    });

    result.push(liveInfo);
  }

  return result;
}

export function filterLiveInfo(liveInfo: LiveInfo, toraTv = true): boolean {
  if (liveInfo.broadcastType === "CS") {
    return false;
  }

  if (liveInfo.broadcaster.match(/J SPORTS \d/)) {
    return false;
  }

  if (liveInfo.broadcaster === "DAZN") {
    return false;
  }

  if (liveInfo.broadcaster === "J SPORTSオンデマンド") {
    return false;
  }

  if (!toraTv && liveInfo.broadcaster === "虎テレ") {
    return false;
  }

  if (liveInfo.label === "録画") {
    return false;
  }

  return true;
}

export async function getRecentTigersLiveList(
  liveListUrl: string,
  fetchDetail = false,
): Promise<LiveInfo[]> {
  const result: LiveInfo[] = [];

  const res = await fetch(liveListUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch Tigers live page: HTTP ${res.status}`);
  }
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const recentLiveList = doc?.querySelectorAll(TIGERS_LIVE_LIST_SELECTOR);

  if (!recentLiveList || recentLiveList.length === 0) {
    logger.info("No live broadcast list currently posted on page", { liveListUrl });
    return result;
  }

  const recentLiveListArray = Array.from(recentLiveList);

  for (const item of recentLiveListArray) {
    const liveInfo = await getEachLiveInfo(
      liveListUrl === TIGERS2_LIVE_LIST_URL,
      item,
      fetchDetail,
    );
    result.push(...liveInfo);
  }

  return result;
}

export function createContent(liveInfo: LiveInfo): string {
  const farmStr = liveInfo.isFarm ? "2軍" : "1軍";
  return `${liveInfo.broadcaster} ${liveInfo.date} ${farmStr}`;
}

export function createDueString(liveInfo: LiveInfo): string {
  const date = liveInfo.date.split(" ")[0];
  const time = liveInfo.timetable.split("-")[0];
  return `${date} @${time} `;
}

export function createDescription(liveInfo: LiveInfo): string {
  return `${liveInfo.timetable} \n${liveInfo.descriptionDetail} \n${liveInfo.descriptionUrl}`;
}

export async function addTask(
  api: TodoistApi,
  task: Parameters<TodoistApi["addTask"]>[0],
): Promise<void> {
  try {
    logger.info("Adding task to Todoist", { task: task as unknown as Record<string, unknown> });
    await api.addTask(task);
  } catch (e) {
    if (e instanceof TodoistRequestError) {
      logger.error("Todoist request error", e, {
        httpStatusCode: e.httpStatusCode,
        responseData: e.responseData,
        isAuthError: e.isAuthenticationError(),
      });
    } else {
      logger.error("Unexpected error in addTask", e);
    }
    throw e;
  }
}

/**
 * Sanitize Todoist project ID.
 * Extracts the base32 ID if a slug or URL was provided (e.g., "tigers-6PRwRfhCxvcWXwPQ" -> "6PRwRfhCxvcWXwPQ").
 */
export function sanitizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  const clean = trimmed.split(/[?#]/)[0];
  const parts = clean.split(/[/_-]/);
  const lastPart = parts[parts.length - 1];
  if (lastPart && /^[0-9A-Za-z]+$/.test(lastPart)) {
    return lastPart;
  }
  return trimmed;
}

export async function crawlAndSync(env: Env): Promise<{ syncedCount: number; skippedCount: number }> {
  const token = env.TODOIST_API_TOKEN;
  const rawProjectId = env.TODOIST_TIGERS_PROJECT_ID;

  if (!token || token === "YOUR_API_TOKEN") {
    logger.warn("TODOIST_API_TOKEN is not configured. Skipping Todoist sync.");
    return { syncedCount: 0, skippedCount: 0 };
  }

  if (!rawProjectId || rawProjectId === "YOUR_PROJECT_ID") {
    logger.warn("TODOIST_TIGERS_PROJECT_ID is not configured. Skipping Todoist sync.");
    return { syncedCount: 0, skippedCount: 0 };
  }

  const projectId = sanitizeProjectId(rawProjectId);
  const liveList1 = await getRecentTigersLiveList(TIGERS1_LIVE_LIST_URL, true);
  const api = new TodoistApi(token);

  const existingTasks = [];
  let cursor: string | null | undefined = undefined;
  try {
    do {
      const response = await api.getTasks({ projectId, cursor: cursor ?? undefined });
      existingTasks.push(...response.results);
      cursor = response.nextCursor;
    } while (cursor);
  } catch (e) {
    if (e instanceof TodoistRequestError) {
      logger.error("Failed to fetch existing tasks from Todoist", e, {
        projectId,
        rawProjectId,
        httpStatusCode: e.httpStatusCode,
        responseData: e.responseData,
        isAuthError: e.isAuthenticationError(),
      });
    }
    throw e;
  }

  const existingTaskBroadcastIds = existingTasks.map((task) => {
    const description = task.description;
    const match = description?.match(/https:\/\/hanshintigers\.jp\/news\/media\/live\d+\.html/);
    return match ? match[0] : null;
  });
  logger.info("Fetched existing task broadcast IDs", {
    count: existingTasks.length,
    existingBroadcastUrls: existingTaskBroadcastIds,
  });

  const toraTv = env.TORA_TV === "true";
  const filteredLiveList = liveList1.filter((info) => filterLiveInfo(info, toraTv));

  let syncedCount = 0;
  let skippedCount = 0;

  for (const liveInfo of filteredLiveList) {
    const descriptionUrl = liveInfo.descriptionUrl;
    if (existingTaskBroadcastIds.includes(descriptionUrl)) {
      logger.info("Task already exists in Todoist", {
        descriptionUrl,
        content: createContent(liveInfo),
      });
      skippedCount++;
      continue;
    }

    const task = {
      content: createContent(liveInfo),
      dueString: createDueString(liveInfo),
      description: createDescription(liveInfo),
      projectId,
    };
    await addTask(api, task);
    syncedCount++;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { syncedCount, skippedCount };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    logger.configure({
      token: env.AXIOM_TOKEN,
      dataset: env.AXIOM_DATASET,
    });

    try {
      const url = new URL(request.url);
      const fetchDetail = url.searchParams.get("detail") === "true";

      logger.info("Handling HTTP request", {
        path: url.pathname,
        method: request.method,
        fetchDetail,
      });

      const liveList = await getRecentTigersLiveList(TIGERS1_LIVE_LIST_URL, fetchDetail);
      return new Response(JSON.stringify(liveList, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("HTTP request handling failed", e);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    } finally {
      ctx.waitUntil(logger.flush());
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    logger.configure({
      token: env.AXIOM_TOKEN,
      dataset: env.AXIOM_DATASET,
    });

    logger.info("Start crawling from scheduled event", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
    });

    try {
      const result = await crawlAndSync(env);
      logger.info("Crawling completed successfully", {
        syncedCount: result.syncedCount,
        skippedCount: result.skippedCount,
      });
    } catch (e) {
      logger.error("Crawling failed", e);
    } finally {
      ctx.waitUntil(logger.flush());
    }
  },
};
