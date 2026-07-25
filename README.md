# 25 Ducats v16 - Home spent vs budget

This package updates the Home screen bucket chart.

## Change

The Home screen no longer shows only a ranked bar chart of spending by bucket.

It now shows each bucket's monthly spend compared with that bucket's planned budget:

- amount spent
- budget amount
- percent used
- remaining amount or over-budget amount
- colour-coded spending status

## Colour coding

- Green: low spending
- Yellow/amber: getting closer to budget
- Orange: near budget
- Red: over budget, or spending exists with no budget set

## Budget source

The Home screen budget comparison uses the newer custom budget line items from `BudgetPlannedExpenses` when available. If no line items exist for a bucket, it falls back to the bucket-level rows in `Budgets`.

## Backend

No Apps Script backend change is required for this update. The included `Code.gs` is unchanged from the attached version and is packaged for convenience.

## Files to replace

- `index.html`
- `app.js`
- `styles/mobile.css`
- optionally `styles.css` if your deployment references the single legacy stylesheet
