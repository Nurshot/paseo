/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

void testI18n;

let AppendSystemPromptCard: typeof import("./host-page").AppendSystemPromptCard;
let InjectPaseoToolsCard: typeof import("./host-page").InjectPaseoToolsCard;

const daemon = vi.hoisted(() => ({
  patchConfig: vi.fn(),
}));

vi.mock("lucide-react-native", () => ({
  ArrowDown: () => null,
  ArrowUp: () => null,
  ArrowUpToLine: () => null,
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  ChevronRight: () => null,
  CircleX: () => null,
  Globe: () => null,
  Info: () => null,
  Monitor: () => null,
  Pencil: () => null,
  Plus: () => null,
  RotateCw: () => null,
  SquareTerminal: () => null,
  Trash2: () => null,
  XCircle: () => null,
}));

vi.mock("@/agent-profiles", () => ({ AgentProfilesSection: () => null }));
vi.mock("@/agent-profiles/settings/agent-settings-profile-card", () => ({
  AgentSettingsProfileCard: () => null,
}));
vi.mock("@/agent-skills", () => ({ AgentSkillsSection: () => null }));
vi.mock("@/screens/settings/terminal-profile-edit-modal", () => ({
  TerminalProfileEditModal: () => null,
}));
vi.mock("@/desktop/daemon/desktop-daemon", () => ({
  startDesktopDaemon: vi.fn(),
  stopDesktopDaemon: vi.fn(),
}));
vi.mock("@/desktop/components/desktop-updates-section", () => ({
  LocalDaemonSection: () => null,
}));
vi.mock("@/desktop/hooks/use-daemon-status", () => ({
  useDaemonStatus: () => null,
}));
vi.mock("@/desktop/settings/desktop-settings", () => ({
  useDesktopSettings: () => ({}),
}));
vi.mock("@/desktop/components/pair-device-modal", () => ({
  PairDeviceModal: () => null,
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({
  useIsLocalDaemon: () => false,
}));
vi.mock("@/screens/settings/providers-section", () => ({
  ProvidersSection: () => null,
}));
vi.mock("@/usage", () => ({ HostUsageSection: () => null }));
vi.mock("@/screens/settings/host-appearance-section", () => ({
  HostAppearanceSection: () => null,
}));
vi.mock("@/stores/session-store", () => ({ useSessionStore: () => null }));
vi.mock("@/components/provider-icons", () => ({ useProviderIcon: () => null }));
vi.mock("./browser-tools-card", () => ({ BrowserToolsOptInCard: () => null }));
vi.mock("./daemon-lifecycle", () => ({
  restartDaemonFromSettings: vi.fn(),
  updateDaemonFromSettings: vi.fn(),
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: "div" },
  Easing: { ease: "ease", inOut: (value: unknown) => value },
  interpolateColor: (value: number, _input: number[], output: string[]) =>
    value >= 1 ? output[1] : output[0],
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  withTiming: (value: unknown) => value,
}));

const config: MutableDaemonConfig = {
  relay: { enabled: false },
  mcp: { injectIntoAgents: false },
  browserTools: { enabled: false },
  providers: {},
  metadataGeneration: { providers: [] },
  autoArchiveAfterMerge: false,
  enableTerminalAgentHooks: false,
  appendSystemPrompt: "Stored prompt",
};

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config,
    isLoading: false,
    patchConfig: daemon.patchConfig,
  }),
}));

vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    AdaptiveModalSheet: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", { role: "dialog" }, children),
  };
});

function renderCard(card: React.ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{card}</QueryClientProvider>);
}

describe("host orchestration settings", () => {
  beforeAll(async () => {
    vi.stubGlobal("React", React);
    ({ AppendSystemPromptCard, InjectPaseoToolsCard } = await import("./host-page"));
  });

  afterAll(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    daemon.patchConfig.mockReset();
  });

  it("shows an MCP toggle save failure", async () => {
    daemon.patchConfig.mockRejectedValueOnce(new Error("Profile was removed"));
    renderCard(<InjectPaseoToolsCard serverId="host-a" />);

    fireEvent.click(screen.getByRole("switch"));

    expect(await screen.findByText("Profile was removed")).toBeDefined();
  });

  it("disables the MCP toggle while its update is pending", async () => {
    daemon.patchConfig.mockReturnValueOnce(new Promise(() => undefined));
    renderCard(<InjectPaseoToolsCard serverId="host-a" />);

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBe("true"));
    expect(screen.getByText("Saving...")).toBeDefined();
  });

  it("keeps the edited prompt open and visible when saving fails", async () => {
    daemon.patchConfig.mockRejectedValueOnce(new Error("Profile was removed"));
    renderCard(<AppendSystemPromptCard serverId="host-a" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Append system prompt");
    fireEvent.change(input, { target: { value: "Unsaved prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Profile was removed")).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
    expect((screen.getByLabelText("Append system prompt") as HTMLTextAreaElement).value).toBe(
      "Unsaved prompt",
    );
  });

  it("does not report an undefined prompt save result as success", async () => {
    daemon.patchConfig.mockResolvedValueOnce(undefined);
    renderCard(<AppendSystemPromptCard serverId="host-a" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Append system prompt"), {
      target: { value: "Unsaved prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Host is not connected")).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
