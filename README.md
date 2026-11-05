# FerryMapperNYC

### [Click here to try FerryMapperNYC live](https://rcoenen.github.io/FerryMapperNYC/)

A lightweight, no-framework trip planner for the NYC Ferry system. Plan routes across all active ferry lines with real schedule data, transfer times, and multiple trip options.

<table>
<tr>
<td width="300"><img src="screenshot.png" width="300" alt="FerryMapperNYC mobile screenshot"></td>
<td valign="top">

## Features

- **Route planning** across all active ferry routes
- **Live service** — official boat positions, delay-adjusted connections, trip cancellations, and service alerts, checked every 30 seconds
- **Schedule-aware** — uses real GTFS departure/arrival times, with explicit timetable fallback when live data is missing or stale
- **Transfer optimization** — configurable minimum transfer time (5 minutes by default), finds fastest connections
- **3 trip options** with Earlier/Best/Later tabs and navigation
- **Depart at / Arrive by** mode
- **Interactive map** with route highlighting, stop popups, and clickable A/B markers
- **Mobile-friendly** — responsive layout with map overlay and touch-optimized controls
- **Your location** — map button and Settings retry restore the blue dot after permissions change, with iPhone/Android help for blocked access
- **Persists search state** in localStorage across sessions

</td>
</tr>
</table>

## How it works

1. **Data pipeline** (`prepare-data.mjs`) downloads the NYC Ferry GTFS feed, parses stop/route/schedule data, deduplicates stops, and builds a routing graph
2. **Timetable routing** searches every scheduled departure on the selected date, keeping alternative connections with different arrival times and transfer counts. It finds the earliest arrival for “depart at” and the latest departure for “arrive by,” preferring fewer transfers when departure and arrival times tie.
3. **Trip options** show earlier/best/later journeys, removing trips overtaken by later departures. Stop lists come from the actual trip; calendar exceptions, after-midnight service, and transfer buffers between ferries are respected. Overnight arrivals are labeled with their day offset. If no trip meets the requested time, the app says so explicitly.

## Getting started

```bash
npm install
npm run prepare-data   # downloads GTFS feed → data/ferry-data.json
npm start              # serves on localhost
```

## Validation

```bash
npm test              # routing regressions and real-feed comparisons
npm run lint          # syntax checks for all application modules
```

## Tech stack

- Single `index.html` — no build tools, no frameworks
- [Leaflet](https://leafletjs.com/) ferry overlays + [MapLibre](https://maplibre.org/) / [OpenFreeMap](https://openfreemap.org/) simplified vector basemaps (no API key)
- Shared ferry corridors use separate parallel lanes, with spacing preserved on zoom and compact A/B endpoint labels.
- Light and Dark maps use blue water, green parks, clear neighborhood labels, and muted street detail. Building and business clutter stays hidden, and minor street names appear only at close zoom. Classic uses standard OpenStreetMap tiles and also serves as the fallback on devices without WebGL.
- Node.js script for GTFS data preparation
- GTFS source: [NYC Ferry Connexionz feed](https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx)

## Data

The official GTFS timetable is downloaded daily by GitHub Actions and validated before publishing. `data/ferry-data.json` includes stops, routes, service calendars, trip schedules, original stop-ID mappings, stop sequences, and a refresh timestamp.

Live feeds come from [NYC Ferry's developer feeds](https://www.ferry.nyc/developer-tools/). The relay in `realtime-relay/` decodes GTFS-Realtime and makes it readable by the GitHub Pages frontend; its responses are cached for 20 seconds. The client polls every 30 seconds while visible. Boat positions and trip predictions expire after 90 seconds; alerts after 10 minutes. Empty feeds are a valid result and never produce estimated boat positions.

Matching trip updates adjust routing for their service date. Cancelled/deleted trips and skipped stops are excluded; stop delays propagate until overridden or marked NO_DATA. Structured NO_SERVICE alerts exclude affected routes, trips, or landings during their reported active periods. Other notices are displayed for affected routes/stops; free text is not automatically interpreted as a cancellation. Added/unscheduled trips without a matching static schedule are not routed.

To deploy the relay to the configured Cloudflare account:

```bash
npx cf auth login
npm run live:build
npm run live:deploy
```

Set `CONFIG.REALTIME_URL` in `js/config.js` to the deployed Worker's `/v1/live` URL. The frontend remains a static site with no build step. The Worker uses the official `gtfs-realtime-bindings` decoder and a separate Vite workspace; it does not serve the site's source files.

## License

This project is released under the **MIT License**.

Use it however you want: copy, modify, fork, sell, or ship in your own projects, as long as you keep the copyright and license notice.
See [LICENSE](LICENSE).
