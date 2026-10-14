import { describe, it, expect, vi } from "vitest";
import type { TodoistApi } from "@doist/todoist-api-typescript";
import {
  filterLiveInfo,
  createContent,
  createDueString,
  createDescription,
  sanitizeProjectId,
  extractBroadcastUrl,
  fetchExistingBroadcastUrls,
  crawlAndSync,
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

  describe("extractBroadcastUrl", () => {
    it("extracts broadcast URL from plain text description", () => {
      const desc = "18:00- 試合終了まで \n詳細 \nhttps://hanshintigers.jp/news/media/live14103.html";
      expect(extractBroadcastUrl(desc)).toBe("https://hanshintigers.jp/news/media/live14103.html");
    });

    it("extracts broadcast URL from markdown formatted link", () => {
      const desc = "詳細: [放送予定｜阪神タイガース](https://hanshintigers.jp/news/media/live14095.html)";
      expect(extractBroadcastUrl(desc)).toBe("https://hanshintigers.jp/news/media/live14095.html");
    });

    it("returns null if no broadcast URL matches", () => {
      expect(extractBroadcastUrl("No link here")).toBeNull();
      expect(extractBroadcastUrl("")).toBeNull();
      expect(extractBroadcastUrl(undefined)).toBeNull();
      expect(extractBroadcastUrl(null)).toBeNull();
    });
  });

  describe("fetchExistingBroadcastUrls", () => {
    it("aggregates broadcast URLs from both active and completed tasks", async () => {
      const mockApi = {
        getTasks: vi.fn().mockResolvedValue({
          results: [
            {
              id: "task-1",
              description: "18:00- \nhttps://hanshintigers.jp/news/media/live14102.html",
            },
          ],
          nextCursor: null,
        }),
        getCompletedTasksByCompletionDate: vi.fn().mockResolvedValue({
          items: [
            {
              id: "task-2",
              description: "18:00- \nhttps://hanshintigers.jp/news/media/live14103.html",
            },
          ],
          nextCursor: null,
        }),
      } as unknown as TodoistApi;

      const urls = await fetchExistingBroadcastUrls(mockApi, "6PRwRfhCxvcWXwPQ");

      expect(urls.has("https://hanshintigers.jp/news/media/live14102.html")).toBe(true);
      expect(urls.has("https://hanshintigers.jp/news/media/live14103.html")).toBe(true);
      expect(urls.size).toBe(2);
    });

    it("handles cursor pagination for both active and completed tasks", async () => {
      const mockApi = {
        getTasks: vi
          .fn()
          .mockResolvedValueOnce({
            results: [{ id: "1", description: "https://hanshintigers.jp/news/media/live001.html" }],
            nextCursor: "cursor-1",
          })
          .mockResolvedValueOnce({
            results: [{ id: "2", description: "https://hanshintigers.jp/news/media/live002.html" }],
            nextCursor: null,
          }),
        getCompletedTasksByCompletionDate: vi
          .fn()
          .mockResolvedValueOnce({
            items: [{ id: "3", description: "https://hanshintigers.jp/news/media/live003.html" }],
            nextCursor: "cursor-2",
          })
          .mockResolvedValueOnce({
            items: [{ id: "4", description: "https://hanshintigers.jp/news/media/live004.html" }],
            nextCursor: null,
          }),
      } as unknown as TodoistApi;

      const urls = await fetchExistingBroadcastUrls(mockApi, "project-123");
      expect(urls.size).toBe(4);
      expect(urls.has("https://hanshintigers.jp/news/media/live001.html")).toBe(true);
      expect(urls.has("https://hanshintigers.jp/news/media/live002.html")).toBe(true);
      expect(urls.has("https://hanshintigers.jp/news/media/live003.html")).toBe(true);
      expect(urls.has("https://hanshintigers.jp/news/media/live004.html")).toBe(true);
    });
  });

  describe("crawlAndSync with completed task prevention", () => {
    it("does not create a new task if the broadcast already exists as completed in Todoist", async () => {
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
                  <td><a href="//hanshintigers.jp/news/media/live14103.html">詳細</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </body></html>
      `;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((input: string | URL | Request) => {
        return Promise.resolve(new Response(mockHtml, { status: 200 }));
      }) as typeof globalThis.fetch;

      const addedTasks: any[] = [];
      const mockApi = {
        getTasks: vi.fn().mockResolvedValue({
          results: [],
          nextCursor: null,
        }),
        getCompletedTasksByCompletionDate: vi.fn().mockResolvedValue({
          items: [
            {
              id: "completed-1",
              content: "サンテレビ 2026/10/15 (木) 1軍",
              description: "18:00-21:30 \n詳細: [放送予定](https://hanshintigers.jp/news/media/live14103.html)",
            },
          ],
          nextCursor: null,
        }),
        addTask: vi.fn().mockImplementation((task) => {
          addedTasks.push(task);
          return Promise.resolve(task);
        }),
      } as unknown as TodoistApi;

      try {
        const env = {
          TODOIST_API_TOKEN: "mock-token",
          TODOIST_TIGERS_PROJECT_ID: "mock-project-id",
          TORA_TV: "false",
        };

        const result = await crawlAndSync(env, mockApi);

        expect(result.syncedCount).toBe(0);
        expect(result.skippedCount).toBe(1);
        expect(addedTasks.length).toBe(0);
        expect(mockApi.addTask).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("creates a new task when broadcast is neither active nor completed in Todoist", async () => {
      const mockHtml = `
        <html><body>
          <div class="media-list clearfix">
            <div class="air-date">2026/10/16 (金)</div>
            <table class="basic-table">
              <tbody>
                <tr>
                  <td>地上波</td>
                  <td>サンテレビ</td>
                  <td class="timetable"><img alt="生中継" />18:00-21:30</td>
                  <td><a href="//hanshintigers.jp/news/media/live99999.html">詳細</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </body></html>
      `;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((input: string | URL | Request) => {
        return Promise.resolve(new Response(mockHtml, { status: 200 }));
      }) as typeof globalThis.fetch;

      const addedTasks: any[] = [];
      const mockApi = {
        getTasks: vi.fn().mockResolvedValue({
          results: [],
          nextCursor: null,
        }),
        getCompletedTasksByCompletionDate: vi.fn().mockResolvedValue({
          items: [],
          nextCursor: null,
        }),
        addTask: vi.fn().mockImplementation((task) => {
          addedTasks.push(task);
          return Promise.resolve(task);
        }),
      } as unknown as TodoistApi;

      try {
        const env = {
          TODOIST_API_TOKEN: "mock-token",
          TODOIST_TIGERS_PROJECT_ID: "mock-project-id",
          TORA_TV: "false",
        };

        const result = await crawlAndSync(env, mockApi);

        expect(result.syncedCount).toBe(1);
        expect(result.skippedCount).toBe(0);
        expect(addedTasks.length).toBe(1);
        expect(addedTasks[0].content).toBe("サンテレビ 2026/10/16 (金) 1軍");
        expect(addedTasks[0].description).toContain("https://hanshintigers.jp/news/media/live99999.html");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

