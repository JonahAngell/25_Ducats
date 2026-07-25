# 25 Ducats v13 - Budget ordering and local draft saves

This package updates the Budget page workflow.

## Budget page ordering

The Budget page now groups content in this order:

1. Gross
2. Take-Home
3. Fixed Expenses
4. Savings
5. Necessities
6. Other

Default placement:

- Gross: Total Pay / income forecast
- Take-Home: Taxes, 401K
- Fixed Expenses: Rent, Tithing, Car Payment, Car Insurance, and the Car bucket by default
- Savings: Career, Savings, Stocks
- Necessities: Food and variable car items such as Car Charging
- Other: Fun and Other Expenses

Car expenses can be split by planned expense placement. The Car bucket defaults to Fixed Expenses, but planned expense rows such as Car Charging default to Necessities so fixed and variable car spending can both be represented.

## New Organise screen

The Budgets page now has an Organise button. It opens a screen where you can move buckets and planned expense rows between the six budget categories.

The layout is saved locally in the browser.

## Local draft saves

Budget field edits no longer post to Google Sheets continuously. Changes are backed up locally in browser storage as a draft.

The app pushes the latest budget to Google Sheets when:

- the user presses Save Budget, or
- the user leaves the Budgets screen while there are unsaved budget changes.

A small Local draft saved indicator appears while edits are waiting to sync.

## Visual changes

Fixed and percentage budget entries are visually distinguished:

- Fixed entries use a blue Fixed dollar amount pill.
- Percentage entries use a green Percentage based pill and show the selected percentage basis.

## Files

- index.html
- app.js
- Code.gs
- styles/base.css
- styles/components.css
- styles/mobile.css
- styles.css

## Backend

No new Apps Script backend action is required for this update. The included Code.gs is packaged for convenience and keeps the v12 budget support actions.
