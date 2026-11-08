import { models as anthropic } from "@paperclipai/adapter-claude-local";
import { models as openai } from "@paperclipai/shared";
import { geminiModels as google } from "@paperclipai/shared/gemini-cli-models";
import { grokModels as xai } from "@paperclipai/shared/grok-cli-models";
import type { AiConnectionMetadata } from "@paperclipai/shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [], github: [] }[connection.provider];
}
