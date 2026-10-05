import { expect, test } from "../support/fixtures";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { submitMessage } from "../support/helpers/composer";
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

test.describe("Agent profiles settings", () => {
  test("repeated settings profile switches keep one copy of every Agents section", async ({
    page,
  }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "profile-section-count",
    });
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
            page.getByRole("button", { name: "Open skills documentation", exact: true }),
          ).toHaveCount(1);
          await expect(
            page.getByRole("button", { name: "Choose skills", exact: true }),
          ).toHaveCount(1);
          await expect(page.getByTestId("agent-profiles-section")).toHaveCount(1);
          await expect(page.getByTestId("host-page-append-system-prompt-card")).toHaveCount(1);
        }
      }
    } finally {
      await client.close();
    }
  });

  test("general Agents profiles restore their own prompt and tool settings", async ({ page }) => {
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "settings-profiles" });
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
      await client.close();
    }
  });

  test("new chats can select different settings profiles without changing the host default", async ({
    page,
  }) => {
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "profile-chats" });
    const bundle = {
      activeProfileId: "coding",
      profiles: [
        {
          id: "coding",
          name: "Coding",
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
      ).toHaveText("Coding");
      await page.getByTestId("workspace-pane-main").getByTestId("workspace-new-tab-button").click();
      await page.getByTestId("workspace-new-tab-menu-agent").click();
      await expect(
        page.getByTestId("chat-settings-profile-selector").filter({ visible: true }),
      ).toContainText("Coding");
      await page.getByTestId("chat-settings-profile-selector").filter({ visible: true }).click();
      await page.getByTestId("chat-settings-profile-reverse").click();
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
      ).toHaveText("Coding");
      await client.patchDaemonConfig({
        agentSettingsProfiles: { ...bundle, activeProfileId: "review" },
      });
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText("Coding");
      await page.reload();
      await expect(
        page.getByTestId("chat-settings-profile-name").filter({ visible: true }),
      ).toHaveText("Coding");
    } finally {
      await workspace.cleanup();
      await client.close();
    }
  });

  test("switching general profiles changes Agent profiles and skill selection", async ({
    page,
  }) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "full-profile-scope",
    });
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
      await editAgentProfile(page, "Binary analyst preset", { notes: "Use for binary analysis." });
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
