# ⚜️ French Market Foot Traffic Dashboard

A mobile-first calendar of events expected to drive foot traffic to the New Orleans French Market and the 1200 block of N. Peters St. It's a plain static site (HTML, Tailwind from a CDN, vanilla JavaScript). There's no build step, and it's free to host on GitHub Pages.

| File | What it is |
|---|---|
| `index.html` | The calendar vendors use |
| `admin/` | Private admin page for adding, editing, importing, and publishing events |
| `events-YYYY-MM.json` | One data file per month, e.g. `events-2026-10.json`. The admin page writes these for you |
| `events-template.csv` | Example spreadsheet layout (optional; the admin page reads most layouts) |
| `assets/` | Calendar code, shared settings (categories, colors, rounding), the importer, and the admin code |

Live site: <https://namebracelets.github.io/Calendar-/>
Admin: <https://namebracelets.github.io/Calendar-/admin/> (not linked from the calendar; bookmark it)

---

## Admin page

### First time on a device (about 5 minutes)

1. **Create a GitHub token** (a key that lets the admin page save to this repository):
   - Signed in to GitHub, open <https://github.com/settings/personal-access-tokens/new>.
   - Name it *Calendar admin*. For Expiration, choose the longest option offered.
   - Repository access: **Only select repositories**, then choose **Calendar-**.
   - Permissions → Repository permissions → **Contents: Read and write**.
   - Click **Generate token** and copy it. GitHub only shows it once.
2. Open the admin page. Your username and repository are filled in. Paste the token, choose an **admin password**, and tap **Connect**.

The token is encrypted with your admin password and saved only in that browser. It is never put on the public website. Next time, you just type your password. On a new phone or computer, repeat step 2 (you can reuse the same token if you saved it somewhere safe, or make a new one).

### Everyday use

- **Events tab:** browse by month, search, **+ Add event**, **Edit**, **Delete**, or tick several and **Delete selected**. Changes collect in a bar at the bottom. Tap **Update Dashboard** to publish them all at once, or **Discard**.
- **Import / Paste tab:** drop in a file or paste text, then tap **Check data**. It reads:
  - Excel files (.xlsx, .xls), CSV, and JSON (including the old file layouts)
  - Rows copied straight out of Google Sheets or Excel
  - Typed lines, one event per line, e.g. `Oct 18 | Saints vs Falcons | Sports | 70,000 | Caesars Superdome | 9am-11:30am`

  Column names don't need to match exactly ("Event", "Venue", "Expected Attendance", "Dates" all work). Rows it can't use are shown in red with **Fix** buttons. Choose **Replace** (swap out everything in those months, which is best for a full month's list) or **Add**, then tap **Update Dashboard**.
- Publishing saves straight to GitHub. The live calendar updates **about a minute later** while GitHub rebuilds the site.
- Every publish is saved in the repository's history, so an older version can always be recovered.
- If the token expires, log in and choose **Use a different GitHub token** to paste a new one.

Events that run across two months (e.g. Oct 30 – Nov 1) are saved into both months' files automatically.

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
