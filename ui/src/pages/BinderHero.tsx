// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BINDER_TEST_CONNECTION_PROVIDERS,
  binderCeoModelSchema,
  createCompanySchema,
  type BinderTestConnectionResult,
} from "@paperclipai/shared";
import { binderHeroApi } from "../api/binder-hero";
import { dashboardApi } from "../api/dashboard";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { formatCents } from "../lib/utils";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "../components/PageSkeleton";
import { QueryErrorState, useQueryView } from "../components/QueryView";
import { InlineBanner } from "../components/InlineBanner";
import { ThemeToggle } from "../components/ThemeToggle";
import { Bot, LayoutDashboard, ListChecks, Wallet } from "lucide-react";

/**
 * Hero per company BINDER (PRD v1.16 Bab 6/7; rencana Tahap 3 Fase 3.5):
 * dashboard kerja + dashboard finansial + progres scrum + model CEO
 * dalam SATU halaman. Dibangun dari API Paperclip yang sudah ada
 * (`dashboardApi.summary`, `goalsApi`) + ringkasan BINDER baru
 * (pool/amplop/ledger, konfigurasi model CEO) — jangan duplikasi.
 *
 * Default KOSONG, tanpa data dummy (PRD v1.19): tanpa company → empty
 * state + formulir buat company yang HANYA memvalidasi (tidak
 * menyimpan apa pun — nama company final menunggu Patria, Tahap 6).
 * Test Connection memakai kunci sementara sekali pakai; kunci TIDAK
 * PERNAH disimpan/dicatat (P1-24). Pembuktian live dengan kunci Patria
 * adalah langkah Tahap 6/MacBook.
 */

const GOAL_STATUS_LABELS: Record<string, string> = {
  planned: "Direncanakan",
  active: "Aktif",
  achieved: "Tercapai",
  cancelled: "Dibatalkan",
};

const ENVELOPE_STATUS_LABELS: Record<string, string> = {
  proposed: "Diusulkan",
  approved: "Disetujui",
  active: "Aktif",
  exhausted: "Habis",
  escalated: "Dieskalasi",
  closed: "Ditutup",
  cancelled: "Dibatalkan",
};

const DEFAULT_API_KEY_REFS = {
  meta: "{env:META_API_KEY}",
  anthropic: "{env:ANTHROPIC_API_KEY}",
} as const;

const DEFAULT_MODEL_IDS = {
  meta: "muse-spark-1.3",
  anthropic: "claude-sonnet-5-5",
} as const;

/** Urutan gradien tile scrum (vonis Patria 8 Nov 2026 09:45 WIB):
 * 1 pink→oranye, 2 biru→ungu, 3 hijau→kuning, 4 peach→pink — berulang. */
const SCRUM_TILE_BG = [
  "bg-binder-tile-1",
  "bg-binder-tile-2",
  "bg-binder-tile-3",
  "bg-binder-tile-4",
] as const;

function SectionHeading({ icon: Icon, title }: { icon: typeof Wallet; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {title}
    </h2>
  );
}

