/**
 * The Orchard Connection — Google Apps Script Email & Calendar Relay + Inbound Reply Poller
 * Paired with:
 * - Private Google Sheet ID: 1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU
 * - Cloudflare Worker API:   https://the-orchard-connection.caddiebot-relay-az6p.workers.dev
 * - GitHub Pages Board:      https://lionelnggrok-netizen.github.io/the-orchard-connection/
 *
 * CRITICAL STANDING RULE:
 * NEVER send any email to lionel.keat@gmail.com (or Lionel Ng).
 * All notifications for Lionel are strictly chat-only in Grok Bot.
 */

const SHEET_ID = "1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU";
const WORKER_API = "https://the-orchard-connection.caddiebot-relay-az6p.workers.dev";

function isBlockedEmail(email, name) {
  const e = String(email || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!e) return true;
  if (e === "lionel.keat@gmail.com" || e === "lionelng.grok@gmail.com") return true;
  if (n === "lionel ng" || n === "lionel") return true;
  return false;
}

/**
 * Webhook receiver for outgoing confirmation, alert, and card-chat emails from the Cloudflare Worker.
 */
function doPost(e) {
  try {
    const job = JSON.parse(e.postData.contents || "{}");
    const recipients = Array.isArray(job.recipients) ? job.recipients : [];

    for (var i = 0; i < recipients.length; i++) {
      var r = recipients[i];
      if (isBlockedEmail(r.email, r.name)) {
        continue; // Strictly skip lionel.keat@gmail.com
      }

      var options = {
        name: "The Orchard Connection"
      };
      if (job.htmlBody) {
        options.htmlBody = job.htmlBody;
      }
      if (job.icsContent) {
        var icsBlob = Utilities.newBlob(job.icsContent, "text/calendar", "orchard-hills-teetime.ics");
        options.attachments = [icsBlob];
      }

      MailApp.sendEmail(r.email, job.subject, job.textBody || "", options);
    }

    logJobToSheet(job);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Time-driven trigger (every 1–5 minutes):
 * Polls Gmail threads matching "[Orchard #tt_...]" for new player replies and posts them
 * back into that tee-time card's chat thread via POST /api/email/inbound.
 */
function pollInboundCardChatReplies() {
  var props = PropertiesService.getScriptProperties();
  var processedIds = JSON.parse(props.getProperty("PROCESSED_MSG_IDS") || "[]");
  var seen = {};
  for (var i = 0; i < processedIds.length; i++) seen[processedIds[i]] = true;

  var threads = GmailApp.search('subject:"[Orchard #tt_" newer_than:7d', 0, 20);
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var id = msg.getId();
      if (seen[id]) continue;

      var fromRaw = msg.getFrom();
      var subject = msg.getSubject();
      // Skip our own outgoing messages
      if (fromRaw.toLowerCase().indexOf(Session.getActiveUser().getEmail().toLowerCase()) !== -1 && m === 0) {
        seen[id] = true;
        processedIds.push(id);
        continue;
      }

      var emailMatch = fromRaw.match(/<([^>]+)>/);
      var fromEmail = emailMatch ? emailMatch[1] : fromRaw.trim();
      var fromName = fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim();

      UrlFetchApp.fetch(WORKER_API + "/api/email/inbound", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          subject: subject,
          fromEmail: fromEmail,
          fromName: fromName,
          text: msg.getPlainBody()
        }),
        muteHttpExceptions: true
      });

      seen[id] = true;
      processedIds.push(id);
    }
  }

  if (processedIds.length > 500) {
    processedIds = processedIds.slice(-500);
  }
  props.setProperty("PROCESSED_MSG_IDS", JSON.stringify(processedIds));
}

function logJobToSheet(job) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    sheet.appendRow([
      job.type || "EMAIL",
      job.id || "",
      job.cardId || "",
      job.subject || "",
      JSON.stringify((job.recipients || []).map(function(r) { return r.name; })),
      new Date().toISOString()
    ]);
  } catch (e) {}
}
