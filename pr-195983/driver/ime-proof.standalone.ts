// Temporary real-browser IME proof for PR #195983. Not part of the patch.
// Runs the Control UI through the repo's own e2e server, drives a real Chromium
// composition through CDP (Input.imeSetComposition), and records trace + video.
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { installMockGateway, startControlUiE2eServer } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiSessionRow } from "../test-helpers/control-ui-session-fixtures.ts";

const arm = process.env.IME_PROOF_ARM?.trim() || "head";
const outDir =
  process.env.IME_PROOF_DIR?.trim() ||
  `/home/code/github/contributions/pr-195983-evidence/${arm}`;
const videoDir = path.join(outDir, "video");
mkdirSync(videoDir, { recursive: true });

const TRACE_INIT = `
window.__imeProofTrace = { events: [], submits: 0, dialogPresentAtSubmit: null };
(function () {
  function record(event, extra) {
    var keyboard = event;
    var target = event.target;
    var entry = {
      type: event.type,
      key: keyboard.key === undefined ? null : keyboard.key,
      keyCode: keyboard.keyCode === undefined ? null : keyboard.keyCode,
      isComposing: keyboard.isComposing === undefined ? null : keyboard.isComposing,
      defaultPrevented: event.defaultPrevented,
      data: event.data === undefined ? null : event.data,
      label: target && target.getAttribute ? target.getAttribute("aria-label") : null,
      value: document.querySelector('input[type="search"]')
        ? document.querySelector('input[type="search"]').value
        : null
    };
    if (extra) { for (var k in extra) entry[k] = extra[k]; }
    window.__imeProofTrace.events.push(entry);
  }
  // Bubble phase: the search input's own handler already ran, so defaultPrevented is final.
  document.addEventListener("keydown", function (event) { record(event); }, false);
  ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"].forEach(
    function (type) { document.addEventListener(type, function (event) { record(event); }, false); }
  );
  document.addEventListener("submit", function (event) {
    var present = !!document.querySelector("openclaw-modal-dialog");
    window.__imeProofTrace.submits += 1;
    window.__imeProofTrace.dialogPresentAtSubmit = present;
    record(event, { dialogPresent: present });
  }, false);
})();
`;

