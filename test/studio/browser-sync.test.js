import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { createStudioServer } from "../../studio/server/index.js";
import { closeBrowser, createPage, getBrowser } from "../visual/utils/puppeteer.js";

describe("studio browser sync", () => {
  let studioServer;
  let serverInfo;
  let listenError = null;
  let browserError = null;

  beforeAll(async () => {
    try {
      studioServer = createStudioServer({ port: 0, host: "127.0.0.1" });
      serverInfo = await studioServer.start();
    } catch (error) {
      listenError = error;
      return;
    }

    try {
      await getBrowser();
    } catch (error) {
      browserError = error;
    }
  });

  afterAll(async () => {
    await closeBrowser();
    if (studioServer && serverInfo) {
      await studioServer.stop();
    }
  });

  test("admin and output stay synchronized without preset warning regressions", async () => {
    if (listenError) {
      expect(listenError.code).toBe("EPERM");
      return;
    }

    if (browserError) {
      expect(browserError).toBeTruthy();
      return;
    }

    const sessionId = "browser-sync-test";
    const adminPage = await createPage();
    const outputPage = await createPage();
    const adminMessages = [];
    const outputMessages = [];

    adminPage.on("console", (message) => adminMessages.push(message.text()));
    outputPage.on("console", (message) => outputMessages.push(message.text()));

    try {
      await outputPage.goto(`http://127.0.0.1:${serverInfo.port}/output/${sessionId}`, {
        waitUntil: "networkidle0",
      });

      await adminPage.evaluate((forcedSessionId) => {
        localStorage.setItem("buttervizmap.sessionId", forcedSessionId);
      }, sessionId);
      await adminPage.goto(`http://127.0.0.1:${serverInfo.port}/admin`, {
        waitUntil: "networkidle0",
      });
      await adminPage.reload({ waitUntil: "networkidle0" });

      await adminPage.waitForSelector("#global-preset");
      await outputPage.waitForSelector("#output-status");
      await adminPage.waitForFunction(() => {
        const select = document.querySelector("#global-preset");
        return select && select.options.length > 10;
      });

      const selectedPreset = await adminPage.evaluate(() => {
        const select = document.querySelector("#global-preset");
        const options = [...select.options];
        const chosen =
          options.find((option) => /Unchained - Rewop/i.test(option.textContent)) ??
          options.find((option) => option.parentElement?.label === "Butterchurn Catalog");
        if (!chosen) {
          return null;
        }

        select.value = chosen.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          value: chosen.value,
          label: chosen.textContent,
        };
      });

      expect(selectedPreset).toBeTruthy();
      await adminPage.evaluate(() => {
        const opacityInput = document.querySelector("#global-opacity");
        opacityInput.value = "0.73";
        opacityInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await adminPage.waitForTimeout(1200);
      await outputPage.waitForTimeout(1200);

      const outputStatus = await outputPage.$eval("#output-status", (node) => node.textContent);
      const outputPixelSignature = await outputPage.$eval("#output-canvas", (canvas) => {
        const context = canvas.getContext("2d");
        const sampleWidth = Math.min(32, canvas.width);
        const sampleHeight = Math.min(32, canvas.height);
        const startX = Math.max(0, Math.floor(canvas.width / 2 - sampleWidth / 2));
        const startY = Math.max(0, Math.floor(canvas.height / 2 - sampleHeight / 2));
        const sample = context.getImageData(startX, startY, sampleWidth, sampleHeight).data;
        let total = 0;
        for (let index = 0; index < sample.length; index += 4) {
          total += sample[index] + sample[index + 1] + sample[index + 2];
        }
        return total;
      });

      expect(outputStatus).toMatch(/connected/i);
      expect(outputPixelSignature).toBeGreaterThan(0);

      const viewerCount = await adminPage.evaluate(() => {
        return [...document.querySelectorAll("#session-panel .chip")]
          .map((node) => node.textContent)
          .find((text) => /viewer/i.test(text));
      });
      expect(viewerCount).toMatch(/1 viewer/);

      await adminPage.reload({ waitUntil: "networkidle0" });
      await adminPage.waitForSelector("#global-preset");
      const persistedState = await adminPage.evaluate(() => ({
        presetId: document.querySelector("#global-preset").value,
        opacity: document.querySelector("#global-opacity").value,
      }));
      expect(persistedState.presetId).toBe(selectedPreset.value);
      expect(Number(persistedState.opacity)).toBeCloseTo(0.73, 2);

      const combinedMessages = [...adminMessages, ...outputMessages].join("\n");
      expect(combinedMessages).not.toMatch(/Tried to load a JS preset that doesn't have converted strings/i);
      expect(combinedMessages).not.toMatch(/getByteTimeDomainData/i);
    } finally {
      await adminPage.close();
      await outputPage.close();
    }
  });

  test("admin keeps shader reaction controls editable and hides the old preset browser", async () => {
    if (listenError) {
      expect(listenError.code).toBe("EPERM");
      return;
    }

    if (browserError) {
      expect(browserError).toBeTruthy();
      return;
    }

    const sessionId = "browser-admin-interaction-controls";
    const adminPage = await createPage();

    try {
      await adminPage.evaluate((forcedSessionId) => {
        localStorage.setItem("buttervizmap.sessionId", forcedSessionId);
      }, sessionId);
      await adminPage.goto(`http://127.0.0.1:${serverInfo.port}/admin`, {
        waitUntil: "networkidle0",
      });

      await adminPage.waitForSelector("#shader-reaction-mode");
      expect(await adminPage.$("#preset-list")).toBeNull();

      await adminPage.evaluate(() => {
        const checkbox = document.querySelector("#role-interactionField");
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await adminPage.waitForFunction(() => {
        const store = window.__buttervizmap?.store;
        const selectedId = store?.state.selectedElementId;
        const element = store?.state.project.elements.find((entry) => entry.id === selectedId);
        return element?.roles?.interactionField === false;
      });

      await adminPage.evaluate(() => {
        const checkbox = document.querySelector("#role-interactionField");
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await adminPage.waitForFunction(() => {
        const store = window.__buttervizmap?.store;
        const selectedId = store?.state.selectedElementId;
        const element = store?.state.project.elements.find((entry) => entry.id === selectedId);
        return element?.roles?.interactionField === true;
      });

      await adminPage.evaluate(() => {
        const select = document.querySelector("#shader-reaction-mode");
        select.value = "reflect";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await adminPage.waitForFunction(() => {
        const store = window.__buttervizmap?.store;
        const selectedId = store?.state.selectedElementId;
        const element = store?.state.project.elements.find((entry) => entry.id === selectedId);
        return (
          document.querySelector("#shader-reaction-mode")?.value === "reflect" &&
          element?.shaderBinding?.reactionMode === "reflect"
        );
      });

      const controlState = await adminPage.evaluate(() => {
        const store = window.__buttervizmap?.store;
        const selectedId = store?.state.selectedElementId;
        const element = store?.state.project.elements.find((entry) => entry.id === selectedId);
        return {
          disabled: document.querySelector("#shader-reaction-mode")?.disabled ?? true,
          reactionMode: element?.shaderBinding?.reactionMode ?? null,
          interactionField: element?.roles?.interactionField ?? null,
        };
      });

      expect(controlState.disabled).toBe(false);
      expect(controlState.interactionField).toBe(true);
      expect(controlState.reactionMode).toBe("reflect");
    } finally {
      await adminPage.close();
    }
  });
});
