# Personal Budget App v7 Stack Fix

This package fixes the `Maximum call stack size exceeded` error that occurred when POST buttons were clicked.

## Root cause

The v7 frontend tried to wrap `callPost` like this:

- save the current `callPost` into `ORIGINAL_CALL_POST_V7`
- redeclare `callPost`
- call `ORIGINAL_CALL_POST_V7` inside the redeclared `callPost`

Because JavaScript function declarations are hoisted, `ORIGINAL_CALL_POST_V7` ended up pointing back to the redeclared wrapper instead of the original function. That caused infinite recursion whenever any POST button called `callPost`.

## Fix

The app now uses `rawCallPostV7` for the actual fetch request and `callPost` only wraps that helper for clearer error messages.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `Code.gs`

Replace your existing frontend files with these files. The Apps Script file is included unchanged from the v7 package for convenience.
