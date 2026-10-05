import { z } from "zod";

export const AgentSettingsSchema = z.object({
  appendSystemPrompt: z.string(),
  mcp: z.object({ injectIntoAgents: z.boolean() }),
  browserTools: z.object({ enabled: z.boolean() }),
});

export const AgentSettingsProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  settings: AgentSettingsSchema,
});

export type AgentSettingsProfile = z.infer<typeof AgentSettingsProfileSchema>;

export const AgentSettingsProfilesSchema = z.object({
  activeProfileId: z.string().min(1),
  profiles: z.array(AgentSettingsProfileSchema).min(1),
});

export type AgentSettingsProfiles = z.infer<typeof AgentSettingsProfilesSchema>;
