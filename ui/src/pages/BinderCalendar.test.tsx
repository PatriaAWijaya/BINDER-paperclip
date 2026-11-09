// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinderCalendar } from "./BinderCalendar";

const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
}));
const mockPostizApi = vi.hoisted(() => ({
  testConnection: vi.fn(),
  batchPush: vi.fn(),
  sync: vi.fn(),
}));
const mockCompanyState = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; issuePrefix: string; name: string }>,
  selectedCompanyId: null as string | null,
  selectedCompany: null as { id: string; issuePrefix: string; name: string } | null,
}));

vi.mock("../api/issues", () => ({
  issuesApi: mockIssuesApi,
}));
vi.mock("../api/postiz", () => ({
  postizApi: mockPostizApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mockCompanyState.companies,
    selectedCompanyId: mockCompanyState.selectedCompanyId,
    selectedCompany: mockCompanyState.selectedCompany,
    setSelectedCompanyId: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function act(callback: () => void) {
  flushSync(callback);
}

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(label),
  );
  if (!button) throw new Error(`Tombol "${label}" tidak ditemukan`);
  return button;
}

const SCHEDULED_ISSUES = [
  {
    id: "issue-sal-1",
    companyId: "company-1",
    title: "[9 Nov 2026] Peluncuran COP31 hari pertama",
    identifier: "SAL-1",
    status: "backlog",
    dueDate: "2026-11-09T02:00:00.000Z",
    postizPostId: null,
    postizState: null,
    postizPushedAt: null,
  },
  {
    id: "issue-sal-4",
    companyId: "company-1",
    title: "[16 Nov 2026] Istiqlal membuktikannya (HERO POST)",
    identifier: "SAL-4",
    status: "backlog",
    dueDate: "2026-11-16T02:00:00.000Z",
    postizPostId: null,
    postizState: null,
    postizPushedAt: null,
  },
  {
    id: "issue-tanpa-jadwal",
    companyId: "company-1",
    title: "Issue TEST (rebuild)",
    identifier: null,
    status: "backlog",
    dueDate: null,
    postizPostId: null,
    postizState: null,
    postizPushedAt: null,
  },
];

describe("BinderCalendar page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompanyState.companies = [];
    mockCompanyState.selectedCompanyId = null;
    mockCompanyState.selectedCompany = null;
    mockIssuesApi.list.mockResolvedValue(SCHEDULED_ISSUES);
    mockPostizApi.testConnection.mockResolvedValue({
      status: "ok",
      message: "Terhubung — Postiz menjawab dengan 1 channel.",
      latencyMs: 90,
      httpStatus: 200,
      integrations: [{ id: "int-1", name: "Saleem IG", provider: "instagram" }],
    });
    mockPostizApi.batchPush.mockResolvedValue({
      approvedActionId: "action-1",
      pushed: 2,
      skipped: 0,
      failed: 0,
      alreadyPushed: 0,
      results: [
        { issueId: "issue-sal-1", outcome: "pushed", postizPostId: "pz-1", mediaMissing: true, reason: null },
        { issueId: "issue-sal-4", outcome: "pushed", postizPostId: "pz-2", mediaMissing: true, reason: null },
      ],
      transportRef: "postiz-batch:pushed=2,skipped=0,already=0",
      error: null,
      rateLimited: false,
    });
    mockPostizApi.sync.mockResolvedValue({
      checked: 2,
      updated: 1,
      unknown: [],
      changes: [
        { issueId: "issue-sal-1", postizPostId: "pz-1", previousState: "draft", nextState: "terjadwal" },
      ],
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <BinderCalendar />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    await flushReact();
    return root;
  }

  function selectCompany() {
    mockCompanyState.companies = [{ id: "company-1", issuePrefix: "SAL", name: "Saleem (DUMMY)" }];
    mockCompanyState.selectedCompanyId = "company-1";
    mockCompanyState.selectedCompany = { id: "company-1", issuePrefix: "SAL", name: "Saleem (DUMMY)" };
  }

  it("tanpa company menampilkan empty state", async () => {
    await renderPage();
    expect(container.textContent).toContain("Belum ada company");
  });

  it("menampilkan post terjadwal per hari WIB + yang belum dijadwalkan", async () => {
    selectCompany();
    await renderPage();

    expect(container.textContent).toContain("9 November 2026");
    expect(container.textContent).toContain("16 November 2026");
    expect(container.textContent).toContain("SAL-1");
    expect(container.textContent).toContain("Peluncuran COP31 hari pertama");
    expect(container.textContent).toContain("SAL-4");
    expect(container.textContent).toContain("Belum dikirim");
    expect(container.textContent).toContain("Belum dijadwalkan (1)");
    expect(container.textContent).toContain("Issue TEST (rebuild)");
  });

  it("tanpa post terjadwal menampilkan empty state kalender", async () => {
    selectCompany();
    mockIssuesApi.list.mockResolvedValue([SCHEDULED_ISSUES[2]]);
    await renderPage();

    expect(container.textContent).toContain("Belum ada post terjadwal");
    expect(container.textContent).toContain("Belum dijadwalkan (1)");
  });

  it("Test Connection memakai kunci sementara lalu mengosongkan field", async () => {
    selectCompany();
    await renderPage();

    const keyInput = container.querySelector("#postiz-api-key") as HTMLInputElement;
    expect(keyInput).not.toBeNull();
    act(() => setInputValue(keyInput, "kunci-test-sementara"));
    act(() => findButton(container, "Uji koneksi").click());
    await flushReact();
    await flushReact();

    expect(mockPostizApi.testConnection).toHaveBeenCalledWith("company-1", {
      baseUrl: "http://localhost:5000",
      apiKey: "kunci-test-sementara",
    });
    expect(container.textContent).toContain("Terhubung — Postiz menjawab dengan 1 channel.");
    expect(container.textContent).toContain("Saleem IG (instagram)");
    expect(keyInput.value).toBe("");
  });

  it("Test Connection tanpa kunci memakai referensi yang terpasang", async () => {
    selectCompany();
    await renderPage();

    act(() => findButton(container, "Uji koneksi").click());
    await flushReact();
    await flushReact();

    expect(mockPostizApi.testConnection).toHaveBeenCalledWith("company-1", {
      baseUrl: "http://localhost:5000",
      apiKeyRef: "{env:POSTIZ_API_KEY}",
    });
  });

  it("kartu batch menunggu persetujuan: tombol kirim mati tanpa approved_action_id", async () => {
    selectCompany();
    await renderPage();

    expect(container.textContent).toContain("Batch Postiz");
    expect(container.textContent).toContain("Kirim 2 post terjadwal yang belum dikirim");
    expect(container.textContent).toContain("Menunggu persetujuan batch");
    expect(findButton(container, "Kirim batch ke Postiz").disabled).toBe(true);
    expect(mockPostizApi.batchPush).not.toHaveBeenCalled();
  });

  it("Test Connection mengisi channel batch dari hasil uji", async () => {
    selectCompany();
    await renderPage();

    const integrationInput = container.querySelector(
      "#postiz-integration-id",
    ) as HTMLInputElement;
    expect(integrationInput.value).toBe("");
    act(() => findButton(container, "Uji koneksi").click());
    await flushReact();
    await flushReact();

    expect(integrationInput.value).toBe("int-1");
  });

  it("batch push mengirim id persetujuan + issue + channel, lalu menampilkan hasil", async () => {
    selectCompany();
    await renderPage();

    const actionInput = container.querySelector(
      "#postiz-approved-action-id",
    ) as HTMLInputElement;
    const integrationInput = container.querySelector(
      "#postiz-integration-id",
    ) as HTMLInputElement;
    const keyInput = container.querySelector("#postiz-batch-api-key") as HTMLInputElement;
    act(() => setInputValue(actionInput, "action-1"));
    act(() => setInputValue(integrationInput, "int-1"));
    act(() => setInputValue(keyInput, "kunci-batch-sementara"));
    act(() => findButton(container, "Kirim batch ke Postiz").click());
    await flushReact();
    await flushReact();

    expect(mockPostizApi.batchPush).toHaveBeenCalledWith("company-1", {
      approvedActionId: "action-1",
      issueIds: ["issue-sal-1", "issue-sal-4"],
      integrationId: "int-1",
      baseUrl: "http://localhost:5000",
      apiKey: "kunci-batch-sementara",
    });
    expect(container.textContent).toContain("Batch selesai — 2 terkirim, 0 dilewati");
    expect(container.textContent).toContain("Terkirim sebagai draf (tanpa media)");
    expect(keyInput.value).toBe("");
  });

  it("sync mengirim rentang tanggal campaign lalu menampilkan hasil", async () => {
    selectCompany();
    await renderPage();

    act(() => findButton(container, "Sinkronkan status Postiz").click());
    await flushReact();
    await flushReact();

    expect(mockPostizApi.sync).toHaveBeenCalledWith("company-1", {
      baseUrl: "http://localhost:5000",
      apiKeyRef: "{env:POSTIZ_API_KEY}",
      startDate: "2026-11-09T02:00:00.000Z",
      endDate: "2026-11-17T02:00:00.000Z",
    });
    expect(container.textContent).toContain("Diperiksa 2 post di Postiz — 1 state diperbarui.");
  });
});
