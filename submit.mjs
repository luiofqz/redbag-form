// Fills (and optionally submits) the "Red Bag Compliance" Microsoft Form
// once per headcode. Configuration comes from environment variables.
import { chromium } from 'playwright';
import fs from 'node:fs';

const FORM_URL = process.env.FORM_URL;
const DUTY_NUMBER = process.env.DUTY_NUMBER || 'LUIGI CERBAN';
const BASE_STATION = process.env.BASE_STATION || 'KGX';
const TURNAROUND_LOCATION = process.env.TURNAROUND_LOCATION || 'KGX';
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Headcodes typed into the workflow take priority; otherwise use headcodes.txt
// (one per line, everything after '#' is ignored).
const typed = (process.env.HEADCODES || '').trim();
const raw = typed || fs.readFileSync('headcodes.txt', 'utf8').replace(/#.*$/gm, '');
const codes = [...new Set(raw.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

if (!FORM_URL) throw new Error('FORM_URL is not set');
if (codes.length === 0) throw new Error('No headcodes provided');

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

async function fillOne(page, code) {
  await page.goto(FORM_URL, { waitUntil: 'networkidle' });
  await question(page, 'Headcode').waitFor({ timeout: 30000 });

  await pickDropdown(page, question(page, 'Headcode'), code);
  await pickRadio(question(page, 'Type of Clean'), 'Turnaround');

  // The remaining questions appear only after Turnaround is chosen.
  await question(page, 'Turnaround Location').waitFor({ timeout: 15000 });
  await pickDropdown(page, question(page, 'Turnaround Location'), TURNAROUND_LOCATION);
  await question(page, 'Duty Number')
    .locator('input[type="text"], input:not([type]), textarea')
    .first()
    .fill(DUTY_NUMBER);
  await pickDropdown(page, question(page, 'Base Station'), BASE_STATION);
  await pickRadio(question(page, 'Red Bag Present'), 'Yes');
  await pickRadio(question(page, 'Red Bag Fully Stocked'), 'Yes');
}

const browser = await chromium.launch();
const results = [];

for (const code of codes) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1600 },
    locale: 'en-GB',
  });
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: `out/${code}-${name}.png`, fullPage: true });
  try {
    await fillOne(page, code);
    await shot('filled');

    if (DRY_RUN) {
      results.push({ code, status: 'DRY RUN - filled, not submitted' });
    } else {
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.getByText(/response (was|has been) (successfully )?submitted|thank/i).first().waitFor({ timeout: 30000 });
      await shot('submitted');
      results.push({ code, status: 'SUBMITTED' });
    }
  } catch (err) {
    await shot('error').catch(() => {});
    const msg = err.message.split('\n').slice(0, 3).join(' | ');
    console.log(`::error title=Headcode ${code} failed::${msg}`);
    results.push({ code, status: `FAILED: ${err.message.split('\n')[0]}` });
  } finally {
    await context.close();
  }
}

await browser.close();

const lines = [
  `## Red Bag Compliance (${DRY_RUN ? 'dry run' : 'live'})`,
  '',
  '| Headcode | Result |',
  '| --- | --- |',
  ...results.map((r) => `| ${r.code} | ${r.status} |`),
];
const summary = lines.join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

if (results.some((r) => r.status.startsWith('FAILED'))) process.exit(1);