async function pressKey(cdp, key, code, virtualKeyCode) {
  const base = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base,
    ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function compose(cdp, text) {
  await cdp.send("Input.imeSetComposition", {
    type: "imeSetComposition",
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
}

async function readTrace(page) {
  return await page.evaluate("window.__imeProofTrace");
}

const key = "agent:main:reliability";
const rows = [
  createControlUiSessionRow(key, "Roadmap review", 1793000000000, {
    category: "Engineering",
    createdAt: 1792900000000,
    projectId: "openclaw",
  }),
  createControlUiSessionRow("agent:main:release", "发布检查清单", 1792999000000, {
    category: "Engineering",
    createdAt: 1792899000000,
    projectId: "openclaw",
  }),
  createControlUiSessionRow("agent:main:memory", "Gateway memory audit", 1792998000000, {
    category: "Engineering",
    createdAt: 1792898000000,
    projectId: "openclaw",
  }),
];
const listed = (sessions) => ({
  response: {
    count: sessions.length,
    defaults: { contextTokens: null, model: "gpt-5.5", modelProvider: "openai" },
    hasMore: false,
    limitApplied: 50,
    nextOffset: null,
    offset: 0,
    path: "",
    sessions,
    totalCount: sessions.length,
    ts: Date.now(),
  },
});

const server = await startControlUiE2eServer(undefined, { source: true });
console.log(`[ime-proof] server ${server.baseUrl}`);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  colorScheme: "light",
  reducedMotion: "reduce",
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log(`[pageerror] ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error") console.log(`[console] ${message.text()}`);
});
await page.addInitScript({ content: TRACE_INIT });
const gateway = await installMockGateway(page, {
  sessionKey: key,
  presenceUsers: [{ self: true, id: "profile-jordan", name: "Jordan Lee" }],
  sessions: rows,
  awaitInitialRoster: false,
  methodResponses: {
    "sessions.list": {
      cases: [{ match: { search: "发布" }, ...listed([rows[1]]) }, listed(rows)],
    },
  },
});
await page.goto(`${server.baseUrl}/chat/${encodeURIComponent(key)}`);
const sidebar = page.locator("openclaw-app-sidebar");
await sidebar.locator(".sidebar-recent-session").first().waitFor({ timeout: 120_000 });
console.log(
  "[ime-proof] readiness " +
    JSON.stringify(
      await page.evaluate("(window.openclawControlUi && window.openclawControlUi.snapshot()) || null"),
    ),
);

const diagnose = async (tag) => {
  await page
    .screenshot({ path: path.join(outDir, `${arm}-failure-${tag}.png`) })
    .catch(() => undefined);
  const html = await page
    .evaluate("document.querySelector('openclaw-app-sidebar') ? document.querySelector('openclaw-app-sidebar').outerHTML.slice(0, 3000) : document.body.innerHTML.slice(0, 3000)")
    .catch(() => "<unavailable>");
  console.log(`[diagnose:${tag}] ${html}`);
};

// New section: name and scope first, then session choice with the search box.
const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
if (await expandSidebar.count()) {
  await expandSidebar.click();
  await page.waitForTimeout(400);
}
const sortTrigger = page.getByRole("button", { name: /Filter & sort/ });
try {
  await sortTrigger.waitFor({ timeout: 90_000 });
} catch (error) {
  await diagnose("sort-trigger");
  throw error;
}
await page.screenshot({ path: path.join(outDir, `${arm}-0-sidebar.png`) });
await sortTrigger.click();
const sortMenu = page.locator(".sidebar-session-sort-menu");
const newSection = sortMenu.getByRole("button", { name: "New section", exact: true });
try {
  await newSection.waitFor({ timeout: 30_000 });
} catch (error) {
  await diagnose("new-section");
  throw error;
}
await newSection.click();
const dialog = page.getByRole("dialog", { name: "New section", exact: true });
try {
  await dialog.waitFor({ timeout: 30_000 });
} catch (error) {
  await diagnose("dialog");
  throw error;
}
await dialog.evaluate((element) =>
  Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
);
const dumpButtons = async (tag) => {
  console.log(
    `[debug:${tag}] ` +
      (await page.evaluate(
        "Array.from(document.querySelectorAll('openclaw-modal-dialog button')).map(b => (b.textContent||'').trim() + '|type=' + b.type + '|disabled=' + b.disabled).join(' ; ')",
      )),
  );
};
await dumpButtons("before-fill");
await dialog.getByLabel("Section name", { exact: true }).fill("IME 取证");
await dumpButtons("after-fill");
await page.waitForTimeout(150);
await dialog.getByRole("button", { name: "Choose sessions", exact: true }).click();
await dialog.getByRole("button", { name: "Search sessions", exact: true }).click();
const search = dialog.getByRole("searchbox", { name: "Search sessions", exact: true });
await search.click();
await page.waitForTimeout(200);

// Counters start at the IME window: reaching step 2 legitimately submits the form once.
await page.evaluate(
  "window.__imeProofTrace.events.length = 0; window.__imeProofTrace.submits = 0; window.__imeProofTrace.dialogPresentAtSubmit = null;",
);

const cdp = await context.newCDPSession(page);
await compose(cdp, "f");
await page.waitForTimeout(120);
await compose(cdp, "fa");
await page.waitForTimeout(120);
await compose(cdp, "fabu");
await page.waitForTimeout(150);
await compose(cdp, "发布");
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outDir, `${arm}-1-composing.png`) });

// The committing Enter: Chrome delivers keydown while isComposing is true.
await pressKey(cdp, "Enter", "Enter", 13);
await page.waitForTimeout(900);
const afterEnter = await readTrace(page);
const enterKeydown = afterEnter.events.find((e) => e.type === "keydown" && e.key === "Enter");
const dialogVisible = await dialog.isVisible().catch(() => false);
const searchStillOpen = (await dialog.getByRole("searchbox").count()) === 1;
const committedValue = searchStillOpen ? await search.inputValue() : null;
const groupWrites = {
  put: (await gateway.getRequests("sessions.groups.put")).length,
  update: (await gateway.getRequests("sessions.groups.update")).length,
  delete: (await gateway.getRequests("sessions.groups.delete")).length,
};
const saveRequests = { length: groupWrites.put + groupWrites.update + groupWrites.delete };
const searchRequests = await gateway.getRequests("sessions.list");
const chineseSearch = searchRequests.filter((request) => request.params?.search === "发布");
const worksheet = searchStillOpen ? await dialog.getByRole("checkbox").count() : null;
await page.screenshot({ path: path.join(outDir, `${arm}-2-after-enter.png`) });

const summary = {
  arm,
  formTag: await page.evaluate(
    "(document.querySelector('input[type=\"search\"]') || {form:null}).form ? document.querySelector('input[type=\"search\"]').form.tagName : null",
  ),
  submitEvents: afterEnter.submits,
  dialogPresentAtSubmit: afterEnter.dialogPresentAtSubmit,
  enterKeydown: enterKeydown ?? null,
  compositionEndEvents: afterEnter.events.filter((e) => e.type === "compositionend").length,
  dialogVisibleAfterEnter: dialogVisible,
  searchStillOpen,
  committedValue,
  groupWriteRequests: groupWrites,
  saveRequestCount: saveRequests.length,
  chineseSearchRequestCount: chineseSearch.length,
  visibleCheckboxes: worksheet,
  keysAfterEnter: afterEnter.events.filter((e) => e.type === "keydown").length,
};

if (searchStillOpen) {
  // Escape belongs to the input method while a composition is pending.
  await search.click();
  await page.waitForTimeout(200);
  await compose(cdp, "fabu");
  await page.waitForTimeout(200);
  await pressKey(cdp, "Escape", "Escape", 27);
  await page.waitForTimeout(600);
  const afterEscape = await readTrace(page);
  const escapeKeydown = afterEscape.events.find((e) => e.type === "keydown" && e.key === "Escape");
  const searchOpenAfterComposingEscape = (await dialog.getByRole("searchbox").count()) === 1;
  const dialogVisibleAfterComposingEscape = await dialog.isVisible().catch(() => false);
  const queryAfterCancel = searchOpenAfterComposingEscape ? await search.inputValue() : null;

  // Settled Escapes keep the documented clear-then-close contract.
  await search.click();
  await search.fill("rel");
  await page.waitForTimeout(400);
  await search.press("Escape");
  await page.waitForTimeout(250);
  const clearedQuery = (await dialog.getByRole("searchbox").count()) === 1
    ? await search.inputValue()
    : null;
  const openAfterFirstSettled = (await dialog.getByRole("searchbox").count()) === 1;
  await search.press("Escape");
  await page.waitForTimeout(250);
  const openAfterSecondSettled = (await dialog.getByRole("searchbox").count()) === 1;

  summary.composingEscape = {
    escapeKeydown: escapeKeydown ?? null,
    searchOpen: searchOpenAfterComposingEscape,
    dialogVisible: dialogVisibleAfterComposingEscape,
    queryAfterCancel,
  };
  summary.settledEscape = {
    clearedQuery,
    openAfterFirst: openAfterFirstSettled,
    openAfterSecond: openAfterSecondSettled,
    dialogVisible: await dialog.isVisible().catch(() => false),
  };
  await page.screenshot({ path: path.join(outDir, `${arm}-3-after-escape.png`) });
}

writeFileSync(path.join(outDir, `${arm}-trace.json`), `${JSON.stringify({ summary, events: afterEnter.events }, null, 2)}\n`);

const lines = [
  `arm=${arm} search form=<${summary.formTag}>`,
  `keydown Enter: isComposing=${String(enterKeydown?.isComposing)} keyCode=${String(enterKeydown?.keyCode)} defaultPrevented=${String(enterKeydown?.defaultPrevented)}`,
  `compositionend (commit) events: ${summary.compositionEndEvents}`,
  `native form submit events: ${summary.submitEvents}`,
  `sessions.groups.* (save) requests: ${summary.saveRequestCount} ${JSON.stringify(groupWrites)}`,
  `dialog visible after Enter: ${dialogVisible} | search still open: ${searchStillOpen}`,
  `committed search value: ${JSON.stringify(committedValue)}`,
  `sessions.list(search=发布) requests: ${summary.chineseSearchRequestCount} | visible checkbox rows: ${String(summary.visibleCheckboxes)}`,
  summary.composingEscape
    ? `Escape while composing: isComposing=${String(summary.composingEscape.escapeKeydown?.isComposing)} defaultPrevented=${String(summary.composingEscape.escapeKeydown?.defaultPrevented)} searchOpen=${String(summary.composingEscape.searchOpen)} queryAfterCancel=${JSON.stringify(summary.composingEscape.queryAfterCancel)}`
    : "Escape while composing: not reached",
  summary.settledEscape
    ? `settled Escapes: clearedQuery=${JSON.stringify(summary.settledEscape.clearedQuery)} openAfterFirst=${String(summary.settledEscape.openAfterFirst)} openAfterSecond=${String(summary.settledEscape.openAfterSecond)}`
    : "settled Escapes: not reached",
];
console.log(`\n[ime-proof:${arm}]\n${lines.join("\n")}\n`);
writeFileSync(path.join(outDir, `${arm}-summary.txt`), `${lines.join("\n")}\n`);

// Keep the recording; close order matters for a finalized webm.
const video = page.video();
await context.close();
if (video) {
  try {
    await video.saveAs(path.join(outDir, `${arm}.webm`));
  } catch (error) {
    console.log(`[ime-proof] video save failed: ${String(error)}`);
  }
}
await browser.close();
await server.close();
for (const name of readdirSync(videoDir)) {
  if (name.endsWith(".webm")) {
    renameSync(path.join(videoDir, name), path.join(outDir, `${arm}-raw.webm`));
  }
}

const failures = [];
if (arm === "base") {
  if (afterEnter.submits !== 1) failures.push(`expected 1 submit, got ${afterEnter.submits}`);
  if (dialogVisible) failures.push("dialog stayed open on base");
  if (enterKeydown?.defaultPrevented !== false) failures.push("base Enter was prevented");
} else {
  if (enterKeydown?.isComposing !== true) failures.push("Enter keydown was not composing");
  if (enterKeydown?.defaultPrevented !== true) failures.push("Enter keydown was not prevented");
  if (afterEnter.submits !== 0) failures.push(`expected 0 submits, got ${afterEnter.submits}`);
  if (!dialogVisible) failures.push("dialog closed after composing Enter");
  if (committedValue !== "发布") failures.push(`committed value ${JSON.stringify(committedValue)}`);
  if (saveRequests.length !== 0) failures.push(`expected 0 save requests, got ${saveRequests.length}`);
  if (summary.chineseSearchRequestCount < 1) failures.push("no search request for committed text");
  if (summary.composingEscape?.searchOpen !== true) failures.push("composing Escape closed search");
  if (summary.settledEscape?.clearedQuery !== "") failures.push("first settled Escape did not clear");
  if (summary.settledEscape?.openAfterFirst !== true) failures.push("first settled Escape closed search");
  if (summary.settledEscape?.openAfterSecond !== false) failures.push("second settled Escape kept search");
}
if (failures.length) {
  console.error(`[ime-proof:${arm}] FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`[ime-proof:${arm}] PASS`);
