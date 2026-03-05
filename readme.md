# Alibi

## Overview
Alibi loads as a standalone page and initializes its UI on load. Entry page: `index.html`.

## What you can do
- Open the app from the Apps menu (or navigate directly to its route).
- Use any visible controls, menus, sliders, buttons, or toggles.
- If the app includes a visual/canvas area, changes should appear as you interact with controls.

## How it works
- The app loads its entry page, then initializes scripts and styles referenced by that page.
- Rendering updates are driven by the app’s internal event handlers (button clicks, input changes, etc.).

## Key files (for edits)
### Pages
- `index.html`

### Scripts
- `app.js`

### Styles
- `styles.css`

### Folders
- `assets/`

## Troubleshooting
- If something looks stale after deploy: hard refresh (mobile: pull-to-refresh + clear site data if needed).
- If something looks empty: open the Console and fix missing file errors first (404/failed to load).
- If input responds but visuals don’t update: refresh once to reinitialize the render loop.
