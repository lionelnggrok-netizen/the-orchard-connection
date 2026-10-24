const API_BASE = "https://the-orchard-connection.caddiebot-relay-az6p.workers.dev";
const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=40.9961&longitude=-74.0690&hourly=temperature_2m,dew_point_2m,precipitation_probability,wind_speed_10m,cloud_cover,soil_temperature_0cm&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&forecast_days=14";

let boardState = {
  players: [],
  teeTimes: [],
  serverTime: null
};

let weatherHourly = null; // Map of "YYYY-MM-DDTHH:00" -> { temp, dew, rain, wind, cloud, soil }
let frostPreviewForced = false;
let openChatCardIds = new Set(["tt_sample_frost_oct25"]);
let openEditCardIds = new Set();

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRegisteredName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  return boardState.players.some(p => p.name.toLowerCase() === n);
}

function getEasternNowIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hh = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}`;
}

function isPastTeeTime(dateStr, timeStr) {
  const nowEt = getEasternNowIso();
  const target = `${dateStr}T${timeStr}`;
  return target < nowEt;
}

function formatCardDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${days[dt.getUTCDay()]}, ${months[dt.getUTCMonth()]} ${d}`;
  } catch {
    return dateStr;
  }
}

function formatCardTime(timeStr) {
  try {
    const [hh, mm] = timeStr.split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function formatChatTimeEt(isoStr) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(isoStr)) + " ET";
  } catch {
    return "";
  }
}

function showStatusBanner(message, type = "ok") {
  const banner = document.getElementById("statusBanner");
  const icon = document.getElementById("statusBannerIcon");
  const text = document.getElementById("statusBannerText");
  banner.classList.remove("hidden", "status-cancel");
  if (type === "cancel") {
    banner.classList.add("status-cancel");
    icon.textContent = "ℹ️";
  } else {
    icon.textContent = "✓";
  }
  text.textContent = message;
}

function openConfirmationModal({ title, subtitle, googleCalUrl, icsUrl, cancelUrl }) {
  const modal = document.getElementById("confirmModal");
  document.getElementById("confirmModalTitle").textContent = title || "Spot Confirmed!";
  document.getElementById("confirmModalSubtitle").textContent = subtitle || "";
  document.getElementById("modalGoogleCalLink").href = googleCalUrl || "#";
  document.getElementById("modalIcsLink").href = icsUrl || "#";

  const cancelBox = document.getElementById("modalCancelLinkBox");
  const cancelInput = document.getElementById("modalCancelUrlInput");
  if (cancelUrl) {
    cancelBox.classList.remove("hidden");
    cancelInput.value = cancelUrl;
  } else {
    cancelBox.classList.add("hidden");
  }
  modal.classList.remove("hidden");
}

async function fetchWeatherForecast() {
  try {
    const resp = await fetch(OPEN_METEO_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || !data.hourly || !Array.isArray(data.hourly.time)) return;

    const map = {};
    const h = data.hourly;
    for (let i = 0; i < h.time.length; i++) {
      map[h.time[i]] = {
        temp: h.temperature_2m ? h.temperature_2m[i] : null,
        dew: h.dew_point_2m ? h.dew_point_2m[i] : null,
        rain: h.precipitation_probability ? h.precipitation_probability[i] : null,
        wind: h.wind_speed_10m ? h.wind_speed_10m[i] : null,
        cloud: h.cloud_cover ? h.cloud_cover[i] : null,
        soil: h.soil_temperature_0cm ? h.soil_temperature_0cm[i] : null
      };
    }
    weatherHourly = map;
    renderBoard();
    updateNewTeeWeatherPreview();
  } catch (err) {
    console.warn("Weather fetch error:", err);
  }
}

/**
 * Evaluates weather & Frost Delay Risk for a given date ("YYYY-MM-DD") and time ("HH:MM")
 * at Orchard Hills Golf Course (Paramus, NJ).
 */
function getCardWeatherAndFrost(dateStr, timeStr) {
  const hourNum = Number((timeStr || "08:00").split(":")[0]);
  const isMorning = hourNum < 11;
  const hourKey = `${dateStr}T${String(hourNum).padStart(2, "0")}:00`;

  const slotWeather = weatherHourly && weatherHourly[hourKey] ? weatherHourly[hourKey] : null;

  // Check dawn window (05:00 to 08:00 + tee time hour) for frost risk on morning rounds
  let minSoil = null;
  let minAir = null;
  let dawnWind = null;
  let dawnCloud = null;

  if (weatherHourly && isMorning) {
    const checkHours = ["05:00", "06:00", "07:00", "08:00", `${String(hourNum).padStart(2, "0")}:00`];
    for (const hm of checkHours) {
      const w = weatherHourly[`${dateStr}T${hm}`];
      if (!w) continue;
      if (typeof w.soil === "number" && (minSoil === null || w.soil < minSoil)) {
        minSoil = w.soil;
      }
      if (typeof w.temp === "number" && (minAir === null || w.temp < minAir)) {
        minAir = w.temp;
        dawnWind = w.wind;
        dawnCloud = w.cloud;
      }
    }
  }

  let liveFrostRisk = false;
  let frostReason = "";

  if (isMorning) {
    if (minSoil !== null && minSoil <= 36.5) {
      liveFrostRisk = true;
      frostReason = `Dawn grass ${Math.round(minSoil)}°F · Air ${minAir !== null ? Math.round(minAir) + "°F" : ""}`;
    } else if (minAir !== null && minAir <= 36.5) {
      liveFrostRisk = true;
      frostReason = `Dawn air ${Math.round(minAir)}°F`;
    } else if (
      minAir !== null &&
      minAir <= 38.5 &&
      (dawnWind === null || dawnWind <= 8) &&
      (dawnCloud === null || dawnCloud <= 45) &&
      (minSoil === null || minSoil <= 37.5)
    ) {
      liveFrostRisk = true;
      frostReason = `Dawn ${Math.round(minSoil ?? minAir)}°F · Clear & calm`;
    }
  }

  const isFrostRisk = isMorning && (liveFrostRisk || frostPreviewForced);
  if (isFrostRisk && !frostReason) {
    frostReason = slotWeather && typeof slotWeather.soil === "number"
      ? `Dawn grass ${Math.round(slotWeather.soil)}°F (Preview)`
      : "Morning Frost Delay Preview";
  }

  return {
    hasForecast: Boolean(slotWeather && typeof slotWeather.temp === "number"),
    temp: slotWeather && typeof slotWeather.temp === "number" ? Math.round(slotWeather.temp) : null,
    wind: slotWeather && typeof slotWeather.wind === "number" ? Math.round(slotWeather.wind) : null,
    rain: slotWeather && typeof slotWeather.rain === "number" ? Math.round(slotWeather.rain) : 0,
    soil: slotWeather && typeof slotWeather.soil === "number" ? Math.round(slotWeather.soil) : null,
    isMorning,
    isFrostRisk,
    frostReason
  };
}

