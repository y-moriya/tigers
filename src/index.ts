import { DOMParser } from "linkedom";
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
};
