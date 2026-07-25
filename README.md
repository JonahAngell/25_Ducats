# 25 Ducats Mobile Redesign v9

This package redesigns the app shell and major views for mobile-first use while keeping the existing Apps Script backend contract.

## What changed

- Replaced the desktop sidebar with a sticky mobile header and fixed bottom navigation.
- Added a floating transfer shortcut button.
- Reworked Buckets, Transactions, Transfers, and Bucket Admin alias displays into card-first mobile layouts.
- Kept larger desktop tables available above desktop widths.
- Kept the existing Budget Planner card layout and tightened it for mobile.
- Split CSS into multiple files:
  - `styles/base.css`
  - `styles/components.css`
  - `styles/mobile.css`
- Left `app.js` as one file for compatibility, but appended mobile rendering overrides at the bottom.

## Files to deploy

- `index.html`
- `app.js`
- `styles/base.css`
- `styles/components.css`
- `styles/mobile.css`

## Backend

No Apps Script redeployment is required for this package if your current POST actions are already working.
