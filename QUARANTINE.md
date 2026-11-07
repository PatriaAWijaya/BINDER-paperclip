# KARANTINA — Jangan dipakai BINDER Fase 1, jangan dihapus dulu

> Dibuat Fase 3.1 (7 Nov 2026, branch `binder/tahap3`).
> Status: **BEKU — tidak dipakai, tidak dihapus.** Penghapusan hanya sesudah
> audit dependensi + fase penghapusan khusus (bukan Tahap 3).

Aturan:
1. **JANGAN dipakai** — tidak ada company/case/chat-channel/plugin pihak ketiga
   yang dibuat atau dikonfigurasi di BINDER Fase 1.
2. **JANGAN dihapus di Tahap 3** — audit dependensi Fase 3.1 membuktikan
   ketiganya terjalin dalam ke kode inti (lihat bukti di bawah).
3. Penonaktifan UI ditunda (bukan bagian Fase 3.1): "jangan dipakai" dicapai
   dengan tidak pernah membuat/memakainya di Fase 1; pencabutan entri UI
   adalah perubahan perilaku untuk fase berikutnya (Fase 3.5/3.6 atau
   setelahnya), bukan cleanup.
4. Pengecualian yang TETAP dipakai sebagai prosedur (bukan sebagai kanal):
   pola `follow-up-results` dan `delegate-work` dari riset skill Tahap 1.

## 1. Sistem `cases` — KARANTINA

- Tabel: `cases`, `pipeline_cases`, `pipeline_case_events`, `case-handoffs`
  (`packages/db/src/schema/cases.ts`, `pipeline_cases.ts`,
  `pipeline_case_events.ts`).
- Route: `server/src/routes/cases.ts`, `case-handoffs.ts`, `cases-schemas.ts`.
- Bukti audit (7 Nov 2026): **93 file sumber non-test** di `server/src` +
  `ui/src` menyebut `cases`; `server/src/app.ts` me-mount route cases;
  pemakai langsung di luar schema/routes antara lain
  `server/src/services/case-handoff-delivery.ts`,
  `server/src/services/case-workflows.ts`,
  `server/src/services/native-runtime/native-case-tools.ts`,
  `server/src/services/native-runtime/paperclip-runner-tool-authority.ts`,
  `packages/shared/src/workflows.ts`.
- Alasan karantina: BINDER memakai Goal → Task, bukan cases — tetapi
  penghapusan sekarang akan merusak build (dependensi tersebar di
  heartbeat, runner authority, dan shared workflows).
- Syarat hapus nanti: audit ulang membuktikan tidak ada route/service yang
  memakainya + fase penghapusan khusus dengan typecheck penuh.

## 2. Kanal chat — KARANTINA

- Tabel: `chat_channels`, `chat_completion_deliveries`,
  `chat_discord_command_owners`, `chat_github`, `chat_slack_manager_grants`,
  `chat_slack_registrations`, `chat_teams_file_transfers`,
  `chat_telegram_draft_ids`, `chat_voice_callbacks`, `chat_voice_inbound`,
  `chat_voice_reports`, `chat_voice_sessions`.
- Route: `server/src/routes/chat-channels.ts` (+ `agent-chat-messages.ts`,
  `board-chat.ts` — board chat internal BUKAN kanal eksternal).
- Bukti audit (7 Nov 2026): puluhan service di `server/src/services/`
  (Slack, Discord, Telegram, Teams, GitHub, voice, webhook, publikasi,
  notifikasi) + test integrasi + helper; permukaan jauh di luar kebutuhan
  Fase 1 (tanpa konektor kirim eksternal untuk CEO).
- Alasan karantina: penghapusan sekarang akan merusak build dan menghapus
  infrastruktur notifikasi internal yang masih dipakai jalur lain
  (mis. `board-chat`, `agent-chat-messages`).
- Syarat hapus nanti: pemisahan kanal eksternal dari chat internal +
  audit ulang + fase penghapusan khusus.

## 3. Plugin system — KARANTINA (struktur dipertahankan)

- Struktur: `packages/plugins/` (`sdk`, `sandbox-providers`,
  `plugin-llm-wiki`, `plugin-workspace-diff`, `examples`,
  `create-paperclip-plugin`, `paperclip-plugin-fake-sandbox`).
- Tabel: `plugins`, `plugin_config`, `plugin_state`, `plugin_jobs`,
  `plugin_logs`, `plugin_webhooks`, `plugin_entities`, `plugin_database`,
  `plugin_managed_resources`, `plugin_lifecycle_acknowledgments`,
  `plugin_company_settings`.
- Route: `server/src/routes/plugins.ts`, `plugin-ui-static.ts`.
- Aturan Fase 1: struktur dipertahankan (BINDER memakai pola plugin untuk
  adapter); **tidak ada plugin pihak ketiga yang diaktifkan**.
- Syarat hapus/ubah nanti: keputusan arsitektur plugin BINDER (Tahap 5+).
