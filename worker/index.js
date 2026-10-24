const STATE_KEY = "state:v1";
const SITE_URL = "https://lionelnggrok-netizen.github.io/the-orchard-connection/";
const WORKER_URL = "https://the-orchard-connection.caddiebot-relay-az6p.workers.dev";
const GOOGLE_SHEET_ID = "1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Orchard-Secret",
  "Cache-Control": "no-store"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

// CRITICAL STANDING RULE: Never email lionel.keat@gmail.com (or Lionel Ng).
// All notifications for Lionel are chat-only in Grok Bot.
function isNeverEmail(email, name) {
  const e = String(email || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!e) return true;
  if (e === "lionel.keat@gmail.com" || e === "lionelng.grok@gmail.com") return true;
  if (n === "lionel ng" || n === "lionel") return true;
  return false;
}

function randomId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function defaultState() {
  return {
    players: [
      {
        id: "plr_lionel",
        name: "Lionel Ng",
        email: "lionel.keat@gmail.com",
        createdAt: "2026-10-24T15:00:00Z",
        chatOnly: true
      }
    ],
    teeTimes: [
      {
        id: "tt_sample_frost_oct25",
        date: "2026-10-25",
        time: "08:10",
        course: "Orchard Hills Golf Course",
        createdAt: "2026-10-24T15:00:00Z",
        canceled: false,
        slots: [
          {
            slot: 1,
            name: "Lionel Ng",
            email: "lionel.keat@gmail.com",
            cancelToken: "tok_demo_slot1_oct25_am",
            claimedAt: "2026-10-24T15:00:00Z"
          },
          { slot: 2, name: null, email: null, cancelToken: null, claimedAt: null },
          { slot: 3, name: null, email: null, cancelToken: null, claimedAt: null },
          { slot: 4, name: null, email: null, cancelToken: null, claimedAt: null }
        ],
        chat: [
          {
            id: "msg_welcome_oct25",
            senderName: "Lionel Ng",
            text: "Booked 8:10 AM for tomorrow! Keep an eye on the dawn frost forecast — grab a slot if you're in.",
            createdAt: "2026-10-24T15:02:00Z",
            via: "web"
          }
        ]
      },
      {
        id: "tt_sample_afternoon_oct25",
        date: "2026-10-25",
        time: "13:30",
        course: "Orchard Hills Golf Course",
        createdAt: "2026-10-24T15:05:00Z",
        canceled: false,
        slots: [
          {
            slot: 1,
            name: "Lionel Ng",
            email: "lionel.keat@gmail.com",
            cancelToken: "tok_demo_slot1_oct25_pm",
            claimedAt: "2026-10-24T15:05:00Z"
          },
          { slot: 2, name: null, email: null, cancelToken: null, claimedAt: null },
          { slot: 3, name: null, email: null, cancelToken: null, claimedAt: null },
          { slot: 4, name: null, email: null, cancelToken: null, claimedAt: null }
        ],
        chat: []
      },
      {
        id: "tt_sample_past_oct18",
        date: "2026-10-18",
        time: "09:20",
        course: "Orchard Hills Golf Course",
        createdAt: "2026-10-15T12:00:00Z",
        canceled: false,
        slots: [
          {
            slot: 1,
            name: "Lionel Ng",
            email: "lionel.keat@gmail.com",
            cancelToken: "tok_past_1",
            claimedAt: "2026-10-15T12:00:00Z"
          },
          {
            slot: 2,
            name: "Mike R.",
            email: "",
            cancelToken: "tok_past_2",
            claimedAt: "2026-10-15T14:10:00Z"
          },
          {
            slot: 3,
            name: "Dave K.",
            email: "",
            cancelToken: "tok_past_3",
            claimedAt: "2026-10-16T09:00:00Z"
          },
          {
            slot: 4,
            name: "Chris M.",
            email: "",
            cancelToken: "tok_past_4",
            claimedAt: "2026-10-16T18:30:00Z"
          }
        ],
        chat: [
          {
            id: "msg_past_1",
            senderName: "Lionel Ng",
            text: "Great autumn round — greens rolled fast on #7 and #9.",
            createdAt: "2026-10-18T12:15:00Z",
            via: "web"
          }
        ]
      }
    ],
    outbox: [],
    lionelChatAlerts: [],
    gasWebhookUrl: ""
  };
}

async function loadState(env) {
  const raw = await env.ORCHARD_KV.get(STATE_KEY);
  if (!raw) {
    const initial = defaultState();
    await env.ORCHARD_KV.put(STATE_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.players)) parsed.players = defaultState().players;
    if (!Array.isArray(parsed.teeTimes)) parsed.teeTimes = [];
    if (!Array.isArray(parsed.outbox)) parsed.outbox = [];
    if (!Array.isArray(parsed.lionelChatAlerts)) parsed.lionelChatAlerts = [];
    return parsed;
  } catch {
    return defaultState();
  }
}

async function saveState(env, state) {
  if (state.outbox && state.outbox.length > 200) {
    state.outbox = state.outbox.slice(-200);
  }
  if (state.lionelChatAlerts && state.lionelChatAlerts.length > 200) {
    state.lionelChatAlerts = state.lionelChatAlerts.slice(-200);
  }
  await env.ORCHARD_KV.put(STATE_KEY, JSON.stringify(state));
}

