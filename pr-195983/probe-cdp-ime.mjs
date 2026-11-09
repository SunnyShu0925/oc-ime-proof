import { chromium } from "/home/code/github/openclaw-wt/openclaw-wt-341/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.setContent(`<body><form id="f"><input id="i" type="search" aria-label="s"></form><script>
window.__trace = [];
for (const t of ["keydown","keyup","compositionstart","compositionupdate","compositionend","submit","input","beforeinput"]) {
  document.addEventListener(t, (e) => {
    window.__trace.push({type: t, key: e.key ?? null, isComposing: e.isComposing ?? null, keyCode: e.keyCode ?? null, data: e.data ?? null, value: e.target?.value ?? null, prevented: e.defaultPrevented ?? null});
  }, true);
}
document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); window.__trace.push({type:"submit-handler"}); });
</script></body>`);
await page.click("#i");
const cdp = await context.newCDPSession(page);
try {
  await cdp.send("Input.imeSetComposition", { type: "imeSetComposition", text: "nihao", selectionStart: 5, selectionEnd: 5 });
  console.log("imeSetComposition ok");
} catch (e) { console.log("imeSetComposition FAILED", e.message); }
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
// try a keyCode-229 style keydown
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Process", code: "", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
const trace = await page.evaluate(() => window.__trace);
console.log(JSON.stringify(trace, null, 1));
console.log("value=", JSON.stringify(await page.inputValue("#i")));
await browser.close();
