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
