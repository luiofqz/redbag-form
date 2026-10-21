# redbag-form

Completes the "Red Bag Compliance" Microsoft Form for one or more headcodes.

Fixed values: Type of Clean = Turnaround, Turnaround Location = KGX,
Duty Number = LUIGI CERBAN, Base Station = KGX, Red Bag Present = Yes,
Red Bag Fully Stocked = Yes.

## Usage

GitHub app or github.com -> Actions -> "Submit Red Bag form" -> Run workflow.

- `headcodes`: one or more headcodes, separated by spaces, commas or new lines.
- `dry_run`: when ticked, the form is filled but NOT submitted. Screenshots of
  the filled form are attached to the run (artifact "screenshots").

Running the workflow with `dry_run` off submits one response per headcode, so
only do it for trains where the red bag has actually been checked.

## Web page for colleagues (Cloudflare Worker)

`worker.js` is a small web page (name + passcode + confirmation) that starts the
workflow with the colleague's name as Duty Number and the saved list from
`headcodes.txt`. The GitHub token stays on the server, never in the page.

Setup (once, about 10 minutes):

1. GitHub -> Settings -> Developer settings -> Fine-grained personal access
   tokens -> Generate new token. Repository access: **Only select repositories**
   -> `luiofqz/redbag-form`. Permissions -> Repository permissions ->
   **Actions: Read and write**. Choose the longest expiry and copy the token.
2. dash.cloudflare.com -> Workers & Pages -> Create -> Start with Hello World
   -> Deploy -> Edit code -> replace everything with the contents of
   `worker.js` -> Deploy.
3. Worker -> Settings -> Variables and Secrets -> add two **secrets**:
   `GH_TOKEN` (the token from step 1) and `PASSCODE` (a long passphrase,
   12+ characters) -> Deploy.
4. Open the worker URL (`https://<name>.<account>.workers.dev`). Add `?dry=1`
   to the URL to test: the form is filled but nothing is submitted.

Give colleagues the plain URL and the passcode. The token expires; when it does,
create a new one and update the `GH_TOKEN` secret.
