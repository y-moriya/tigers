import {
  DOMParser,
  Element,
} from "https://deno.land/x/deno_dom@v0.1.37/deno-dom-wasm.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";
import { TodoistApi } from "npm:@doist/todoist-api-typescript";

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
  console.log(date);

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
    )?.textContent;

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
    console.log(liveInfo);

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
  const time = liveInfo.timetable.split(" ")[0].replace("-", "");

  return `${date}@${time}`;
}

// Learn more at https://deno.land/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const liveList = await getRecentTigersLiveList();
  const api = new TodoistApi(config().TODOIST_API_TOKEN);
  for (const liveInfo of liveList) {
    await api.addTask({
      content: createContent(liveInfo),
      dueString: createDueString(liveInfo),
      projectId: config().TODOIST_TIGERS_PROJECT_ID,
    });
  }
}
