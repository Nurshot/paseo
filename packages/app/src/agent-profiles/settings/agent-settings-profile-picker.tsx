import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/ui/select-field";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";

export function AgentSettingsProfilePicker({
  serverId,
  value,
  onSelect,
  disabled,
}: {
  serverId: string | null;
  value?: string;
  onSelect?: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "agentSettingsProfiles");
  const { config } = useDaemonConfig(serverId);
  const bundle = config?.agentSettingsProfiles;
  const options = useMemo(
    () =>
      bundle?.profiles.map((profile) => ({
        id: profile.id,
        value: profile.id,
        label: profile.name,
        testID: `chat-settings-profile-${profile.id}`,
      })) ?? [],
    [bundle],
  );
  const selected = options.find((option) => option.id === value);
  if (!supported || !bundle || !onSelect) return null;
  return (
    <View style={styles.control}>
      <SelectField
        label={t("settings.host.agentSettingsProfiles.title")}
        value={value ?? null}
        selectedDisplay={selected ?? null}
        options={options}
        onChange={onSelect}
        placeholder={t("settings.host.agentSettingsProfiles.title")}
        emptyText={t("settings.host.agentProfiles.emptyState")}
        disabled={disabled}
        field={false}
        size="sm"
        triggerTestID="chat-settings-profile-selector"
      />
    </View>
  );
}

const styles = StyleSheet.create(() => ({ control: { maxWidth: 180, flexShrink: 1 } }));

export function AgentSettingsProfileLabel({ name }: { name?: string }) {
  return name ? (
    <Text style={labelStyles.text} numberOfLines={1} testID="chat-settings-profile-name">
      {name}
    </Text>
  ) : null;
}

const labelStyles = StyleSheet.create((theme) => ({
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, maxWidth: 180 },
}));
