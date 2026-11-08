import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { companiesApi } from "../api/companies";
import { queryKeys } from "../lib/queryKeys";
import { QueryErrorState } from "../components/QueryView";
import { formatCents, relativeTime } from "../lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Check,
  X,
  Plus,
  MoreHorizontal,
  Trash2,
  Users,
  CircleDot,
  DollarSign,
  Calendar,
  Archive,
  ArchiveRestore,
} from "lucide-react";

export function Companies() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    loading,
    error,
    retryCompanies,
  } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  // A cloud stack holds exactly one company; creating another is a 403 floor
  // server-side, so the wizard entry point is hidden rather than dead-ending.
  const isCloud = Boolean(useCloudInstance());

  const { data: stats } = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
  });

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeepCleanId, setConfirmDeepCleanId] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      companiesApi.update(id, { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      setConfirmDeleteId(null);
      setConfirmDeepCleanId(null);
    },
  });

  // "Archive only the name": the organization leaves the active list, but
  // every agent, skill and task stays intact in the archive until the user
  // decides to deep clean. This reuses the existing archive endpoint — it
  // never deletes anything.
  const archiveMutation = useMutation({
    mutationFn: (id: string) => companiesApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      setConfirmDeleteId(null);
    },
  });

  // Unarchiving previously had no UI at all: archiving happens in company
  // settings, but an archived company disappears from the sidebar switcher,
  // so its settings page — and with it any way back — was only reachable by
  // hand-typed URL. This list is the one place that still shows archived
  // companies, so restoration lives here.
  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => companiesApi.update(id, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Organizations" }]);
  }, [setBreadcrumbs]);

  function startEdit(companyId: string, currentName: string) {
    setEditingId(companyId);
    setEditName(currentName);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    editMutation.mutate({ id: editingId, newName: editName.trim() });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {isCloud ? null : (
          <Button size="sm" onClick={() => openOnboarding()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Organization
          </Button>
        )}
      </div>

      <div className="min-h-6">
        {loading && <p className="text-sm text-muted-foreground">Loading organizations...</p>}
        {error ? (
          <QueryErrorState size="inline" error={error} action="load organizations" onRetry={() => void retryCompanies()} />
        ) : null}
      </div>

      <div className="grid gap-4">
        {companies.map((company) => {
          const selected = company.id === selectedCompanyId;
          const isEditing = editingId === company.id;
          const isConfirmingDelete = confirmDeleteId === company.id;
          const isConfirmingDeepClean = confirmDeepCleanId === company.id;
          const companyStats = stats?.[company.id];
          const agentCount = companyStats?.agentCount ?? 0;
          const issueCount = companyStats?.issueCount ?? 0;
          const budgetPct =
            company.budgetMonthlyCents > 0
              ? Math.round(
                  (company.spentMonthlyCents / company.budgetMonthlyCents) * 100,
                )
              : 0;

          return (
            <Card
              key={company.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedCompanyId(company.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedCompanyId(company.id);
                }
              }}
              interactive
              className={`block group text-left p-5 ${
                selected ? "border-primary ring-1 ring-primary hover:border-primary" : ""
              }`}
            >
              {/* Header row: name + menu */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={saveEdit}
                        disabled={editMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base">{company.name}</h3>
                      <Badge variant="ghost"
                        className={`text-(length:--text-micro) ${
                          company.status === "active"
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : company.status === "paused"
                              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {company.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(company.id, company.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {company.description && !isEditing && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {company.description}
                    </p>
                  )}
                </div>

                {/* Three-dot menu */}
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => startEdit(company.id, company.name)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      {company.status === "archived" && (
                        <DropdownMenuItem
                          disabled={unarchiveMutation.isPending}
                          onClick={() => unarchiveMutation.mutate(company.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Unarchive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {company.status === "archived" ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setConfirmDeepCleanId(company.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Deep clean
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setConfirmDeleteId(company.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete Organization
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 sm:gap-5 mt-4 text-sm text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <span>
                    {agentCount} {agentCount === 1 ? "agent" : "agents"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5" />
                  <span>
                    {issueCount} {issueCount === 1 ? "task" : "tasks"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 tabular-nums">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>
                    {formatCents(company.spentMonthlyCents)}
                    {company.budgetMonthlyCents > 0
                      ? <> / {formatCents(company.budgetMonthlyCents)} <span className="text-xs">({budgetPct}%)</span></>
                      : <span className="text-xs ml-1">Unlimited budget</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {relativeTime(company.createdAt)}</span>
                </div>
              </div>

              {/* Removal choice: archive only the name, or deep clean */}
              {isConfirmingDelete && (
                <div
                  className="mt-4 bg-destructive/5 border border-destructive/20 rounded-md px-4 py-3 space-y-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm font-medium">
                    How should this organization be removed?
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Archive only the name.
                        </span>{" "}
                        The organization leaves the active list, but all of its
                        data — agents, skills, tasks — stays intact in the
                        archive until you decide to deep clean. You can restore
                        it later.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => archiveMutation.mutate(company.id)}
                        disabled={archiveMutation.isPending || deleteMutation.isPending}
                      >
                        <Archive className="h-3.5 w-3.5" />
                        {archiveMutation.isPending ? "Archiving…" : "Archive only the name"}
                      </Button>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-destructive">
                          Deep clean — delete permanently.
                        </span>{" "}
                        The organization and all of its data are deleted. This
                        cannot be undone.
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="shrink-0"
                        onClick={() => deleteMutation.mutate(company.id)}
                        disabled={archiveMutation.isPending || deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deleteMutation.isPending ? "Deleting…" : "Deep clean"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={archiveMutation.isPending || deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Deep clean confirmation for an already-archived organization */}
              {isConfirmingDeepClean && (
                <div
                  className="mt-4 flex items-center justify-between bg-destructive/5 border border-destructive/20 rounded-md px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-destructive font-medium">
                    Deep clean this archived organization and all its data? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeepCleanId(null)}
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(company.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Deep clean"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
