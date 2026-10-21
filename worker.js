// Cloudflare Worker: a small web page + API that starts the GitHub workflow.
// The GitHub token never reaches the browser.
//
// Worker secrets (Settings -> Variables and Secrets):
//   GH_TOKEN  fine-grained GitHub token, repo luiofqz/redbag-form only,
//             permission "Actions: Read and write"
//   PASSCODE  shared passphrase that colleagues type on the page (12+ chars)

const REPO = 'luiofqz/redbag-form';
const WORKFLOW = 'submit.yml';
const GH = 'https://api.github.com';

// Shifts offered on the page. The value must match an option of the workflow's
// "shift" input and a file shifts/<value>.txt in the repository.
const SHIFTS = [
  { value: '0800-1600', label: '08:00 - 16:00' },
  { value: '0630-1430', label: '06:30 - 14:30' },
];

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'redbag-form-worker',
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// Constant-time string comparison.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const NAME_RE = /^\p{L}[\p{L} '.\-]{1,39}$/u;

async function listRuns(env, perPage) {
  const res = await fetch(
    `${GH}/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=${perPage}`,
    { headers: ghHeaders(env.GH_TOKEN) },
  );
  if (!res.ok) throw new Error(`GitHub runs lookup failed (${res.status})`);
  const data = await res.json();
  return data.workflow_runs ?? [];
}

const latestRun = async (env) => (await listRuns(env, 1))[0] ?? null;

