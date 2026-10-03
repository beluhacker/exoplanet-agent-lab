# Exoplanet Research Dashboard

## Build
- Replace the placeholder home page with a dense, dark scientific operations dashboard.
- Add a prominent “Run Discovery Loop” control that posts to `http://127.0.0.1:8000/run-discovery`, with running, success, and error states.
- Plot target transmission-spectrum observations against simulated atmospheric fits in an interactive Recharts visualization.
- Add a live terminal-style Agent Log Stream that shows staged iterations and incorporates messages returned by the discovery endpoint when available.
- Add a Degeneracy Analysis panel that renders the final markdown-style report and ranked hypothesis scores from the response, with credible demo data as the initial state.

## Visual direction
- Use a graphite observatory-console aesthetic with crisp cyan, coral, and lime scientific signals.
- Prioritize dense data legibility, restrained borders, compact typography, and subtle status motion rather than decorative effects.
- Keep the layout responsive: an integrated workstation on desktop and a clear stacked workflow on mobile.

## Technical details
- Keep the experience on `/` and add complete page metadata.
- Use the installed Recharts and Lucide packages; avoid adding dependencies.
- Normalize likely API response shapes defensively and preserve demo content if the local endpoint is unavailable.
- Define all palette and typography roles as semantic tokens in the global design system.
- Verify the request interaction, responsive rendering, runtime console, and current build status.
