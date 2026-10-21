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

async function latestRun(env) {
  const res = await fetch(
    `${GH}/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=1`,
    { headers: ghHeaders(env.GH_TOKEN) },
  );
  if (!res.ok) throw new Error(`GitHub runs lookup failed (${res.status})`);
  const data = await res.json();
  return data.workflow_runs?.[0] ?? null;
}

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
        inputs: { headcodes: '', duty_number: name, dry_run: dry ? 'true' : 'false' },
      }),
    });
    if (res.status !== 204) return json({ error: `GitHub refused the request (${res.status}).` }, 502);
  } catch {
    return json({ error: 'Could not reach GitHub. Try again.' }, 502);
  }
  return json({ ok: true, startedAt: Date.now(), dry });
}

async function handleStatus(request, env) {
  if (!env.GH_TOKEN || !env.PASSCODE) return json({ error: 'Server is not configured.' }, 500);
  if (!safeEqual(request.headers.get('x-passcode') ?? '', env.PASSCODE)) return json({ error: 'Wrong passcode.' }, 401);
  try {
    const run = await latestRun(env);
    if (!run) return json({ run: null });
    return json({
      run: { status: run.status, conclusion: run.conclusion, createdAt: Date.parse(run.created_at) },
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
  input[type=text], input[type=password] { font:inherit; padding:12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:inherit; }
  label.check { display:flex; gap:10px; align-items:flex-start; font-weight:400; }
  label.check input { margin-top:4px; width:20px; height:20px; flex:none; }
  button { font:inherit; font-weight:700; padding:14px; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #banner { display:none; background:#fff4d6; color:#5c4400; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:14px; }
  #msg { margin-top:16px; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--card); display:none; }
  #msg.ok { border-color:var(--ok); } #msg.bad { border-color:var(--bad); }
</style>
</head>
<body>
<main>
  <h1>Red Bag Compliance</h1>
  <p class="sub">Submits the form for every train on the saved list, one response per headcode.</p>
  <div id="banner">DRY RUN: the form is filled but nothing is submitted.</div>
  <form id="f" autocomplete="off">
    <label>Your name (Duty Number)
      <input id="name" type="text" maxlength="40" required autocapitalize="characters">
    </label>
    <label>Passcode
      <input id="pass" type="password" required>
    </label>
    <label class="check">
      <input id="ok" type="checkbox" required>
      <span>I have checked the red bag on every train on the list.</span>
    </label>
    <button id="go" type="submit">Submit all</button>
  </form>
  <div id="msg" role="status" aria-live="polite"></div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const dry = new URLSearchParams(location.search).get('dry') === '1';
  if (dry) $('banner').style.display = 'block';
  try { $('name').value = localStorage.getItem('rb_name') || ''; $('pass').value = localStorage.getItem('rb_pass') || ''; } catch {}

  function show(text, kind) {
    const m = $('msg'); m.textContent = text; m.className = kind || ''; m.style.display = 'block';
  }

  async function poll(startedAt, pass) {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      try {
        const res = await fetch('/status', { headers: { 'x-passcode': pass } });
        const data = await res.json();
        const run = data.run;
        if (!run || run.createdAt < startedAt - 20000) { show('Waiting for the run to start...'); continue; }
        if (run.status !== 'completed') { show('Running... this takes a few minutes. You can close this page.'); continue; }
        if (run.conclusion === 'success') show(dry ? 'Dry run finished. Nothing was submitted.' : 'Done. All responses were submitted.', 'ok');
        else show('The run finished with problems. Tell Luigi so he can check which trains failed.', 'bad');
        return;
      } catch { /* keep polling */ }
    }
    show('Still running. Ask Luigi to check GitHub Actions.', 'bad');
  }

  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('name').value, pass = $('pass').value;
    $('go').disabled = true;
    show('Starting...');
    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, passcode: pass, confirmed: $('ok').checked, dry }),
      });
      const data = await res.json();
      if (!res.ok) { show(data.error || 'Something went wrong.', 'bad'); $('go').disabled = false; return; }
      try { localStorage.setItem('rb_name', name); localStorage.setItem('rb_pass', pass); } catch {}
      show('Started. This takes a few minutes. Do not tap again.');
      poll(data.startedAt, pass).finally(() => { $('go').disabled = false; });
    } catch {
      show('Network problem. Check your connection and try again.', 'bad');
      $('go').disabled = false;
    }
  });
</script>
</body>
</html>`;
