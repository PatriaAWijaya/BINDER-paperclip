// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinderHero } from "./BinderHero";

const mockBinderHeroApi = vi.hoisted(() => ({
  fundingSummary: vi.fn(),
  ceoModel: vi.fn(),
  updateCeoModel: vi.fn(),
  testConnection: vi.fn(),
}));
const mockDashboardApi = vi.hoisted(() => ({
  summary: vi.fn(),
}));
const mockGoalsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));
const mockCompanyState = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; issuePrefix: string; name: string }>,
  selectedCompanyId: null as string | null,
  selectedCompany: null as { id: string; issuePrefix: string; name: string } | null,
}));

vi.mock("../api/binder-hero", () => ({
  binderHeroApi: mockBinderHeroApi,
}));
vi.mock("../api/dashboard", () => ({
  dashboardApi: mockDashboardApi,
}));
vi.mock("../api/goals", () => ({
  goalsApi: mockGoalsApi,
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

vi.mock("../components/ThemeToggle", () => ({
  ThemeToggle: () => null,
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

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(label),
  );
  if (!button) throw new Error(`Tombol "${label}" tidak ditemukan`);
  return button;
}

const DASHBOARD_SUMMARY = {
  companyId: "company-1",
  agents: { active: 1, running: 0, paused: 0, error: 0 },
  tasks: { open: 2, inProgress: 1, blocked: 0, done: 3 },
  costs: { monthSpendCents: 500, monthBudgetCents: 2000, monthUtilizationPercent: 25 },
  pendingApprovals: 1,
  budgets: { activeIncidents: 0, pendingApprovals: 1, pausedAgents: 0, pausedProjects: 0 },
  runActivity: [],
};

const FUNDING_SUMMARY = {
  companyId: "company-1",
  pool: { balanceCents: 1500, monthlyTopUpCents: 2000, level: 0, exhausted: false },
  envelopes: [
    {
      id: "env-12345678",
      issueId: "issue-1",
      status: "active",
      amountCents: 1000,
      spentCents: 200,
      remainingCents: 800,
      level: 0,
    },
  ],
  ledgerBalanced: true,
  ledgerDifferenceCents: "0.0000000",
};

const CEO_MODEL = {
  registered: true,
  companyId: "company-1",
  primary: {
    modelFamily: "meta",
    modelId: "muse-spark-1.3",
    provider: "opencode_local",
    apiKeyRef: "{env:META_API_KEY}",
  },
  fallback: {
    modelFamily: "anthropic",
    modelId: "claude-sonnet-5-5",
    provider: "claude_local",
    apiKeyRef: "{env:ANTHROPIC_API_KEY}",
  },
  runtimeDefault: "sandbox",
  budgetMonthlyCents: 2000,
};

describe("BinderHero page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompanyState.companies = [];
    mockCompanyState.selectedCompanyId = null;
    mockCompanyState.selectedCompany = null;
    mockDashboardApi.summary.mockResolvedValue(DASHBOARD_SUMMARY);
    mockBinderHeroApi.fundingSummary.mockResolvedValue(FUNDING_SUMMARY);
    mockBinderHeroApi.ceoModel.mockResolvedValue(CEO_MODEL);
    mockGoalsApi.list.mockResolvedValue([
      { id: "goal-1", status: "active" },
      { id: "goal-2", status: "achieved" },
    ]);
    mockBinderHeroApi.testConnection.mockResolvedValue({
      provider: "meta",
      modelId: "muse-spark-1.3",
      status: "ok",
      message: "Terhubung — Meta menjawab untuk model muse-spark-1.3.",
      latencyMs: 120,
      httpStatus: 200,
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
          <BinderHero />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    await flushReact();
    return root;
  }

  function selectCompany() {
    mockCompanyState.companies = [{ id: "company-1", issuePrefix: "PAP", name: "Company TEST" }];
    mockCompanyState.selectedCompanyId = "company-1";
    mockCompanyState.selectedCompany = { id: "company-1", issuePrefix: "PAP", name: "Company TEST" };
  }

  it("menampilkan empty state + formulir buat company yang hanya memvalidasi", async () => {
    const root = await renderPage();

    expect(container.textContent).toContain("Belum ada company");
    expect(container.textContent).toContain("tidak menyimpan apa pun");

    const nameInput = container.querySelector<HTMLInputElement>("#binder-hero-company-name");
    expect(nameInput).not.toBeNull();
    act(() => {
      setInputValue(nameInput!, "Company Baru");
      findButton(container, "Periksa formulir").click();
    });
    await flushReact();
    expect(container.textContent).toContain("Formulir valid");
    expect(container.textContent).toContain("Tidak ada yang disimpan");
    // Formulir validasi saja: tidak ada pemanggilan API pembuatan company.
    expect(mockBinderHeroApi.testConnection).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("menolak nama company kosong dengan pesan bahasa biasa", async () => {
    const root = await renderPage();

    act(() => {
      findButton(container, "Periksa formulir").click();
    });
    await flushReact();
    expect(container.textContent).toContain("Nama company wajib diisi.");

    act(() => {
      root.unmount();
    });
  });

  it("menampilkan dashboard kerja + finansial + scrum + model CEO", async () => {
    selectCompany();
    const root = await renderPage();

    expect(container.textContent).toContain("Hero — Company TEST");
    expect(container.textContent).toContain("Dashboard kerja");
    expect(container.textContent).toContain("Agen aktif");
    expect(container.textContent).toContain("Dashboard finansial");
    expect(container.textContent).toContain("$15.00");
    expect(container.textContent).toContain("Ledger");
    expect(container.textContent).toContain("Seimbang");
    expect(container.textContent).toContain("Amplop env-1234");
    expect(container.textContent).toContain("Progres scrum");
    expect(container.textContent).toContain("Model — CEO Edison");
    expect(container.textContent).toContain("muse-spark-1.3");
    expect(container.textContent).toContain("{env:META_API_KEY}");

    act(() => {
      root.unmount();
    });
  });

  it("Test Connection memakai kunci sementara lalu mengosongkan field", async () => {
    selectCompany();
    const root = await renderPage();

    const keyInput = container.querySelector<HTMLInputElement>("#binder-hero-tc-key");
    expect(keyInput).not.toBeNull();
    act(() => {
      setInputValue(keyInput!, "kunci-test-sementara");
      findButton(container, "Test Connection").click();
    });
    await flushReact();
    await flushReact();

    expect(mockBinderHeroApi.testConnection).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        provider: "meta",
        modelId: "muse-spark-1.3",
        apiKey: "kunci-test-sementara",
      }),
    );
    expect(container.textContent).toContain("Terhubung — Meta menjawab untuk model muse-spark-1.3.");
    // Kunci sementara tidak boleh tertinggal di field setelah dipakai.
    expect(keyInput!.value).toBe("");

    act(() => {
      root.unmount();
    });
  });

  it("Test Connection tanpa kunci memakai referensi yang terpasang", async () => {
    selectCompany();
    mockBinderHeroApi.testConnection.mockResolvedValue({
      provider: "meta",
      modelId: "muse-spark-1.3",
      status: "not_configured",
      message: "Belum ada API key untuk Meta — masukkan API key, lalu tekan Test Connection.",
      latencyMs: null,
      httpStatus: null,
    });
    const root = await renderPage();

    act(() => {
      findButton(container, "Test Connection").click();
    });
    await flushReact();
    await flushReact();

    expect(mockBinderHeroApi.testConnection).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        provider: "meta",
        modelId: "muse-spark-1.3",
        apiKeyRef: "{env:META_API_KEY}",
      }),
    );
    expect(container.textContent).toContain("Belum ada API key untuk Meta");

    act(() => {
      root.unmount();
    });
  });

  it("ganti provider Test Connection mengikuti model terdaftar", async () => {
    selectCompany();
    const root = await renderPage();

    const providerSelect = container.querySelector<HTMLSelectElement>(
      "#binder-hero-tc-provider",
    );
    const modelInput = container.querySelector<HTMLInputElement>("#binder-hero-tc-model");
    expect(providerSelect).not.toBeNull();
    expect(modelInput).not.toBeNull();
    act(() => {
      setSelectValue(providerSelect!, "anthropic");
    });
    expect(modelInput!.value).toBe("claude-sonnet-5-5");

    act(() => {
      root.unmount();
    });
  });
});