function findOrRegisterPlayer(state, rawName, rawEmail) {
  const name = String(rawName || "").trim();
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!name) return { error: "Player name is required." };

  const existingByName = state.players.find(
    p => p.name.toLowerCase() === name.toLowerCase()
  );
  const existingByEmail = email
    ? state.players.find(p => p.email && p.email.toLowerCase() === email)
    : null;

  const existing = existingByName || existingByEmail;
  if (existing) {
    if (email && !existing.chatOnly && !isNeverEmail(email, name)) {
      existing.email = email;
    }
    return { player: existing, isNew: false };
  }

  // If name is Lionel, never require or send email
  if (isNeverEmail(email, name)) {
    const lionel = {
      id: randomId("plr"),
      name,
      email: "lionel.keat@gmail.com",
      createdAt: new Date().toISOString(),
      chatOnly: true
    };
    state.players.push(lionel);
    return { player: lionel, isNew: true };
  }

  if (!email || !email.includes("@")) {
    return {
      error: `"${name}" is not on the registered player list yet — please enter their email address once to register.`
    };
  }

  const newPlayer = {
    id: randomId("plr"),
    name,
    email,
    createdAt: new Date().toISOString(),
    chatOnly: false
  };
  state.players.push(newPlayer);
  return { player: newPlayer, isNew: true };
}

function formatFriendlyDateTime(dateStr, timeStr) {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayName = days[dt.getUTCDay()];
    const monthName = months[dt.getUTCMonth()];
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    const minPadded = String(mm).padStart(2, "0");
    return `${dayName}, ${monthName} ${d} at ${h12}:${minPadded} ${ampm}`;
  } catch {
    return `${dateStr} at ${timeStr}`;
  }
}

function buildCalendarLinks(card) {
  const [y, m, d] = card.date.split("-").map(Number);
  const [hh, mm] = card.time.split(":").map(Number);
  const pad = n => String(n).padStart(2, "0");
  const startLocal = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
  let endMinutesTotal = hh * 60 + mm + 135;
  let endH = Math.floor(endMinutesTotal / 60) % 24;
  let endM = endMinutesTotal % 60;
  const endLocal = `${y}${pad(m)}${pad(d)}T${pad(endH)}${pad(endM)}00`;

  const playersList = card.slots
    .filter(s => s.name)
    .map(s => `Slot ${s.slot}: ${s.name}`)
    .join("\\n");

  const title = `Orchard Hills Tee Time (${formatFriendlyDateTime(card.date, card.time)})`;
  const details = `The Orchard Connection — 9 Holes at Orchard Hills Golf Course (Paramus, NJ)\\nPlayers:\\n${playersList}\\n\\nBoard: ${SITE_URL}#${card.id}`;
  const location = "Orchard Hills Golf Course, 404 Paramus Rd, Paramus, NJ 07652";

  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${startLocal}/${endLocal}`,
    ctz: "America/New_York",
    details: details.replace(/\\n/g, "\n"),
    location
  });

  const googleCalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;
  const icsUrl = `${WORKER_URL}/api/ics?cardId=${encodeURIComponent(card.id)}`;

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Orchard Connection//Orchard Hills Golf//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${card.id}@the-orchard-connection`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;TZID=America/New_York:${startLocal}`,
    `DTEND;TZID=America/New_York:${endLocal}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${details}`,
    `LOCATION:${location}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return { googleCalUrl, icsUrl, icsContent, title, location };
}

async function dispatchEmailJob(env, state, job) {
  const rawRecipients = Array.isArray(job.recipients) ? job.recipients : [];
  const allowedRecipients = [];
  const seenEmails = new Set();

  for (const r of rawRecipients) {
    const email = String(r.email || "").trim().toLowerCase();
    const name = String(r.name || "").trim();
    if (isNeverEmail(email, name)) {
      state.lionelChatAlerts.push({
        id: randomId("chat_alert"),
        type: job.type,
        subject: job.subject,
        summary: job.summary || job.textBody,
        createdAt: new Date().toISOString()
      });
      continue;
    }
    if (!email || !email.includes("@") || seenEmails.has(email)) continue;
    seenEmails.add(email);
    allowedRecipients.push({ name, email });
  }

  const record = {
    id: randomId("mail"),
    type: job.type,
    cardId: job.cardId || null,
    subject: job.subject,
    recipients: allowedRecipients,
    textBody: job.textBody,
    htmlBody: job.htmlBody || null,
    icsContent: job.icsContent || null,
    cancelUrl: job.cancelUrl || null,
    googleCalUrl: job.googleCalUrl || null,
    createdAt: new Date().toISOString(),
    dispatchedToWebhook: false
  };

  state.outbox.push(record);

  const webhookUrl = state.gasWebhookUrl || env.GAS_WEBHOOK_URL;
  if (webhookUrl && allowedRecipients.length > 0) {
    try {
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
      record.dispatchedToWebhook = resp.ok;
    } catch {
      record.dispatchedToWebhook = false;
    }
  }
  return record;
}