function renderPlayerRosterAndDatalist() {
  const countBadge = document.getElementById("playerCountBadge");
  const chipsContainer = document.getElementById("registeredPlayersChips");
  const datalist = document.getElementById("registeredPlayersDatalist");

  countBadge.textContent = String(boardState.players.length);

  chipsContainer.innerHTML = boardState.players
    .map(p => `<span class="roster-chip">⛳ ${escapeHtml(p.name)}</span>`)
    .join("");

  datalist.innerHTML = boardState.players
    .map(p => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");

  renderAddTeeTimeSlotsBuilder();
}

function renderAddTeeTimeSlotsBuilder() {
  const container = document.getElementById("newTeeSlotsContainer");
  if (!container) return;

  const playerOptions = [
    `<option value="">— Pick registered player or type below —</option>`,
    ...boardState.players.map(
      p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`
    )
  ].join("");

  let html = "";
  for (let s = 1; s <= 4; s++) {
    const isPoster = s === 1;
    const defaultName = isPoster ? "Lionel Ng" : "";
    const isReg = isRegisteredName(defaultName);

    html += `
      <div class="builder-slot-box" data-builder-slot="${s}">
        <div class="builder-slot-head">
          <span>Slot ${s} ${isPoster ? "(Poster / Host *)" : "(Optional)"}</span>
          <span>${isPoster ? "Required" : "Open if blank"}</span>
        </div>
        <select class="builder-player-select" data-slot="${s}" aria-label="Pick registered player for Slot ${s}">
          ${playerOptions}
        </select>
        <input
          type="text"
          class="builder-name-input"
          data-slot="${s}"
          list="registeredPlayersDatalist"
          placeholder="${isPoster ? "Your Name (e.g. Lionel Ng)" : "Friend's Name (or leave open)"}"
          value="${escapeHtml(defaultName)}"
          ${isPoster ? "required" : ""}
        />
        <input
          type="email"
          class="builder-email-input ${isReg || !defaultName ? "hidden" : ""}"
          data-slot="${s}"
          placeholder="Friend's Email (saved privately)"
        />
        <div class="email-on-file-pill ${isReg ? "" : "hidden"}" data-slot-pill="${s}">
          ✓ Registered player (email on file)
        </div>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll(".builder-player-select").forEach(sel => {
    const s = sel.getAttribute("data-slot");
    const nameInput = container.querySelector(`.builder-name-input[data-slot="${s}"]`);
    if (nameInput && nameInput.value) {
      sel.value = nameInput.value;
    }
    sel.addEventListener("change", () => {
      if (sel.value) {
        nameInput.value = sel.value;
      }
      syncBuilderSlotEmailVisibility(s);
    });
  });

  container.querySelectorAll(".builder-name-input").forEach(inp => {
    const s = inp.getAttribute("data-slot");
    inp.addEventListener("input", () => syncBuilderSlotEmailVisibility(s));
  });
}

function syncBuilderSlotEmailVisibility(slotNum) {
  const container = document.getElementById("newTeeSlotsContainer");
  const nameInput = container.querySelector(`.builder-name-input[data-slot="${slotNum}"]`);
  const emailInput = container.querySelector(`.builder-email-input[data-slot="${slotNum}"]`);
  const pill = container.querySelector(`[data-slot-pill="${slotNum}"]`);
  const val = String(nameInput.value || "").trim();

  if (!val) {
    emailInput.classList.add("hidden");
    emailInput.required = false;
    pill.classList.add("hidden");
  } else if (isRegisteredName(val)) {
    emailInput.classList.add("hidden");
    emailInput.required = false;
    emailInput.value = "";
    pill.classList.remove("hidden");
  } else {
    emailInput.classList.remove("hidden");
    emailInput.required = true;
    pill.classList.add("hidden");
  }
}

function updateNewTeeWeatherPreview() {
  const dateVal = document.getElementById("newTeeDate").value;
  const timeVal = document.getElementById("newTeeTime").value;
  const previewEl = document.getElementById("newTeeWeatherPreview");
  if (!dateVal || !timeVal) {
    previewEl.textContent = "Pick a date & time to preview Orchard Hills forecast";
    return;
  }
  const wf = getCardWeatherAndFrost(dateVal, timeVal);
  if (!wf.hasForecast) {
    previewEl.innerHTML = `⛳ <strong>${escapeHtml(formatCardDate(dateVal))} · ${escapeHtml(formatCardTime(timeVal))}</strong> (Forecast available within 14 days)`;
    return;
  }
  previewEl.innerHTML = `
    <strong>Orchard Hills Forecast:</strong> 🌡️ ${wf.temp}°F · 💨 ${wf.wind} mph · 🌧️ ${wf.rain}%
    ${wf.isFrostRisk ? `<span style="margin-left:8px;color:#0284c7;font-weight:700;">❄️ Frost Delay Risk (${escapeHtml(wf.frostReason)}) — Card will turn Icy Blue!</span>` : ""}
  `;
}

function renderCardEditDrawerHtml(card) {
  const isEditOpen = openEditCardIds.has(card.id);
  const slot1Name = (card.slots && card.slots[0] && card.slots[0].name) || "Slot 1 Poster";

  const editSlotsRowsHtml = (card.slots || [])
    .map(s => {
      const sNum = s.slot;
      const currentName = s.name || "";
      const isKnownOrCurrent = Boolean(currentName) || isRegisteredName(currentName);

      const selectOpts = [
        `<option value="">Pick registered...</option>`,
        ...boardState.players.map(
          p =>
            `<option value="${escapeHtml(p.name)}" ${
              p.name.toLowerCase() === currentName.toLowerCase() ? "selected" : ""
            }>${escapeHtml(p.name)}</option>`
        )
      ].join("");

      return `
        <div class="edit-slot-item" data-edit-slot-row="${sNum}">
          <span class="edit-slot-label">Slot ${sNum}${sNum === 1 ? " *" : ""}</span>
          <select class="edit-slot-select" data-slot="${sNum}" aria-label="Select registered player for Slot ${sNum}">
            ${selectOpts}
          </select>
          <input
            type="text"
            class="edit-slot-name-input"
            data-slot="${sNum}"
            data-original-name="${escapeHtml(currentName)}"
            list="registeredPlayersDatalist"
            placeholder="${sNum === 1 ? "Poster Name (Required)" : "Open slot (or type name)"}"
            value="${escapeHtml(currentName)}"
            ${sNum === 1 ? "required" : ""}
          />
          <input
            type="email"
            class="edit-slot-email-input ${isKnownOrCurrent || !currentName ? "hidden" : ""}"
            data-slot="${sNum}"
            placeholder="New player's email"
          />
          <span class="slot-email-saved-tag ${isKnownOrCurrent && currentName ? "" : "hidden"}" data-edit-saved-tag="${sNum}">
            ✓ Email on file
          </span>
          ${
            sNum > 1
              ? `<button type="button" class="edit-slot-clear-btn" data-action="clear-edit-slot" data-slot="${sNum}" title="Clear Slot ${sNum}">Clear</button>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  return `
    <div class="card-edit-drawer ${isEditOpen ? "" : "hidden"}" data-edit-drawer="${escapeHtml(card.id)}">
      <div class="edit-drawer-head">
        <div class="edit-drawer-title">
          <span>✎ Edit Tee Time &amp; Players</span>
        </div>
        <button type="button" class="icon-close-btn" data-action="toggle-edit" data-card-id="${escapeHtml(card.id)}" title="Close Edit">✕</button>
      </div>

      <form class="card-edit-form" data-card-id="${escapeHtml(card.id)}">
        <div class="edit-datetime-row">
          <div class="field-group">
            <label>Date</label>
            <input type="date" class="edit-date-input" value="${escapeHtml(card.date)}" required />
          </div>
          <div class="field-group">
            <label>Tee Time</label>
            <input type="time" class="edit-time-input" value="${escapeHtml(card.time)}" required />
          </div>
        </div>

        <div class="edit-slots-stack" style="margin-top:10px;">
          ${editSlotsRowsHtml}
        </div>

        <div class="edit-error-banner hidden" data-edit-error="${escapeHtml(card.id)}" style="margin-top:10px;"></div>

        <div class="edit-verify-footer" style="margin-top:10px;">
          <div class="edit-verify-group">
            <label class="edit-verify-label">🔒 Verify Slot 1 (${escapeHtml(slot1Name)}) Email:</label>
            <input
              type="email"
              class="edit-poster-email-input"
              placeholder="Enter ${escapeHtml(slot1Name)}'s email to save"
              required
            />
          </div>

          <div class="edit-actions-right">
            <button
              type="button"
              class="btn-danger-outline"
              data-action="cancel-entire-card-edit"
              data-card-id="${escapeHtml(card.id)}"
              title="Cancel and remove this entire tee-time card"
            >
              🗑 Cancel Tee Time
            </button>
            <span class="save-hint">Save</span>
            <button type="submit" class="check-circle-btn" title="Verify Slot 1 Email &amp; Save Changes" aria-label="Save Tee Time Changes">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  `;
}

function renderTeeTimeCard(card, isPast = false) {
  const wf = getCardWeatherAndFrost(card.date, card.time);
  const openSlotsCount = card.slots.filter(s => !s.filled).length;
  const frostClass = !isPast && wf.isFrostRisk ? "card-frost-risk" : "";
  const isEditOpen = openEditCardIds.has(card.id);

  const weatherBadgeHtml = wf.hasForecast
    ? `
      <div class="weather-badge" title="Live Orchard Hills (Paramus, NJ) hourly forecast">
        <span class="weather-metric">🌡️ ${wf.temp}°F</span>
        <span class="weather-sep">·</span>
        <span class="weather-metric">💨 ${wf.wind} mph</span>
        <span class="weather-sep">·</span>
        <span class="weather-metric">🌧️ ${wf.rain}%</span>
      </div>
    `
    : `<div class="weather-badge">⛳ Paramus, NJ · 9 Holes</div>`;

  const frostAlertHtml =
    !isPast && wf.isFrostRisk
      ? `<div class="frost-alert-badge" title="Overnight/dawn grass & air temperature indicates frost delay potential at Orchard Hills">
           <span>❄️ Frost Delay Risk</span>
           <span>· ${escapeHtml(wf.frostReason)}</span>
         </div>`
      : "";

  const playerOptionsHtml = [
    `<option value="">Pick player...</option>`,
    ...boardState.players.map(
      p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`
    )
  ].join("");

  const slotsHtml = card.slots
    .map(slotObj => {
      if (slotObj.filled) {
        const roleLabel = slotObj.slot === 1 ? "Poster / Host" : "Confirmed";
        const cancelHint =
          slotObj.slot === 1
            ? "Cancel entire tee time card (Slot 1 host)"
            : `Remove ${slotObj.name} and reopen Slot ${slotObj.slot}`;

        return `
          <div class="slot-row slot-filled">
            <div class="slot-num-badge">${slotObj.slot}</div>
            <div class="slot-player-info">
              <div>
                <span class="slot-player-name">${escapeHtml(slotObj.name)}</span>
                <span class="slot-role-tag">${roleLabel}</span>
              </div>
              ${
                !isPast
                  ? `<button type="button" class="slot-cancel-inline-btn" data-action="cancel-slot" data-card-id="${escapeHtml(card.id)}" data-slot="${slotObj.slot}" data-player-name="${escapeHtml(slotObj.name)}" title="${escapeHtml(cancelHint)}">✕ Drop</button>`
                  : ""
              }
            </div>
          </div>
        `;
      }

      if (isPast) {
        return `
          <div class="slot-row">
            <div class="slot-num-badge">${slotObj.slot}</div>
            <div class="slot-player-info">
              <span style="color:#94a3b8;font-size:13px;">Unfilled slot</span>
            </div>
          </div>
        `;
      }

      return `
        <div class="slot-row">
          <div class="slot-num-badge">${slotObj.slot}</div>
          <form class="slot-claim-form" data-card-id="${escapeHtml(card.id)}" data-slot="${slotObj.slot}">
            <select class="slot-player-select" aria-label="Select registered player for Slot ${slotObj.slot}">
              ${playerOptionsHtml}
            </select>
            <input
              type="text"
              class="slot-input slot-name-input"
              list="registeredPlayersDatalist"
              placeholder="Or type Name..."
              required
            />
            <input
              type="email"
              class="slot-input slot-email-input hidden"
              placeholder="Email (kept private)"
            />
            <span class="slot-email-saved-tag hidden">✓ Email on file</span>
            <button type="submit" class="check-circle-btn" title="Claim Slot ${slotObj.slot}" aria-label="Save Slot ${slotObj.slot}">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </form>
        </div>
      `;
    })
    .join("");

  const chatMessages = Array.isArray(card.chat) ? card.chat : [];
  const isChatOpen = openChatCardIds.has(card.id) || chatMessages.length > 0;

  const chatListHtml =
    chatMessages.length === 0
      ? `<div class="chat-empty-state">No messages yet. Start a note for the players on this tee time!</div>`
      : chatMessages
          .map(
            m => `
          <div class="chat-msg-item">
            <div class="chat-msg-head">
              <span class="chat-sender">${escapeHtml(m.senderName)}</span>
              <span class="chat-meta">
                ${m.via === "email" ? `<span class="via-email-pill">📧 via email reply</span>` : ""}
                <span>${escapeHtml(formatChatTimeEt(m.createdAt))}</span>
              </span>
            </div>
            <div class="chat-text">${escapeHtml(m.text)}</div>
          </div>
        `
          )
          .join("");

  return `
    <article id="${escapeHtml(card.id)}" class="teetime-card ${frostClass}" data-card-id="${escapeHtml(card.id)}">
      <!-- Minimal Header: Date & Tee Time + Edit Button + Live Weather / Frost Badge -->
      <div class="card-header">
        <div class="card-datetime-block">
          <div class="card-date-row">
            <span class="card-date-text">${escapeHtml(formatCardDate(card.date))}</span>
            <span class="spots-pill ${openSlotsCount === 0 ? "spots-full" : ""}">
              ${openSlotsCount === 0 ? "Full (4/4)" : `${openSlotsCount} spot${openSlotsCount === 1 ? "" : "s"} open`}
            </span>
            <button
              type="button"
              class="card-edit-trigger-btn ${isEditOpen ? "active" : ""}"
              data-action="toggle-edit"
              data-card-id="${escapeHtml(card.id)}"
              title="Edit Tee Time or Players (verifies Slot 1 poster's email)"
            >
              ✎ Edit
            </button>
          </div>
          <div class="card-time-text">
            ${!isPast && wf.isFrostRisk ? `<span aria-hidden="true">❄️</span>` : ""}
            <span>${escapeHtml(formatCardTime(card.time))}</span>
          </div>
        </div>

        <div class="card-weather-col">
          ${weatherBadgeHtml}
          ${frostAlertHtml}
        </div>
      </div>

      <!-- Inline Edit Drawer (Verified by Slot 1 Poster Email) -->
      ${renderCardEditDrawerHtml(card)}

      <!-- 4 Player Slots (Strictly 4, No Waitlist) -->
      <div class="slots-list">
        ${slotsHtml}
      </div>

      <!-- Card Footer Bar -->
      <div class="card-footer-bar">
        <div class="card-util-btns">
          <a href="${escapeHtml(card.googleCalUrl)}" target="_blank" rel="noopener" class="chip-btn" title="Add to Google Calendar">
            📅 + Google Cal
          </a>
          <a href="${escapeHtml(card.icsUrl)}" class="chip-btn" title="Download .ics Calendar Invite">
            📥 .ics
          </a>
          <button type="button" class="chip-btn" data-action="share-card" data-card-id="${escapeHtml(card.id)}">
            📤 Copy Invite
          </button>
        </div>

        <button type="button" class="chip-btn" data-action="toggle-chat" data-card-id="${escapeHtml(card.id)}">
          💬 Card Chat (${chatMessages.length})
        </button>
      </div>

      <!-- Per-Card Mini Chat Thread (Synced with Email) -->
      <div class="card-chat-box ${isChatOpen ? "" : "hidden"}" data-chat-box="${escapeHtml(card.id)}">
        <div class="chat-messages-list">
          ${chatListHtml}
        </div>
        <form class="chat-compose-form" data-card-id="${escapeHtml(card.id)}">
          <input
            type="text"
            class="chat-sender-input"
            list="registeredPlayersDatalist"
            placeholder="Your Name"
            value="Lionel Ng"
            required
          />
          <input
            type="text"
            class="chat-text-input"
            placeholder="Message this tee-time group..."
            required
          />
          <button type="submit" class="chat-send-btn">Send ➤</button>
        </form>
        <div class="chat-sync-caption">
          📧 Emails only players signed up on this card · Reply directly to the email to post back here.
        </div>
      </div>
    </article>
  `;
}

function renderBoard() {
  const upcomingGrid = document.getElementById("upcomingCardsGrid");
  const pastGrid = document.getElementById("pastCardsContainer");
  const upcomingBadge = document.getElementById("upcomingCountBadge");
  const pastBadge = document.getElementById("pastCountBadge");

  const sorted = [...(boardState.teeTimes || [])].sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
  );

  const upcoming = [];
  const past = [];

  for (const t of sorted) {
    if (isPastTeeTime(t.date, t.time)) {
      past.push(t);
    } else {
      upcoming.push(t);
    }
  }

  upcomingBadge.textContent = String(upcoming.length);
  pastBadge.textContent = String(past.length);

  if (upcoming.length === 0) {
    upcomingGrid.innerHTML = `
      <div class="panel-card" style="grid-column: 1 / -1; text-align: center; padding: 36px 20px;">
        <h3 style="margin:0 0 6px;font-family:'Outfit',sans-serif;">No Upcoming Tee Times Posted Yet</h3>
        <p style="margin:0 0 14px;color:#52665b;font-size:14px;">Click <strong>＋ Add Tee Time</strong> above to post your next Orchard Hills round.</p>
      </div>
    `;
  } else {
    upcomingGrid.innerHTML = upcoming.map(c => renderTeeTimeCard(c, false)).join("");
  }

  // Past rounds sorted newest-finished first inside the collapsed section
  const pastReversed = [...past].reverse();
  pastGrid.innerHTML =
    pastReversed.length === 0
      ? `<div style="color:#64748b;font-size:13px;padding:8px;">No past rounds recorded yet.</div>`
      : pastReversed.map(c => renderTeeTimeCard(c, true)).join("");

  bindCardInteractiveEvents();
}

function bindCardInteractiveEvents() {
  // 1. Open Slot Form interactions (Dropdown + Name autocomplete + smart Email visibility)
  document.querySelectorAll(".slot-claim-form").forEach(form => {
    const selectEl = form.querySelector(".slot-player-select");
    const nameInput = form.querySelector(".slot-name-input");
    const emailInput = form.querySelector(".slot-email-input");
    const savedTag = form.querySelector(".slot-email-saved-tag");

    function updateSlotInputs() {
      const val = String(nameInput.value || "").trim();
      if (!val) {
        emailInput.classList.add("hidden");
        emailInput.required = false;
        savedTag.classList.add("hidden");
      } else if (isRegisteredName(val)) {
        emailInput.classList.add("hidden");
        emailInput.required = false;
        emailInput.value = "";
        savedTag.classList.remove("hidden");
      } else {
        emailInput.classList.remove("hidden");
        emailInput.required = true;
        savedTag.classList.add("hidden");
      }
    }

    selectEl.addEventListener("change", () => {
      if (selectEl.value) {
        nameInput.value = selectEl.value;
      }
      updateSlotInputs();
    });

    nameInput.addEventListener("input", () => {
      updateSlotInputs();
    });

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const cardId = form.getAttribute("data-card-id");
      const slot = Number(form.getAttribute("data-slot"));
      const name = String(nameInput.value || "").trim();
      const email = String(emailInput.value || "").trim();
      if (!name) return;

      const btn = form.querySelector("button[type='submit']");
      btn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/api/slots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, slot, name, email })
        });
        const data = await resp.json();
        if (!resp.ok) {
          alert(data.error || "Could not claim slot.");
          btn.disabled = false;
          return;
        }
        boardState = data;
        renderPlayerRosterAndDatalist();
        renderBoard();

        if (data.claimed) {
          openConfirmationModal({
            title: `Slot ${data.claimed.slot} Claimed — ${data.claimed.name}`,
            subtitle:
              "Your spot is locked in! Confirmation email, calendar invite & one-click cancel link are ready.",
            googleCalUrl: data.claimed.googleCalUrl,
            icsUrl: data.claimed.icsUrl,
            cancelUrl: data.claimed.cancelUrl
          });
        }
      } catch (err) {
        alert("Network error saving slot: " + err.message);
        btn.disabled = false;
      }
    });
  });

  // 2. Toggle Inline Card Edit Drawer ("✎ Edit")
  document.querySelectorAll("[data-action='toggle-edit']").forEach(btn => {
    btn.addEventListener("click", () => {
      const cardId = btn.getAttribute("data-card-id");
      const drawer = document.querySelector(`[data-edit-drawer="${cardId}"]`);
      if (!drawer) return;
      const isHidden = drawer.classList.contains("hidden");
      if (isHidden) {
        drawer.classList.remove("hidden");
        openEditCardIds.add(cardId);
      } else {
        drawer.classList.add("hidden");
        openEditCardIds.delete(cardId);
      }
      document
        .querySelectorAll(`.card-edit-trigger-btn[data-card-id="${cardId}"]`)
        .forEach(b => b.classList.toggle("active", isHidden));
    });
  });

  // 2b. Inline Card Edit Form Interactions & Submission (Verifies Slot 1 Poster Email)
  document.querySelectorAll(".card-edit-form").forEach(form => {
    const cardId = form.getAttribute("data-card-id");
    const errBanner = form.querySelector(`[data-edit-error="${cardId}"]`);

    function showEditError(msg) {
      if (!errBanner) return;
      if (!msg) {
        errBanner.classList.add("hidden");
        errBanner.textContent = "";
      } else {
        errBanner.textContent = msg;
        errBanner.classList.remove("hidden");
      }
    }

    form.querySelectorAll(".edit-slot-item").forEach(row => {
      const selectEl = row.querySelector(".edit-slot-select");
      const nameInp = row.querySelector(".edit-slot-name-input");
      const emailInp = row.querySelector(".edit-slot-email-input");
      const savedTag = row.querySelector(".slot-email-saved-tag");
      const clearBtn = row.querySelector("[data-action='clear-edit-slot']");
      const origName = String(nameInp.getAttribute("data-original-name") || "").trim().toLowerCase();

      function syncRowEmailField() {
        const val = String(nameInp.value || "").trim();
        const isSameAsOriginal = Boolean(val && origName && val.toLowerCase() === origName);
        if (!val) {
          emailInp.classList.add("hidden");
          emailInp.required = false;
          emailInp.value = "";
          savedTag.classList.add("hidden");
        } else if (isSameAsOriginal || isRegisteredName(val)) {
          emailInp.classList.add("hidden");
          emailInp.required = false;
          emailInp.value = "";
          savedTag.classList.remove("hidden");
        } else {
          emailInp.classList.remove("hidden");
          emailInp.required = true;
          savedTag.classList.add("hidden");
        }
      }

      selectEl.addEventListener("change", () => {
        if (selectEl.value) {
          nameInp.value = selectEl.value;
        }
        syncRowEmailField();
      });

      nameInp.addEventListener("input", () => {
        syncRowEmailField();
      });

      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          selectEl.value = "";
          nameInp.value = "";
          syncRowEmailField();
        });
      }
    });

    // Cancel Entire Tee Time button inside Edit Drawer (requires Slot 1 poster's email)
    const cancelCardBtn = form.querySelector("[data-action='cancel-entire-card-edit']");
    if (cancelCardBtn) {
      cancelCardBtn.addEventListener("click", async () => {
        showEditError("");
        const posterEmailInp = form.querySelector(".edit-poster-email-input");
        const posterEmail = String(posterEmailInp.value || "").trim();
        if (!posterEmail || !posterEmail.includes("@")) {
          showEditError("Please enter Slot 1 poster's email first to verify before canceling the tee time.");
          posterEmailInp.focus();
          return;
        }
        if (!confirm("Cancel this entire tee-time card and notify all players on it?")) return;

        cancelCardBtn.disabled = true;
        try {
          const resp = await fetch(`${API_BASE}/api/teetime/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId, posterEmail, cancelEntireCard: true })
          });
          const data = await resp.json();
          cancelCardBtn.disabled = false;
          if (!resp.ok) {
            showEditError(data.error || "Could not verify poster email.");
            return;
          }
          openEditCardIds.delete(cardId);
          boardState = data;
          renderPlayerRosterAndDatalist();
          renderBoard();
          if (data.editResult && data.editResult.message) {
            showStatusBanner(data.editResult.message, "cancel");
          }
        } catch (err) {
          cancelCardBtn.disabled = false;
          showEditError("Network error: " + err.message);
        }
      });
    }

    // Submit Edit Form (Save Date, Tee Time, and/or 4 Player Slots)
    form.addEventListener("submit", async e => {
      e.preventDefault();
      showEditError("");

      const date = form.querySelector(".edit-date-input").value;
      const time = form.querySelector(".edit-time-input").value;
      const posterEmail = String(form.querySelector(".edit-poster-email-input").value || "").trim();

      if (!posterEmail || !posterEmail.includes("@")) {
        showEditError("Please enter Slot 1 poster's email address to verify and save changes.");
        return;
      }

      const slots = [];
      for (let s = 1; s <= 4; s++) {
        const nameInp = form.querySelector(`.edit-slot-name-input[data-slot="${s}"]`);
        const emailInp = form.querySelector(`.edit-slot-email-input[data-slot="${s}"]`);
        const sName = String(nameInp ? nameInp.value : "").trim();
        const sEmail = String(emailInp ? emailInp.value : "").trim();
        slots.push({ slot: s, name: sName, email: sEmail });
      }

      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/api/teetime/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, posterEmail, date, time, slots })
        });
        const data = await resp.json();
        submitBtn.disabled = false;
        if (!resp.ok) {
          showEditError(data.error || "Could not save edits.");
          return;
        }
        openEditCardIds.delete(cardId);
        boardState = data;
        renderPlayerRosterAndDatalist();
        renderBoard();
        if (data.editResult && data.editResult.message) {
          showStatusBanner(data.editResult.message, "ok");
        }
      } catch (err) {
        submitBtn.disabled = false;
        showEditError("Network error saving edits: " + err.message);
      }
    });
  });

  // 3. Inline Cancel / Drop Button
  document.querySelectorAll("[data-action='cancel-slot']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cardId = btn.getAttribute("data-card-id");
      const slot = Number(btn.getAttribute("data-slot"));
      const playerName = btn.getAttribute("data-player-name");
      const promptMsg =
        slot === 1
          ? `Cancel Slot 1 (${playerName})? Since Slot 1 is the poster, this will cancel the ENTIRE tee-time card and notify the group.`
          : `Remove ${playerName} from Slot ${slot} and reopen this spot?`;
      if (!confirm(promptMsg)) return;

      try {
        const resp = await fetch(`${API_BASE}/api/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, slot })
        });
        const data = await resp.json();
        if (!resp.ok) {
          alert(data.error || "Could not cancel spot.");
          return;
        }
        boardState = data;
        renderBoard();
        if (data.cancelResult && data.cancelResult.message) {
          showStatusBanner(data.cancelResult.message, "cancel");
        }
      } catch (err) {
        alert("Error canceling spot: " + err.message);
      }
    });
  });

  // 4. Toggle Card Chat
  document.querySelectorAll("[data-action='toggle-chat']").forEach(btn => {
    btn.addEventListener("click", () => {
      const cardId = btn.getAttribute("data-card-id");
      const box = document.querySelector(`[data-chat-box="${cardId}"]`);
      if (!box) return;
      const isHidden = box.classList.contains("hidden");
      if (isHidden) {
        box.classList.remove("hidden");
        openChatCardIds.add(cardId);
      } else {
        box.classList.add("hidden");
        openChatCardIds.delete(cardId);
      }
    });
  });

  // 5. Share / Copy Card Invite
  document.querySelectorAll("[data-action='share-card']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cardId = btn.getAttribute("data-card-id");
      const card = (boardState.teeTimes || []).find(c => c.id === cardId);
      if (!card) return;
      const openCount = card.slots.filter(s => !s.filled).length;
      const shareUrl = `${window.location.origin}${window.location.pathname}#${card.id}`;
      const text = `⛳ Orchard Hills – ${formatCardDate(card.date)} at ${formatCardTime(card.time)} (${openCount} spot${openCount === 1 ? "" : "s"} open): ${shareUrl}`;
      try {
        await navigator.clipboard.writeText(text);
        showStatusBanner(`Copied invite text to clipboard: "${text}"`);
      } catch {
        prompt("Copy this tee-time invite link:", text);
      }
    });
  });

  // 6. Card Chat Compose Submit
  document.querySelectorAll(".chat-compose-form").forEach(form => {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const cardId = form.getAttribute("data-card-id");
      const senderInput = form.querySelector(".chat-sender-input");
      const textInput = form.querySelector(".chat-text-input");
      const senderName = String(senderInput.value || "").trim();
      const text = String(textInput.value || "").trim();
      if (!senderName || !text) return;

      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, senderName, text })
        });
        const data = await resp.json();
        if (!resp.ok) {
          alert(data.error || "Could not post chat message.");
          submitBtn.disabled = false;
          return;
        }
        openChatCardIds.add(cardId);
        boardState = data;
        renderBoard();
      } catch (err) {
        alert("Network error posting chat: " + err.message);
        submitBtn.disabled = false;
      }
    });
  });
}

