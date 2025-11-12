# Transit Meeting Point Finder

A web-based tool to find optimal meeting points for multiple people using public transit data (GTFS format).

## Features

- Finds the best meeting point for 2+ people starting from different locations
- Uses real GTFS (General Transit Feed Specification) data
- Considers:
  - Public transit routes (buses, trains, trams, etc.)
  - Walking between stops (via pathways, transfers, and geographic proximity)
  - Wait times and travel times
  - Fairness (minimizes maximum travel time)

## How to Use

### 1. GTFS Data

The app automatically loads GTFS files from the `gtfs_subset/` folder. This subset contains Berlin transit data with:
- `stops.txt` - Stop/station information
- `stop_times.txt` - Schedule data
- `trips.txt` - Trip information
- `routes.txt` - Route details
- `pathways.txt` - Walking paths between platforms
- `transfers.txt` - Transfer information

### 2. Run Locally

Serve it with a local web server (required for file loading):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`

Note: You cannot just open `index.html` directly due to CORS restrictions. You must use a web server.

### 3. Use the Tool

1. The page automatically loads the GTFS data on startup
2. Set the start time (e.g., 13:00)
3. Enter starting stations for Person A and Person B (e.g., "Alexanderplatz", "U Spittelmarkt")
4. Click "Find Meeting Point"
5. View the results showing:
   - Optimal meeting location
   - Travel time for each person
   - Detailed route with all transit connections and walks

## How It Works

The algorithm uses a multi-person Dijkstra search:

1. Each person has their own priority queue (frontier) of possible actions
2. At each step, we pop the globally shortest action (by total elapsed time)
3. Actions include:
   - Taking transit (wait + ride time)
   - Walking via pathways/transfers (30s minimum)
   - Walking to nearby stops (within 10 min @ 1.3 m/s)
4. A meeting is found when all people have reached the same platform
5. The algorithm ensures fairness by reporting each person's travel time

## GitHub Pages Deployment

To host on GitHub Pages:

1. Create a new repository
2. Upload all files:
   - `index.html`
   - `meeting-finder.js`
   - `README.md`
   - `gtfs_subset/` folder with all 6 .txt files
3. Go to Settings → Pages
4. Select main branch as source
5. Your site will be at `https://username.github.io/repo-name/`

The GTFS subset is small enough (~16MB total) to be hosted directly on GitHub.

## Limitations

- Requires client-side processing (large GTFS files may be slow)
- No server-side optimization
- Search capped at 2 hours travel time per person
- Works best with complete GTFS datasets

## Credits

Translated from Python to JavaScript for browser-based usage.