function sanitizeBoard(state) {
  const sortedTeeTimes = [...state.teeTimes]
    .filter(t => !t.canceled)
    .sort((a, b) => {
      const ka = `${a.date}T${a.time}`;
      const kb = `${b.date}T${b.time}`;
      return ka.localeCompare(kb);
    })
    .map(card => {
      const cal = buildCalendarLinks(card);
      return {
        id: card.id,
        date: card.date,
        time: card.time,
        course: card.course || "Orchard Hills Golf Course",
        notes: card.notes || "",
        createdAt: card.createdAt,
        updatedAt: card.updatedAt || null,
        googleCalUrl: cal.googleCalUrl,
        icsUrl: cal.icsUrl,
        slots: (card.slots || []).map(s => ({
          slot: s.slot,
          name: s.name || null,
          filled: Boolean(s.name),
          claimedAt: s.claimedAt || null
        })),
        chat: (card.chat || []).map(m => ({
          id: m.id,
          senderName: m.senderName,
          text: m.text,
          createdAt: m.createdAt,
          via: m.via || "web"
        }))
      };
    });

  const publicPlayers = [...state.players]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({
      id: p.id,
      name: p.name
    }));

  return {
    ok: true,
    course: {
      name: "Orchard Hills Golf Course",
      location: "Paramus, NJ",
      address: "404 Paramus Rd, Paramus, NJ 07652",
      holes: 9,
      lat: 40.9961,
      lon: -74.069
    },
    players: publicPlayers,
    teeTimes: sortedTeeTimes,
    googleSheetId: GOOGLE_SHEET_ID,
    serverTime: new Date().toISOString()
  };
}

