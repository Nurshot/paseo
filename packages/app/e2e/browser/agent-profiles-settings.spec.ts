import { expect, test } from "../support/fixtures";
import type { Page, TestInfo } from "@playwright/test";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import type { AgentSettingsProfiles } from "@getpaseo/protocol/agent-settings-profile";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { submitMessage } from "../support/helpers/composer";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import {
  createAgentProfile,
  createAgentProfileFromEmptyState,
  editAgentProfile,
  expectAgentProfile,
  expectAgentProfileForm,
  expectAgentProfileOrder,
  expectAgentProfileTagsGone,
  expectHostAgentProfiles,
  expectNoAgentProfiles,
  moveAgentProfileUp,
  openAgentProfileSettings,
  removeAgentProfile,
  seedAgentProfiles,
  stageLegacyFavoritesForHostMigration,
} from "../support/helpers/agent-profiles";

const MOCK_PROVIDER_LABEL = "Mock Load Test";

async function openOrchestrationSettings(page: Page) {
  const gate = await installDaemonWebSocketGate(page);
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "orchestration-feedback",
  });
  const previous = (await client.getDaemonConfig()).config;
  const settings = {
    appendSystemPrompt: "Stored prompt",
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    agentProfiles: [],
    skills: { selection: { mode: "custom" as const, skills: [] } },
  };
  const bundle: AgentSettingsProfiles = {
    activeProfileId: "coding",
    profiles: [
      { id: "coding", name: "Coding", settings },
      { id: "reverse", name: "Reverse", settings },
    ],
  };
  async function close() {
    gate.setServerMessageSuppressed("status", false);
    await restoreGeneralSettings(client, previous);
    await client.close();
  }
  try {
    await client.patchDaemonConfig({ agentSettingsProfiles: bundle });
    await openAgentProfileSettings(page);
    await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Coding");
    return { gate, client, bundle, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function captureSettingsFeedback(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function restoreGeneralSettings(client: DaemonClient, previous: MutableDaemonConfig) {
  await client.patchDaemonConfig({
    agentSettingsProfiles: previous.agentSettingsProfiles ?? {
      activeProfileId: "default",
      profiles: [
        {
          id: "default",
          name: "Default",
          settings: {
            appendSystemPrompt: previous.appendSystemPrompt,
            mcp: { injectIntoAgents: previous.mcp.injectIntoAgents },
            browserTools: { enabled: previous.browserTools.enabled },
            agentProfiles: previous.agentProfiles ?? [],
            skills: {
              selection: previous.skills?.selection ?? { mode: "all" },
            },
          },
        },
      ],
    },
  });
}

test.describe("Agent profiles settings", () => {
  test("Paseo tools save shows pending state and persists through the real daemon", async ({
    page,
  }, testInfo) => {
    const fixture = await openOrchestrationSettings(page);
    try {
      const card = page.getByTestId("host-page-inject-mcp-card");
      const toggle = card.getByRole("switch");
      await expect(toggle).not.toBeChecked();
      fixture.gate.holdNextClientRequest("set_daemon_config_request");
      await toggle.click();
      await fixture.gate.waitForHeldClientRequest();
      await expect(page.getByTestId("host-page-inject-mcp-saving")).toBeVisible();
      await expect(toggle).toBeDisabled();
      await captureSettingsFeedback(page, testInfo, "mcp-save-pending");
      fixture.gate.releaseHeldClientRequest();
      await expect(toggle).toBeChecked();
      await expect(toggle).toBeEnabled();
      await expect(page.getByTestId("host-page-inject-mcp-saving")).toHaveCount(0);
      expect((await fixture.client.getDaemonConfig()).config.mcp.injectIntoAgents).toBe(true);
      await captureSettingsFeedback(page, testInfo, "mcp-save-success");
    } finally {
      await fixture.close();
    }
  });

  test("Paseo tools save shows a real daemon rejection and supports retry", async ({
    page,
  }, testInfo) => {
    const fixture = await openOrchestrationSettings(page);
    try {
      const toggle = page.getByTestId("host-page-inject-mcp-card").getByRole("switch");
      fixture.gate.setServerMessageSuppressed("status", true);
      await fixture.client.patchDaemonConfig({
        agentSettingsProfiles: {
          activeProfileId: "reverse",
          profiles: [fixture.bundle.profiles[1]],
        },
      });
      await toggle.click();
      const error = page.getByTestId("host-page-inject-mcp-error");
      await expect(error).toContainText("Agent settings profile does not exist");
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
      expect((await fixture.client.getDaemonConfig()).config.mcp.injectIntoAgents).toBe(false);
      await captureSettingsFeedback(page, testInfo, "mcp-save-error");
      await fixture.client.patchDaemonConfig({ agentSettingsProfiles: fixture.bundle });
      await toggle.click();
      await expect(error).toHaveCount(0);
      await expect(toggle).toBeChecked();
      expect(
        (await fixture.client.getDaemonConfig()).config.agentSettingsProfiles?.profiles[0].settings
          .mcp.injectIntoAgents,
      ).toBe(true);
      await captureSettingsFeedback(page, testInfo, "mcp-save-retry-success");
    } finally {
      await fixture.close();
    }
  });

  test("system prompt save keeps the editor pending and persists through the real daemon", async ({
    page,
  }, testInfo) => {
    const fixture = await openOrchestrationSettings(page);
    try {
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      const input = page.getByTestId("host-page-append-system-prompt-input");
      await input.fill("App-level saved prompt");
      const save = page.getByTestId("host-page-append-system-prompt-save");
      fixture.gate.holdNextClientRequest("set_daemon_config_request");
      await save.click();
      await fixture.gate.waitForHeldClientRequest();
      await expect(save).toContainText("Saving");
      await expect(save).toBeDisabled();
      await expect(page.getByTestId("host-page-append-system-prompt-reset")).toBeDisabled();
      await expect(input).toHaveValue("App-level saved prompt");
      await captureSettingsFeedback(page, testInfo, "prompt-save-pending");
      fixture.gate.releaseHeldClientRequest();
      await expect(page.getByTestId("host-page-append-system-prompt-sheet")).toHaveCount(0);
      expect((await fixture.client.getDaemonConfig()).config.appendSystemPrompt).toBe(
        "App-level saved prompt",
      );
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      await expect(input).toHaveValue("App-level saved prompt");
      await captureSettingsFeedback(page, testInfo, "prompt-save-success");
    } finally {
      await fixture.close();
    }
  });

  test("system prompt save shows a real daemon rejection and retains the draft for retry", async ({
    page,
  }, testInfo) => {
    const fixture = await openOrchestrationSettings(page);
    try {
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      const input = page.getByTestId("host-page-append-system-prompt-input");
      await input.fill("Keep this unsaved prompt");
      fixture.gate.setServerMessageSuppressed("status", true);
      await fixture.client.patchDaemonConfig({
        agentSettingsProfiles: {
          activeProfileId: "reverse",
          profiles: [fixture.bundle.profiles[1]],
        },
      });
      const save = page.getByTestId("host-page-append-system-prompt-save");
      await save.click();
      const error = page.getByTestId("host-page-append-system-prompt-error");
      await expect(error).toContainText("Agent settings profile does not exist");
      await expect(input).toHaveValue("Keep this unsaved prompt");
      await expect(save).toBeEnabled();
      expect((await fixture.client.getDaemonConfig()).config.appendSystemPrompt).toBe(
        "Stored prompt",
      );
      await captureSettingsFeedback(page, testInfo, "prompt-save-error");
      await fixture.client.patchDaemonConfig({ agentSettingsProfiles: fixture.bundle });
      await save.click();
      await expect(page.getByTestId("host-page-append-system-prompt-sheet")).toHaveCount(0);
      expect(
        (await fixture.client.getDaemonConfig()).config.agentSettingsProfiles?.profiles[0].settings
          .appendSystemPrompt,
      ).toBe("Keep this unsaved prompt");
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      await expect(input).toHaveValue("Keep this unsaved prompt");
      await expect(error).toHaveCount(0);
      await captureSettingsFeedback(page, testInfo, "prompt-save-retry-success");
    } finally {
      await fixture.close();
    }
  });

  test("stale profile removal shows an error and preserves a concurrent edit", async ({ page }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "stale-profile-removal",
    });
    const previous = (await client.getDaemonConfig()).config;
    const settings = {
      appendSystemPrompt: "",
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      agentProfiles: [],
      skills: { selection: { mode: "custom" as const, skills: [] } },
    };
    try {
      await client.patchDaemonConfig({
        agentSettingsProfiles: {
          activeProfileId: "coding",
          profiles: [
            { id: "coding", name: "Coding", settings },
            { id: "reverse", name: "Reverse", settings },
          ],
        },
      });
      await openAgentProfileSettings(page);
      const dialogPromise = page.waitForEvent("dialog");
      const clickPromise = page.getByTestId("agent-settings-profile-remove").click();
      const dialog = await dialogPromise;
      const newerPreset = {
        id: "concurrent",
        name: "Concurrent preset",
        provider: "mock",
      };
      await client.patchDaemonConfig({
        agentSettingsProfilePatch: {
          profileId: "coding",
          agentProfiles: [newerPreset],
        },
      });
      await dialog.accept();
      await clickPromise;
      await expect(page.getByText(/Agent settings profiles changed/)).toBeVisible();
      const current = (await client.getDaemonConfig()).config.agentSettingsProfiles;
      expect(current?.activeProfileId).toBe("coding");
      expect(current?.profiles.map((profile) => profile.id)).toEqual(["coding", "reverse"]);
      expect(current?.profiles[0].settings.agentProfiles).toEqual([newerPreset]);
    } finally {
      await restoreGeneralSettings(client, previous);
      await client.close();
    }
  });

  test("repeated settings profile switches keep one copy of every Agents section", async ({
    page,
  }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "profile-section-count",
    });
    const previous = (await client.getDaemonConfig()).config;
    const settings = {
      appendSystemPrompt: "",
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      agentProfiles: [],
      skills: { selection: { mode: "custom" as const, skills: [] } },
    };
    try {
      await client.patchDaemonConfig({
        agentSettingsProfiles: {
          activeProfileId: "section-a",
          profiles: [
            { id: "section-a", name: "Section A", settings },
            { id: "section-b", name: "Section B", settings },
          ],
        },
      });
      await openAgentProfileSettings(page);
      for (const width of [601, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (let change = 0; change < 6; change++) {
          const name = change % 2 === 0 ? "Section B" : "Section A";
          await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
          await page.getByText(name, { exact: true }).click();
          await expect(page.getByTestId("agent-settings-profile-select")).toContainText(name);
          await expect(
            page.getByRole("button", {
              name: "Open skills documentation",
              exact: true,
            }),
          ).toHaveCount(1);
          await expect(
            page.getByRole("button", { name: "Choose skills", exact: true }),
          ).toHaveCount(1);
          await expect(page.getByTestId("agent-profiles-section")).toHaveCount(1);
          await expect(page.getByTestId("host-page-append-system-prompt-card")).toHaveCount(1);
        }
      }
    } finally {
      await restoreGeneralSettings(client, previous);
      await client.close();
    }
  });

  test("general Agents profiles restore their own prompt and tool settings", async ({ page }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "settings-profiles",
    });
    const previous = (await client.getDaemonConfig()).config;
    try {
      await openAgentProfileSettings(page);
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Default");
      await page.getByTestId("agent-settings-profile-create").click();
      await page.getByTestId("agent-settings-profile-name-input").fill("Reverse engineering");
      await page.getByTestId("agent-settings-profile-name-submit").click();
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText(
        "Reverse engineering",
      );
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      await page
        .getByTestId("host-page-append-system-prompt-input")
        .fill("Analyze binaries before making changes.");
      await page.getByTestId("host-page-append-system-prompt-save").click();
      await expect(page.getByTestId("host-page-append-system-prompt-sheet")).not.toBeVisible();

      await page.getByTestId("agent-settings-profile-create").click();
      await page.getByTestId("agent-settings-profile-name-input").fill("Coding");
      await page.getByTestId("agent-settings-profile-name-submit").click();
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Coding");
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      await page
        .getByTestId("host-page-append-system-prompt-input")
        .fill("Write code and run focused tests.");
      await page.getByTestId("host-page-append-system-prompt-save").click();
      await expect(page.getByTestId("host-page-append-system-prompt-sheet")).not.toBeVisible();
      await page.getByTestId("host-page-inject-mcp-card").getByRole("switch").click();
      await expect
        .poll(async () => (await client.getDaemonConfig()).config.appendSystemPrompt)
        .toBe("Write code and run focused tests.");
      const coding = (await client.getDaemonConfig()).config;

      await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
      await page.getByText("Reverse engineering", { exact: true }).click();
      await expect
        .poll(async () => (await client.getDaemonConfig()).config.appendSystemPrompt)
        .toBe("Analyze binaries before making changes.");
      expect((await client.getDaemonConfig()).config.mcp.injectIntoAgents).toBe(
        !coding.mcp.injectIntoAgents,
      );
      await page.getByTestId("host-page-append-system-prompt-edit").click();
      await expect(page.getByTestId("host-page-append-system-prompt-input")).toHaveValue(
        "Analyze binaries before making changes.",
      );
      await page.keyboard.press("Escape");

      await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
      await page.getByText("Coding", { exact: true }).click();
      await expect
        .poll(async () => (await client.getDaemonConfig()).config.appendSystemPrompt)
        .toBe("Write code and run focused tests.");
      await page.reload();
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Coding");
      await page.getByTestId("agent-settings-profile-rename").click();
      await page.getByTestId("agent-settings-profile-name-input").fill("Development");
      await page.getByTestId("agent-settings-profile-name-submit").click();
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Development");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByTestId("agent-settings-profile-remove").click();
      await expect(page.getByTestId("agent-settings-profile-select")).toContainText("Default");
      expect(
        (await client.getDaemonConfig()).config.agentSettingsProfiles?.profiles.map(
          (profile) => profile.name,
        ),
      ).toEqual(["Default", "Reverse engineering"]);
    } finally {
      await restoreGeneralSettings(client, previous);
      await client.close();
    }
  });

  test("new chats can select different settings profiles without changing the host default", async ({
    page,
  }, testInfo) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "profile-chats",
    });
    const previous = (await client.getDaemonConfig()).config;
    const codingProfileName = "Kodlama";
    const bundle = {
      activeProfileId: "coding",
      profiles: [
        {
          id: "coding",
          name: codingProfileName,
          settings: {
            appendSystemPrompt: "Write tested code.",
            mcp: { injectIntoAgents: false },
            browserTools: { enabled: false },
          },
        },
        {
          id: "reverse",
          name: "Reverse engineering",
          settings: {
            appendSystemPrompt: "Analyze binaries.",
            mcp: { injectIntoAgents: false },
            browserTools: { enabled: false },
          },
        },
        {
          id: "review",
          name: "Review",
          settings: {
            appendSystemPrompt: "Review the diff.",
            mcp: { injectIntoAgents: false },
            browserTools: { enabled: false },
          },
        },
      ],
    };
    await client.patchDaemonConfig({ agentSettingsProfiles: bundle });
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "profile-chats-",
      title: "Default coding chat",
    });
    try {
      await openAgentRoute(page, workspace);
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText(codingProfileName);
      const badge = page.getByTestId("chat-settings-profile-label").filter({ visible: true });
      const liveModel = page.getByTestId("combined-model-selector").filter({ visible: true });
      await expect(badge).toBeVisible();
      const badgeBox = await badge.boundingBox();
      const liveModelBox = await liveModel.boundingBox();
      if (!badgeBox || !liveModelBox)
        throw new Error("Profile badge and model control must be visible");
      expect(badgeBox.height).toBeCloseTo(28, 0);
      expect(
        Math.abs(badgeBox.y + badgeBox.height / 2 - liveModelBox.y - liveModelBox.height / 2),
      ).toBeLessThanOrEqual(1);
      await expect(badge.getByRole("button")).toHaveCount(0);
      await captureSettingsFeedback(page, testInfo, "profile-badge-aligned");
      await page.getByTestId("workspace-pane-main").getByTestId("workspace-new-tab-button").click();
      await page.getByTestId("workspace-new-tab-menu-agent").click();
      await expect(
        page.getByTestId("chat-settings-profile-selector").filter({ visible: true }),
      ).toContainText(codingProfileName);
      const picker = page.getByTestId("chat-settings-profile-selector").filter({ visible: true });
      const draftModel = page.getByTestId("combined-model-selector").filter({ visible: true });
      await expect(picker).toHaveAccessibleName(`Settings profile: ${codingProfileName}`);
      const pickerBox = await picker.boundingBox();
      const draftModelBox = await draftModel.boundingBox();
      if (!pickerBox || !draftModelBox)
        throw new Error("Profile picker and model control must be visible");
      expect(pickerBox.height).toBeCloseTo(28, 0);
      expect(
        Math.abs(pickerBox.y + pickerBox.height / 2 - draftModelBox.y - draftModelBox.height / 2),
      ).toBeLessThanOrEqual(1);
      await captureSettingsFeedback(page, testInfo, "profile-picker-aligned");
      await picker.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("chat-settings-profile-reverse")).toBeVisible();
      await captureSettingsFeedback(page, testInfo, "profile-picker-desktop-menu");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(picker).toBeVisible();
      await picker.click();
      await expect(page.getByTestId("chat-settings-profile-reverse")).toBeVisible();
      await expect(page.getByTestId("chat-settings-profile-reverse")).toBeInViewport({ ratio: 1 });
      await captureSettingsFeedback(page, testInfo, "profile-picker-compact-menu");
      await page.getByTestId("chat-settings-profile-reverse").click();
      await expect(picker).toContainText("Reverse engineering");
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(
        page.getByTestId("chat-settings-profile-selector").filter({ visible: true }),
      ).toContainText("Reverse engineering");
      await submitMessage(page, "Inspect this project.");
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText("Reverse engineering");
      expect((await client.getDaemonConfig()).config.agentSettingsProfiles?.activeProfileId).toBe(
        "coding",
      );
      await page.getByTestId("workspace-pane-main").getByTestId("workspace-new-tab-button").click();
      await page.getByTestId("workspace-new-tab-menu-agent").click();
      await page.getByTestId("chat-settings-profile-selector").filter({ visible: true }).click();
      await page.getByTestId("chat-settings-profile-review").click();
      await submitMessage(page, "Review this project.");
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText("Review");
      await page.getByTestId(`workspace-tab-agent_${workspace.agentId}`).click();
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText(codingProfileName);
      await client.patchDaemonConfig({
        agentSettingsProfiles: { ...bundle, activeProfileId: "review" },
      });
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText(codingProfileName);
      await page.reload();
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText(codingProfileName);
    } finally {
      await workspace.cleanup();
      await restoreGeneralSettings(client, previous);
      await client.close();
    }
  });

  test("switching general profiles changes Agent profiles and skill selection", async ({
    page,
  }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "full-profile-scope",
    });
    const previous = (await client.getDaemonConfig()).config;
    const base = {
      appendSystemPrompt: "",
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
    };
    const bundle = {
      activeProfileId: "coding-scope",
      profiles: [
        {
          id: "coding-scope",
          name: "Coding scope",
          settings: {
            ...base,
            agentProfiles: [
              {
                id: "dev",
                name: "Developer preset",
                provider: "mock",
                model: "e2e-fast-stream",
                modeId: "load-test",
              },
            ],
            skills: { selection: { mode: "all" as const } },
          },
        },
        {
          id: "reverse-scope",
          name: "Reverse scope",
          settings: {
            ...base,
            agentProfiles: [
              {
                id: "binary",
                name: "Binary analyst preset",
                provider: "mock",
                model: "e2e-fast-stream",
                modeId: "load-test",
              },
            ],
            skills: { selection: { mode: "custom" as const, skills: [] } },
          },
        },
      ],
    };
    try {
      await client.patchDaemonConfig({ agentSettingsProfiles: bundle });
      await openAgentProfileSettings(page);
      await expectAgentProfile(page, {
        name: "Developer preset",
        tags: [MOCK_PROVIDER_LABEL, "E2E fast stream", "Load test"],
      });
      await expect(page.getByTestId("agent-profiles-card")).not.toContainText(
        "Binary analyst preset",
      );
      await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
      await page.getByText("Reverse scope", { exact: true }).click();
      await expectAgentProfile(page, {
        name: "Binary analyst preset",
        tags: [MOCK_PROVIDER_LABEL, "E2E fast stream", "Load test"],
      });
      await expect(page.getByTestId("agent-profiles-card")).not.toContainText("Developer preset");
      await expect
        .poll(async () => (await client.getAgentSkillsStatus()).selection)
        .toEqual({ mode: "custom", skills: [] });
      await page.getByRole("button", { name: "Choose skills", exact: true }).click();
      await expect(page.getByTestId("skill-selection-all")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await page.keyboard.press("Escape");
      await editAgentProfile(page, "Binary analyst preset", {
        notes: "Use for binary analysis.",
      });
      await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
      await page.getByText("Coding scope", { exact: true }).click();
      await expectAgentProfile(page, {
        name: "Developer preset",
        tags: [MOCK_PROVIDER_LABEL, "E2E fast stream", "Load test"],
      });
      await expect
        .poll(async () => (await client.getAgentSkillsStatus()).selection)
        .toEqual({ mode: "all" });
      await page.getByTestId("agent-settings-profile-select").getByRole("button").click();
      await page.getByText("Reverse scope", { exact: true }).click();
      await expectAgentProfile(page, {
        name: "Binary analyst preset",
        tags: [MOCK_PROVIDER_LABEL, "E2E fast stream", "Load test"],
        notes: "Use for binary analysis.",
      });
      await page.reload();
      await expectAgentProfile(page, {
        name: "Binary analyst preset",
        tags: [MOCK_PROVIDER_LABEL, "E2E fast stream", "Load test"],
        notes: "Use for binary analysis.",
      });
    } finally {
      await restoreGeneralSettings(client, previous);
      await client.close();
    }
  });

  test("legacy model favourites migrate into provider-and-model-only host profiles", async ({
    page,
  }) => {
    const seed = await seedAgentProfiles([]);
    const migratedProfile = {
      id: "legacy_favorite:mock:one-minute-stream",
      name: "One minute stream",
      provider: "mock",
      model: "one-minute-stream",
    };

    try {
      await stageLegacyFavoritesForHostMigration(page, [
        { provider: "mock", modelId: "one-minute-stream" },
      ]);

      await expectHostAgentProfiles([migratedProfile]);
      await openAgentProfileSettings(page);
      await expectAgentProfile(page, {
        name: migratedProfile.name,
        tags: [MOCK_PROVIDER_LABEL, "One minute stream"],
      });
    } finally {
      await seed.restore();
    }
  });

  test("host owner creates, edits, reorders and removes agent profiles", async ({ page }) => {
    // The journey owns the list, so it starts from an empty one whatever the
    // worker ran before, and hands it back untouched.
    const seed = await seedAgentProfiles([]);

    try {
      await test.step("the section starts empty", async () => {
        await openAgentProfileSettings(page);
        await expectNoAgentProfiles(page);
      });

      await test.step("create a profile from the modal", async () => {
        await createAgentProfileFromEmptyState(page, {
          name: "UI work",
          provider: MOCK_PROVIDER_LABEL,
          model: "Ten second stream",
          thinking: "High",
          mode: "Approval test",
          notes: "Use for UI work — components, layout and design tokens.",
        });
        await expectAgentProfile(page, {
          name: "UI work",
          tags: [MOCK_PROVIDER_LABEL, "Ten second stream", "Approval test", "High"],
          notes: "Use for UI work — components, layout and design tokens.",
        });
      });

      await test.step("editing to a model without thinking levels drops the level", async () => {
        await editAgentProfile(page, "UI work", {
          model: "One minute stream",
          notes: "Now for quick checks.",
        });
        await expectAgentProfile(page, {
          name: "UI work",
          tags: [MOCK_PROVIDER_LABEL, "One minute stream", "Approval test"],
          notes: "Now for quick checks.",
        });
        await expectAgentProfileTagsGone(page, {
          name: "UI work",
          tags: ["Ten second stream", "High"],
        });
      });

      await test.step("the edit form reopens on what was stored", async () => {
        await expectAgentProfileForm(page, "UI work", {
          provider: MOCK_PROVIDER_LABEL,
          model: "One minute stream",
          mode: "Approval test",
          notes: "Now for quick checks.",
        });
      });

      await test.step("a second profile lands below the first", async () => {
        await createAgentProfile(page, {
          name: "Deep review",
          provider: MOCK_PROVIDER_LABEL,
          model: "Five minute stream",
        });
        await expectAgentProfileOrder(page, ["UI work", "Deep review"]);
      });

      await test.step("reorder puts the second profile on top", async () => {
        await moveAgentProfileUp(page, "Deep review");
        await expectAgentProfileOrder(page, ["Deep review", "UI work"]);
      });

      await test.step("removing a profile confirms by name", async () => {
        await removeAgentProfile(page, "UI work");
        await expectAgentProfileOrder(page, ["Deep review"]);
      });

      await test.step("removing the last profile returns the empty state", async () => {
        await removeAgentProfile(page, "Deep review");
        await expectNoAgentProfiles(page);
      });
    } finally {
      await seed.restore();
    }
  });
});
