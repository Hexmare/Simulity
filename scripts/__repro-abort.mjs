import { chromium } from "playwright";

const port = process.argv[2] ?? "8082";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), String(m.text()).slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 160), r.failure()?.errorText));
page.on("response", (r) => {
  if (r.status() >= 400) console.log("[badresp]", r.status(), r.url().slice(0, 160));
});
console.log("goto...");
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("loaded, waiting...");
await page.waitForTimeout(15000);
console.log("title:", await page.title());
await browser.close();
console.log("done");
