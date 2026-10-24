# ⛳ The Orchard Connection

Tee-time coordination board for **Orchard Hills Golf Course** (Paramus, NJ · `40.9961, -74.0690`).

- **Live Board (GitHub Pages)**: `https://lionelnggrok-netizen.github.io/the-orchard-connection/`
- **Serverless Backend (Cloudflare Worker + KV)**: `https://the-orchard-connection.caddiebot-relay-az6p.workers.dev`
- **Private Google Sheet Database**: `https://docs.google.com/spreadsheets/d/1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU/edit`

## Key Features
1. **Chronological 4-Player Tee-Time Cards & Collapsed Past Rounds**:
   - Upcoming tee times are sorted chronologically by Date and Tee Time (`America/New_York`).
   - Finished rounds automatically move into the collapsed **Past Rounds** section at the bottom.
2. **Minimal Header + Live Orchard Hills Weather & ❄️ Frost Delay Risk**:
   - Pulls hourly `temperature_2m`, `dew_point_2m`, `precipitation_probability`, `wind_speed_10m`, `cloud_cover`, and `soil_temperature_0cm` (0cm grass temperature) from Open-Meteo for Orchard Hills (`40.9961, -74.0690`).
   - Morning tee times (`< 11:00 AM`) with dawn grass/air temperatures near or below `36°F` automatically flag **❄️ Frost Delay Risk** and switch the card background to an **icy blue theme with snowflakes** (plus a header toggle to preview the frost theme anytime).
3. **4 Slots (No Waitlist) & Registered Player Dropdown**:
   - Clicking **+ Add Tee Time** creates a 4-player card; filling Slot 1 (and any confirmed slots) and clicking the green checkmark circle (`✓`) saves the card.
   - Returning players on the **Registered Player List** can pick their name from the dropdown without re-typing their email (`✓ Email on file`), while new friends enter Name + Email once and are automatically added to the player list.
   - Only player names are shown on the public board; emails and cancel tokens remain strictly private in the backend.
4. **Calendar Invites, Alerts & One-Click Cancel Links**:
   - Saving a spot generates a Google Calendar invite link, `.ics` calendar file, and a unique **one-click cancel link**.
   - Clicking a slot's cancel link removes that player's name and reopens the spot—or if **Slot 1 (the poster)** cancels via their link, cancels the entire tee-time card and notifies everyone.
   - **Standing Privacy/Notification Rule**: `lionel.keat@gmail.com` (Lionel Ng) is strictly filtered out from all outgoing email calls in both the Worker and Google Apps Script (`isNeverEmail`), keeping Lionel's notifications chat-only.
5. **Per-Card Mini Chat Thread + Email Reply Sync**:
   - Each card has an inline chat thread that emails **only the players signed up on that specific tee-time card**.
   - Replies to `[Orchard #<cardId>]` emails sync back into that card's chat thread via `/api/email/inbound`.
