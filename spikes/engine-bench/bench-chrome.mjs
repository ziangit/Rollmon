// Drives the installed Chrome headless against index.html (served from the
// repo root) and prints the Worker's report. Usage: node bench-chrome.mjs [budget_ms]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { formatReport } from "./bench-shared.js";

const budgetMs = Number(process.argv[2] ?? 100);
const port = 8974;
const root = fileURLToPath(new URL("../..", import.meta.url));
const server = spawn("python3", ["-m", "http.server", String(port), "--directory", root], { stdio: "ignore" });
for (let i = 0; ; i++) {
  try { await fetch(`http://127.0.0.1:${port}/`); break; } catch (e) {
    if (i > 50) throw new Error("static server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const executablePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.error("page:", m.text()); });
  await page.goto(`http://127.0.0.1:${port}/spikes/engine-bench/index.html?budget=${budgetMs}`);
  await page.waitForFunction(() => window.__benchReport, { timeout: 120_000 });
  console.log(formatReport(await page.evaluate(() => window.__benchReport)));
} finally {
  await browser.close();
  server.kill();
}