function stripEmailQuotedReply(rawText) {
  const lines = String(rawText || "").split(/\r?\n/);
  const cleaned = [];
  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^From:\s+/i.test(line.trim())) break;
    if (/^-{3,}\s*Original Message/i.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. GET /api/board
      if (path === "/api/board" && request.method === "GET") {
        const state = await loadState(env);
        return jsonResponse(sanitizeBoard(state));
      }

      // 2. GET /api/ics
      if (path === "/api/ics" && request.method === "GET") {
        const cardId = url.searchParams.get("cardId");
        const state = await loadState(env);
        const card = state.teeTimes.find(t => t.id === cardId);
        if (!card) return jsonResponse({ error: "Tee time not found" }, 404);
        const cal = buildCalendarLinks(card);
        return new Response(cal.icsContent, {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="orchard-hills-${card.date}-${card.time.replace(":", "")}.ics"`,
            ...CORS_HEADERS
          }
        });
      }

      // 3. POST /api/players ("Join Player List")
      if (path === "/api/players" && request.method === "POST") {
        const body = await request.json();
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        if (!name) return jsonResponse({ error: "Please enter your name." }, 400);
        if (!isNeverEmail(email, name) && (!email || !email.includes("@"))) {
          return jsonResponse({ error: "Please enter a valid email address." }, 400);
        }

        const state = await loadState(env);
        const res = findOrRegisterPlayer(state, name, email);
        if (res.error) return jsonResponse({ error: res.error }, 400);

        await dispatchEmailJob(env, state, {
          type: "player_registered",
          subject: "Welcome to The Orchard Connection — Player List Confirmed",
          recipients: [{ name: res.player.name, email: res.player.email }],
          textBody: `Hi ${res.player.name},\n\nYou are now on The Orchard Connection registered player list for Orchard Hills Golf Course!\n\nNext time you claim a tee-time spot on the board, you can simply pick your name from the dropdown without re-typing your email. You'll also get notified whenever new tee times or open spots are posted.\n\nBoard: ${SITE_URL}`,
          htmlBody: `<p>Hi <strong>${res.player.name}</strong>,</p><p>You're officially on <strong>The Orchard Connection</strong> player list for Orchard Hills Golf Course!</p><p>Next time you grab a spot on the board, just pick your name from the dropdown—no need to re-type your email. You'll also get email alerts when spots open up, get claimed, or drop.</p><p><a href="${SITE_URL}" style="display:inline-block;padding:10px 16px;background:#15803d;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open The Orchard Connection</a></p>`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          registeredPlayer: { id: res.player.id, name: res.player.name, isNew: res.isNew }
        });
      }

      // 4. POST /api/teetimes ("+ Add Tee Time")
      if (path === "/api/teetimes" && request.method === "POST") {
        const body = await request.json();
        const date = String(body.date || "").trim();
        const time = String(body.time || "").trim();
        const inputSlots = Array.isArray(body.slots) ? body.slots : [];

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return jsonResponse({ error: "Please select a valid date (YYYY-MM-DD)." }, 400);
        }
        if (!/^\d{2}:\d{2}$/.test(time)) {
          return jsonResponse({ error: "Please select a valid tee time (HH:MM)." }, 400);
        }

        const state = await loadState(env);
        const slots = [1, 2, 3, 4].map(num => ({
          slot: num,
          name: null,
          email: null,
          cancelToken: null,
          claimedAt: null
        }));

        for (const s of inputSlots) {
          const idx = Number(s.slot) - 1;
          if (idx < 0 || idx > 3) continue;
          const sName = String(s.name || "").trim();
          const sEmail = String(s.email || "").trim().toLowerCase();
          if (!sName) continue;

          const reg = findOrRegisterPlayer(state, sName, sEmail);
          if (reg.error) return jsonResponse({ error: reg.error }, 400);

          slots[idx] = {
            slot: idx + 1,
            name: reg.player.name,
            email: reg.player.email,
            cancelToken: randomId("tok"),
            claimedAt: new Date().toISOString()
          };
        }

        if (!slots[0].name) {
          return jsonResponse({ error: "Slot 1 (poster/booker) must have a player name." }, 400);
        }

        const newCard = {
          id: randomId("tt"),
          date,
          time,
          course: "Orchard Hills Golf Course",
          notes: String(body.notes || "").trim(),
          createdAt: new Date().toISOString(),
          canceled: false,
          slots,
          chat: []
        };

        state.teeTimes.push(newCard);
        const cal = buildCalendarLinks(newCard);
        const friendlyWhen = formatFriendlyDateTime(date, time);
        const openCount = slots.filter(s => !s.name).length;

        const cancelLinksForResponse = [];
        for (const s of slots) {
          if (!s.name) continue;
          const cancelUrl = `${SITE_URL}?cancel=${encodeURIComponent(s.cancelToken)}`;
          cancelLinksForResponse.push({ slot: s.slot, name: s.name, cancelUrl });
          const roleNote =
            s.slot === 1
              ? "As Slot 1 (the tee-time poster), clicking your cancel link will cancel the entire tee-time card and notify everyone."
              : "If your plans change, click your one-click cancel link below to remove your name and reopen the spot.";

          await dispatchEmailJob(env, state, {
            type: "slot_confirmation",
            cardId: newCard.id,
            subject: `Confirmed: Orchard Hills Tee Time — ${friendlyWhen} [Orchard #${newCard.id}]`,
            recipients: [{ name: s.name, email: s.email }],
            cancelUrl,
            googleCalUrl: cal.googleCalUrl,
            icsContent: cal.icsContent,
            textBody: `Hi ${s.name},\n\nYou're confirmed in Slot ${s.slot} for Orchard Hills Golf Course on ${friendlyWhen}!\n\nAdd to Google Calendar: ${cal.googleCalUrl}\nDownload .ics Invite: ${cal.icsUrl}\n\nOne-Click Cancel Link:\n${cancelUrl}\n(${roleNote})\n\nView Board: ${SITE_URL}#${newCard.id}`,
            htmlBody: `<div style="font-family:sans-serif;max-width:560px;line-height:1.5;color:#0f172a;">
              <h2 style="color:#15803d;margin-bottom:4px;">⛳ Tee Time Confirmed — Orchard Hills</h2>
              <p style="margin-top:0;color:#475569;"><strong>${friendlyWhen}</strong> · Slot ${s.slot} (${s.name})</p>
              <p style="margin:16px 0;">
                <a href="${cal.googleCalUrl}" style="display:inline-block;padding:10px 16px;background:#15803d;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;margin-right:8px;">📅 Add to Google Calendar</a>
                <a href="${cal.icsUrl}" style="display:inline-block;padding:10px 16px;background:#e2e8f0;color:#0f172a;text-decoration:none;border-radius:8px;font-weight:600;">📥 Download .ics</a>
              </p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />
              <p style="font-size:13px;color:#64748b;">${roleNote}</p>
              <p><a href="${cancelUrl}" style="display:inline-block;padding:8px 14px;background:#fee2e2;color:#b91c1c;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">✕ One-Click Cancel My Spot</a></p>
            </div>`
          });
        }

        const allNotify = [
          ...state.players.map(p => ({ name: p.name, email: p.email })),
          ...slots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
        ];
        await dispatchEmailJob(env, state, {
          type: "teetime_posted",
          cardId: newCard.id,
          subject: `⛳ New Tee Time Posted: Orchard Hills — ${friendlyWhen} (${openCount} spot${openCount === 1 ? "" : "s"} open)`,
          recipients: allNotify,
          textBody: `${slots[0].name} posted a tee time at Orchard Hills Golf Course for ${friendlyWhen}.\nOpen spots: ${openCount} of 4.\n\nClaim a spot on The Orchard Connection:\n${SITE_URL}#${newCard.id}`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          createdCardId: newCard.id,
          calendar: { googleCalUrl: cal.googleCalUrl, icsUrl: cal.icsUrl },
          cancelLinks: cancelLinksForResponse
        });
      }

      // 4b. POST /api/teetime/edit or PUT /api/teetime (Edit Tee Time Card — Verified by Slot 1 Poster Email)
      if (
        (path === "/api/teetime/edit" && (request.method === "POST" || request.method === "PUT")) ||
        (path === "/api/teetime" && request.method === "PUT")
      ) {
        const body = await request.json();
        const cardId = String(body.cardId || "").trim();
        const inputPosterEmail = String(body.posterEmail || "").trim().toLowerCase();

        if (!cardId) {
          return jsonResponse({ error: "Card ID is required." }, 400);
        }
        if (!inputPosterEmail || !inputPosterEmail.includes("@")) {
          return jsonResponse(
            { error: "Please enter Slot 1 poster's email address to verify and save edits." },
            400
          );
        }

        const state = await loadState(env);
        const card = state.teeTimes.find(t => t.id === cardId && !t.canceled);
        if (!card) {
          return jsonResponse({ error: "Tee time card not found." }, 404);
        }

        const slot1 = (card.slots || []).find(s => s.slot === 1) || card.slots[0] || {};
        const storedPosterEmail = String(slot1.email || "").trim().toLowerCase();
        const slot1NameLower = String(slot1.name || "").trim().toLowerCase();
        const isLionelSlot1 =
          storedPosterEmail === "lionel.keat@gmail.com" ||
          storedPosterEmail === "lionelng.grok@gmail.com" ||
          slot1NameLower === "lionel ng" ||
          slot1NameLower === "lionel";

        const posterMatches =
          (storedPosterEmail && inputPosterEmail === storedPosterEmail) ||
          (isLionelSlot1 &&
            (inputPosterEmail === "lionel.keat@gmail.com" ||
              inputPosterEmail === "lionelng.grok@gmail.com"));

        if (!posterMatches) {
          return jsonResponse(
            { error: "Poster email does not match Slot 1's email for this tee time." },
            403
          );
        }

        const oldDate = card.date;
        const oldTime = card.time;
        const oldFriendlyWhen = formatFriendlyDateTime(oldDate, oldTime);
        const oldSlots = (card.slots || []).map(s => ({ ...s }));

        // Option A: Poster chose to cancel/delete the entire tee-time card from the Edit panel
        if (body.cancelEntireCard === true) {
          card.canceled = true;
          card.canceledAt = new Date().toISOString();
          const allNotify = [
            ...state.players.map(p => ({ name: p.name, email: p.email })),
            ...oldSlots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
          ];

          await dispatchEmailJob(env, state, {
            type: "teetime_canceled",
            cardId: card.id,
            subject: `⚠️ Tee Time Canceled: Orchard Hills — ${oldFriendlyWhen}`,
            recipients: allNotify,
            textBody: `${slot1.name || "The poster"} canceled the Orchard Hills tee time for ${oldFriendlyWhen}. The card has been removed from the board.\n\nBoard: ${SITE_URL}`
          });

          await saveState(env, state);
          return jsonResponse({
            ...sanitizeBoard(state),
            editResult: {
              action: "card_canceled",
              cardId: card.id,
              message: `Tee time for ${oldFriendlyWhen} has been canceled and removed from the board.`
            }
          });
        }

        // Option B: Update Date, Tee Time, and/or Slots 1–4
        const newDate = String(body.date || card.date).trim();
        const newTime = String(body.time || card.time).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
          return jsonResponse({ error: "Please select a valid date (YYYY-MM-DD)." }, 400);
        }
        if (!/^\d{2}:\d{2}$/.test(newTime)) {
          return jsonResponse({ error: "Please select a valid tee time (HH:MM)." }, 400);
        }

        const inputSlots = Array.isArray(body.slots) ? body.slots : null;
        const newSlots = [1, 2, 3, 4].map(num => ({
          slot: num,
          name: null,
          email: null,
          cancelToken: null,
          claimedAt: null
        }));

        if (inputSlots) {
          for (const s of inputSlots) {
            const idx = Number(s.slot) - 1;
            if (idx < 0 || idx > 3) continue;
            const sName = String(s.name || "").trim();
            const sEmail = String(s.email || "").trim().toLowerCase();
            if (!sName) continue;

            // Check if this player was already on the card (preserving existing email/cancelToken)
            const prevSameSlot = oldSlots[idx];
            const prevAnywhereOnCard = oldSlots.find(
              os => os.name && os.name.toLowerCase() === sName.toLowerCase()
            );
            const matchedPrev =
              prevSameSlot &&
              prevSameSlot.name &&
              prevSameSlot.name.toLowerCase() === sName.toLowerCase()
                ? prevSameSlot
                : prevAnywhereOnCard;

            if (matchedPrev && !sEmail) {
              // Ensure player is also on registered list if they have an email
              if (matchedPrev.email) {
                findOrRegisterPlayer(state, matchedPrev.name, matchedPrev.email);
              }
              newSlots[idx] = {
                slot: idx + 1,
                name: matchedPrev.name,
                email: matchedPrev.email,
                cancelToken: matchedPrev.cancelToken || randomId("tok"),
                claimedAt: matchedPrev.claimedAt || new Date().toISOString()
              };
            } else {
              const reg = findOrRegisterPlayer(state, sName, sEmail);
              if (reg.error) return jsonResponse({ error: reg.error }, 400);

              newSlots[idx] = {
                slot: idx + 1,
                name: reg.player.name,
                email: reg.player.email,
                cancelToken:
                  matchedPrev && matchedPrev.cancelToken
                    ? matchedPrev.cancelToken
                    : randomId("tok"),
                claimedAt:
                  matchedPrev && matchedPrev.claimedAt
                    ? matchedPrev.claimedAt
                    : new Date().toISOString()
              };
            }
          }
        } else {
          for (let i = 0; i < 4; i++) {
            if (oldSlots[i]) newSlots[i] = { ...oldSlots[i], slot: i + 1 };
          }
        }

        if (!newSlots[0].name) {
          return jsonResponse(
            { error: "Slot 1 (poster/booker) must have a player name." },
            400
          );
        }

        card.date = newDate;
        card.time = newTime;
        card.slots = newSlots;
        card.updatedAt = new Date().toISOString();

        const newFriendlyWhen = formatFriendlyDateTime(newDate, newTime);
        const dateTimeChanged = oldDate !== newDate || oldTime !== newTime;
        const cal = buildCalendarLinks(card);

        // Identify newly added players and removed players
        const oldNamesSet = new Set(
          oldSlots.filter(s => s.name).map(s => s.name.toLowerCase())
        );
        const newNamesSet = new Set(
          newSlots.filter(s => s.name).map(s => s.name.toLowerCase())
        );

        const newlyAddedSlots = newSlots.filter(
          s => s.name && !oldNamesSet.has(s.name.toLowerCase())
        );
        const removedSlots = oldSlots.filter(
          s => s.name && !newNamesSet.has(s.name.toLowerCase())
        );

        // Send confirmation + calendar invite + cancel link to newly added players
        for (const s of newlyAddedSlots) {
          const cancelUrl = `${SITE_URL}?cancel=${encodeURIComponent(s.cancelToken)}`;
          await dispatchEmailJob(env, state, {
            type: "slot_confirmation",
            cardId: card.id,
            subject: `Confirmed: Orchard Hills Tee Time — ${newFriendlyWhen} [Orchard #${card.id}]`,
            recipients: [{ name: s.name, email: s.email }],
            cancelUrl,
            googleCalUrl: cal.googleCalUrl,
            icsContent: cal.icsContent,
            textBody: `Hi ${s.name},\n\nYou've been added to Slot ${s.slot} for Orchard Hills Golf Course on ${newFriendlyWhen}!\n\nAdd to Google Calendar: ${cal.googleCalUrl}\nDownload .ics Invite: ${cal.icsUrl}\n\nOne-Click Cancel Link:\n${cancelUrl}\n\nBoard: ${SITE_URL}#${card.id}`
          });
        }

        // Notify players on the tee time (and registered list if time changed or spots opened)
        const openCount = newSlots.filter(s => !s.name).length;
        const notifyPool =
          dateTimeChanged || removedSlots.length > 0
            ? [
                ...state.players.map(p => ({ name: p.name, email: p.email })),
                ...oldSlots.filter(s => s.name).map(s => ({ name: s.name, email: s.email })),
                ...newSlots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
              ]
            : [
                ...oldSlots.filter(s => s.name).map(s => ({ name: s.name, email: s.email })),
                ...newSlots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
              ];

        const changeSummaryParts = [];
        if (dateTimeChanged) {
          changeSummaryParts.push(`Rescheduled from ${oldFriendlyWhen} to ${newFriendlyWhen}`);
        }
        if (newlyAddedSlots.length > 0) {
          changeSummaryParts.push(
            `Added: ${newlyAddedSlots.map(s => `${s.name} (Slot ${s.slot})`).join(", ")}`
          );
        }
        if (removedSlots.length > 0) {
          changeSummaryParts.push(
            `Removed: ${removedSlots.map(s => `${s.name} (Slot ${s.slot})`).join(", ")}`
          );
        }
        const summaryLine =
          changeSummaryParts.length > 0
            ? changeSummaryParts.join(" · ")
            : `Updated tee time details for ${newFriendlyWhen}`;

        await dispatchEmailJob(env, state, {
          type: "teetime_edited",
          cardId: card.id,
          subject: `✎ Tee Time Updated: Orchard Hills — ${newFriendlyWhen} (${openCount} open)`,
          recipients: notifyPool,
          icsContent: dateTimeChanged ? cal.icsContent : null,
          googleCalUrl: cal.googleCalUrl,
          textBody: `${newSlots[0].name} updated the Orchard Hills tee time (${newFriendlyWhen}).\n${summaryLine}\nOpen spots: ${openCount} of 4.\n\nUpdated Calendar Invite: ${cal.googleCalUrl}\nView Board: ${SITE_URL}#${card.id}`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          editResult: {
            action: "card_updated",
            cardId: card.id,
            when: newFriendlyWhen,
            summary: summaryLine,
            message: `Tee time updated (${newFriendlyWhen})! ${summaryLine}.`
          }
        });
      }

      // 5. POST /api/slots (Claim an open slot on a card)
      if (path === "/api/slots" && request.method === "POST") {
        const body = await request.json();
        const cardId = String(body.cardId || "").trim();
        const slotNum = Number(body.slot);
        const rawName = String(body.name || "").trim();
        const rawEmail = String(body.email || "").trim().toLowerCase();

        if (!cardId || slotNum < 1 || slotNum > 4 || !rawName) {
          return jsonResponse({ error: "Card ID, slot number (1-4), and player name are required." }, 400);
        }

        const state = await loadState(env);
        const card = state.teeTimes.find(t => t.id === cardId && !t.canceled);
        if (!card) return jsonResponse({ error: "Tee time card not found." }, 404);

        const targetSlot = card.slots.find(s => s.slot === slotNum);
        if (!targetSlot) return jsonResponse({ error: "Invalid slot number." }, 400);
        if (targetSlot.name) {
          return jsonResponse({ error: `Slot ${slotNum} is already claimed by ${targetSlot.name}.` }, 409);
        }

        const reg = findOrRegisterPlayer(state, rawName, rawEmail);
        if (reg.error) return jsonResponse({ error: reg.error }, 400);

        targetSlot.name = reg.player.name;
        targetSlot.email = reg.player.email;
        targetSlot.cancelToken = randomId("tok");
        targetSlot.claimedAt = new Date().toISOString();

        const cal = buildCalendarLinks(card);
        const friendlyWhen = formatFriendlyDateTime(card.date, card.time);
        const cancelUrl = `${SITE_URL}?cancel=${encodeURIComponent(targetSlot.cancelToken)}`;
        const openCount = card.slots.filter(s => !s.name).length;

        await dispatchEmailJob(env, state, {
          type: "slot_confirmation",
          cardId: card.id,
          subject: `Confirmed: Orchard Hills Tee Time — ${friendlyWhen} [Orchard #${card.id}]`,
          recipients: [{ name: targetSlot.name, email: targetSlot.email }],
          cancelUrl,
          googleCalUrl: cal.googleCalUrl,
          icsContent: cal.icsContent,
          textBody: `Hi ${targetSlot.name},\n\nYou're locked in for Slot ${slotNum} at Orchard Hills Golf Course on ${friendlyWhen}!\n\nAdd to Google Calendar: ${cal.googleCalUrl}\nDownload .ics Invite: ${cal.icsUrl}\n\nNeed to drop your spot? Click your one-click cancel link:\n${cancelUrl}\n\nBoard: ${SITE_URL}#${card.id}`,
          htmlBody: `<div style="font-family:sans-serif;max-width:560px;line-height:1.5;color:#0f172a;">
            <h2 style="color:#15803d;margin-bottom:4px;">⛳ Spot Confirmed — Orchard Hills</h2>
            <p style="margin-top:0;color:#475569;"><strong>${friendlyWhen}</strong> · Slot ${slotNum} (${targetSlot.name})</p>
            <p style="margin:16px 0;">
              <a href="${cal.googleCalUrl}" style="display:inline-block;padding:10px 16px;background:#15803d;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;margin-right:8px;">📅 Add to Google Calendar</a>
              <a href="${cal.icsUrl}" style="display:inline-block;padding:10px 16px;background:#e2e8f0;color:#0f172a;text-decoration:none;border-radius:8px;font-weight:600;">📥 Download .ics</a>
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />
            <p style="font-size:13px;color:#64748b;">Can't make it anymore? Click below to remove your name and reopen the spot:</p>
            <p><a href="${cancelUrl}" style="display:inline-block;padding:8px 14px;background:#fee2e2;color:#b91c1c;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">✕ One-Click Cancel My Spot</a></p>
          </div>`
        });

        const allNotify = [
          ...state.players.map(p => ({ name: p.name, email: p.email })),
          ...card.slots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
        ];
        await dispatchEmailJob(env, state, {
          type: "slot_claimed",
          cardId: card.id,
          subject: `⛳ Spot Claimed: ${targetSlot.name} joined Orchard Hills (${friendlyWhen}) — ${openCount} open`,
          recipients: allNotify,
          textBody: `${targetSlot.name} claimed Slot ${slotNum} for Orchard Hills on ${friendlyWhen}. (${openCount} spot${openCount === 1 ? "" : "s"} remaining).\n\nView Board: ${SITE_URL}#${card.id}`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          claimed: {
            cardId: card.id,
            slot: slotNum,
            name: targetSlot.name,
            googleCalUrl: cal.googleCalUrl,
            icsUrl: cal.icsUrl,
            cancelUrl
          }
        });
      }

      // 6. GET or POST /api/cancel (One-Click Cancel via email token or board action)
      if (path === "/api/cancel" && (request.method === "GET" || request.method === "POST")) {
        let token = url.searchParams.get("token") || "";
        let cardId = url.searchParams.get("cardId") || "";
        let slotNum = Number(url.searchParams.get("slot") || 0);

        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (body.token) token = String(body.token).trim();
          if (body.cardId) cardId = String(body.cardId).trim();
          if (body.slot) slotNum = Number(body.slot);
        }

        const state = await loadState(env);
        let foundCard = null;
        let foundSlot = null;

        for (const card of state.teeTimes) {
          if (card.canceled) continue;
          for (const s of card.slots) {
            if (token && s.cancelToken === token) {
              foundCard = card;
              foundSlot = s;
              break;
            }
            if (!token && cardId && card.id === cardId && s.slot === slotNum && s.name) {
              foundCard = card;
              foundSlot = s;
              break;
            }
          }
          if (foundCard) break;
        }

        if (!foundCard || !foundSlot) {
          return jsonResponse({ error: "Cancel link is invalid or this spot was already canceled." }, 404);
        }

        const canceledPlayerName = foundSlot.name;
        const friendlyWhen = formatFriendlyDateTime(foundCard.date, foundCard.time);
        const allNotify = [
          ...state.players.map(p => ({ name: p.name, email: p.email })),
          ...foundCard.slots.filter(s => s.name).map(s => ({ name: s.name, email: s.email }))
        ];

        let cancelResult = {};

        if (foundSlot.slot === 1) {
          foundCard.canceled = true;
          foundCard.canceledAt = new Date().toISOString();
          cancelResult = {
            action: "card_canceled",
            cardId: foundCard.id,
            playerName: canceledPlayerName,
            when: friendlyWhen,
            message: `${canceledPlayerName} (Slot 1 host) canceled the entire tee time for ${friendlyWhen}. All players have been notified.`
          };

          await dispatchEmailJob(env, state, {
            type: "teetime_canceled",
            cardId: foundCard.id,
            subject: `⚠️ Tee Time Canceled: Orchard Hills — ${friendlyWhen}`,
            recipients: allNotify,
            textBody: `${canceledPlayerName} (Slot 1 booker) canceled the Orchard Hills tee time for ${friendlyWhen}. The entire tee time card has been removed from the board.\n\nBoard: ${SITE_URL}`
          });
        } else {
          const reopenedSlotNum = foundSlot.slot;
          foundSlot.name = null;
          foundSlot.email = null;
          foundSlot.cancelToken = null;
          foundSlot.claimedAt = null;
          const openCount = foundCard.slots.filter(s => !s.name).length;

          cancelResult = {
            action: "slot_reopened",
            cardId: foundCard.id,
            slot: reopenedSlotNum,
            playerName: canceledPlayerName,
            when: friendlyWhen,
            message: `${canceledPlayerName} dropped from Slot ${reopenedSlotNum} (${friendlyWhen}). The spot is now open again!`
          };

          await dispatchEmailJob(env, state, {
            type: "slot_dropped",
            cardId: foundCard.id,
            subject: `🟢 Spot Opened Up! Orchard Hills — ${friendlyWhen} (${openCount} open)`,
            recipients: allNotify,
            textBody: `${canceledPlayerName} dropped from Slot ${reopenedSlotNum} for Orchard Hills on ${friendlyWhen}. That spot is now open!\n\nGrab the spot here:\n${SITE_URL}#${foundCard.id}`
          });
        }

        await saveState(env, state);

        const accept = request.headers.get("Accept") || "";
        if (request.method === "GET" && accept.includes("text/html")) {
          const redirectUrl = `${SITE_URL}?canceled=${encodeURIComponent(cancelResult.action)}&msg=${encodeURIComponent(cancelResult.message)}`;
          return Response.redirect(redirectUrl, 302);
        }

        return jsonResponse({
          ...sanitizeBoard(state),
          cancelResult
        });
      }

      // 7. POST /api/chat (Per-card mini chat thread -> emails ONLY players on that card)
      if (path === "/api/chat" && request.method === "POST") {
        const body = await request.json();
        const cardId = String(body.cardId || "").trim();
        const senderName = String(body.senderName || "").trim();
        const text = String(body.text || "").trim();

        if (!cardId || !senderName || !text) {
          return jsonResponse({ error: "Card ID, your name, and a message are required." }, 400);
        }

        const state = await loadState(env);
        const card = state.teeTimes.find(t => t.id === cardId && !t.canceled);
        if (!card) return jsonResponse({ error: "Tee time card not found." }, 404);

        const msg = {
          id: randomId("msg"),
          senderName,
          text,
          createdAt: new Date().toISOString(),
          via: "web"
        };
        if (!Array.isArray(card.chat)) card.chat = [];
        card.chat.push(msg);

        const friendlyWhen = formatFriendlyDateTime(card.date, card.time);
        const cardRecipients = card.slots
          .filter(s => s.name && s.email)
          .map(s => ({ name: s.name, email: s.email }));

        await dispatchEmailJob(env, state, {
          type: "card_chat",
          cardId: card.id,
          subject: `💬 Orchard Hills Tee Time Chat (${friendlyWhen}) [Orchard #${card.id}]`,
          recipients: cardRecipients,
          textBody: `${senderName} posted in the tee-time chat for ${friendlyWhen}:\n\n"${text}"\n\n---\nReply directly to this email to post a message back to this tee-time card's chat thread, or view on the board:\n${SITE_URL}#${card.id}`,
          htmlBody: `<div style="font-family:sans-serif;max-width:560px;line-height:1.5;color:#0f172a;">
            <p style="margin:0 0 8px;color:#475569;font-size:13px;"><strong>Orchard Hills Tee Time Chat</strong> · ${friendlyWhen}</p>
            <div style="background:#f8fafc;border-left:4px solid #15803d;padding:12px 16px;border-radius:6px;margin-bottom:14px;">
              <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${senderName}</div>
              <div style="color:#1e293b;white-space:pre-wrap;">${text}</div>
            </div>
            <p style="font-size:12px;color:#64748b;">💡 <strong>Tip:</strong> Reply directly to this email and your reply will automatically appear in this tee-time card's chat thread! (<a href="${SITE_URL}#${card.id}">Open Board</a>)</p>
          </div>`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          postedMessage: msg
        });
      }

      // 8. POST /api/email/inbound (Sync email replies back into a card's chat thread)
      if (path === "/api/email/inbound" && request.method === "POST") {
        const body = await request.json();
        let cardId = String(body.cardId || "").trim();
        const subject = String(body.subject || "");
        const fromEmail = String(body.fromEmail || "").trim().toLowerCase();
        const fromName = String(body.fromName || "").trim();
        const rawText = String(body.text || "");

        if (!cardId && subject) {
          const m = subject.match(/\[Orchard #(tt_[a-zA-Z0-9_-]+)\]/i);
          if (m) cardId = m[1];
        }

        const state = await loadState(env);
        const card = state.teeTimes.find(t => t.id === cardId && !t.canceled);
        if (!card) return jsonResponse({ error: "Matching tee time card not found for email reply." }, 404);

        const cleanText = stripEmailQuotedReply(rawText);
        if (!cleanText) return jsonResponse({ error: "Empty reply body." }, 400);

        const slotPlayer = card.slots.find(s => s.email && s.email.toLowerCase() === fromEmail);
        const regPlayer = state.players.find(p => p.email && p.email.toLowerCase() === fromEmail);
        const senderName =
          (slotPlayer && slotPlayer.name) ||
          (regPlayer && regPlayer.name) ||
          fromName ||
          (fromEmail ? fromEmail.split("@")[0] : "Player");

        const msg = {
          id: randomId("msg"),
          senderName,
          text: cleanText,
          createdAt: new Date().toISOString(),
          via: "email"
        };
        if (!Array.isArray(card.chat)) card.chat = [];
        card.chat.push(msg);

        const friendlyWhen = formatFriendlyDateTime(card.date, card.time);
        const cardRecipients = card.slots
          .filter(s => s.name && s.email && s.email.toLowerCase() !== fromEmail)
          .map(s => ({ name: s.name, email: s.email }));

        await dispatchEmailJob(env, state, {
          type: "card_chat_email_reply",
          cardId: card.id,
          subject: `Re: 💬 Orchard Hills Tee Time Chat (${friendlyWhen}) [Orchard #${card.id}]`,
          recipients: cardRecipients,
          textBody: `${senderName} replied via email to the tee-time chat (${friendlyWhen}):\n\n"${cleanText}"\n\n---\nReply to this email to respond in the thread: ${SITE_URL}#${card.id}`
        });

        await saveState(env, state);
        return jsonResponse({
          ...sanitizeBoard(state),
          inboundMessage: msg
        });
      }

      // 9. POST /api/reset-demo (Reset to default state)
      if (path === "/api/reset-demo" && request.method === "POST") {
        const initial = defaultState();
        await saveState(env, initial);
        return jsonResponse(sanitizeBoard(initial));
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      return jsonResponse({ error: String(err && err.message ? err.message : err) }, 500);
    }
  }
};
