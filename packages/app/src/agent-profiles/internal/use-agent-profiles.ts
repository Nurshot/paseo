import { useCallback } from "react";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";
import { supportsAgentProfiles } from "./capabilities";

export interface UseAgentProfilesResult {
  /** `null` until the daemon config has arrived. */
  profiles: AgentProfile[] | null;
  /** False on daemons that predate agent profiles, or while disconnected. */
  isSupported: boolean;
  /** Writes the whole list; there is no per-profile RPC. */
  saveProfiles: (next: AgentProfile[]) => Promise<void>;
}

export function useAgentProfiles(
  serverId: string | null,
  settingsProfileId?: string,
): UseAgentProfilesResult {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore((state) => {
    return supportsAgentProfiles(state.sessions[serverId ?? ""]?.serverInfo?.features);
  });

  const saveProfiles = useCallback(
    async (next: AgentProfile[]) => {
      if (!settingsProfileId || !config?.agentSettingsProfiles) {
        if (settingsProfileId && settingsProfileId !== "default")
          throw new Error("Agent settings profile does not exist");
        await patchConfig({ agentProfiles: next });
        return;
      }
      const bundle = config?.agentSettingsProfiles;
      const profile = bundle?.profiles.find((entry) => entry.id === settingsProfileId);
      if (!bundle || !profile) throw new Error("Agent settings profile does not exist");
      const edited = { ...profile, settings: { ...profile.settings, agentProfiles: next } };
      await patchConfig({
        agentSettingsProfiles: {
          ...bundle,
          profiles: bundle.profiles.map((entry) => (entry.id === profile.id ? edited : entry)),
        },
      });
    },
    [config?.agentSettingsProfiles, patchConfig, settingsProfileId],
  );

  const configuredProfiles =
    settingsProfileId && config?.agentSettingsProfiles
      ? config?.agentSettingsProfiles?.profiles.find((profile) => profile.id === settingsProfileId)
          ?.settings.agentProfiles
      : config?.agentProfiles;
  return {
    profiles: config ? (configuredProfiles ?? []) : null,
    isSupported,
    saveProfiles,
  };
}
