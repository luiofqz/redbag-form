// Fills (and optionally submits) the "Red Bag Compliance" Microsoft Form
// once per headcode. Configuration comes from environment variables.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const FORM_URL = process.env.FORM_URL;
const DUTY_NUMBER = (process.env.DUTY_NUMBER || 'LUIGI CERBAN').trim().toUpperCase();
const BASE_STATION = process.env.BASE_STATION || 'KGX';
const TURNAROUND_LOCATION = process.env.TURNAROUND_LOCATION || 'KGX';
const DRY_RUN = process.env.DRY_RUN !== 'false';
// How many forms are filled at the same time (each in its own browser context).
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CONCURRENCY) || 4));

// Headcodes typed into the workflow take priority; otherwise use the list for the
// chosen shift in shifts/<shift>.txt (one per line, '#' starts a comment).
const SHIFT = process.env.SHIFT || '0800-1600';
if (!/^\d{4}-\d{4}$/.test(SHIFT)) throw new Error(`Invalid shift: ${SHIFT}`);
const typed = (process.env.HEADCODES || '').trim();
const raw = typed || fs.readFileSync(`shifts/${SHIFT}.txt`, 'utf8').replace(/#.*$/gm, '');
const codes = [...new Set(raw.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

if (!FORM_URL) throw new Error('FORM_URL is not set');
if (codes.length === 0) {
  console.log(`::error title=No headcodes::shifts/${SHIFT}.txt has no headcodes. Add them and run again.`);
  throw new Error(`No headcodes for shift ${SHIFT}`);
}

fs.mkdirSync('out', { recursive: true });

const question = (page, title) =>
  page
    .locator('[data-automation-id="questionItem"]')
    .filter({ hasText: title })
    .first();

async function pickDropdown(page, q, value) {
  await q
    .locator('[role="combobox"], button[aria-haspopup], [aria-haspopup="listbox"]')
    .first()
    .click();
  const option = page.getByRole('option', { name: value, exact: true }).first();
  try {
    await option.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    await page.keyboard.press('Escape');
    throw new Error(`Option "${value}" not found in dropdown`);
  }
  await option.click();
}

async function pickRadio(q, label) {
  await q.getByText(label, { exact: true }).first().click();
}

async function fillOne(page, code, tm) {
  let t = Date.now();
  const lap = (k) => { const n = Date.now(); tm[k] = ((n - t) / 1000).toFixed(1); t = n; };

  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
  await question(page, 'Headcode').waitFor({ timeout: 30000 });
  lap('load');

  await pickDropdown(page, question(page, 'Headcode'), code);
  lap('headcode');
  await pickRadio(question(page, 'Type of Clean'), 'Turnaround');

  // The remaining questions appear only after Turnaround is chosen.
  await question(page, 'Turnaround Location').waitFor({ timeout: 15000 });
  lap('turnaround');
  await pickDropdown(page, question(page, 'Turnaround Location'), TURNAROUND_LOCATION);
  await question(page, 'Duty Number')
    .locator('input[type="text"], input:not([type]), textarea')
    .first()
    .fill(DUTY_NUMBER);
  await pickDropdown(page, question(page, 'Base Station'), BASE_STATION);
  await pickRadio(question(page, 'Red Bag Present'), 'Yes');
  await pickRadio(question(page, 'Red Bag Fully Stocked'), 'Yes');
  lap('rest');
}

// Prefer the Chrome that is preinstalled on GitHub's runners (no download needed);
// fall back to Playwright's own Chromium.
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}

const timings = [];

async function processOne(code) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1600 },
    locale: 'en-GB',
  });
  // Images, fonts and media are not needed to fill the form; skipping them is faster.
  await context.route('**/*', (route) =>
    ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  const page = await context.newPage();
  const t0 = Date.now();
  const tm = {};
  const shot = (name) => page.screenshot({ path: `out/${code}-${name}.png`, fullPage: true });
  let submitClicked = false;
  try {
    // Retry the fill phase only (never after Submit, to avoid duplicates).
    for (let attempt = 1; ; attempt++) {
      try {
        await fillOne(page, code, tm);
        break;
      } catch (err) {
        if (attempt >= 3 || /not found in dropdown/.test(err.message)) throw err;
        console.log(`Attempt ${attempt} for ${code} failed (${err.message.split('\n')[0]}); retrying...`);
        await page.waitForTimeout(3000 * attempt);
      }
    }
    await shot('filled');
    timings.push(`${code} load ${tm.load} hc ${tm.headcode} turn ${tm.turnaround} rest ${tm.rest} total ${((Date.now() - t0) / 1000).toFixed(1)}`);

    if (DRY_RUN) return { code, status: 'DRY RUN - filled, not submitted' };

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    submitClicked = true;
    await page.getByText(/response (was|has been) (successfully )?submitted|thank/i).first().waitFor({ timeout: 30000 });
    await shot('submitted');
    return { code, status: 'SUBMITTED' };
  } catch (err) {
    await shot('error').catch(() => {});
    const msg = err.message.split('\n').slice(0, 3).join(' | ');
    console.log(`::error title=Headcode ${code} failed::${msg}`);
    return {
      code,
      status: submitClicked
        ? 'NOT CONFIRMED - Submit was clicked, the form may have been sent. Check responses before retrying'
        : `FAILED: ${err.message.split('\n')[0]}`,
    };
  } finally {
    await context.close();
  }
}

// Small worker pool: each headcode is handled by exactly one worker.
const results = new Array(codes.length);
let nextIndex = 0;
async function poolWorker() {
  while (nextIndex < codes.length) {
    const i = nextIndex++;
    results[i] = await processOne(codes[i]);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, poolWorker));
console.log(`::notice title=Timing (seconds)::${timings.join(' | ')}`);
console.log(`Processed ${codes.length} headcode(s) in ${Math.round((Date.now() - started) / 1000)}s with concurrency ${CONCURRENCY}`);

await browser.close();

const lines = [
  `## Red Bag Compliance (${DRY_RUN ? 'dry run' : 'live'}) - ${typed ? 'typed list' : `shift ${SHIFT}`}`,
  '',
  '| Headcode | Result |',
  '| --- | --- |',
  ...results.map((r) => `| ${r.code} | ${r.status} |`),
];
const summary = lines.join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

if (results.some((r) => /^(FAILED|NOT CONFIRMED)/.test(r.status))) process.exit(1);
