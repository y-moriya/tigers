import {
  DOMParser,
  Element,
} from "https://deno.land/x/deno_dom@v0.1.37/deno-dom-wasm.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";
import {
  AddTaskArgs,
  TodoistApi,
  TodoistRequestError,
} from "npm:@doist/todoist-api-typescript";
import Logger from "https://deno.land/x/logger@v1.1.0/logger.ts";

// init logger
const logger = new Logger();
await logger.initFileLogger("./logs");

const TIGERS_LIVE_LIST_URL = "https://hanshintigers.jp/news/media/live.html";
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
}

export async function getRecentTigersLiveList(): Promise<LiveInfo[]> {
  // define result array
  const result: LiveInfo[] = [];

  const res = await fetch(TIGERS_LIVE_LIST_URL);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const recentLiveList = doc!.querySelector(TIGERS_LIVE_LIST_SELECTOR);

  const element = recentLiveList as Element;
  // get date information from div.air-date
  const date = element.querySelector("div.air-date")?.textContent.trim()
    .replace(/\s+/g, " ");
  logger.info(date);

  // separate month and day from date
  const [month, day] = date!.split(" ")[0].split("/");
  // get current date
  const now = new Date();
  // if month and day is not current month and day, exit
  if (
    now.getMonth() + 1 !== parseInt(month) || now.getDate() !== parseInt(day)
  ) {
    return result;
  }

  // get trs from table.basic-table > tbody > tr
  const trs = element.querySelectorAll("table.basic-table > tbody > tr");
  for (const tr of trs) {
    const trElement = tr as Element;

    // get broadcast type from tr > td:nth-child(1)
    const broadcastType = trElement!.querySelector("td:nth-child(1)")
      ?.textContent;

    // continue if broadcast type is "CS"
    if (broadcastType === "CS") {
      continue;
    }

    // get broadcaster from trElement > td:nth-child(2)
    const broadcaster = trElement!.querySelector("td:nth-child(2)")
      ?.textContent;

    // continue if broadcaster match "J SPORTS \d"
    if (broadcaster?.match(/J SPORTS \d/)) {
      continue;
    }

    // continue if broadcaster is "DAZN" or "虎テレ"
    if (broadcaster === "DAZN" || broadcaster === "虎テレ") {
      continue;
    }

    // get label img alt from trElement > td.timetable > img
    const label = trElement!.querySelector("td.timetable > img")
      ?.getAttribute("alt");

    // continue if label is "録画"
    if (label === "録画") {
      continue;
    }

    // get timetable from trElement > td.timetable textContent
    const timetable = trElement!.querySelector("td.timetable")?.textContent;

    // get description url from trElement > td:nth-child(4) > a.href
    const descriptionUrl = DESCRIPTION_URL_PREFIX +
      trElement!.querySelector("td:nth-child(4) > a")?.getAttribute("href");

    // get description from description url
    const descriptionRes = await fetch(descriptionUrl);
    const descriptionHtml = await descriptionRes.text();
    const descriptionDoc = new DOMParser().parseFromString(
      descriptionHtml,
      "text/html",
    );
    // get descriptionDetail from p.media-detail-note
    const descriptionDetail = descriptionDoc!.querySelector(
      "p.media-detail-note",
    )?.innerText.replaceAll("\n", " ");

    // create LiveInfo object from above information
    const liveInfo: LiveInfo = {
      date: date!,
      broadcastType: broadcastType!,
      broadcaster: broadcaster!,
      label: label!,
      timetable: timetable!,
      descriptionUrl: descriptionUrl!,
      descriptionDetail: descriptionDetail!,
    };

    // log liveInfo
    logger.info(liveInfo);

    // push to result array
    result.push(liveInfo);

    // wait 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // return result array
  return result;
}

// create content from live information
function createContent(liveInfo: LiveInfo): string {
  return `${liveInfo.broadcaster} ${liveInfo.date}`;
}

// create due string from live information
function createDueString(liveInfo: LiveInfo): string {
  // separate date from liveInfo.date
  const date = liveInfo.date.split(" ")[0];
  // separate time from liveInfo.timetable
  const time = liveInfo.timetable.split("-")[0];

  return `${date}@${time}`;
}

// add task to Todoist function
async function addTask(api: TodoistApi, task: AddTaskArgs): Promise<void> {
  try {
    logger.info(task);
    await api.addTask(task);
  } catch (e) {
    if (e instanceof TodoistRequestError) {
      logger.error(
        `${e.message}, ${e.httpStatusCode}, ${e.responseData}, isAuthError: ${e.isAuthenticationError()}`,
      );
    } else {
      throw e;
    }
  }
}

if (import.meta.main) {
  const liveList = await getRecentTigersLiveList();
  const api = new TodoistApi(config().TODOIST_API_TOKEN);

  // if liveList is empty, exit
  if (liveList.length === 0) {
    logger.info("No live information found.");

    // add empty task to Todoist
    const emptyTask = {
      content: "本日視聴可能な野球放送はありません。",
      dueString: "today",
      projectId: config().TODOIST_TIGERS_PROJECT_ID,
    };
    await addTask(api, emptyTask);
    Deno.exit(0);
  }

  for (const liveInfo of liveList) {
    const task = {
      content: createContent(liveInfo),
      dueString: createDueString(liveInfo),
      description: liveInfo.descriptionDetail,
      projectId: config().TODOIST_TIGERS_PROJECT_ID,
    };
    await addTask(api, task);
  }
}
