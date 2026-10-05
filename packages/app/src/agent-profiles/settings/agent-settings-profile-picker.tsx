import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react-native";
import { type ComboboxOption, Combobox, ComboboxItem } from "@/components/ui/combobox";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";

const SEARCH_THRESHOLD = 8;

function renderProfileOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={`chat-settings-profile-${option.id}`}
    />
  );
}

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
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo<ComboboxOption[]>(
    () =>
      bundle?.profiles.map((profile) => ({
        id: profile.id,
        label: profile.name,
      })) ?? [],
    [bundle],
  );
  const selected = options.find((option) => option.id === value);
  const title = t("settings.host.agentSettingsProfiles.title");
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const handleOpenChange = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  if (!supported || !bundle || !onSelect) return null;
  return (
    <>
      <View style={styles.control}>
        <AgentControlTrigger
          ref={anchorRef}
          icon={Settings2}
          surface="toolbar"
          label={title}
          value={selected?.label}
          showCaret
          open={open}
          disabled={disabled}
          onPress={handlePress}
          accessibilityLabel={selected ? `${title}: ${selected.label}` : title}
          testID="chat-settings-profile-selector"
        />
      </View>
      <Combobox
        options={options}
        value={value ?? ""}
        onSelect={onSelect}
        searchable={options.length > SEARCH_THRESHOLD}
        title={title}
        placeholder={title}
        emptyText={t("settings.host.agentProfiles.emptyState")}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={180}
        renderOption={renderProfileOption}
      />
    </>
  );
}

const styles = StyleSheet.create(() => ({
  control: { minWidth: 0, maxWidth: 180, flexShrink: 1 },
}));

export function AgentSettingsProfileLabel({ name }: { name?: string }) {
  const { t } = useTranslation();
  return name ? (
    <View
      style={labelStyles.container}
      testID="chat-settings-profile-label"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${t("settings.host.agentSettingsProfiles.title")}: ${name}`}
    >
      <ComposerToolbarGlyph size={16}>
        <Settings2 size={16} color={labelStyles.iconColor.color} />
      </ComposerToolbarGlyph>
      <Text style={labelStyles.text} numberOfLines={1} testID="chat-settings-profile-name">
        {name}
      </Text>
    </View>
  ) : null;
}

const labelStyles = StyleSheet.create((theme) => ({
  container: {
    height: 28,
    minWidth: 0,
    maxWidth: 180,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  text: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  iconColor: { color: theme.colors.foregroundMuted },
}));