async function handleRun(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!env.GH_TOKEN || !env.PASSCODE) return json({ error: 'Server is not configured.' }, 500);
  if (!safeEqual(body.passcode ?? '', env.PASSCODE)) return json({ error: 'Wrong passcode.' }, 401);

  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!NAME_RE.test(name)) return json({ error: 'Enter a valid name (letters and spaces, 2-40 characters).' }, 400);
  const shift = String(body.shift ?? '');
  if (!SHIFTS.some((s) => s.value === shift)) return json({ error: 'Choose a shift.' }, 400);
  if (body.confirmed !== true) return json({ error: 'Please confirm the red bags were checked.' }, 400);
  const dry = body.dry === true;

  try {
    const last = await latestRun(env);
    if (last && ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(last.status)) {
      return json({ error: 'A run is already in progress. Wait for it to finish.' }, 409);
    }

    const res = await fetch(`${GH}/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { ...ghHeaders(env.GH_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: { shift, headcodes: '', duty_number: name, dry_run: dry ? 'true' : 'false' },
      }),
    });
    if (res.status !== 204) return json({ error: `GitHub refused the request (${res.status}).` }, 502);
  } catch {
    return json({ error: 'Could not reach GitHub. Try again.' }, 502);
  }
  return json({ ok: true, startedAt: Date.now(), dry, shift });
}

async function handleStatus(request, env) {
  if (!env.GH_TOKEN || !env.PASSCODE) return json({ error: 'Server is not configured.' }, 500);
  if (!safeEqual(request.headers.get('x-passcode') ?? '', env.PASSCODE)) return json({ error: 'Wrong passcode.' }, 401);
  try {
    const runs = await listRuns(env, 10);
    return json({
      runs: runs.map((r) => ({ status: r.status, conclusion: r.conclusion, createdAt: Date.parse(r.created_at) })),
    });
  } catch {
    return json({ error: 'Could not reach GitHub.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/run') return handleRun(request, env);
    if (request.method === 'GET' && pathname === '/status') return handleStatus(request, env);
    if (request.method === 'GET' && pathname === '/') {
      return new Response(PAGE, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

const SHIFT_OPTIONS = SHIFTS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Red Bag Compliance</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f4f5; --card:#fff; --fg:#1d1b1c; --muted:#6b6468; --accent:#8a1f45; --line:#ddd6d9; --ok:#1a7f4b; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141213; --card:#1e1b1c; --fg:#f1eded; --muted:#a39a9e; --line:#3a3436; --accent:#d4557f; --ok:#4cc38a; --bad:#ff7b72; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:420px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:8px 0 4px; }
  p.sub { color:var(--muted); margin:0 0 20px; }
  form { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; display:grid; gap:14px; }
  label { display:grid; gap:6px; font-weight:600; font-size:14px; }
  input[type=text], input[type=password], select { font:inherit; padding:12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:inherit; }
  label.check { display:flex; gap:10px; align-items:flex-start; font-weight:400; }
  label.check input { margin-top:4px; width:20px; height:20px; flex:none; }
  button { font:inherit; font-weight:700; padding:14px; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #banner { display:none; background:#fff4d6; color:#5c4400; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:14px; }
  #msg { margin-top:16px; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--card); display:none; }
  #msg.ok { border-color:var(--ok); } #msg.bad { border-color:var(--bad); }
  [hidden] { display:none !important; }
  #result { padding:16px; border-radius:10px; text-align:center; font-weight:700; border:2px solid var(--ok); }
  #result.bad { border-color:var(--bad); }
  #result a { display:inline-block; margin-top:8px; font-weight:400; color:var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Red Bag Compliance</h1>
  <p class="sub">Submits the form for every train on the saved list of the chosen shift, one response per headcode.</p>
  <div id="banner">DRY RUN: the form is filled but nothing is submitted.</div>
  <form id="f" autocomplete="off">
    <label>Your name (Duty Number)
      <input id="name" type="text" maxlength="40" required autocapitalize="characters">
    </label>
    <label>Shift
      <select id="shift" required>${SHIFT_OPTIONS}</select>
    </label>
    <label>Passcode
      <input id="pass" type="password" required>
    </label>
    <label class="check">
      <input id="ok" type="checkbox" required>
      <span>I have checked the red bag on every train of this shift.</span>
    </label>
    <button id="go" type="submit">Submit all</button>
    <div id="result" role="status" aria-live="polite" hidden></div>
  </form>
  <div id="msg" role="status" aria-live="polite"></div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const dry = new URLSearchParams(location.search).get('dry') === '1';
  if (dry) $('banner').style.display = 'block';
  try {
    $('name').value = localStorage.getItem('rb_name') || '';
    $('pass').value = localStorage.getItem('rb_pass') || '';
    const saved = localStorage.getItem('rb_shift');
    if (saved && [...$('shift').options].some((o) => o.value === saved)) $('shift').value = saved;
  } catch {}

  function show(text, kind) {
    const m = $('msg'); m.textContent = text; m.className = kind || ''; m.style.display = 'block';
  }

  // Replaces the Submit button with the final result.
  function finish(kind, text) {
    try { localStorage.removeItem('rb_run'); } catch {}
    $('msg').style.display = 'none';
    $('go').hidden = true;
    const r = $('result');
    r.className = kind;
    r.textContent = text;
    r.appendChild(document.createElement('br'));
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Start another';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      r.hidden = true;
      $('go').hidden = false;
      $('go').disabled = false;
      $('ok').checked = false;
    });
    r.appendChild(a);
    r.hidden = false;
  }

  async function poll(startedAt, pass, label, isDry) {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      try {
        const res = await fetch('/status', { headers: { 'x-passcode': pass } });
        if (res.status === 401) { finish('bad', 'Wrong passcode.'); return; }
        const data = await res.json();
        // Our run is the oldest one created after we pressed the button.
        const run = (data.runs || []).filter((r) => r.createdAt >= startedAt - 20000).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!run) { show('Waiting for the run to start...'); continue; }
        if (run.status !== 'completed') { show('Running... this takes a few minutes. Keep this page open. If you close it, open the same link again on this phone and the result will appear.'); continue; }
        if (run.conclusion === 'success') finish('ok', isDry ? 'Dry run finished ✔ Nothing was submitted.' : 'Done ✔ All responses were submitted (' + label + ').');
        else finish('bad', 'Finished with problems. Do not run again before checking. Tell Luigi so he can check which trains failed.');
        return;
      } catch { /* keep polling */ }
    }
    finish('bad', 'Still running. Ask Luigi to check GitHub Actions.');
  }

  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('name').value, pass = $('pass').value;
    const label = $('shift').selectedOptions[0].textContent;
    $('go').disabled = true;
    show('Starting...');
    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, shift: $('shift').value, passcode: pass, confirmed: $('ok').checked, dry }),
      });
      const data = await res.json();
      if (!res.ok) { show(data.error || 'Something went wrong.', 'bad'); $('go').disabled = false; return; }
      try { localStorage.setItem('rb_name', name); localStorage.setItem('rb_pass', pass); localStorage.setItem('rb_shift', $('shift').value); } catch {}
      try { localStorage.setItem('rb_run', JSON.stringify({ startedAt: data.startedAt, label, dry })); } catch {}
      show('Started. This takes a few minutes. Keep this page open until you see the confirmation. Do not tap again.');
      poll(data.startedAt, pass, label, dry);
    } catch {
      show('Network problem. Check your connection and try again.', 'bad');
      $('go').disabled = false;
    }
  });

  // If the page was closed while a run was in progress, pick the run up again.
  try {
    const saved = JSON.parse(localStorage.getItem('rb_run') || 'null');
    const pass = localStorage.getItem('rb_pass');
    if (saved && pass && Date.now() - saved.startedAt < 45 * 60 * 1000) {
      $('go').disabled = true;
      show('Checking the run you started earlier...');
      poll(saved.startedAt, pass, saved.label, saved.dry);
    } else if (saved) {
      localStorage.removeItem('rb_run');
    }
  } catch {}
</script>
</body>
</html>`;
