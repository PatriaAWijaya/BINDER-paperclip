// @vitest-environment jsdom

// Regression guard (audit Tahap 3 Fase 3.6): with 0 companies, the BINDER
// hero empty state ("Belum ada company") was unreachable — /hero fell
// through to the global NotFound ("Page not found") because no unprefixed
// `hero` route existed, and /:companyPrefix/hero could never match
// without a company prefix. The unprefixed `hero` route in <App> is the
// only way in. This drives the real <App> route table so a future removal
// of that route fails loudly. It does NOT create a company: the form on
// the empty state only validates (company final name waits for Patria,
// Tahap 6).

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// jsdom's CSS parser rejects the custom-property marker rule stitches inserts
// (`--sxs{--sxs:N}`), pulled into <App>'s eager import graph transitively via
// @codesandbox/sandpack-react. Substitute a benign, valid rule on parse failure
// so stitches' index bookkeeping stays intact and the module graph evaluates.
// (sandpack itself is never exercised by the routing under test.)
vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __papHeroRoutingPatched?: boolean;
  };
  if (!sheetProto.__papHeroRoutingPatched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".pap-hero-routing-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__papHeroRoutingPatched = true;
  }
});

// Real Layout renders the full authenticated shell (sidebar, data queries) and
// owns the "No company matches prefix" NotFound. For routing we only need it to
// resolve the :companyPrefix segment and render its nested routes.
vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});

// Rendered by <App> outside <Routes> and needs DialogProvider; irrelevant here.
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));

// Cloud access is unrelated to the route-table regression. Let it fall through
// synchronously so this test does not poll its three query transitions.
vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});

// BinderHero reads breadcrumbs; the providers live in main.tsx, not <App>.
vi.mock("./context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// The real theme toggle needs ThemeProvider (main.tsx); routing is not it.
vi.mock("./components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

// No companies at all: the BINDER starting state (PRD v1.19).
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [],
    selectedCompanyId: null,
    selectedCompany: null,
    setSelectedCompanyId: vi.fn(),
    loading: false,
    error: null,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

async function renderAppAt(container: HTMLElement, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { root, queryClient };
}

/**
 * Waits on the condition, not on a fixed number of turns (same fix #11499
 * as the sibling App routing tests: a loaded worker gets more turns rather
 * than a failure on a route that resolves perfectly well).
 */
async function waitForRoute(container: HTMLElement, text: string) {
  await vi.waitFor(() => expect(container.textContent).toContain(text));
}

describe("App BINDER hero routing (audit Fase 3.6)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the hero empty state at unprefixed /hero with 0 companies", async () => {
    const { root, queryClient } = await renderAppAt(container, "/hero");
    await waitForRoute(container, "Belum ada company");
    expect(container.textContent).not.toContain("Page not found");
    expect(container.textContent).toContain("Periksa formulir");
    flushSync(() => root.unmount());
    queryClient.clear();
  });

  it("renders the hero empty state at /:companyPrefix/hero with 0 companies", async () => {
    const { root, queryClient } = await renderAppAt(container, "/PAP/hero");
    await waitForRoute(container, "Belum ada company");
    expect(container.textContent).not.toContain("Page not found");
    flushSync(() => root.unmount());
    queryClient.clear();
  });
});
