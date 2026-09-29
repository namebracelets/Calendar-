# ⚜️ French Market Foot Traffic Dashboard

A mobile-first calendar of events expected to drive foot traffic to the New Orleans French Market and the 1200 block of N. Peters St. It's a plain static site (HTML, Tailwind from a CDN, vanilla JavaScript). There's no build step, and it's free to host on GitHub Pages.

| File | What it is |
|---|---|
| `index.html` | The calendar vendors use |
| `builder.html` | Turns a spreadsheet (CSV) into a monthly data file |
| `events-YYYY-MM.json` | One data file per month, e.g. `events-2026-10.json` |
| `events-template.csv` | Spreadsheet template for `builder.html` |
| `assets/` | Shared code (categories, colors, rounding) and the calendar logic |

> The included `events-2026-09.json` and `events-2026-10.json` are **sample data**, marked `"sample": true`, which shows a yellow "Sample data" banner. Replace them with audited data before sharing the link.

---

## One-time setup: publish on GitHub Pages (about 10 minutes)

1. Create a free account at <https://github.com> if you don't have one.
2. Click **+ → New repository**. Name it something like `french-market-events`, set it to **Public**, and click **Create repository**.
3. On the new repo page, click **uploading an existing file**. Drag in **everything inside this folder**, including the `assets` folder, then click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and click **Save**.
5. After a minute or two the site is live at
   `https://YOUR-USERNAME.github.io/french-market-events/`
   Share that link with vendors. It works on any phone browser, and they can use *Add to Home Screen* to get an app icon.

(Netlify or Vercel also work. Drag the folder onto <https://app.netlify.com/drop>.)

---

## Monthly update (about 5 minutes)

1. Fill in the spreadsheet using the columns from `events-template.csv` (one row per event):

   | Column | Required | Example |
   |---|---|---|
   | `title` | ✔ | Tech Industry Conference |
   | `category` | ✔ | One of the 9 names exactly: Conventions, Cruise Ships, Sports, Concerts, Youth Events, Festivals, Parades, Tours/Charters, Miscellaneous |
   | `start_date` | ✔ | 2026-10-16 |
   | `end_date` | | 2026-10-18 (blank = one-day event) |
   | `total_attendance` | ✔ | 35000 |
   | `daily_attendance` | | `2026-10-16:12000; 2026-10-17:13000; 2026-10-18:10000` (blank = total split evenly across the days) |
   | `impact_window` | | 10:30 AM – 1:30 PM |
   | `location` | | Ernest N. Morial Convention Center |
   | `proximity` | | Direct Market Proximity (1200 Block N. Peters) · MCCNO Corridor · Superdome |
   | `notes` | | Street closure on N. Peters during route |
   | `sources` | | URLs separated by `;` |

2. Export it as CSV (Google Sheets: *File → Download → CSV*; Excel: *Save As → CSV UTF-8*).
3. Open `https://YOUR-USERNAME.github.io/french-market-events/builder.html`, pick the month, load the CSV, fix any red errors, and click **Download JSON**. You get a file named like `events-2026-11.json`.
4. On GitHub, open your repo, click **Add file → Upload files**, drop in the JSON file, and click **Commit changes**. Uploading a file with the same name replaces that month.
5. The calendar updates within a minute or two. If a phone shows old data, refresh the page.

**File names must match exactly:** `events-2026-11.json`, not `events-2026-11 (1).json`. Browsers add " (1)" when you download a file twice. Rename the file before uploading, or upload over the existing file on GitHub.

**Two file layouts work:** the builder's output (`{"month": ..., "events": [...]}` with `startDate`, `totalAttendance`, …) or a plain list of events using the spreadsheet column names (`start_date`, `total_attendance`, `daily_attendance`, …).

**Multi-month events** (e.g. Sep 30 – Oct 2): put the event in *both* months' spreadsheets. Each calendar shows only the days in its own month. The modal still shows the full span and total.

---

## How the app behaves

- It opens on the device's current month. **◄ Last Month / This Month / Next Month ►** switch between the three months around today without reloading the page.
- Each day shows one colored badge per category that has events, labeled `[rounded attendance] [category]`. Phones show at most 3 badges plus "+X more". Day shading gets darker as the total crowd grows.
- Rounding: under 1,000 goes to the nearest 100 (250 → 300). At 1,000 and up it goes to the nearest thousand (12,800 → 13K).
- Tap a day or badge to see the full date, the daily total, and a card for each event with its daily attendance, span and total, French Market impact window, location, and proximity tag. Close with ×, a tap outside the card, or Esc.
- If a month's file hasn't been uploaded yet, the page says: *"Data for [Month Year] is currently being audited and will be available shortly."*

To change category colors or names, edit the `CATEGORIES` list in `assets/shared.js`. To keep data files in a subfolder, set `DATA_PATH` in the same file (e.g. `"data/"`).

---

## Data audit checklist (for whoever compiles each month)

**Check these sources**
- **Conventions:** MCCNO calendar (mccno.com), New Orleans & Company Meeting Planner Guide, hotel event registries (Hilton Riverside, Marriott Canal, Sheraton, Hyatt Regency).
- **Cruise Ships:** Port NOLA cruise terminal schedule (portnola.com), CruiseMapper/CruiseDig, Viking Mississippi, and American Cruise Lines docking schedules.
- **Stadiums & stages:** Caesars Superdome, Smoothie King Center, Saenger Theatre, Mahalia Jackson Theater, Fillmore NOLA, House of Blues.
- **Tour groups & charters:** GroupTrips.com, Peoria Charter, Miller Travel, Military Reunion Network, Diamond Tours.
- **Permits & safety:** City of New Orleans One Stop Shop (special events, closures, second lines), NORTA service alerts & detours, NOPD special event and traffic advisories.
- **News & culture:** WWL-TV, WDSU, Fox 8, NOLA.com/Times-Picayune, Biz New Orleans, New Orleans CityBusiness, City Press Office, Ready.NOLA.gov, OffBeat, WWOZ community calendar, French Quarter Journal.

**Leave these out**
- ✖ Elementary/primary (K–5) field trips. Include middle school, high school, and college charters **only** if their itinerary has a window at the market.
- ✖ Daily hop-on/hop-off buses and routine city walking tours.
- ✖ Steamboat NATCHEZ and Creole Queen daily departures.
- ✖ Private second lines that start or march more than 2 blocks from the Flea/Farmers Market sheds. Major public French Quarter parades (Krewe of BOO!, Krewe du Vieux, Barkus, etc.) are always included.
