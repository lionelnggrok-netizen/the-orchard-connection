/**
 * The Orchard Connection — Google Apps Script Email & Calendar Relay + Outbox/Inbound Poller
 * Paired with:
 * - Private Google Sheet ID: 1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU
 * - Cloudflare Worker API:   https://the-orchard-connection.caddiebot-relay-az6p.workers.dev
 * - GitHub Pages Board:      https://lionelnggrok-netizen.github.io/the-orchard-connection/
 */

const SHEET_ID = "1lb-2hSrPhls-_qPPp25V_jYUbPLqJCFUXcekQYmJOHU";
const WORKER_API = "https://the-orchard-connection.caddiebot-relay-az6p.workers.dev";

function isValidEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return Boolean(e && e.indexOf("@") !== -1);
}

function sendEmailJob(job) {
  const recipients = Array.isArray(job.recipients) ? job.recipients : [];
  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    if (!isValidEmail(r.email)) continue;

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
}

/**
 * Webhook receiver for outgoing confirmation, alert, and card-chat emails from the Cloudflare Worker.
 */
function doPost(e) {
  try {
    const job = JSON.parse(e.postData.contents || "{}");
    sendEmailJob(job);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Time-driven trigger (every 1 minute):
 * 1. Polls Worker GET /api/outbox?pending=1 for any unsent email jobs and sends them via Gmail/MailApp,
 *    then acknowledges them via POST /api/outbox/ack.
 * 2. Polls Gmail threads matching "[Orchard #tt_...]" for new player replies and posts them
 *    back into that tee-time card's chat thread via POST /api/email/inbound.
 */
function syncOutboxAndInboundReplies() {
  pollPendingOutboxJobs();
  pollInboundCardChatReplies();
}

function pollPendingOutboxJobs() {
  try {
    var resp = UrlFetchApp.fetch(WORKER_API + "/api/outbox?pending=1", { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText() || "{}");
    var jobs = Array.isArray(data.outbox) ? data.outbox : [];
    var ackIds = [];
    for (var i = 0; i < jobs.length; i++) {
      sendEmailJob(jobs[i]);
      ackIds.push(jobs[i].id);
    }
    if (ackIds.length > 0) {
      UrlFetchApp.fetch(WORKER_API + "/api/outbox/ack", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ ids: ackIds }),
        muteHttpExceptions: true
      });
    }
  } catch (e) {}
}

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
      // Skip the initial outgoing notification message (#0 in thread)
      if (m === 0) {
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
      JSON.stringify((job.recipients || []).map(function(r) { return r.name + " <" + r.email + ">"; })),
      new Date().toISOString()
    ]);
  } catch (e) {}
}
