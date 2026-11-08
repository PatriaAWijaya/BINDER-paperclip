import express from "express";
import { unprocessable, forbidden } from "../errors.js";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ServerAdapterModule } from "../adapters/index.js";
import type { RunnerTarget } from "../services/agent-runner-selection.js";

const mockAdapterPluginStore = vi.hoisted(() => ({
  listAdapterPlugins: vi.fn(),
  addAdapterPlugin: vi.fn(),
  removeAdapterPlugin: vi.fn(),
  getAdapterPluginByType: vi.fn(),
  getAdapterPluginsDir: vi.fn(),
  getDisabledAdapterTypes: vi.fn(),
  setAdapterDisabled: vi.fn(),
}));

const mockPluginLoader = vi.hoisted(() => ({
  buildExternalAdapters: vi.fn(),
  loadExternalAdapterPackage: vi.fn(),
  getUiParserSource: vi.fn(),
  getOrExtractUiParserSource: vi.fn(),
  reloadExternalAdapter: vi.fn(),
}));
const mockCandidateAdmission = vi.hoisted(() => vi.fn());

const overridingConfigSchemaAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
  testEnvironment: async () => ({
    adapterType: "claude_local",
    status: "pass",
    checks: [],
    testedAt: new Date(0).toISOString(),
  }),
  getConfigSchema: async () => ({
    version: 1,
    fields: [
      {
        key: "mode",
        type: "text",
        label: "Mode",
      },
    ],
  }),
};

let registerServerAdapter: typeof import("../adapters/registry.js").registerServerAdapter;
let unregisterServerAdapter: typeof import("../adapters/registry.js").unregisterServerAdapter;
let findServerAdapter: typeof import("../adapters/registry.js").findServerAdapter;
let findActiveServerAdapter: typeof import("../adapters/registry.js").findActiveServerAdapter;
let setOverridePaused: typeof import("../adapters/registry.js").setOverridePaused;
let adapterRoutes: typeof import("../routes/adapters.js").adapterRoutes;
let errorHandler: typeof import("../middleware/index.js").errorHandler;

function registerModuleMocks() {
  vi.doMock("../services/native-runtime/acpx-qualification.js", async () => ({
    ...await vi.importActual("../services/native-runtime/acpx-qualification.js"),
    resolveAntigravityCandidateAdmission: mockCandidateAdmission,
  }));
  vi.doMock("node:child_process", async () => vi.importActual("node:child_process"));
  vi.doMock("../adapters/plugin-loader.js", () => mockPluginLoader);
  vi.doMock("../services/adapter-plugin-store.js", () => mockAdapterPluginStore);
}

function resetAdapterMocks() {
  vi.resetAllMocks();
  mockAdapterPluginStore.listAdapterPlugins.mockReturnValue([]);
  mockAdapterPluginStore.addAdapterPlugin.mockResolvedValue(undefined);
  mockAdapterPluginStore.removeAdapterPlugin.mockReturnValue(false);
  mockAdapterPluginStore.getAdapterPluginByType.mockReturnValue(undefined);
  mockAdapterPluginStore.getAdapterPluginsDir.mockReturnValue("/tmp/paperclip-adapter-routes-test");
  mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue([]);
  mockAdapterPluginStore.setAdapterDisabled.mockReturnValue(false);
  mockPluginLoader.buildExternalAdapters.mockResolvedValue([]);
  mockPluginLoader.loadExternalAdapterPackage.mockResolvedValue(null);
  mockPluginLoader.getUiParserSource.mockResolvedValue(null);
  mockPluginLoader.getOrExtractUiParserSource.mockResolvedValue(null);
  mockPluginLoader.reloadExternalAdapter.mockResolvedValue(null);
}

function createApp(
  actorOverrides: Partial<Express.Request["actor"]> = {},
  options: Parameters<typeof adapterRoutes>[0] = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: [],
      source: "local_implicit",
      isInstanceAdmin: false,
      ...actorOverrides,
    };
    next();
  });
  app.use("/api", adapterRoutes(options));
  app.use(errorHandler);
  return app;
}

