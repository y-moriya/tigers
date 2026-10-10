import { describe, it, expect } from "vitest";
import {
  filterLiveInfo,
  createContent,
  createDueString,
  createDescription,
  sanitizeProjectId,
  type LiveInfo,
} from "./index.js";

describe("Tigers live info functions", () => {
  const sampleLiveInfo: LiveInfo = {
    date: "2026/10/10 (土)",
    broadcastType: "地上波",
    broadcaster: "サンテレビ",
    label: "生中継",
    timetable: "18:00-21:00",
    descriptionUrl: "https://hanshintigers.jp/news/media/live12345.html",
    descriptionDetail: "阪神タイガース対巨人戦中継",
    isFarm: false,
  };

  it("createContent formats broadcaster, date and 1軍/2軍", () => {
    expect(createContent(sampleLiveInfo)).toBe("サンテレビ 2026/10/10 (土) 1軍");

    const farmInfo = { ...sampleLiveInfo, isFarm: true };
    expect(createContent(farmInfo)).toBe("サンテレビ 2026/10/10 (土) 2軍");
  });

  it("createDueString extracts date and start time", () => {
    expect(createDueString(sampleLiveInfo)).toBe("2026/10/10 @18:00 ");
  });

  it("createDescription formats timetable, descriptionDetail and url", () => {
    const desc = createDescription(sampleLiveInfo);
    expect(desc).toBe("18:00-21:00 \n阪神タイガース対巨人戦中継 \nhttps://hanshintigers.jp/news/media/live12345.html");
  });

  describe("filterLiveInfo", () => {
    it("allows standard terrestrial broadcast", () => {
      expect(filterLiveInfo(sampleLiveInfo)).toBe(true);
    });

    it("filters out CS broadcasts", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcastType: "CS" })).toBe(false);
    });

    it("filters out J SPORTS numbered channels", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "J SPORTS 1" })).toBe(false);
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "J SPORTS 3" })).toBe(false);
    });

    it("filters out DAZN", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "DAZN" })).toBe(false);
    });

    it("filters out J SPORTSオンデマンド", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "J SPORTSオンデマンド" })).toBe(false);
    });

    it("filters out 虎テレ when toraTv is false", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "虎テレ" }, false)).toBe(false);
      expect(filterLiveInfo({ ...sampleLiveInfo, broadcaster: "虎テレ" }, true)).toBe(true);
    });

    it("filters out 録画 broadcasts", () => {
      expect(filterLiveInfo({ ...sampleLiveInfo, label: "録画" })).toBe(false);
    });
  });

  describe("HTML Parsing and getRecentTigersLiveList", () => {
    it("parses tigers live list table accurately", async () => {
      const mockHtml = `
        <html><body>
          <div class="media-list clearfix">
            <div class="air-date">2026/10/15 (木)</div>
            <table class="basic-table">
              <tbody>
                <tr>
                  <td>地上波</td>
                  <td>サンテレビ</td>
                  <td class="timetable"><img alt="生中継" />18:00-21:30</td>
                  <td><a href="/news/media/live001.html">詳細</a></td>
                </tr>
                <tr>
                  <td>CS</td>
                  <td>スカイA</td>
                  <td class="timetable"><img alt="生中継" />17:45-22:00</td>
                  <td><a href="/news/media/live002.html">詳細</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </body></html>
      `;

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          return Promise.resolve(new Response(mockHtml, { status: 200 }));
        }) as typeof globalThis.fetch;

        const { getRecentTigersLiveList } = await import("./index.js");
        const list = await getRecentTigersLiveList("https://hanshintigers.jp/news/media/live.html", false);

        expect(list.length).toBe(2);
        expect(list[0].date).toBe("2026/10/15 (木)");
        expect(list[0].broadcaster).toBe("サンテレビ");
        expect(list[0].broadcastType).toBe("地上波");
        expect(list[0].label).toBe("生中継");
        expect(list[0].timetable).toBe("18:00-21:30");
        expect(list[0].descriptionUrl).toBe("https:/news/media/live001.html");
        expect(list[0].isFarm).toBe(false);

        expect(list[1].broadcastType).toBe("CS");
        expect(list[1].broadcaster).toBe("スカイA");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns empty array safely when no media-list is found", async () => {
      const mockEmptyHtml = `<html><body><p>放送予定の掲載は順次行います。</p></body></html>`;
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          return Promise.resolve(new Response(mockEmptyHtml, { status: 200 }));
        }) as typeof globalThis.fetch;

        const { getRecentTigersLiveList } = await import("./index.js");
        const list = await getRecentTigersLiveList("https://hanshintigers.jp/news/media/live.html", false);
        expect(list).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("sanitizeProjectId", () => {
    it("keeps clean Base32 project ID as is", () => {
      expect(sanitizeProjectId("6PRwRfhCxvcWXwPQ")).toBe("6PRwRfhCxvcWXwPQ");
    });

    it("extracts ID from slug with project name prefix", () => {
      expect(sanitizeProjectId("tigers-6PRwRfhCxvcWXwPQ")).toBe("6PRwRfhCxvcWXwPQ");
    });

    it("extracts ID from full Todoist URL", () => {
      expect(
        sanitizeProjectId("https://app.todoist.com/app/project/tigers-6PRwRfhCxvcWXwPQ")
      ).toBe("6PRwRfhCxvcWXwPQ");
    });

    it("handles whitespace and query parameters", () => {
      expect(sanitizeProjectId("  6PRwRfhCxvcWXwPQ?view=list  ")).toBe("6PRwRfhCxvcWXwPQ");
    });

    it("handles legacy numeric project IDs", () => {
      expect(sanitizeProjectId("28316311")).toBe("28316311");
    });
  });
});