async function handleUrlCancelTokenIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const cancelToken = params.get("cancel");
  const canceledMsg = params.get("msg");

  if (canceledMsg) {
    showStatusBanner(canceledMsg, "cancel");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (!cancelToken) return;

  try {
    const resp = await fetch(`${API_BASE}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: cancelToken })
    });
    const data = await resp.json();
    window.history.replaceState({}, document.title, window.location.pathname);
    if (!resp.ok) {
      showStatusBanner(data.error || "That cancel link was already used or is invalid.", "cancel");
      return;
    }
    boardState = data;
    renderPlayerRosterAndDatalist();
    renderBoard();
    if (data.cancelResult && data.cancelResult.message) {
      showStatusBanner(data.cancelResult.message, "cancel");
    }
  } catch (err) {
    showStatusBanner("Error processing cancel link: " + err.message, "cancel");
  }
}

async function loadBoard() {
  try {
    const resp = await fetch(`${API_BASE}/api/board`);
    const data = await resp.json();
    if (data && data.ok) {
      boardState = data;
      renderPlayerRosterAndDatalist();
      renderBoard();
    }
  } catch (err) {
    console.error("Failed to load board:", err);
  }
}

function initApp() {
  // Default new tee time date to tomorrow
  const tomorrow = new Date(Date.now() + 86400000);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getDate()).padStart(2, "0");
  document.getElementById("newTeeDate").value = `${yyyy}-${mm}-${dd}`;
  document.getElementById("newTeeTime").value = "08:20";

  document.getElementById("newTeeDate").addEventListener("change", updateNewTeeWeatherPreview);
  document.getElementById("newTeeTime").addEventListener("change", updateNewTeeWeatherPreview);

  // Header panel toggles
  const addPanel = document.getElementById("addTeeTimePanel");
  const joinPanel = document.getElementById("joinPlayerPanel");

  document.getElementById("openAddTeeTimeBtn").addEventListener("click", () => {
    joinPanel.classList.add("hidden");
    addPanel.classList.toggle("hidden");
    updateNewTeeWeatherPreview();
  });
  document.getElementById("closeAddTeeTimeBtn").addEventListener("click", () => {
    addPanel.classList.add("hidden");
  });

  document.getElementById("openJoinPlayerModalBtn").addEventListener("click", () => {
    addPanel.classList.add("hidden");
    joinPanel.classList.toggle("hidden");
  });
  document.getElementById("closeJoinPlayerBtn").addEventListener("click", () => {
    joinPanel.classList.add("hidden");
  });

  // Frost preview toggle button
  const frostBtn = document.getElementById("frostPreviewBtn");
  const frostLabel = document.getElementById("frostPreviewLabel");
  frostBtn.addEventListener("click", () => {
    frostPreviewForced = !frostPreviewForced;
    frostBtn.classList.toggle("frost-forced", frostPreviewForced);
    frostLabel.textContent = frostPreviewForced
      ? "Frost: ON"
      : "Frost: Live";
    renderBoard();
    updateNewTeeWeatherPreview();
  });

  // QR Code Modal toggle & copy link
  const qrModal = document.getElementById("qrModal");
  const openQrBtn = document.getElementById("openQrModalBtn");
  const closeQrBtn = document.getElementById("closeQrModalBtn");
  const copySiteUrlBtn = document.getElementById("copySiteUrlBtn");
  if (openQrBtn && qrModal) {
    openQrBtn.addEventListener("click", () => {
      qrModal.classList.remove("hidden");
      qrModal.style.display = "flex";
    });
  }
  if (closeQrBtn && qrModal) {
    closeQrBtn.addEventListener("click", () => {
      qrModal.classList.add("hidden");
      qrModal.style.display = "";
    });
  }
  if (qrModal) {
    qrModal.addEventListener("click", e => {
      if (e.target === qrModal) {
        qrModal.classList.add("hidden");
        qrModal.style.display = "";
      }
    });
  }
  if (copySiteUrlBtn) {
    copySiteUrlBtn.addEventListener("click", async () => {
      const siteUrl = "https://lionelnggrok-netizen.github.io/the-orchard-connection/";
      try {
        await navigator.clipboard.writeText(siteUrl);
        copySiteUrlBtn.textContent = "Copied Link ✓";
        setTimeout(() => {
          copySiteUrlBtn.textContent = "🔗 Copy Site Link";
        }, 2000);
      } catch {
        prompt("Copy site URL:", siteUrl);
      }
    });
  }

  // Status banner dismiss
  document.getElementById("closeStatusBannerBtn").addEventListener("click", () => {
    document.getElementById("statusBanner").classList.add("hidden");
  });

  // Modal close & copy cancel URL
  document.getElementById("closeConfirmModalBtn").addEventListener("click", () => {
    document.getElementById("confirmModal").classList.add("hidden");
  });
  document.getElementById("copyCancelUrlBtn").addEventListener("click", async () => {
    const inp = document.getElementById("modalCancelUrlInput");
    try {
      await navigator.clipboard.writeText(inp.value);
      document.getElementById("copyCancelUrlBtn").textContent = "Copied ✓";
      setTimeout(() => {
        document.getElementById("copyCancelUrlBtn").textContent = "Copy Link";
      }, 2000);
    } catch {
      inp.select();
    }
  });

  // Past Rounds collapsible toggle
  const pastToggleBtn = document.getElementById("pastRoundsToggleBtn");
  const pastContainer = document.getElementById("pastCardsContainer");
  const pastChevron = document.getElementById("pastChevron");
  const pastHint = document.getElementById("pastToggleHint");
  pastToggleBtn.addEventListener("click", () => {
    const isHidden = pastContainer.classList.contains("hidden");
    pastContainer.classList.toggle("hidden", !isHidden);
    pastToggleBtn.setAttribute("aria-expanded", String(isHidden));
    pastChevron.textContent = isHidden ? "▾" : "▸";
    pastHint.textContent = isHidden ? "Click to collapse past rounds" : "Click to expand finished rounds";
  });

  // Submit Join Player List form
  document.getElementById("joinPlayerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const nameEl = document.getElementById("joinPlayerName");
    const emailEl = document.getElementById("joinPlayerEmail");
    const name = String(nameEl.value || "").trim();
    const email = String(emailEl.value || "").trim();
    if (!name || !email) return;

    const btn = document.getElementById("saveJoinPlayerBtn");
    btn.disabled = true;
    try {
      const resp = await fetch(`${API_BASE}/api/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email })
      });
      const data = await resp.json();
      btn.disabled = false;
      if (!resp.ok) {
        alert(data.error || "Could not register player.");
        return;
      }
      nameEl.value = "";
      emailEl.value = "";
      boardState = data;
      renderPlayerRosterAndDatalist();
      renderBoard();
      showStatusBanner(`${name} is now registered on The Orchard Connection player list!`);
    } catch (err) {
      btn.disabled = false;
      alert("Network error: " + err.message);
    }
  });

  // Submit "+ Add Tee Time" form
  document.getElementById("addTeeTimeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const date = document.getElementById("newTeeDate").value;
    const time = document.getElementById("newTeeTime").value;
    const slots = [];

    for (let s = 1; s <= 4; s++) {
      const nameInp = document.querySelector(`.builder-name-input[data-slot="${s}"]`);
      const emailInp = document.querySelector(`.builder-email-input[data-slot="${s}"]`);
      const sName = String(nameInp ? nameInp.value : "").trim();
      const sEmail = String(emailInp ? emailInp.value : "").trim();
      if (sName) {
        slots.push({ slot: s, name: sName, email: sEmail });
      }
    }

    const btn = document.getElementById("saveNewTeeTimeBtn");
    btn.disabled = true;
    try {
      const resp = await fetch(`${API_BASE}/api/teetimes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time, slots })
      });
      const data = await resp.json();
      btn.disabled = false;
      if (!resp.ok) {
        alert(data.error || "Could not create tee time.");
        return;
      }
      document.getElementById("addTeeTimePanel").classList.add("hidden");
      boardState = data;
      renderPlayerRosterAndDatalist();
      renderBoard();

      const firstCancel =
        data.cancelLinks && data.cancelLinks.length > 0 ? data.cancelLinks[0].cancelUrl : null;
      if (data.calendar) {
        openConfirmationModal({
          title: `Tee Time Posted — ${formatCardDate(date)} at ${formatCardTime(time)}`,
          subtitle:
            "Your 4-player card is live on The Orchard Connection! Calendar invite & one-click cancel link are ready below.",
          googleCalUrl: data.calendar.googleCalUrl,
          icsUrl: data.calendar.icsUrl,
          cancelUrl: firstCancel
        });
      }
    } catch (err) {
      btn.disabled = false;
      alert("Network error creating tee time: " + err.message);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("qr") === "1" && qrModal) {
    qrModal.classList.remove("hidden");
    qrModal.style.display = "flex";
  }

  loadBoard().then(() => {
    handleUrlCancelTokenIfPresent();
  });
  fetchWeatherForecast();
}

document.addEventListener("DOMContentLoaded", initApp);