export function BinderHero() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Hero" }]);
  }, [setBreadcrumbs]);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const dashboardView = useQueryView(dashboardQuery);

  const fundingQuery = useQuery({
    queryKey: queryKeys.binderHero.fundingSummary(selectedCompanyId!),
    queryFn: () => binderHeroApi.fundingSummary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const ceoQuery = useQuery({
    queryKey: queryKeys.binderHero.ceoModel(selectedCompanyId!),
    queryFn: () => binderHeroApi.ceoModel(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // --- Formulir buat company: VALIDASI SAJA, tidak menyimpan. ---
  const [newCompanyName, setNewCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companyCheck, setCompanyCheck] = useState<{ ok: boolean; message: string } | null>(null);

  function checkCompanyForm(event: React.FormEvent) {
    event.preventDefault();
    const result = createCompanySchema.safeParse({
      name: newCompanyName.trim(),
      description: companyDescription.trim() ? companyDescription.trim() : null,
    });
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      setCompanyCheck({
        ok: false,
        message:
          firstIssue?.path[0] === "name"
            ? "Nama company wajib diisi."
            : (firstIssue?.message ?? "Formulir belum valid — periksa kembali isian."),
      });
      return;
    }
    setCompanyCheck({
      ok: true,
      message:
        "Formulir valid — nama company final menunggu Patria (Tahap 6). Tidak ada yang disimpan.",
    });
  }

  // --- Test Connection model. ---
  const [tcProvider, setTcProvider] = useState<(typeof BINDER_TEST_CONNECTION_PROVIDERS)[number]>(
    "meta",
  );
  const [tcModelId, setTcModelId] = useState<string>(DEFAULT_MODEL_IDS.meta);
  const [tcApiKey, setTcApiKey] = useState("");
  const [tcResult, setTcResult] = useState<BinderTestConnectionResult | null>(null);
  const [tcError, setTcError] = useState<string | null>(null);

  const testConnection = useMutation({
    mutationFn: () => {
      const trimmedKey = tcApiKey.trim();
      return binderHeroApi.testConnection(selectedCompanyId!, {
        provider: tcProvider,
        modelId: tcModelId.trim(),
        ...(trimmedKey
          ? { apiKey: trimmedKey }
          : { apiKeyRef: DEFAULT_API_KEY_REFS[tcProvider] }),
      });
    },
    onSuccess: (result) => {
      setTcResult(result);
      setTcError(null);
      // Kunci sementara tidak boleh tertinggal di field setelah dipakai.
      setTcApiKey("");
    },
    onError: () => {
      setTcResult(null);
      setTcError("Tidak bisa menghubungi server — periksa koneksi, lalu coba lagi.");
      setTcApiKey("");
    },
  });

  function handleProviderChange(provider: (typeof BINDER_TEST_CONNECTION_PROVIDERS)[number]) {
    setTcProvider(provider);
    const ceo = ceoQuery.data;
    const registeredModel =
      ceo?.registered && ceo.primary?.modelFamily === provider
        ? ceo.primary.modelId
        : ceo?.registered && ceo.fallback?.modelFamily === provider
          ? ceo.fallback.modelId
          : null;
    setTcModelId(registeredModel ?? DEFAULT_MODEL_IDS[provider]);
    setTcResult(null);
    setTcError(null);
  }

  // --- Ganti model utama CEO. ---
  const [umFamily, setUmFamily] = useState<"meta" | "anthropic">("meta");
  const [umModelId, setUmModelId] = useState<string>(DEFAULT_MODEL_IDS.meta);
  const [umAdapter, setUmAdapter] = useState("opencode_local");
  const [umApiKeyRef, setUmApiKeyRef] = useState<string>(DEFAULT_API_KEY_REFS.meta);
  const [umMessage, setUmMessage] = useState<{ ok: boolean; message: string } | null>(null);

  const updateModel = useMutation({
    mutationFn: () =>
      binderHeroApi.updateCeoModel(selectedCompanyId!, {
        companyId: selectedCompanyId!,
        primaryModel: {
          modelFamily: umFamily,
          modelId: umModelId.trim(),
          provider: umAdapter,
          apiKeyRef: umApiKeyRef.trim(),
        },
      }),
    onSuccess: () => {
      setUmMessage({ ok: true, message: "Model utama diperbarui." });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.binderHero.ceoModel(selectedCompanyId!),
      });
    },
    onError: () => {
      setUmMessage({
        ok: false,
        message: "Gagal memperbarui model — periksa isian, lalu coba lagi.",
      });
    },
  });

  function submitUpdateModel(event: React.FormEvent) {
    event.preventDefault();
    const parsed = binderCeoModelSchema.safeParse({
      modelFamily: umFamily,
      modelId: umModelId.trim(),
      provider: umAdapter,
      apiKeyRef: umApiKeyRef.trim(),
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setUmMessage({
        ok: false,
        message: firstIssue?.message ?? "Isian model belum valid — periksa kembali.",
      });
      return;
    }
    setUmMessage(null);
    updateModel.mutate();
  }

  const goalsByStatus = useMemo(() => {
    const counts: Record<string, number> = { planned: 0, active: 0, achieved: 0, cancelled: 0 };
    for (const goal of goalsQuery.data ?? []) {
      counts[goal.status] = (counts[goal.status] ?? 0) + 1;
    }
    return counts;
  }, [goalsQuery.data]);

  if (!selectedCompanyId) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <EmptyState
          icon={LayoutDashboard}
          title="Belum ada company"
          message="Pilih company untuk melihat hero-nya, atau periksa formulir buat company di bawah ini. Nama company final menunggu Patria (Tahap 6) — formulir ini hanya memeriksa, tidak menyimpan apa pun."
        />
        <Card elevation="low" className="p-5">
          <form onSubmit={checkCompanyForm} className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-foreground">Buat company — periksa formulir</h2>
            <div className="flex flex-col gap-2">
              <Label htmlFor="binder-hero-company-name">Nama company</Label>
              <Input
                id="binder-hero-company-name"
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="Nama company"
                className="h-(--binder-control-height)"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="binder-hero-company-description">Deskripsi (opsional)</Label>
              <Input
                id="binder-hero-company-description"
                value={companyDescription}
                onChange={(event) => setCompanyDescription(event.target.value)}
                placeholder="Deskripsi singkat"
                className="h-(--binder-control-height)"
              />
            </div>
            <div className="flex flex-row items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Validasi saja — tidak ada yang disimpan.
              </p>
              <Button type="submit">Periksa formulir</Button>
            </div>
            {companyCheck && (
              <InlineBanner tone={companyCheck.ok ? "info" : "danger"}>
                {companyCheck.message}
              </InlineBanner>
            )}
          </form>
        </Card>
      </div>
    );
  }

  if (dashboardQuery.isLoading || dashboardView.kind === "reconnecting") {
    return <PageSkeleton variant="dashboard" />;
  }
  if (dashboardView.kind === "error") {
    return (
      <QueryErrorState
        size="page"
        error={dashboardView.error}
        action="load the hero"
        onRetry={dashboardView.retry}
      />
    );
  }

  const summary = dashboardQuery.data;
  const funding = fundingQuery.data;
  const ceo = ceoQuery.data;
  const companyName = selectedCompany?.name ?? companies.find((c) => c.id === selectedCompanyId)?.name ?? "";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">
            Hero{companyName ? ` — ${companyName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Dashboard kerja, dashboard finansial, dan progres scrum dalam satu halaman.
          </p>
        </div>
        <ThemeToggle variant="icon" />
      </header>

      <section aria-label="Dashboard kerja" className="flex flex-col gap-3">
        <SectionHeading icon={LayoutDashboard} title="Dashboard kerja" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon={Bot}
            value={summary?.agents.active ?? 0}
            label="Agen aktif"
            appearance="card"
            tone="binder-tile-1"
          />
          <MetricCard
            icon={ListChecks}
            value={summary?.tasks.open ?? 0}
            label="Tugas terbuka"
            appearance="card"
            tone="binder-tile-2"
          />
          <MetricCard
            icon={ListChecks}
            value={summary?.tasks.done ?? 0}
            label="Tugas selesai"
            appearance="card"
            tone="binder-tile-3"
          />
          <MetricCard
            icon={ListChecks}
            value={summary?.pendingApprovals ?? 0}
            label="Persetujuan menunggu"
            appearance="card"
            tone="binder-tile-4"
          />
        </div>
      </section>

      <section aria-label="Dashboard finansial" className="flex flex-col gap-3">
        <SectionHeading icon={Wallet} title="Dashboard finansial" />
        {fundingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat ringkasan dana…</p>}
        {fundingQuery.isError && (
          <InlineBanner tone="danger">
            Gagal memuat ringkasan dana — coba muat ulang halaman.
          </InlineBanner>
        )}
        {funding && !funding.pool && (
          <InlineBanner tone="info">
            Pool BINDER belum dibuat untuk company ini — top-up pertama menunggu owner.
          </InlineBanner>
        )}
        {funding?.pool && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              icon={Wallet}
              value={formatCents(funding.pool.balanceCents)}
              label="Saldo pool"
              appearance="card"
              tone="binder-tile-1"
            />
            <MetricCard
              icon={Wallet}
              value={formatCents(funding.pool.monthlyTopUpCents)}
              label="Pagu top-up bulanan"
              appearance="card"
              tone="binder-tile-2"
            />
            <MetricCard
              icon={Wallet}
              value={funding.envelopes.length}
              label="Amplop aktif"
              appearance="card"
              tone="binder-tile-3"
            />
            <MetricCard
              icon={Wallet}
              value={funding.ledgerBalanced ? "Seimbang" : "Selisih"}
              label="Ledger"
              description={
                funding.ledgerBalanced
                  ? "Saldo pool sama dengan pergerakan dana."
                  : `Selisih ${formatCents(Number(funding.ledgerDifferenceCents))} — periksa ledger.`
              }
              appearance="card"
              tone="binder-tile-4"
            />
          </div>
        )}
        {funding?.pool && funding.pool.level >= 70 && !funding.pool.exhausted && (
          <InlineBanner tone="warning">
            Pool sudah terpakai {funding.pool.level}% — pertimbangkan top-up sebelum habis.
          </InlineBanner>
        )}
        {funding?.pool?.exhausted && (
          <InlineBanner tone="danger">
            Pool habis — tugas baru tidak bisa dibiayai sampai ada top-up dari owner.
          </InlineBanner>
        )}
        {funding && funding.envelopes.length > 0 && (
          <Card elevation="low" className="p-5">
            <h3 className="mb-3 text-base font-semibold text-foreground">Amplop tugas</h3>
            <ul className="flex flex-col divide-y divide-border">
              {funding.envelopes.map((envelope) => (
                <li key={envelope.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    Amplop {envelope.id.slice(0, 8)} ·{" "}
                    {ENVELOPE_STATUS_LABELS[envelope.status] ?? envelope.status}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Jumlah {formatCents(envelope.amountCents)} · Terpakai{" "}
                    {formatCents(envelope.spentCents)} · Sisa {formatCents(envelope.remainingCents)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-label="Progres scrum" className="flex flex-col gap-3">
        <SectionHeading icon={ListChecks} title="Progres scrum" />
        {goalsQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat progres…</p>}
        {goalsQuery.isError && (
          <InlineBanner tone="danger">
            Gagal memuat progres scrum — coba muat ulang halaman.
          </InlineBanner>
        )}
        {goalsQuery.data && (
          <Card elevation="low" className="p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(goalsByStatus).map(([status, count], index) => (
                <div
                  key={status}
                  className={`flex flex-col gap-1 rounded-lg px-3 py-2 ${SCRUM_TILE_BG[index % SCRUM_TILE_BG.length]}`}
                >
                  <p className="text-2xl font-semibold text-binder-tile-ink tabular-nums">{count}</p>
                  <p className="text-sm font-medium text-binder-tile-ink-2">
                    Goal {GOAL_STATUS_LABELS[status] ?? status}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1 rounded-lg bg-binder-tile-1 px-3 py-2">
                <p className="text-2xl font-semibold text-binder-tile-ink tabular-nums">
                  {summary?.tasks.open ?? 0}
                </p>
                <p className="text-sm font-medium text-binder-tile-ink-2">Tugas terbuka</p>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-binder-tile-2 px-3 py-2">
                <p className="text-2xl font-semibold text-binder-tile-ink tabular-nums">
                  {summary?.tasks.inProgress ?? 0}
                </p>
                <p className="text-sm font-medium text-binder-tile-ink-2">Tugas berjalan</p>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-binder-tile-3 px-3 py-2">
                <p className="text-2xl font-semibold text-binder-tile-ink tabular-nums">
                  {summary?.tasks.blocked ?? 0}
                </p>
                <p className="text-sm font-medium text-binder-tile-ink-2">Tugas terblokir</p>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-binder-tile-4 px-3 py-2">
                <p className="text-2xl font-semibold text-binder-tile-ink tabular-nums">
                  {summary?.tasks.done ?? 0}
                </p>
                <p className="text-sm font-medium text-binder-tile-ink-2">Tugas selesai</p>
              </div>
            </div>
          </Card>
        )}
      </section>

      <section aria-label="Model CEO" className="flex flex-col gap-3">
        <SectionHeading icon={Bot} title="Model — CEO Edison" />
        {ceoQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat konfigurasi model…</p>}
        {ceoQuery.isError && (
          <InlineBanner tone="danger">
            Gagal memuat konfigurasi model — coba muat ulang halaman.
          </InlineBanner>
        )}
        {ceo && !ceo.registered && (
          <InlineBanner tone="info">
            CEO Edison belum terdaftar di company ini.
          </InlineBanner>
        )}
        {ceo?.registered && ceo.primary && (
          <Card elevation="low" className="p-5">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex flex-row justify-between gap-3">
                <dt className="text-muted-foreground">Model utama</dt>
                <dd className="font-medium text-foreground">
                  {ceo.primary.modelId} ({ceo.primary.modelFamily} via {ceo.primary.provider})
                </dd>
              </div>
              <div className="flex flex-row justify-between gap-3">
                <dt className="text-muted-foreground">Referensi kunci utama</dt>
                <dd className="font-mono text-foreground">{ceo.primary.apiKeyRef}</dd>
              </div>
              {ceo.fallback && (
                <div className="flex flex-row justify-between gap-3">
                  <dt className="text-muted-foreground">Fallback</dt>
                  <dd className="font-medium text-foreground">
                    {ceo.fallback.modelId} ({ceo.fallback.modelFamily} via {ceo.fallback.provider})
                  </dd>
                </div>
              )}
              <div className="flex flex-row justify-between gap-3">
                <dt className="text-muted-foreground">Runtime</dt>
                <dd className="font-medium text-foreground">{ceo.runtimeDefault ?? "—"}</dd>
              </div>
              <div className="flex flex-row justify-between gap-3">
                <dt className="text-muted-foreground">Budget bulanan</dt>
                <dd className="font-medium text-foreground">
                  {ceo.budgetMonthlyCents !== null ? formatCents(ceo.budgetMonthlyCents) : "—"}
                </dd>
              </div>
            </dl>
          </Card>
        )}

        <Card elevation="low" className="p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setTcResult(null);
              setTcError(null);
              testConnection.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <h3 className="text-base font-semibold text-foreground">Test Connection</h3>
            <p className="text-sm text-muted-foreground">
              Masukkan API key, tekan Test Connection, dan lihat hasilnya — semudah mengirim
              pesan. Kunci dipakai sekali untuk panggilan uji ini saja dan tidak disimpan.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-tc-provider">Provider</Label>
                <select
                  id="binder-hero-tc-provider"
                  value={tcProvider}
                  onChange={(event) =>
                    handleProviderChange(
                      event.target.value as (typeof BINDER_TEST_CONNECTION_PROVIDERS)[number],
                    )
                  }
                  className="h-(--binder-control-height) w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                >
                  <option value="meta">Meta</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-tc-model">Model</Label>
                <Input
                  id="binder-hero-tc-model"
                  value={tcModelId}
                  onChange={(event) => setTcModelId(event.target.value)}
                  className="h-(--binder-control-height)"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="binder-hero-tc-key">API key (opsional)</Label>
              <Input
                id="binder-hero-tc-key"
                type="password"
                value={tcApiKey}
                onChange={(event) => setTcApiKey(event.target.value)}
                placeholder="Kosongkan untuk memakai key yang sudah terpasang di server"
                autoComplete="off"
                className="h-(--binder-control-height)"
              />
              <p className="text-sm text-muted-foreground">
                Kosongkan bila key sudah terpasang di server — statusnya akan terbaca sebagai
                “belum terhubung” bila belum ada.
              </p>
            </div>
            <div className="flex flex-row items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {testConnection.isPending
                  ? "Menghubungi provider…"
                  : tcResult
                    ? `Hasil terakhir: ${tcResult.status === "ok" ? "terhubung" : tcResult.status === "not_configured" ? "belum terhubung" : "gagal"}${tcResult.latencyMs !== null ? ` (${tcResult.latencyMs} ms)` : ""}`
                    : "Belum ada percobaan."}
              </p>
              <Button type="submit" disabled={testConnection.isPending || !tcModelId.trim()}>
                Test Connection
              </Button>
            </div>
            {tcResult && (
              <InlineBanner
                tone={
                  tcResult.status === "ok"
                    ? "info"
                    : tcResult.status === "not_configured"
                      ? "warning"
                      : "danger"
                }
              >
                {tcResult.message}
              </InlineBanner>
            )}
            {tcError && <InlineBanner tone="danger">{tcError}</InlineBanner>}
          </form>
        </Card>

        <Card elevation="low" className="p-5">
          <form onSubmit={submitUpdateModel} className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-foreground">Ganti model utama</h3>
            <p className="text-sm text-muted-foreground">
              Ganti model berarti ganti konfigurasi, bukan ganti kode. Pergantian tetap hanya
              di checkpoint. Kunci disimpan hanya sebagai referensi — bukan nilainya.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-um-family">Family model</Label>
                <select
                  id="binder-hero-um-family"
                  value={umFamily}
                  onChange={(event) => {
                    const family = event.target.value as "meta" | "anthropic";
                    setUmFamily(family);
                    setUmModelId(DEFAULT_MODEL_IDS[family]);
                    setUmAdapter(family === "meta" ? "opencode_local" : "claude_local");
                    setUmApiKeyRef(DEFAULT_API_KEY_REFS[family]);
                  }}
                  className="h-(--binder-control-height) w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                >
                  <option value="meta">Meta</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-um-model">Model</Label>
                <Input
                  id="binder-hero-um-model"
                  value={umModelId}
                  onChange={(event) => setUmModelId(event.target.value)}
                  className="h-(--binder-control-height)"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-um-adapter">Adapter</Label>
                <select
                  id="binder-hero-um-adapter"
                  value={umAdapter}
                  onChange={(event) => setUmAdapter(event.target.value)}
                  className="h-(--binder-control-height) w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                >
                  <option value="opencode_local">opencode_local</option>
                  <option value="claude_local">claude_local</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="binder-hero-um-keyref">Referensi kunci</Label>
                <Input
                  id="binder-hero-um-keyref"
                  value={umApiKeyRef}
                  onChange={(event) => setUmApiKeyRef(event.target.value)}
                  placeholder="{env:META_API_KEY}"
                  autoComplete="off"
                  className="h-(--binder-control-height)"
                />
              </div>
            </div>
            <div className="flex flex-row items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Hanya board yang bisa mengganti model.
              </p>
              <Button type="submit" disabled={updateModel.isPending || !ceo?.registered}>
                Simpan model utama
              </Button>
            </div>
            {umMessage && (
              <InlineBanner tone={umMessage.ok ? "info" : "danger"}>{umMessage.message}</InlineBanner>
            )}
          </form>
        </Card>
      </section>
    </div>
  );
}
