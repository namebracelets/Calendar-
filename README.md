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

### Data format

Spreadsheets and CSVs use one row per event, with this header (other column names are recognized too):

```
title,category,start_date,end_date,total_attendance,daily_attendance,market_visitors,daily_market_visitors,impact_window,location,proximity,notes,sources
```

- `category` is one of the 9 categories. `daily_attendance` is optional (`2026-10-16:12000; 2026-10-17:13000`). If it's left blank, the total is split evenly across the days. `sources` are separated by `;`.
- **Estimated market visitors** (optional): the people likely to walk through the Farmers and Flea Market sheds during market hours because of the event.
  - `market_visitors`: the event's total. `daily_market_visitors`: per day, in the same format as `daily_attendance` (`2026-10-16:1200; 2026-10-17:1300`). If only the total is given, it's split evenly across the days.
  - `0` is a real value: that event isn't shown on that day. A blank cell means "not given."
  - In the month files the fields are `marketVisitors` and `dailyMarketVisitors`.
  - `total_attendance` and `daily_attendance` stay the event's whole crowd.
- **When a month has market figures** (any event in its file has them), that month shows the market-visitor view:
  - Badges, day totals, "Busiest" and shading use market visitors. Shading steps are 3,000+, 6,000+, 9,000+ and 12,000+.
  - The day window starts with *Estimated Market Visitors*, then *Estimated Downtown Visitors* (the day's total attendees across everything listed), hotel occupancy and weather.
  - Each event shows its market visitors and total daily attendees.
  - Months without market figures look as they always have.
- **Free-range tourists:** visitors staying downtown with no scheduled event during market hours. They come as one ordinary **Miscellaneous** row per day, titled "Free-range tourists". `total_attendance` is the number of such visitors in town; `market_visitors` is those likely to pass through the sheds.
- **Estimated hotel occupancy** goes in one extra row with the same header and **Hotel Occupancy** as its category (any capitalization). It isn't an event: it never becomes a badge and never counts toward crowd totals.
  - `daily_attendance`: one whole-number percentage (0–100) per date, e.g. `2026-10-01:51; 2026-10-02:74; …; 2026-10-31:92`.
  - `total_attendance`: the month's average. `start_date`/`end_date` give the period it covers.
  - `notes` and `sources`: how the estimate was made. They're saved with the figures.
  - The import preview shows it as one line (e.g. *Estimated hotel occupancy: Oct 1–31 (31 days), 51%–95%*).
  - **Bad entries** (not a real date, no percentage, or not a whole number from 0 to 100) don't stop the import. The good figures are published, and each bad entry is flagged:
    - The calendar shows a red **!** next to that day's date.
    - The day window explains which entry was wrong and how to fix it.
    - An entry whose date isn't a real day (e.g. `2026-10-32:40`) is shown in a red notice above that month's calendar instead.
    - To clear a flag, correct the entry in the spreadsheet and import the Hotel Occupancy row again (Add or Replace).
  - **Replace** swaps out the figures and flags for each month the row covers. **Add** sets the listed dates, clears their old flags, and leaves the other days alone.
  - See the last row of `events-template.csv` for an example.

In each month file, the admin page stores the figures as `"hotelOccupancy": { "2026-10-01": 51, … }`, with `hotelOccupancyNotes`, `hotelOccupancySources`, and any flagged entries in `hotelOccupancyIssues`. A month with figures but no events still gets a file.

## Vendor check-ins (Google Form setup)

Returning visitors get a short "how was business?" question at most once a day. Answers are anonymous. Each one holds a random ID made once per phone, the date rated, the answer, the weekday and month, whether it was answered the same day or looking back, and the app version. There's no name, email, IP address or sales amount.

Answer codes: `1` very busy, `2` somewhat busy, `3` average, `4` somewhat slow, `5` very slow, `didn't work`.

Until the steps below are done, answers stay on each vendor's phone and the daily vendor summary stays hidden.

1. **Create the form.** Go to <https://forms.google.com> and start a blank form.
   - In **Settings → Responses**, turn off **Collect email addresses** and **Limit to 1 response**, so no sign-in is needed.
   - Add 7 **Short answer** questions, in this order: `Vendor ID`, `Date rated`, `Answer`, `Weekday`, `Month`, `Same day or looking back`, `App version`.
2. **Link a Sheet.** On the **Responses** tab, click **Link to Sheets** → **Create a new spreadsheet**.
3. **Get the pre-filled link.** In the form's **⋮** menu, choose **Get pre-filled link**. Type `x` in every box, click **Get link**, and copy it. Send that link to Claude Code, which will fill in the settings block at the top of `assets/checkin.js`.
4. **Add the Summary tab.** In the Sheet, add a tab named **Summary**. In cell **A1**, paste this formula. It keeps each vendor's latest answer per date, then counts answers per date:

   ```
   =QUERY(SORTN(SORT(FILTER('Form Responses 1'!A2:H, 'Form Responses 1'!B2:B<>""), 1, FALSE), 9^9, 2, 2, TRUE, 3, TRUE), "select Col3, Col4, count(Col2) group by Col3, Col4 label Col3 'Date', Col4 'Answer', count(Col2) 'Count'", 0)
   ```

   If your responses tab has a different name, change `Form Responses 1` to match.
5. **Publish only the Summary tab.** Choose **File → Share → Publish to web**. Pick **Summary** (not the whole document) and **Comma-separated values (.csv)**, then click **Publish**. Copy the link and send it to Claude Code. The tab with individual answers is never published.

A day's details show something like "8 vendors answered: 3 very busy, 2 somewhat busy, 3 average" once at least 3 vendors who worked that day have answered. Answers that couldn't be sent (for example, while offline) are kept on the phone and retried on the next visit.

## Weather

Each day shows a weather icon:
- **Past days:** observed conditions.
- **Today through 13 days ahead:** the forecast. Days 8–14 are marked "extended forecast, less certain."
- **Later days:** typical conditions, in a lighter shade.

The day window has a link to a small weather window with morning and afternoon conditions, rain, high and low, wind, humidity and any National Weather Service alerts.

Sources are free and need no keys: Open-Meteo (forecast and archive) and the National Weather Service. Typical conditions come from `weather-normals.json`, built once from 30 years of Open-Meteo archive data with `node scripts/build-weather-normals.mjs`. Weather is cached on the phone for about an hour. If a service is down, the calendar works without it.

## How the app behaves

- It opens on the device's current month. **◄ Last Month / This Month / Next Month ►** switch between the three months around today without reloading the page.
- Each day shows one colored badge per category that has events, labeled `[rounded attendance] [category]`. Phones show at most 3 badges plus "+X more". Day shading gets darker as the total crowd grows.
- Rounding: under 1,000 goes to the nearest 100 (250 → 300). At 1,000 and up it goes to the nearest thousand (12,800 → 13K).
- Tap a day or badge to see the full date, the daily total, and a card for each event with its daily attendance, span and total, French Market impact window, location, and proximity tag. Close with ×, a tap outside the card, or Esc.
- **First visit:** a short tutorial (about 8 seconds) taps today's square and opens its details. Any tap or key ends it, and **How it works** by the legend replays it. Returning visitors get the vendor check-in instead, at most once a day.
- Vendors who have rated about 10 days get a **Your days** note, worked out on their phone only. It shows how their busy and slow days lined up with market visitors, weekdays, kinds of events and rain, plus upcoming days that look like their best ones.
- If a day has an estimated hotel occupancy figure, its window shows *Estimated Hotel Occupancy: 51%* under the foot-traffic line. A day with a figure but no events still opens, showing the figure and "No tracked events".
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
