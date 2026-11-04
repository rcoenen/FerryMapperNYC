# FerryMapperNYC

### [Click here to try FerryMapperNYC live](https://rcoenen.github.io/FerryMapperNYC/)

A lightweight, no-framework trip planner for the NYC Ferry system. Plan routes across all active ferry lines with real schedule data, transfer times, and multiple trip options.

<table>
<tr>
<td width="300"><img src="screenshot.png" width="300" alt="FerryMapperNYC mobile screenshot"></td>
<td valign="top">

## Features

- **Route planning** across 39 ferry stops and 7 active routes
- **Schedule-aware** — uses real GTFS departure/arrival times
- **Transfer optimization** — configurable minimum transfer time (5 minutes by default), finds fastest connections
- **3 trip options** with Earlier/Requested/Later tabs and navigation
- **Depart at / Arrive by** mode
- **Interactive map** with route highlighting, stop popups, and clickable A/B markers
- **Mobile-friendly** — responsive layout with map overlay and touch-optimized controls
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
- Light and Dark maps hide buildings, minor roads, and street labels; Classic uses standard OpenStreetMap tiles and also serves as the fallback on devices without WebGL
- Node.js script for GTFS data preparation
- GTFS source: [NYC Ferry Connexionz feed](https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx)

## Data

The `data/ferry-data.json` file contains:
- **39 ferry stops**
- **7 active routes** (Astoria, East River, Rockaway East, Rockaway-Soundview, Rockaway West, South Brooklyn, St. George)
- **503 trip schedules** with full stop times
- Pre-built routing graph with edges from all trip patterns per route

## License

This project is released under the **MIT License**.

Use it however you want: copy, modify, fork, sell, or ship in your own projects, as long as you keep the copyright and license notice.
See [LICENSE](LICENSE).
