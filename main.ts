import {
  DOMParser,
  type Element,
} from "https://deno.land/x/deno_dom@v0.1.37/deno-dom-wasm.ts";
import {
  TodoistApi,
  TodoistRequestError,
} from "npm:@doist/todoist-api-typescript@latest";
import "https://deno.land/x/dotenv@v3.2.2/load.ts";
import { logger } from "./logger.ts";

const TIGERS1_LIVE_LIST_URL = "https://hanshintigers.jp/news/media/live.html";
const TIGERS2_LIVE_LIST_URL = "https://hanshintigers.jp/news/media/farmlive.html";
const TIGERS_LIVE_LIST_SELECTOR = "div.media-list.clearfix";
const DESCRIPTION_URL_PREFIX = "https:";

// type for live information
interface LiveInfo {
  date: string;
  broadcastType: string;
  broadcaster: string;
  label: string;
  timetable: string;
  descriptionUrl: string;
  descriptionDetail: string;
  isFarm: boolean;
}

async function getEachLiveInfo(isFarm: boolean, liveElement: Element, fetchDetail = false): Promise<LiveInfo[]> {
  // get date information from div.air-date
  const date = liveElement.querySelector("div.air-date")?.textContent.trim()
    .replace(/\s+/g, " ");
  const result: LiveInfo[] = [];

  // get trs from table.basic-table > tbody > tr
  const trs = liveElement.querySelectorAll("table.basic-table > tbody > tr");
  for (const tr of trs) {
    const trElement = tr as Element;

    // get broadcast type from tr > td:nth-child(1)
    const broadcastType = trElement?.querySelector("td:nth-child(1)")
      ?.textContent ?? "";

    // get broadcaster from trElement > td:nth-child(2)
    const broadcaster = trElement?.querySelector("td:nth-child(2)")
      ?.textContent ?? "";

    // get label img alt from trElement > td.timetable > img
    const label = trElement?.querySelector("td.timetable > img")
      ?.getAttribute("alt") ?? "";

    // get timetable from trElement > td.timetable textContent
    const timetable = trElement?.querySelector("td.timetable")?.textContent ?? "";

    // get description url from trElement > td:nth-child(4) > a.href
    // 詳細URLが未登録の場合はスキップ（後から追加されると重複登録の原因になる）
    const href = trElement?.querySelector("td:nth-child(4) > a")?.getAttribute("href");
    if (!href) continue;
    const descriptionUrl = DESCRIPTION_URL_PREFIX + href;

    let descriptionDetail = "";
    if (fetchDetail) {
      // get description from description url
      const descriptionRes = await fetch(descriptionUrl);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const descriptionHtml = await descriptionRes.text();

      const descriptionDoc = new DOMParser().parseFromString(
        descriptionHtml,
        "text/html",
      );
      // get descriptionDetail from p.media-detail-note
      descriptionDetail = descriptionDoc?.querySelector(
        "p.media-detail-note",
      )?.innerText.replaceAll("\n", " ") ?? "";
    }

    // create LiveInfo object from above information
    const liveInfo: LiveInfo = {
      date: date!,
      broadcastType,
      broadcaster,
      label,
      timetable,
      descriptionUrl,
      descriptionDetail,
      isFarm,
    };

    // log liveInfo
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

function filterLiveInfo(liveInfo: LiveInfo): boolean {
  // broadcast type is "CS"
  if (liveInfo.broadcastType === "CS") {
    return false;
  }

  // broadcaster match "J SPORTS \d"
  if (liveInfo.broadcaster.match(/J SPORTS \d/)) {
    return false;
  }

  // broadcaster is "DAZN"
  if (liveInfo.broadcaster === "DAZN") {
    return false;
  }

  // broadcaster is "J SPORTSオンデマンド"
  if (liveInfo.broadcaster === "J SPORTSオンデマンド") {
    return false;
  }

  // broadcaster is "虎テレ" if TORA_TV is not true
  const TORA_TV = Deno.env.get("TORA_TV") === "true";
  if (!TORA_TV && liveInfo.broadcaster === "虎テレ") {
    return false;
  }

  // label is "録画"
  if (liveInfo.label === "録画") {
    return false;
  }

  return true;
}

export async function getRecentTigersLiveList(liveListUrl: string, fetchDetail = false): Promise<LiveInfo[]> {
  // define result array
  const result: LiveInfo[] = [];

  const res = await fetch(liveListUrl);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const recentLiveList = doc?.querySelectorAll(TIGERS_LIVE_LIST_SELECTOR);

  if (!recentLiveList) {
    throw new Error("Recent live list not found");
  }

  // get first element from recentLiveList
  const recentLiveListArray = Array.from(recentLiveList);

  for (const recentLiveList of recentLiveListArray) {
    const liveInfo = await getEachLiveInfo(liveListUrl === TIGERS2_LIVE_LIST_URL, recentLiveList as Element, fetchDetail);
    // push liveInfo to result array
    result.push(...liveInfo);
  }

  // return result array
  return result;
}

// create content from live information
function createContent(liveInfo: LiveInfo): string {
  const farmStr = liveInfo.isFarm ? "2軍" : "1軍";
  return `${liveInfo.broadcaster} ${liveInfo.date} ${farmStr}`;
}

// create due string from live information
function createDueString(liveInfo: LiveInfo): string {
  // separate date from liveInfo.date
  const date = liveInfo.date.split(" ")[0];
  // separate time from liveInfo.timetable
  const time = liveInfo.timetable.split("-")[0];

  return `${date} @${time} `;
}

function createDescription(liveInfo: LiveInfo): string {
  return `${liveInfo.timetable} \n${liveInfo.descriptionDetail} \n${liveInfo.descriptionUrl}`;
}

// add task to Todoist function
async function addTask(api: TodoistApi, task: Parameters<TodoistApi["addTask"]>[0]): Promise<void> {
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

async function main() {
  const liveList1 = await getRecentTigersLiveList(TIGERS1_LIVE_LIST_URL, true);
  // const liveList2 = await getRecentTigersLiveList(TIGERS2_LIVE_LIST_URL);
  // const liveList = liveList1.concat(liveList2);
  const api = new TodoistApi(Deno.env.get("TODOIST_API_TOKEN") as string);
  const projectId = Deno.env.get("TODOIST_TIGERS_PROJECT_ID") as string;

  // 全既存タスクをページネーションで取得
  const existingTasks = [];
  let cursor: string | null | undefined = undefined;
  do {
    const response = await api.getTasks({ projectId: projectId, cursor: cursor ?? undefined });
    existingTasks.push(...response.results);
    cursor = response.nextCursor;
  } while (cursor);

  const existingTaskBroadcastIds = existingTasks.map((task) => {
    const description = task.description;
    const match = description?.match(/https:\/\/hanshintigers\.jp\/news\/media\/live\d+\.html/);
    return match ? match[0] : null;
  });
  logger.info("Fetched existing task broadcast IDs", {
    count: existingTasks.length,
    existingBroadcastUrls: existingTaskBroadcastIds,
  });

  const filteredLiveList = liveList1.filter(filterLiveInfo);

  for (const liveInfo of filteredLiveList) {
    // check if liveInfo is already in Todoist
    const descriptionUrl = liveInfo.descriptionUrl;
    if (existingTaskBroadcastIds.includes(descriptionUrl)) {
      logger.info("Task already exists in Todoist", {
        descriptionUrl,
        content: createContent(liveInfo),
      });
      continue;
    }

    const task = {
      content: createContent(liveInfo),
      dueString: createDueString(liveInfo),
      description: createDescription(liveInfo),
      projectId: projectId,
    };
    await addTask(api, task);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// メインの処理
if (import.meta.main) {
  Deno.cron("Get todays live information for tigers", "0 19 * * *", async () => {
    logger.info("Start crawling");
    try {
      await main();
      logger.info("Crawling completed successfully");
    } catch (e) {
      logger.error("Crawling failed", e);
    } finally {
      await logger.flush();
    }
  });

  // ポート番号の取得 (環境変数 PORT または CLI引数 --port, -p から。デフォルトは 8000)
  let port = 8000;
  const portEnv = Deno.env.get("PORT");
  if (portEnv) {
    const parsed = parseInt(portEnv, 10);
    if (!isNaN(parsed)) {
      port = parsed;
    }
  }

  for (let i = 0; i < Deno.args.length; i++) {
    if (Deno.args[i] === "--port" || Deno.args[i] === "-p") {
      const nextArg = Deno.args[i + 1];
      if (nextArg) {
        const parsed = parseInt(nextArg, 10);
        if (!isNaN(parsed)) {
          port = parsed;
        }
      }
    }
  }

  // Deno Deployでデプロイメントをアクティブに保ち、
  // ヘルスチェックを可能にするためのダミーサーバー
  Deno.serve({ port }, async (_req) => {
    try {
      const url = new URL(_req.url);
      const fetchDetail = url.searchParams.get("detail") === "true";
      logger.info("Handling HTTP request", {
        path: url.pathname,
        method: _req.method,
        fetchDetail,
      });
      const liveList = await getRecentTigersLiveList(TIGERS1_LIVE_LIST_URL, fetchDetail);
      return new Response(
        JSON.stringify(liveList, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("HTTP request handling failed", e);
      return new Response(
        JSON.stringify({ error: message }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    } finally {
      await logger.flush();
    }
  });
}