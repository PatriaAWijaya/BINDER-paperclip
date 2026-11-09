// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  Issue,
  PostizBatchPushResult,
  PostizSyncResult,
  PostizTestConnectionResult,
} from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { postizApi } from "../api/postiz";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "../components/PageSkeleton";
import { QueryErrorState } from "../components/QueryView";
import { InlineBanner } from "../components/InlineBanner";
import { CalendarDays, Link2 } from "lucide-react";

/**
 * Kalender jadwal BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md;
 * Fase A: tampilkan jadwal + form koneksi Postiz + Test Connection;
 * Fase B: kirim batch ke Postiz sebagai draft lewat Gate + sync
 * status).
 *
 * BINDER adalah sumber kebenaran jadwal: halaman ini membaca issue
 * yang punya `dueDate` dan menampilkannya per hari (WIB). Postiz
 * adalah kanal tayang — batch dikirim sebagai DRAFT (bukan langsung
 * tayang); penjadwalan tayang (promosi draf ke jadwal) adalah Fase C.
 *
 * Default KOSONG, tanpa data dummy (PRD v1.19): tanpa issue terjadwal
 * → empty state. Test Connection memakai kunci sementara sekali pakai;
 * kunci TIDAK PERNAH disimpan/dicatat (P1-24). Pembuktian live dengan
 * instance self-hosted + kunci Patria adalah langkah Fase C.
 */

const POSTIZ_STATE_LABELS: Record<string, string> = {
  belum_dikirim: "Belum dikirim",
  draft: "Draf",
  terjadwal: "Terjadwal",
  tayang: "Tayang",
  gagal: "Gagal",
};

/** Alamat default instance Postiz self-hosted (aturan hosting umum 9 Nov 2026). */
const DEFAULT_POSTIZ_BASE_URL = "http://localhost:5000";

const dayFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
});

function wibDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function groupByDay(scheduled: Issue[]): Array<{ key: string; date: Date; items: Issue[] }> {
  const groups = new Map<string, { date: Date; items: Issue[] }>();
  for (const issue of scheduled) {
    const date = new Date(issue.dueDate as Date);
    const key = wibDayKey(date);
    const group = groups.get(key) ?? { date, items: [] };
    group.items.push(issue);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function BinderCalendar() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Kalender" }]);
  }, [setBreadcrumbs]);

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 500 }),
    enabled: !!selectedCompanyId,
  });

  const scheduled = useMemo(() => {
    const rows = (issuesQuery.data ?? []).filter((issue) => issue.dueDate);
    return rows.sort(
      (a, b) => new Date(a.dueDate as Date).getTime() - new Date(b.dueDate as Date).getTime(),
    );
  }, [issuesQuery.data]);
  const unscheduled = useMemo(
    () => (issuesQuery.data ?? []).filter((issue) => !issue.dueDate),
    [issuesQuery.data],
  );
  const dayGroups = useMemo(() => groupByDay(scheduled), [scheduled]);

  // --- Batch Postiz (Fase B): kirim batch sebagai draft lewat Gate. ---
  // Issue yang bisa dikirim = punya tanggal tayang + belum pernah dikirim.
  const pushable = useMemo(
    () => scheduled.filter((issue) => !issue.postizPostId),
    [scheduled],
  );
  const [batchApprovedActionId, setBatchApprovedActionId] = useState("");
  const [batchIntegrationId, setBatchIntegrationId] = useState("");
  const [batchApiKey, setBatchApiKey] = useState("");
  const [batchResult, setBatchResult] = useState<PostizBatchPushResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<PostizSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const batchPush = useMutation({
    mutationFn: () => {
      const trimmedKey = batchApiKey.trim();
      return postizApi.batchPush(selectedCompanyId!, {
        approvedActionId: batchApprovedActionId.trim(),
        issueIds: pushable.map((issue) => issue.id),
        integrationId: batchIntegrationId.trim(),
        baseUrl: postizBaseUrl.trim(),
        ...(trimmedKey ? { apiKey: trimmedKey } : { apiKeyRef: "{env:POSTIZ_API_KEY}" }),
      });
    },
    onSuccess: (result) => {
      setBatchResult(result);
      setBatchError(null);
      setBatchApiKey("");
      // State postiz di issue berubah — muat ulang daftar.
      void issuesQuery.refetch();
    },
    onError: () => {
      setBatchResult(null);
      setBatchError("Tidak bisa menghubungi server — periksa koneksi, lalu coba lagi.");
      setBatchApiKey("");
    },
  });

  const syncRange = useMemo(() => {
    if (scheduled.length === 0) return null;
    const first = new Date(scheduled[0].dueDate as Date);
    const last = new Date(scheduled[scheduled.length - 1].dueDate as Date);
    const end = new Date(last.getTime() + 24 * 60 * 60 * 1000);
    return { startDate: first.toISOString(), endDate: end.toISOString() };
  }, [scheduled]);

  const syncPostiz = useMutation({
    mutationFn: () => {
      const trimmedKey = batchApiKey.trim();
      return postizApi.sync(selectedCompanyId!, {
        baseUrl: postizBaseUrl.trim(),
        ...(trimmedKey ? { apiKey: trimmedKey } : { apiKeyRef: "{env:POSTIZ_API_KEY}" }),
        startDate: syncRange!.startDate,
        endDate: syncRange!.endDate,
      });
    },
    onSuccess: (result) => {
      setSyncResult(result);
      setSyncError(null);
      setBatchApiKey("");
      void issuesQuery.refetch();
    },
    onError: () => {
      setSyncResult(null);
      setSyncError("Tidak bisa menghubungi server — periksa koneksi, lalu coba lagi.");
      setBatchApiKey("");
    },
  });

  function submitBatchPush(event: React.FormEvent) {
    event.preventDefault();
    setBatchResult(null);
    setBatchError(null);
    batchPush.mutate();
  }

  function submitSync(event: React.FormEvent) {
    event.preventDefault();
    setSyncResult(null);
    setSyncError(null);
    syncPostiz.mutate();
  }

  const batchOutcomeLabels: Record<string, string> = {
    pushed: "Terkirim sebagai draf",
    skipped: "Dilewati",
    failed: "Gagal",
    already_pushed: "Sudah dikirim",
  };

  // --- Koneksi Postiz: form + Test Connection. ---
  const [postizBaseUrl, setPostizBaseUrl] = useState(DEFAULT_POSTIZ_BASE_URL);
  const [postizApiKey, setPostizApiKey] = useState("");
  const [postizResult, setPostizResult] = useState<PostizTestConnectionResult | null>(null);
  const [postizError, setPostizError] = useState<string | null>(null);

  const testPostizConnection = useMutation({
    mutationFn: () => {
      const trimmedKey = postizApiKey.trim();
      return postizApi.testConnection(selectedCompanyId!, {
        baseUrl: postizBaseUrl.trim(),
        ...(trimmedKey ? { apiKey: trimmedKey } : { apiKeyRef: "{env:POSTIZ_API_KEY}" }),
      });
    },
    onSuccess: (result) => {
      setPostizResult(result);
      setPostizError(null);
      // Kunci sementara tidak boleh tertinggal di field setelah dipakai.
      setPostizApiKey("");
      // Isi channel batch dari hasil uji bila field masih kosong.
      if (!batchIntegrationId && result.integrations && result.integrations.length > 0) {
        setBatchIntegrationId(result.integrations[0].id);
      }
    },
    onError: () => {
      setPostizResult(null);
      setPostizError("Tidak bisa menghubungi server — periksa koneksi, lalu coba lagi.");
      setPostizApiKey("");
    },
  });

  function submitPostizTest(event: React.FormEvent) {
    event.preventDefault();
    setPostizResult(null);
    setPostizError(null);
    testPostizConnection.mutate();
  }

  if (!selectedCompanyId) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <EmptyState
          icon={CalendarDays}
          title="Belum ada company"
          message="Pilih company untuk melihat kalender jadwalnya."
        />
      </div>
    );
  }

  if (issuesQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <PageSkeleton />
      </div>
    );
  }

  if (issuesQuery.isError) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <QueryErrorState error={issuesQuery.error} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Kalender jadwal</h1>
        <p className="text-sm text-muted-foreground">
          {selectedCompany?.name ?? "Company"} — post yang sudah punya tanggal tayang.
          Batch dikirim ke Postiz sebagai draf (bukan langsung tayang); penjadwalan
          tayang menyusul di Fase C.
        </p>
      </header>

      {dayGroups.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Belum ada post terjadwal"
          message="Belum ada issue dengan tanggal tayang di company ini. Tanggal tayang diisi dari rencana campaign (mis. 12 post Saleem) atau dari detail issue."
        />
      ) : (
        dayGroups.map((group) => (
          <Card key={group.key} elevation="low" className="p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              {dayFormatter.format(group.date)}
            </h2>
            <ul className="flex flex-col gap-3">
              {group.items.map((issue) => (
                <li key={issue.id} className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
                  <span className="text-sm font-medium text-foreground">
                    {timeFormatter.format(new Date(issue.dueDate as Date))} WIB — {issue.identifier ?? issue.title}
                  </span>
                  <span className="text-sm text-muted-foreground">{issue.title}</span>
                  <span className="text-sm text-muted-foreground">
                    Status: {issue.status} · Postiz:{" "}
                    {POSTIZ_STATE_LABELS[issue.postizState ?? "belum_dikirim"] ??
                      (issue.postizState ?? "belum_dikirim")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      {unscheduled.length > 0 && (
        <Card elevation="low" className="p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Belum dijadwalkan ({unscheduled.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {unscheduled.slice(0, 10).map((issue) => (
              <li key={issue.id} className="text-sm text-muted-foreground">
                {issue.identifier ?? issue.title} — {issue.title}
              </li>
            ))}
          </ul>
          {unscheduled.length > 10 && (
            <p className="mt-2 text-sm text-muted-foreground">
              …dan {unscheduled.length - 10} issue lain tanpa tanggal tayang.
            </p>
          )}
        </Card>
      )}

      <Card elevation="low" className="p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
          <Link2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          Koneksi Postiz
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Postiz adalah kanal tayang (self-hosted dulu, sesuai aturan hosting umum 9 Nov 2026;
          cloud cukup ganti alamat, tanpa ubah kode). Instance Postiz belum ada — deployment
          menyusul. Kunci API dipakai sekali untuk uji ini saja, tidak disimpan.
        </p>
        <form onSubmit={submitPostizTest} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="postiz-base-url">Alamat instance Postiz</Label>
            <Input
              id="postiz-base-url"
              value={postizBaseUrl}
              onChange={(event) => setPostizBaseUrl(event.target.value)}
              placeholder="http://localhost:5000"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="postiz-api-key">API key Postiz</Label>
            <Input
              id="postiz-api-key"
              type="password"
              value={postizApiKey}
              onChange={(event) => setPostizApiKey(event.target.value)}
              placeholder="Kosongkan bila sudah terpasang sebagai {env:POSTIZ_API_KEY}"
              autoComplete="off"
            />
          </div>
          <div>
            <Button type="submit" disabled={testPostizConnection.isPending}>
              {testPostizConnection.isPending ? "Menguji…" : "Uji koneksi"}
            </Button>
          </div>
        </form>
        {postizResult && (
          <div className="mt-4">
            <InlineBanner
              tone={postizResult.status === "ok" ? "info" : postizResult.status === "not_configured" ? "info" : "danger"}
            >
              {postizResult.message}
            </InlineBanner>
            {postizResult.integrations && postizResult.integrations.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {postizResult.integrations.map((integration) => (
                  <li key={integration.id} className="text-sm text-muted-foreground">
                    {integration.name}
                    {integration.provider ? ` (${integration.provider})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {postizError && (
          <div className="mt-4">
            <InlineBanner tone="danger">{postizError}</InlineBanner>
          </div>
        )}
      </Card>

      <Card elevation="low" className="p-5">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Batch Postiz</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Kirim {pushable.length} post terjadwal yang belum dikirim ke Postiz sebagai draf.
          Batch hanya jalan dengan persetujuan owner: CEO menyiapkan pengajuan batch,
          owner menyetujui, lalu masukkan approved_action_id di sini. Tanpa id yang
          valid, Gate menolak — tidak ada satu pun post yang terkirim. Draft yang
          dibuat belum punya visual (baru arahan visual di issue) — tambahkan visual
          di Postiz sebelum dijadwalkan.
        </p>
        <form onSubmit={submitBatchPush} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="postiz-approved-action-id">approved_action_id batch</Label>
            <Input
              id="postiz-approved-action-id"
              value={batchApprovedActionId}
              onChange={(event) => setBatchApprovedActionId(event.target.value)}
              placeholder="UUID approved_action_id yang diterbitkan owner"
              autoComplete="off"
            />
            {!batchApprovedActionId.trim() && (
              <p className="text-sm text-muted-foreground">
                Menunggu persetujuan batch — tombol kirim aktif sesudah id dimasukkan.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="postiz-integration-id">Channel Postiz (integration id)</Label>
            <Input
              id="postiz-integration-id"
              value={batchIntegrationId}
              onChange={(event) => setBatchIntegrationId(event.target.value)}
              placeholder="Diisi otomatis dari hasil Uji koneksi"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="postiz-batch-api-key">API key Postiz (untuk batch ini)</Label>
            <Input
              id="postiz-batch-api-key"
              type="password"
              value={batchApiKey}
              onChange={(event) => setBatchApiKey(event.target.value)}
              placeholder="Kosongkan bila sudah terpasang sebagai {env:POSTIZ_API_KEY}"
              autoComplete="off"
            />
          </div>
          <div>
            <Button
              type="submit"
              disabled={
                batchPush.isPending ||
                pushable.length === 0 ||
                !batchApprovedActionId.trim() ||
                !batchIntegrationId.trim()
              }
            >
              {batchPush.isPending ? "Mengirim…" : "Kirim batch ke Postiz"}
            </Button>
          </div>
        </form>
        {batchResult && (
          <div className="mt-4 flex flex-col gap-2">
            <InlineBanner tone={batchResult.error ? "danger" : "info"}>
              {batchResult.error
                ? `Batch berhenti di tengah — ${batchResult.error}`
                : `Batch selesai — ${batchResult.pushed} terkirim, ${batchResult.skipped} dilewati, ${batchResult.alreadyPushed} sudah dikirim sebelumnya.`}
            </InlineBanner>
            <ul className="flex flex-col gap-1">
              {batchResult.results.map((item) => (
                <li key={item.issueId} className="text-sm text-muted-foreground">
                  {batchOutcomeLabels[item.outcome] ?? item.outcome}
                  {item.mediaMissing ? " (tanpa media)" : ""}
                  {item.reason ? ` — ${item.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {batchError && (
          <div className="mt-4">
            <InlineBanner tone="danger">{batchError}</InlineBanner>
          </div>
        )}
        <form onSubmit={submitSync} className="mt-4 flex flex-col gap-4 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Sinkronkan status dari Postiz (draf → terjadwal → tayang) ke issue di halaman
            ini. Sync hanya membaca — status issue BINDER tidak diubah otomatis.
          </p>
          <div>
            <Button type="submit" disabled={syncPostiz.isPending || !syncRange}>
              {syncPostiz.isPending ? "Menyinkronkan…" : "Sinkronkan status Postiz"}
            </Button>
          </div>
        </form>
        {syncResult && (
          <div className="mt-4">
            <InlineBanner tone="info">
              {`Diperiksa ${syncResult.checked} post di Postiz — ${syncResult.updated} state diperbarui.`}
              {syncResult.unknown.length > 0
                ? ` ${syncResult.unknown.length} post punya state yang tidak dikenal dan dibiarkan.`
                : ""}
            </InlineBanner>
          </div>
        )}
        {syncError && (
          <div className="mt-4">
            <InlineBanner tone="danger">{syncError}</InlineBanner>
          </div>
        )}
      </Card>
    </div>
  );
}
