// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { Companies } from "./Companies";

const mockCompaniesApi = vi.hoisted(() => ({
  stats: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));
const mockOpenOnboarding = vi.hoisted(() => vi.fn());
const mockCompanyState = vi.hoisted(() => ({
  companies: [
    {
      id: "company-1",
      issuePrefix: "PAP",
      name: "Acme Labs",
      status: "active",
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
    },
  ],
}));

vi.mock("../api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mockCompanyState.companies,
    selectedCompanyId: "company-1",
    setSelectedCompanyId: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openOnboarding: mockOpenOnboarding }),
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

const CLOUD_HEALTH = {
  status: "ok" as const,
  cloud: {
    managed: true as const,
    managedBy: "paperclip-cloud" as const,
    stackSlug: "acme-labs",
    cloudBaseUrl: "https://cloud.example.test",
  },
};

describe("Companies page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompanyState.companies = [
      {
        id: "company-1",
        issuePrefix: "PAP",
        name: "Acme Labs",
        status: "active",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      },
    ];
    mockCompaniesApi.stats.mockResolvedValue({});
    mockCompaniesApi.archive.mockResolvedValue({ id: "company-1", status: "archived" });
    mockCompaniesApi.remove.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderPage({ cloud }: { cloud?: boolean } = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (cloud) queryClient.setQueryData(queryKeys.health, CLOUD_HEALTH);
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Companies />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    return root;
  }

  it("offers the company wizard when self-hosted", async () => {
    const root = await renderPage();

    expect(container.textContent).toContain("New Organization");

    act(() => {
      root.unmount();
    });
  });

  it("hides the company wizard on a cloud-managed instance", async () => {
    const root = await renderPage({ cloud: true });

    // Cloud stacks hold exactly one company and POST /companies is a 403 floor,
    // so the entry point must not be offered at all.
    expect(container.textContent).not.toContain("New Organization");
    expect(container.textContent).toContain("Acme Labs");
    expect(mockOpenOnboarding).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  // The three-dot menu trigger is the only button carrying Radix's data-state.
  async function openCardMenu() {
    const trigger = container.querySelector('button[data-state="closed"]');
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
  }

  function menuItem(label: string) {
    return Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.includes(label),
    );
  }

  async function clickMenuItem(label: string) {
    const item = menuItem(label);
    expect(item).not.toBeUndefined();
    act(() => {
      item?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
  }

  function dialogButton(label: string) {
    return Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(label),
    );
  }

  async function clickDialogButton(label: string) {
    const button = dialogButton(label);
    expect(button).not.toBeUndefined();
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
  }

  it("offers archive-only and deep clean as two removal types", async () => {
    const root = await renderPage();
    await openCardMenu();
    await clickMenuItem("Delete Organization");

    // The old single confirmation ("Delete this organization and all its
    // data?") is gone: the dialog now offers both removal types.
    expect(container.textContent).toContain("How should this organization be removed?");
    expect(container.textContent).toContain("Archive only the name");
    expect(container.textContent).toContain("Deep clean");
    expect(container.textContent).not.toContain("Delete this organization and all its data?");

    await clickDialogButton("Archive only the name");

    expect(mockCompaniesApi.archive).toHaveBeenCalledWith("company-1");
    expect(mockCompaniesApi.remove).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("deep cleans when the permanent option is chosen", async () => {
    const root = await renderPage();
    await openCardMenu();
    await clickMenuItem("Delete Organization");
    await clickDialogButton("Deep clean");

    expect(mockCompaniesApi.remove).toHaveBeenCalledWith("company-1");
    expect(mockCompaniesApi.archive).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("offers deep clean with its own confirmation for an archived organization", async () => {
    mockCompanyState.companies = [
      {
        id: "company-1",
        issuePrefix: "PAP",
        name: "Acme Labs",
        status: "archived",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      },
    ];
    const root = await renderPage();
    await openCardMenu();

    // An archived organization is already in the archive, so the menu offers
    // deep clean directly — not the two-type removal dialog — while restore
    // stays available.
    expect(menuItem("Deep clean")).not.toBeUndefined();
    expect(menuItem("Delete Organization")).toBeUndefined();
    expect(menuItem("Unarchive")).not.toBeUndefined();

    await clickMenuItem("Deep clean");

    expect(container.textContent).toContain(
      "Deep clean this archived organization and all its data? This cannot be undone.",
    );

    await clickDialogButton("Deep clean");

    expect(mockCompaniesApi.remove).toHaveBeenCalledWith("company-1");
    expect(mockCompaniesApi.archive).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