describe("adapter routes", () => {
  // Keep the route and middleware on one module graph so HttpError retains
  // its identity. Reset mock state and adapter overrides between tests.
  beforeAll(async () => {
    registerModuleMocks();
    resetAdapterMocks();
    const registry = await import("../adapters/registry.js");
    const routes = await import("../routes/adapters.js");
    const middleware = await import("../middleware/index.js");
    registerServerAdapter = registry.registerServerAdapter;
    unregisterServerAdapter = registry.unregisterServerAdapter;
    findServerAdapter = registry.findServerAdapter;
    findActiveServerAdapter = registry.findActiveServerAdapter;
    setOverridePaused = registry.setOverridePaused;
    adapterRoutes = routes.adapterRoutes;
    errorHandler = middleware.errorHandler;
  });

  beforeEach(() => {
    resetAdapterMocks();
    setOverridePaused("claude_local", false);
    unregisterServerAdapter("hermes_local");
    unregisterServerAdapter("claude_local");
    registerServerAdapter(overridingConfigSchemaAdapter);
  });

  afterEach(() => {
    setOverridePaused("claude_local", false);
    unregisterServerAdapter("hermes_local");
    unregisterServerAdapter("claude_local");
  });

  it("GET /api/adapters includes capabilities object for each adapter", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters");
    expect(res.status).toBe(200);
    const adapters = Array.isArray(res.body) ? res.body : JSON.parse(res.text);
    expect(Array.isArray(adapters)).toBe(true);
    expect(adapters.length).toBeGreaterThan(0);

    // Every adapter should have a capabilities object
    for (const adapter of adapters) {
      expect(adapter.capabilities).toBeDefined();
      expect(typeof adapter.capabilities.supportsInstructionsBundle).toBe("boolean");
      expect(typeof adapter.capabilities.supportsSkills).toBe("boolean");
      expect(typeof adapter.capabilities.supportsLocalAgentJwt).toBe("boolean");
      expect(typeof adapter.capabilities.requiresMaterializedRuntimeSkills).toBe("boolean");
      expect(typeof adapter.capabilities.supportsAcp).toBe("boolean");
    }
  });
  it("projects only the enabled company-local candidate and exact model", async () => {
    mockCandidateAdmission.mockImplementation(({ companyId }) => companyId === "company-1"
      ? { agent: "antigravity", model: "exact-google-model", profileDigest: "private-profile", nativeClosureDigest: "private-closure" } : undefined);
    const local = createApp({}, { resolveRunnerTarget: async () => ({ driver: "local" }) });
    const scoped = await request(local).get("/api/adapters?companyId=company-1");
    expect(scoped.status).toBe(200);
    expect(scoped.body.find((adapter: any) => adapter.type === "paperclip_runner").candidateHarnesses)
      .toEqual([{ agent: "antigravity", model: "exact-google-model" }]);
    expect(JSON.stringify(scoped.body)).not.toContain("private-profile");
    expect(JSON.stringify(scoped.body)).not.toContain("private-closure");
    for (const query of ["", "?companyId=other-company"]) {
      const response = await request(local).get(`/api/adapters${query}`);
      expect(response.status).toBe(200);
      expect(response.body.every((adapter: any) => adapter.candidateHarnesses === undefined)).toBe(true);
    }
    const remote = await request(createApp({}, { resolveRunnerTarget: async () => ({ driver: "ssh" }) }))
      .get("/api/adapters?companyId=company-1&environmentId=remote");
    expect(remote.body.every((adapter: any) => adapter.candidateHarnesses === undefined)).toBe(true);
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["paperclip_runner"]);
    const disabled = await request(local).get("/api/adapters?companyId=company-1");
    expect(disabled.body.find((adapter: any) => adapter.type === "paperclip_runner").candidateHarnesses).toBeUndefined();
  });

  it("keeps ordinary adapter discovery available after candidate startup authority expires", async () => {
    mockCandidateAdmission.mockImplementation(() => { throw new Error("ACPX candidate startup authorization expired"); });
    const app = createApp({}, { resolveRunnerTarget: async () => ({ driver: "local" }) });
    const response = await request(app).get("/api/adapters?companyId=company-1");
    expect(response.status).toBe(200);
    expect(response.body.some((adapter: any) => adapter.type === "claude_local")).toBe(true);
    expect(response.body.every((adapter: any) => adapter.candidateHarnesses === undefined)).toBe(true);
  });

  it("warns once without startup payloads for malformed candidate authority, while expiry stays quiet", async () => {
    const { logger } = await import("../middleware/logger.js");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const app = createApp({}, { resolveRunnerTarget: async () => ({ driver: "local" }) });
    try {
      mockCandidateAdmission.mockImplementation(() => { throw new Error("ACPX candidate startup authorization expired"); });
      expect((await request(app).get("/api/adapters?companyId=company-1")).status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
      mockCandidateAdmission.mockImplementation(() => { throw new Error("Invalid Antigravity candidate admission"); });
      for (let index = 0; index < 2; index++) {
        const response = await request(app).get("/api/adapters?companyId=company-1");
        expect(response.status).toBe(200);
        expect(response.body.every((adapter: any) => adapter.candidateHarnesses === undefined)).toBe(true);
      }
      expect(warn).toHaveBeenCalledExactlyOnceWith({ code: "ANTIGRAVITY_CANDIDATE_ADMISSION_INVALID" }, "Invalid Google Antigravity preview authorization");
    } finally { warn.mockRestore(); }
  });

  it("keeps the shared runner implementation available for Codex without the experimental flag", async () => {
    const disabledResponse = await request(createApp()).get("/api/adapters");
    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.body.find((adapter: any) => adapter.type === "paperclip_runner"))
      .toMatchObject({ disabled: false });

    const enabledResponse = await request(createApp({}, {
      getNativeRunnerEnabled: async () => true,
    })).get("/api/adapters");
    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.body.find((adapter: any) => adapter.type === "paperclip_runner"))
      .toMatchObject({
        disabled: false,
        capabilities: {
          supportsInstructionsBundle: true,
        },
      });
  });

  it.each<[RunnerTarget, string]>([
    [{ driver: "ssh", platform: "linux", architecture: "x64" }, "paperclip"],
    [{ driver: "ssh", platform: "darwin", architecture: "arm64" }, "paperclip"],
    [{ driver: "ssh", platform: "darwin", architecture: "x64" }, "paperclip"],
    [{ driver: "ssh", platform: "linux", architecture: "arm64" }, "legacy"],
    [{ driver: "ssh", platform: "linux", architecture: "arm" }, "legacy"],
    [{ driver: "local", platform: "win32", architecture: "x64" }, "legacy"],
    [{ driver: "sandbox", platform: "linux", architecture: "arm64", libc: "glibc", glibcVersion: "2.39" }, "legacy"],
  ])("projects the selected environment once for the whole adapter inventory (%s)", async (target, defaultRunner) => {
    const resolveRunnerTarget = vi.fn(async () => target);
    const response = await request(createApp({}, { resolveRunnerTarget })).get("/api/adapters?companyId=company-1&environmentId=selected");
    expect(response.status).toBe(200);
    expect(resolveRunnerTarget).toHaveBeenCalledExactlyOnceWith("company-1", "selected");
    // The runner-capable example is now `opencode_local`: the Codex CLI entry
    // died with the adapter deletion, and the OpenCode CLI is the remaining
    // runner harness whose default follows the target (paperclip where the
    // runner supports the platform, legacy elsewhere). Unlike the Codex CLI,
    // the OpenCode CLI ships no linux/arm64 build, so those rows are legacy.
    expect(response.body.find((adapter: any) => adapter.type === "opencode_local")).toMatchObject({ defaultRunner });
    expect(response.body.find((adapter: any) => adapter.type === "claude_local")).toMatchObject({ defaultRunner: "legacy" });
  });

  it("uses the company's effective default environment when discovery omits an override", async () => {
    const resolveRunnerTarget = vi.fn(async () => ({ driver: "sandbox" }));
    const response = await request(createApp({}, { resolveRunnerTarget })).get("/api/adapters?companyId=company-1");
    expect(response.status).toBe(200);
    expect(resolveRunnerTarget).toHaveBeenCalledExactlyOnceWith("company-1", undefined);
    expect(response.body.find((adapter: any) => adapter.type === "opencode_local")).toMatchObject({ defaultRunner: "legacy" });
  });

  it("keeps unscoped inventory independent of company target discovery", async () => {
    const resolveRunnerTarget = vi.fn();
    const response = await request(createApp({}, { resolveRunnerTarget })).get("/api/adapters");
    expect(response.status).toBe(200);
    expect(resolveRunnerTarget).not.toHaveBeenCalled();
  });

  it("rejects a foreign company before selecting or probing an environment", async () => {
    const resolveRunnerTarget = vi.fn();
    const response = await request(createApp({ source: "session", companyIds: ["allowed"] }, { resolveRunnerTarget })).get("/api/adapters?companyId=foreign&environmentId=selected");
    expect(response.status).toBe(403);
    expect(resolveRunnerTarget).not.toHaveBeenCalled();
  });

  it("keeps the adapter inventory available without granting local support when the implicit managed Computer is unavailable", async () => {
    // The `cursor_cloud` entry died with the adapter deletion: Cursor API
    // discovery no longer surfaces as its own inventory entry. What remains
    // observable is the route behavior: the catalog stays visible (200, not
    // 422) when only the implicit managed Computer is unavailable, and no
    // entry grants local execution support.
    const unavailable = unprocessable("Managed Computer unavailable", { code: "managed_sandbox_unavailable" });
    const app = createApp({}, { resolveRunnerTarget: async () => { throw unavailable; } });
    const response = await request(app).get("/api/adapters?companyId=company-1");
    expect(response.status).toBe(200);
    expect(response.body.find((adapter: any) => adapter.type === "cursor_cloud")).toBeUndefined();
    expect(response.body.find((adapter: any) => adapter.type === "opencode_local").supportedRunners).toEqual([]);
    expect(response.body.every((adapter: any) => adapter.supportedRunners.length === 0)).toBe(true);
    const explicit = await request(app).get("/api/adapters?companyId=company-1&environmentId=selected");
    expect(explicit.status).toBe(422);
    const foreign = await request(createApp({}, { resolveRunnerTarget: async () => { throw forbidden("Foreign Computer", { code: "environment_company_mismatch" }); } })).get("/api/adapters?companyId=company-1");
    expect(foreign.status).toBe(403);
  });

  it("offers no Paperclip runner under Kubernetes-only policy, including the unavailable managed Computer fallback", async () => {
    // The `cursor_cloud` entry died with the adapter deletion, so the
    // Kubernetes-only policy is now observed on the remaining inventory:
    // no entry offers the Paperclip runner (defaultRunner stays legacy).
    for (const resolveRunnerTarget of [
      async () => ({ driver: "sandbox", executionMode: "kubernetes" as const }),
      async () => { throw unprocessable("Managed Computer unavailable", { code: "managed_sandbox_unavailable", executionMode: "kubernetes" }); },
    ]) {
      const response = await request(createApp({}, { resolveRunnerTarget })).get("/api/adapters?companyId=company-1");
      expect(response.status).toBe(200);
      expect(response.body.find((adapter: any) => adapter.type === "cursor_cloud")).toBeUndefined();
      expect(response.body.every((adapter: any) => adapter.defaultRunner === "legacy")).toBe(true);
    }
  });

  it.each(["environmentId=selected", "companyId=", "companyId=one&companyId=two", "companyId=one&environmentId="])("rejects malformed discovery scope before resolution (%s)", async query => {
    const resolveRunnerTarget = vi.fn();
    const response = await request(createApp({}, { resolveRunnerTarget })).get(`/api/adapters?${query}`);
    expect(response.status).toBe(400);
    expect(resolveRunnerTarget).not.toHaveBeenCalled();
  });

  it("keeps the shared implementation available for Dot independently, while honoring adapter-admin disabling", async () => {
    const options = { getNativeRunnerEnabled: async () => false, getOpenAiDotEnabled: async () => true };
    const enabled = await request(createApp({}, options)).get("/api/adapters");
    expect(enabled.body.find((adapter: any) => adapter.type === "paperclip_runner")).toMatchObject({ disabled: false });
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["paperclip_runner"]);
    const disabled = await request(createApp({}, options)).get("/api/adapters");
    expect(disabled.body.find((adapter: any) => adapter.type === "paperclip_runner")).toMatchObject({ disabled: true });
  });

  it("GET /api/adapters returns correct capabilities for built-in adapters", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters");
    expect(res.status).toBe(200);

    // opencode_local has instructions bundle + skills + jwt, with materialized
    // skills and no ACP (claude_local is overridden by beforeEach, so check
    // opencode_local instead). The Codex ACP entry died with the adapter.
    const openCodeLocal = res.body.find((a: any) => a.type === "opencode_local");
    expect(openCodeLocal).toBeDefined();
    expect(openCodeLocal.capabilities).toMatchObject({
      supportsInstructionsBundle: true,
      supportsSkills: true,
      supportsLocalAgentJwt: true,
      requiresMaterializedRuntimeSkills: true,
      supportsAcp: false,
    });
    expect(openCodeLocal.acp).toBeUndefined();

    // process adapter should have no local capabilities
    const processAdapter = res.body.find((a: any) => a.type === "process");
    expect(processAdapter).toBeDefined();
    expect(processAdapter.capabilities).toMatchObject({
      supportsInstructionsBundle: false,
      supportsSkills: false,
      supportsLocalAgentJwt: true,
      requiresMaterializedRuntimeSkills: false,
      supportsAcp: false,
    });

    // paperclip_runner has instructions bundle + skills, no local JWT, no
    // materialized skills, no ACP.
    const runnerAdapter = res.body.find((a: any) => a.type === "paperclip_runner");
    expect(runnerAdapter).toBeDefined();
    expect(runnerAdapter.capabilities).toMatchObject({
      supportsInstructionsBundle: true,
      supportsSkills: true,
      supportsLocalAgentJwt: false,
      requiresMaterializedRuntimeSkills: false,
      supportsAcp: false,
    });
    expect(runnerAdapter.acp).toBeUndefined();

    // http adapter has no local capabilities at all.
    const httpAdapter = res.body.find((a: any) => a.type === "http");
    expect(httpAdapter).toBeDefined();
    expect(httpAdapter.capabilities).toMatchObject({
      supportsInstructionsBundle: false,
      supportsSkills: false,
      supportsLocalAgentJwt: false,
      requiresMaterializedRuntimeSkills: false,
      supportsAcp: false,
    });

    // acpx_local remains registered only as a tombstone for legacy rows.
    const acpxLocal = res.body.find((a: any) => a.type === "acpx_local");
    expect(acpxLocal).toBeDefined();
    expect(acpxLocal.source).toBe("builtin");
    expect(acpxLocal.capabilities).toMatchObject({
      supportsInstructionsBundle: false,
      supportsSkills: false,
      supportsLocalAgentJwt: false,
      requiresMaterializedRuntimeSkills: false,
      supportsAcp: false,
    });

    // The cursor, gemini_local, grok_local, kimi_local, hermes_local, and
    // hermes_gateway blocks lived here. Deleted with the adapter deletion,
    // 8 Nov 2026: those adapters no longer exist in the inventory, and their
    // capability profiles (including the Codex/Gemini/Kimi ACP entries) died
    // with them. `claude_local` is deliberately not asserted here either:
    // beforeEach overrides it with a minimal module, so its inventory
    // capabilities reflect the override, not the real adapter.
  });

  it("GET /api/adapters derives supportsSkills from listSkills/syncSkills presence", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters");
    expect(res.status).toBe(200);

    // http adapter has no listSkills/syncSkills
    const httpAdapter = res.body.find((a: any) => a.type === "http");
    expect(httpAdapter).toBeDefined();
    expect(httpAdapter.capabilities.supportsSkills).toBe(false);

    // opencode_local has listSkills/syncSkills
    const openCodeLocal = res.body.find((a: any) => a.type === "opencode_local");
    expect(openCodeLocal).toBeDefined();
    expect(openCodeLocal.capabilities.supportsSkills).toBe(true);

    // acpx_local remains registered only as a tombstone for legacy rows.
    const acpxLocal = res.body.find((a: any) => a.type === "acpx_local");
    expect(acpxLocal).toBeDefined();
    expect(acpxLocal.capabilities.supportsSkills).toBe(false);
  });

  it("uses the active adapter when resolving config schema for a paused builtin override", async () => {
    const app = createApp();

    const active = await request(app).get("/api/adapters/claude_local/config-schema");
    expect(active.status, JSON.stringify(active.body)).toBe(200);
    expect(active.body).toMatchObject({
      fields: [{ key: "mode" }],
    });

    const paused = await request(app)
      .patch("/api/adapters/claude_local/override")
      .send({ paused: true });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);

    const builtin = await request(app).get("/api/adapters/claude_local/config-schema");
    expect([200, 404], JSON.stringify(builtin.body)).toContain(builtin.status);
    expect(builtin.body).not.toMatchObject({
      fields: [{ key: "mode" }],
    });
  });

  it("serves an empty tombstone config schema for retired acpx_local", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters/acpx_local/config-schema");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields).toEqual([]);
  });

  it("serves provider-scoped Paperclip Runner configuration fields", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters/paperclip_runner/config-schema");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "provider",
        options: expect.arrayContaining([
          expect.objectContaining({ value: "codex" }),
          expect.objectContaining({ value: "opencode" }),
          expect.objectContaining({ value: "claude_managed" }),
          expect.objectContaining({ value: "aws_agentcore" }),
          expect.objectContaining({ value: "acpx" }),
        ]),
      }),
      expect.objectContaining({
        key: "codexPermissionMode",
        default: "never",
        meta: { visibleWhen: { key: "provider", value: "codex" } },
      }),
      expect.objectContaining({
        key: "opencodePermissionMode",
        default: "allow",
        meta: { visibleWhen: { key: "provider", value: "opencode" } },
      }),
      expect.objectContaining({
        key: "acpxPermissionMode",
        default: "approve-all",
        meta: { visibleWhen: { key: "provider", value: "acpx" } },
      }),
      expect.objectContaining({
        key: "model",
        meta: { visibleWhen: { key: "provider", value: "opencode" } },
      }),
      expect.objectContaining({
        key: "idleTimeoutMs",
        meta: { visibleWhen: { key: "lifecycleMode", value: "warm" } },
      }),
    ]));
    const acpxAgent = res.body.fields.find((field: { key?: string }) => field.key === "acpxAgent");
    expect(acpxAgent).toMatchObject({
      type: "select",
      default: "claude",
      meta: { visibleWhen: { key: "provider", value: "acpx" } },
      options: [
        { value: "grok", label: "Grok Build" },
        { value: "claude", label: "Claude" },
        { value: "cursor", label: "Cursor" },
        { value: "copilot", label: "GitHub Copilot" },
        { value: "pi", label: "Pi" },
        { value: "kimi", label: "Kimi Code" },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain("Codex via ACPX");
  });

  it("serves the built-in claude_local ACP engine config schema", async () => {
    const app = createApp();

    const paused = await request(app)
      .patch("/api/adapters/claude_local/override")
      .send({ paused: true });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);

    const res = await request(app).get("/api/adapters/claude_local/config-schema");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "engine",
          default: "auto",
          options: expect.arrayContaining([
            expect.objectContaining({ value: "auto" }),
            expect.objectContaining({ value: "cli" }),
            expect.objectContaining({ value: "acp" }),
          ]),
        }),
        expect.objectContaining({
          key: "agentCommand",
          meta: { visibleWhen: { key: "engine", values: ["acp"] } },
        }),
        expect.objectContaining({
          key: "warmHandleIdleMs",
          default: 0,
        }),
      ]),
    );
  });

  // Three builtin config-schema tests lived here (codex_local, gemini_local,
  // hermes_local + hermes_gateway). Their adapters have no registry entry
  // anymore, so the route no longer serves their schemas. The kept schemas
  // (claude_local, Paperclip Runner, acpx tombstone) are covered by the
  // neighbouring tests. Deleted with the adapter deletion, 8 Nov 2026.

  it("GET /api/adapters lists acpx_local only as a model-less tombstone", async () => {
    const app = createApp();

    const res = await request(app).get("/api/adapters");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const acpxLocal = res.body.find((a: any) => a.type === "acpx_local");
    expect(acpxLocal).toBeDefined();
    expect(acpxLocal.modelsCount).toBe(0);
  });

  it("rejects signed-in users without org access", async () => {
    const app = createApp({
      userId: "outsider-1",
      source: "session",
      companyIds: [],
      memberships: [],
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/adapters/claude_local/config-schema");

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("POST /api/adapters/install preserves module-provided sessionManagement (hot-install parity with init-time IIFE)", async () => {
    const HOT_INSTALL_TYPE = "hot_install_session_test";
    const declaredSessionManagement = {
      supportsSessionResume: true,
      nativeContextManagement: "confirmed" as const,
      defaultSessionCompaction: {
        enabled: true,
        maxSessionRuns: 10,
        maxRawInputTokens: 100_000,
        maxSessionAgeHours: 24,
      },
    };
    const externalModule: ServerAdapterModule = {
      type: HOT_INSTALL_TYPE,
      execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
      testEnvironment: async () => ({
        adapterType: HOT_INSTALL_TYPE,
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      sessionManagement: declaredSessionManagement,
    };
    mockPluginLoader.loadExternalAdapterPackage.mockResolvedValue(externalModule);

    const app = createApp({ isInstanceAdmin: true });
    const res = await request(app)
      .post("/api/adapters/install")
      .send({ packageName: "/tmp/fake-hot-install-adapter", isLocalPath: true });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.type).toBe(HOT_INSTALL_TYPE);

    const registered = findServerAdapter(HOT_INSTALL_TYPE);
    expect(registered).not.toBeNull();
    expect(registered?.sessionManagement).toEqual(declaredSessionManagement);

    unregisterServerAdapter(HOT_INSTALL_TYPE);
  });

  it("POST /api/adapters/install allows an external adapter to override a builtin type", async () => {
    // The overridden builtin is `opencode_local`: `codex_local` died with the
    // adapter deletion, and `claude_local` is overridden by beforeEach.
    const builtin = findServerAdapter("opencode_local");
    expect(builtin).not.toBeNull();

    const externalModule: ServerAdapterModule = {
      type: "opencode_local",
      execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
      testEnvironment: async () => ({
        adapterType: "opencode_local",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "plugin-opencode", label: "Plugin OpenCode" }],
    };
    mockPluginLoader.loadExternalAdapterPackage.mockResolvedValue(externalModule);

    const app = createApp({ isInstanceAdmin: true });
    const res = await request(app)
      .post("/api/adapters/install")
      .send({ packageName: "/tmp/fake-opencode-override", isLocalPath: true });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.type).toBe("opencode_local");
    const registeredOverride = findServerAdapter("opencode_local");
    expect(registeredOverride).toMatchObject({
      type: "opencode_local",
      models: [{ id: "plugin-opencode", label: "Plugin OpenCode" }],
    });

    setOverridePaused("opencode_local", true);
    expect(findActiveServerAdapter("opencode_local")).toBe(builtin);

    mockAdapterPluginStore.getAdapterPluginByType.mockReturnValue({
      type: "opencode_local",
      packageName: undefined,
      localPath: "/tmp/fake-opencode-override",
      installedAt: new Date(0).toISOString(),
    });
    mockAdapterPluginStore.removeAdapterPlugin.mockReturnValue(true);

    const removed = await request(app).delete("/api/adapters/opencode_local");
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body).toMatchObject({ type: "opencode_local", removed: true });

    unregisterServerAdapter("opencode_local");
    expect(findServerAdapter("opencode_local")).toBe(builtin);
    setOverridePaused("opencode_local", false);
  });

});
