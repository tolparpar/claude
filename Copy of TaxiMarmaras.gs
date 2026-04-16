// ============================================================
// TELEGRAM CONFIG
// ============================================================
var TELEGRAM_TOKEN   = '8663908966:AAEHQ0F6nzFvLny06xuVcoAOiGAIEHfqIGM';
var TELEGRAM_CHAT_ID = '8765013314';
var GOOGLE_SPEECH_API_KEY = 'AIzaSyAInzjtU14nWjt-iVVyCijWdotl4FT8f_k';

function sendTelegram(message) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

// ============================================================
// ΚΡΑΤΗΣΕΙΣ — τρέχει από trigger κάθε 5 λεπτά
// ============================================================
function checkNewBookings() {
  var label     = GmailApp.getUserLabelByName('New Booking');
  var labelDone = GmailApp.getUserLabelByName('Κρατήσεις');
  if (!label) { Logger.log('ERROR: Δεν βρέθηκε label "New Booking"'); return; }

  var threads = label.getThreads();
  Logger.log('Κρατήσεις με label New Booking: ' + threads.length);

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    try {
      var messages = thread.getMessages();
      var msg  = messages[messages.length - 1];
      var body = msg.getBody();
      processBooking(body);
      thread.removeLabel(label);
      if (labelDone) thread.addLabel(labelDone);
      thread.moveToArchive();
      Logger.log('Μεταφέρθηκε στο Κρατήσεις: thread ' + i);
    } catch(e) {
      Logger.log('ERROR στο thread ' + i + ': ' + e.message);
    }
  }
}

// ============================================================
// ΕΠΕΞΕΡΓΑΣΙΑ ΚΡΑΤΗΣΗΣ
// ============================================================
function processBooking(body) {
  var name       = extractField(body, 'First_Name') + ' ' + extractField(body, 'Last_Name');
  var date       = extractField(body, 'Date');
  var time       = extractField(body, 'Time');
  var service    = extractField(body, 'Service');
  var phone      = extractField(body, 'Phone');
  var email      = extractField(body, 'Email');
  var passengers = extractField(body, 'Passengers');
  var notes      = extractField(body, 'Notes');
  var retDate    = extractField(body, 'Return_Date');
  var retTime    = extractField(body, 'Return_Time');
  var language   = extractField(body, 'Language') || 'en';

  if (!date || !time) { Logger.log('ERROR: Δεν βρέθηκε ημερομηνία/ώρα'); return; }

  // ── Αποθήκευση στο Sheet ──
  saveBookingToSheet(date, time, service);
  if (retDate && retDate.length > 3) {
    saveBookingToSheet(retDate, retTime || '08:00', 'Return → Airport');
  }

  // ── Έλεγχος σύγκρουσης ──
  var conflict    = checkConflict(date, time, service);
  var retConflict = (retDate && retDate.length > 3)
                    ? checkConflict(retDate, retTime || '08:00', 'Return') : null;

  // ── Telegram μήνυμα ──
  var msg =
    '🚕 <b>ΝΕΑ ΚΡΑΤΗΣΗ!</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '👤 <b>Όνομα:</b> ' + name + '\n' +
    '📞 <b>Τηλέφωνο:</b> ' + phone + '\n' +
    '📧 <b>Email:</b> ' + email + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '📅 <b>Ημερομηνία:</b> ' + date + '\n' +
    '🕐 <b>Ώρα:</b> ' + time + '\n' +
    '🗺 <b>Διαδρομή:</b> ' + service + '\n' +
    '👥 <b>Επιβάτες:</b> ' + passengers + '\n' +
    (notes ? '📝 <b>Σημειώσεις:</b> ' + notes + '\n' : '') +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '💰 Στείλε τιμή (π.χ. 90) ή φωνητικά!\n' +
    '🔊 Στείλε "v" για φωνητική ανάγνωση';

  if (retDate && retDate.length > 3) {
    msg += '\n🔄 <b>ΕΠΙΣΤΡΟΦΗ:</b> ' + retDate + ' — ' + (retTime || '—');
  }
  if (conflict) {
    msg += '\n🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n‼️ <b>ΣΥΓΚΡΟΥΣΗ ΩΡΑΡΙΟΥ!</b> ‼️\n⛔ ' + conflict + '\n🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨';
  }
  if (retConflict) {
    msg += '\n🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n‼️ <b>ΣΥΓΚΡΟΥΣΗ ΕΠΙΣΤΡΟΦΗΣ!</b> ‼️\n⛔ ' + retConflict + '\n🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨';
  }

  sendTelegram(msg);

  // ── Αποθήκευση κειμένου για φωνητική ανάγνωση ──
  var bookingText =
    'Νέα κράτηση. ' +
    'Όνομα: ' + name + '. ' +
    'Ημερομηνία: ' + date + '. ' +
    'Ώρα: ' + time + '. ' +
    'Διαδρομή: ' + service + '. ' +
    'Επιβάτες: ' + passengers + '. ' +
    (retDate && retDate.length > 3 ? 'Επιστροφή: ' + retDate + ' στις ' + (retTime||'') + '. ' : '') +
    (notes ? 'Σημειώσεις: ' + notes + '. ' : '') +
    'Ποια είναι η τιμή;';
  PropertiesService.getScriptProperties().setProperty('lastBookingText', bookingText);

  // ── Αν είναι ενεργή η λειτουργία οδήγησης → αυτόματη φωνητική ανάγνωση ──
  var drivingMode = PropertiesService.getScriptProperties().getProperty('drivingMode');
  if (drivingMode === 'on') {
    Utilities.sleep(2000); // μικρή καθυστέρηση για να φτάσει πρώτα το κείμενο
    sendVoiceMessage(bookingText);
  }

  // ── Draft email στον πελάτη ──
  var PAYPAL_BASE  = 'https://PayPal.Me/taximarmaras/';
  var depositLink  = PAYPAL_BASE + '0';
  var fullDiscLink = PAYPAL_BASE + '0';

  var langTag   = '<!-- LANG:' + language + ' -->';
  var emailBody = langTag + '\n' +
    '<p><b>Name:</b> ' + name + '<br/>' +
    '<b>Date:</b> ' + date + '<br/>' +
    '<b>Time:</b> ' + time + '<br/>' +
    '<b>Route:</b> ' + service + '<br/>' +
    '<b>Passengers:</b> ' + passengers + '<br/>' +
    (retDate && retDate.length > 3 ? '<b>Return:</b> ' + retDate + ' ' + (retTime||'') + '<br/>' : '') +
    (notes ? '<b>Notes:</b> ' + notes + '<br/>' : '') +
    '</p>' +
    '<br/><p><b>Price: ___EUR</b></p><br/>' +
    '<p><b>Payment options:</b></p>' +
    '<p>- 20% Deposit (<b>___EUR</b>)<br/><a href="' + depositLink + '">' + depositLink + '</a></p>' +
    '<p>- Full payment -10% (<b>___EUR</b>)<br/><a href="' + fullDiscLink + '">' + fullDiscLink + '</a></p>';

  GmailApp.createDraft(
    email,
    '✅ Επιβεβαίωση Κράτησης — Taxi Marmaras',
    '',
    { htmlBody: emailBody, name: 'Taxi Marmaras', replyTo: 'taximarmaras@gmail.com' }
  );
  Logger.log('Draft email δημιουργήθηκε για: ' + email + ' [' + language + ']');
}

// ============================================================
// PAYPAL — τρέχει από trigger κάθε 5 λεπτά
// ============================================================
function checkPayPal() {
  var labelPaid = GmailApp.getUserLabelByName('Πληρωμές');
  var threads   = GmailApp.search('from:paypal.com is:unread', 0, 10);

  threads.forEach(function(thread) {
    var msg  = thread.getMessages()[0];
    var body = msg.getPlainBody();

    var emailMatch    = body.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    var customerEmail = emailMatch ? emailMatch[1] : null;
    Logger.log('PayPal email πελάτη: ' + customerEmail);

    var booking = findBookingByEmail(customerEmail);

    if (booking) {
      var cal   = CalendarApp.getDefaultCalendar();
      var start = parseDateTime(booking.date, booking.time);
      var end   = new Date(start.getTime() + 90 * 60000);
      var title = '✅ ' + booking.name + ' — ' + booking.service;
      var desc  = '📞 ' + booking.phone + '\n📧 ' + customerEmail +
                  '\n👥 Επιβάτες: ' + booking.passengers +
                  (booking.notes ? '\n📝 ' + booking.notes : '') +
                  '\n\n💶 Τιμή: ___€\n💰 Προκαταβολή: ✅ ΠΛΗΡΩΘΗΚΕ';
      cal.createEvent(title, start, end, {description: desc});

      if (booking.retDate && booking.retDate.length > 3) {
        var retStart = parseDateTime(booking.retDate, booking.retTime || '08:00');
        var retEnd   = new Date(retStart.getTime() + 90 * 60000);
        cal.createEvent('🔄 ' + booking.name + ' — Επιστροφή → Αεροδρόμιο', retStart, retEnd, {description: desc});
      }

      sendTelegram(
        '💳 <b>ΠΛΗΡΩΜΗ ΕΠΙΒΕΒΑΙΩΘΗΚΕ!</b>\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '👤 <b>Όνομα:</b> ' + booking.name + '\n' +
        '📅 <b>Ημερομηνία:</b> ' + booking.date + '\n' +
        '🕐 <b>Ώρα:</b> ' + booking.time + '\n' +
        '🗺 <b>Διαδρομή:</b> ' + booking.service + '\n' +
        '✅ <b>Calendar event δημιουργήθηκε!</b>'
      );
    } else {
      sendTelegram('💳 <b>ΠΛΗΡΩΜΗ ΕΛΛΗΦΘΗ</b> αλλά δεν βρέθηκε αντίστοιχη κράτηση!\n📧 ' + customerEmail);
    }

    msg.markRead();
    if (labelPaid) thread.addLabel(labelPaid);
    thread.moveToArchive();
  });
}

// ============================================================
// ΒΡΙΣΚΕΙ ΚΡΑΤΗΣΗ ΑΠΟ EMAIL
// ============================================================
function findBookingByEmail(customerEmail) {
  if (!customerEmail) return null;
  var bookingThreads = GmailApp.search('label:Κρατήσεις', 0, 30);
  for (var i = 0; i < bookingThreads.length; i++) {
    var messages = bookingThreads[i].getMessages();
    var body     = messages[messages.length - 1].getBody();
    var bEmail   = extractField(body, 'Email');
    if (bEmail.toLowerCase() === customerEmail.toLowerCase()) {
      return {
        name:       extractField(body, 'First_Name') + ' ' + extractField(body, 'Last_Name'),
        date:       extractField(body, 'Date'),
        time:       extractField(body, 'Time'),
        service:    extractField(body, 'Service'),
        phone:      extractField(body, 'Phone'),
        passengers: extractField(body, 'Passengers'),
        notes:      extractField(body, 'Notes'),
        retDate:    extractField(body, 'Return_Date'),
        retTime:    extractField(body, 'Return_Time')
      };
    }
  }
  return null;
}

// ============================================================
// ΕΛΕΓΧΟΣ ΣΥΓΚΡΟΥΣΗΣ
// ============================================================
function checkConflict(date, time, service) {
  var ss    = SpreadsheetApp.openById('1vClFz8rVs7xrrbBKUYrhfivzgzMz51CaXw_SS35xmuY');
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();

  var newStart = timeToMinutes(time);
  var newBlockStart, newBlockEnd;

  if (service.indexOf('SKG') !== -1) {
    newBlockStart = newStart - 120; newBlockEnd = newStart + 120;
  } else if (service.indexOf('Return') !== -1) {
    newBlockStart = newStart; newBlockEnd = newStart + 210;
  } else {
    newBlockStart = newStart - 90; newBlockEnd = newStart + 90;
  }

  for (var i = 1; i < data.length; i++) {
    var rowDate    = data[i][0];
    var rowDateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, 'UTC', 'yyyy-MM-dd') : String(rowDate);
    if (rowDateStr !== date) continue;

    var existStart = timeToMinutes(data[i][3] instanceof Date
      ? Utilities.formatDate(data[i][3], 'UTC', 'HH:mm') : String(data[i][3]));
    var existEnd   = timeToMinutes(data[i][4] instanceof Date
      ? Utilities.formatDate(data[i][4], 'UTC', 'HH:mm') : String(data[i][4]));

    if (newBlockStart < existEnd && newBlockEnd > existStart) {
      return 'Υπάρχει κράτηση: ' + data[i][2] + ' στις ' + data[i][1];
    }
  }
  return null;
}

function timeToMinutes(t) {
  if (!t) return 0;
  var parts = String(t).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// ============================================================
// ΑΠΟΘΗΚΕΥΣΗ ΣΤΟ SHEET
// ============================================================
function saveBookingToSheet(date, time, service) {
  var ss    = SpreadsheetApp.openById('1vClFz8rVs7xrrbBKUYrhfivzgzMz51CaXw_SS35xmuY');
  var sheet = ss.getSheets()[0];
  var h = parseInt(time.split(':')[0]);
  var m = parseInt(time.split(':')[1]);
  var blockStart, blockEnd;

  if (service.indexOf('SKG') !== -1) {
    blockStart = padTime(h - 2, m); blockEnd = padTime(h + 2, m);
  } else if (service.indexOf('Return') !== -1) {
    blockStart = padTime(h, m); blockEnd = padTime(h + 3, m + 30);
  } else {
    blockStart = padTime(h - 1, m - 30); blockEnd = padTime(h + 1, m + 30);
  }
  sheet.appendRow([date, time, service, blockStart, blockEnd]);
}

function padTime(h, m) {
  if (m >= 60) { h += 1; m -= 60; }
  if (m < 0)   { h -= 1; m += 60; }
  if (h < 0) h = 0; if (h > 23) h = 23;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// ============================================================
// PARSE DATE/TIME
// ============================================================
function parseDateTime(dateStr, timeStr) {
  var parts  = dateStr.split('-');
  var tparts = timeStr.split(':');
  return new Date(
    parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]),
    parseInt(tparts[0]), parseInt(tparts[1])
  );
}

// ============================================================
// EXTRACT FIELD
// ============================================================
function extractField(body, field) {
  var r1 = new RegExp('<strong>' + field + '<\\/strong><\\/td>\\s*<td[^>]*>\\s*<pre[^>]*>([^<]+)<\\/pre>', 'i');
  var m1 = body.match(r1);
  if (m1) return m1[1].trim();
  var r2 = new RegExp('<strong>' + field + '<\\/strong><\\/td>\\s*<td[^>]*>([^<]+)<\\/td>', 'i');
  var m2 = body.match(r2);
  if (m2) return m2[1].trim();
  return '';
}

// ============================================================
// WEB APP — επιστρέφει κρατήσεις ως JSON
// ============================================================
function doGet(e) {
  var ss    = SpreadsheetApp.openById('1vClFz8rVs7xrrbBKUYrhfivzgzMz51CaXw_SS35xmuY');
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var bookings = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      bookings.push({
        date:       Utilities.formatDate(new Date(data[i][0]), 'UTC', 'yyyy-MM-dd'),
        time:       data[i][1] instanceof Date ? Utilities.formatDate(new Date(data[i][1]), 'UTC', 'HH:mm') : data[i][1],
        service:    data[i][2],
        blockStart: data[i][3] instanceof Date ? Utilities.formatDate(new Date(data[i][3]), 'UTC', 'HH:mm') : data[i][3],
        blockEnd:   data[i][4] instanceof Date ? Utilities.formatDate(new Date(data[i][4]), 'UTC', 'HH:mm') : data[i][4]
      });
    }
  }
  return ContentService.createTextOutput(JSON.stringify(bookings)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// POLLING — ελέγχει για νέα μηνύματα κάθε 1 λεπτό
// ============================================================
function checkTelegramMessages() {
  var props      = PropertiesService.getScriptProperties();
  var lastUpdate = parseInt(props.getProperty('lastUpdateId') || '0');

  var url      = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates?offset=' + (lastUpdate + 1) + '&limit=10';
  var response = UrlFetchApp.fetch(url);
  var data     = JSON.parse(response.getContentText());

  if (!data.ok || data.result.length === 0) return;

  data.result.forEach(function(update) {
    props.setProperty('lastUpdateId', update.update_id.toString());

    var message = update.message;
    if (!message) return;

    var chatId = message.chat.id.toString();
    if (chatId !== TELEGRAM_CHAT_ID) return;

    // ── Φωνητικό μήνυμα → Speech-to-Text ──
    if (message.voice) {
      var fileId = message.voice.file_id;
      var text   = transcribeVoice(fileId);
      Logger.log('Φωνητικό → κείμενο: ' + text);
      if (text) {
        processTextCommand(text);
      } else {
        sendTelegram('Δεν κατάλαβα τι είπες. Δοκίμασε ξανά!');
      }
      return;
    }

    // ── Γραπτό μήνυμα ──
    if (!message.text) return;
    var txt = message.text.toString().trim();
    Logger.log('Μήνυμα: ' + txt);
    processTextCommand(txt);
  });
}

// ── Επεξεργασία εντολής (κείμενο ή από φωνή) ──
function processTextCommand(text) {
  var cmd   = text.toLowerCase().trim();
  var props = PropertiesService.getScriptProperties();

  // ── ΟΔΗΓΗΣΗ ON ──
  if (cmd === 'οδηγηση' || cmd === 'οδήγηση' || cmd === 'driving' || cmd === 'drive') {
    props.setProperty('drivingMode', 'on');
    sendTelegram('🚗 Λειτουργία οδήγησης ΕΝΕΡΓΗ!\nΚάθε νέα κράτηση θα διαβάζεται αυτόματα φωνητικά.');
    sendVoiceMessage('Λειτουργία οδήγησης ενεργοποιήθηκε. Καλό ταξίδι!');
    return;
  }

  // ── ΟΔΗΓΗΣΗ OFF ──
  if (cmd === 'σταματα' || cmd === 'σταμάτα' || cmd === 'stop' || cmd === 'stamata') {
    props.setProperty('drivingMode', 'off');
    sendTelegram('🛑 Λειτουργία οδήγησης ΑΠΕΝΕΡΓΟΠΟΙΗΘΗΚΕ.');
    return;
  }

  // ── ΚΑΤΑΣΤΑΣΗ ──
  if (cmd === 'κατασταση' || cmd === 'κατάσταση' || cmd === 'status') {
    var mode = props.getProperty('drivingMode') === 'on' ? '🚗 ΕΝΕΡΓΗ' : '🛑 ΑΝΕΝΕΡΓΗ';
    sendTelegram('Λειτουργία οδήγησης: ' + mode);
    return;
  }

  // ── "v" ή "φωνή" → διάβασε την τελευταία κράτηση φωνητικά ──
  if (cmd === 'v' || cmd === 'φωνη' || cmd === 'φωνή' || cmd === 'foni') {
    readLastBookingAloud();
    return;
  }

  // ── Τιμή (αριθμός) ──
  if (cmd.match(/^\d+([.,]\d+)?$/)) {
    var price = parseFloat(cmd.replace(',', '.'));
    if (price > 0) {
      updateDraftWithPrice(price);
      return;
    }
  }

  // ── Σημερινές κρατήσεις ──
  if (cmd.indexOf('κρατ') !== -1 || cmd.indexOf('krat') !== -1 || cmd.indexOf('booking') !== -1) {
    var bookings = getTodayBookings();
    sendTelegram(bookings);
    sendVoiceMessage(bookings);
    return;
  }

  // ── Επόμενη κράτηση ──
  if (cmd.indexOf('επόμ') !== -1 || cmd.indexOf('επομ') !== -1 || cmd.indexOf('next') !== -1) {
    var next = getNextBooking();
    sendTelegram(next);
    sendVoiceMessage(next);
    return;
  }

  // ── Βοήθεια ──
  sendTelegram(
    '📋 <b>Εντολές:</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '🔢 Αριθμός (π.χ. <b>90</b>) → τιμή κράτησης\n' +
    '🔊 <b>v</b> → φωνητική ανάγνωση τελευταίας κράτησης\n' +
    '🚗 <b>οδήγηση</b> → αυτόματη φωνή για κάθε κράτηση\n' +
    '🛑 <b>σταμάτα</b> → απενεργοποίηση αυτόματης φωνής\n' +
    '📊 <b>κατάσταση</b> → δες αν η οδήγηση είναι ενεργή\n' +
    '📅 <b>κρατήσεις</b> → σημερινές κρατήσεις\n' +
    '⏭ <b>επόμενη</b> → επόμενη κράτηση\n' +
    '🎤 Μπορείς να μιλάς φωνητικά για όλες τις εντολές!'
  );
}

// ── Speech-to-Text (φωνή → κείμενο) ──
function transcribeVoice(fileId) {
  try {
    var fileUrl  = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getFile?file_id=' + fileId;
    var fileResp = JSON.parse(UrlFetchApp.fetch(fileUrl).getContentText());
    if (!fileResp.ok) return null;

    var filePath    = fileResp.result.file_path;
    var downloadUrl = 'https://api.telegram.org/file/bot' + TELEGRAM_TOKEN + '/' + filePath;

    var audioBlob   = UrlFetchApp.fetch(downloadUrl).getBlob();
    var audioBase64 = Utilities.base64Encode(audioBlob.getBytes());

    var speechUrl = 'https://speech.googleapis.com/v1/speech:recognize?key=' + GOOGLE_SPEECH_API_KEY;
    var payload   = {
      config: {
        encoding: 'OGG_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'el-GR',
        alternativeLanguageCodes: ['en-US'],
        model: 'default'
      },
      audio: { content: audioBase64 }
    };

    var speechResp = JSON.parse(UrlFetchApp.fetch(speechUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    }).getContentText());

    if (speechResp.results && speechResp.results.length > 0) {
      return speechResp.results[0].alternatives[0].transcript;
    }
    return null;
  } catch(e) {
    Logger.log('Speech-to-Text error: ' + e.message);
    return null;
  }
}

// ── Text-to-Speech (κείμενο → φωνητικό μήνυμα στο Telegram) ──
function sendVoiceMessage(text) {
  try {
    var ttsUrl  = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_SPEECH_API_KEY;
    var payload = {
      input: { text: text },
      voice: { languageCode: 'el-GR', name: 'el-GR-Standard-A' },
      audioConfig: { audioEncoding: 'OGG_OPUS' }
    };

    var ttsResp = JSON.parse(UrlFetchApp.fetch(ttsUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    }).getContentText());

    if (!ttsResp.audioContent) return;

    var audioBytes = Utilities.base64Decode(ttsResp.audioContent);
    var audioBlob  = Utilities.newBlob(audioBytes, 'audio/ogg', 'voice.ogg');

    var sendUrl = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendVoice';
    UrlFetchApp.fetch(sendUrl, {
      method: 'post',
      payload: {
        chat_id: TELEGRAM_CHAT_ID,
        voice: audioBlob
      }
    });
  } catch(e) {
    Logger.log('Text-to-Speech error: ' + e.message);
  }
}

// ── Διαβάζει φωνητικά την τελευταία κράτηση ──
function readLastBookingAloud() {
  var props       = PropertiesService.getScriptProperties();
  var lastBooking = props.getProperty('lastBookingText');

  if (!lastBooking) {
    sendTelegram('Δεν υπάρχει πρόσφατη κράτηση για ανάγνωση.');
    return;
  }

  sendTelegram('🔊 Διαβάζω φωνητικά...');
  sendVoiceMessage(lastBooking);
}

// ── Ενημέρωση draft με τιμή ──
function updateDraftWithPrice(price) {
  var deposit     = Math.round(price * 0.20);
  var fullDisc    = Math.round(price * 0.90);
  var PAYPAL_BASE = 'https://PayPal.Me/taximarmaras/';
  var WHATSAPP    = 'https://wa.me/306909145400';
  var VIBER       = 'viber://chat?number=306909145400';

  var drafts      = GmailApp.getDrafts();
  var targetDraft = null;
  for (var i = 0; i < drafts.length; i++) {
    var subj = drafts[i].getMessage().getSubject();
    if (subj.indexOf('Επιβεβαίωση Κράτησης') !== -1 ||
        subj.indexOf('Booking Confirmation') !== -1 ||
        subj.indexOf('Buchungsbestätigung') !== -1) {
      targetDraft = drafts[i];
      break;
    }
  }

  if (!targetDraft) {
    sendTelegram('❌ Δεν βρέθηκε draft κράτησης!');
    return;
  }

  var msg     = targetDraft.getMessage();
  var toEmail = msg.getTo();
  var oldBody = msg.getBody();

  var langMatch = oldBody.match(/LANG:([a-z]+)/i);
  var lang      = langMatch ? langMatch[1].toLowerCase() : 'en';

  var nameMatch  = oldBody.match(/<b>(?:Name):<\/b>\s*([^<]+)/);
  var dateMatch  = oldBody.match(/<b>(?:Date):<\/b>\s*([^<]+)/);
  var timeMatch  = oldBody.match(/<b>(?:Time):<\/b>\s*([^<]+)/);
  var routeMatch = oldBody.match(/<b>(?:Route):<\/b>\s*([^<]+)/);
  var passMatch  = oldBody.match(/<b>(?:Passengers):<\/b>\s*([^<]+)/);
  var retMatch   = oldBody.match(/<b>(?:Return):<\/b>\s*([^<]+)/);
  var notesMatch = oldBody.match(/<b>(?:Notes):<\/b>\s*([^<]+)/);

  var name  = nameMatch  ? nameMatch[1].trim()  : '';
  var date  = dateMatch  ? dateMatch[1].trim()  : '';
  var time  = timeMatch  ? timeMatch[1].trim()  : '';
  var route = routeMatch ? routeMatch[1].trim() : '';
  var pass  = passMatch  ? passMatch[1].trim()  : '';
  var ret   = retMatch   ? retMatch[1].trim()   : '';
  var notes = notesMatch ? notesMatch[1].trim() : '';

  var newBody = buildEmailBody(lang, name, date, time, route, pass, ret, notes, price, deposit, fullDisc, PAYPAL_BASE, WHATSAPP, VIBER);
  var subject = buildEmailSubject(lang);

  targetDraft.deleteDraft();
  GmailApp.createDraft(toEmail, subject, '', { htmlBody: newBody, name: 'Taxi Marmaras', replyTo: 'taximarmaras@gmail.com' });

  var confirmMsg =
    '✅ <b>Draft ενημερώθηκε!</b> (' + lang.toUpperCase() + ')\n' +
    '💶 Τιμή: <b>' + price + ' EUR</b>\n' +
    '💰 Προκαταβολή 20%: <b>' + deposit + ' EUR</b>\n' +
    '💳 Εξόφληση -10%: <b>' + fullDisc + ' EUR</b>\n\n' +
    '📧 Πήγαινε στο Gmail → Πρόχειρα και στείλε!';

  sendTelegram(confirmMsg);
  sendVoiceMessage('Εντάξει. Τιμή ' + price + ' ευρώ. Το draft ενημερώθηκε. Πήγαινε στο Gmail να στείλεις.');
}

function buildEmailSubject(lang) {
  if (lang === 'de') return '✅ Buchungsbestätigung — Taxi Marmaras';
  if (lang === 'gr') return '✅ Επιβεβαίωση Κράτησης — Taxi Marmaras';
  return '✅ Booking Confirmation — Taxi Marmaras';
}

function buildEmailBody(lang, name, date, time, route, pass, ret, notes, price, deposit, fullDisc, PAYPAL_BASE, WHATSAPP, VIBER) {
  var retLine   = ret   ? '<b>' + (lang==='gr'?'Επιστροφή':lang==='de'?'Rückfahrt':'Return') + ':</b> ' + ret + '<br/>' : '';
  var notesLine = notes ? '<b>' + (lang==='gr'?'Σημειώσεις':lang==='de'?'Notizen':'Notes') + ':</b> ' + notes + '<br/>' : '';

  if (lang === 'gr') {
    return '<p>Αγαπητέ/ή <b>' + name + '</b>,</p>' +
      '<p>Σας ευχαριστούμε για την κράτησή σας! Παρακάτω τα στοιχεία του δρομολογίου σας:</p><br/>' +
      '<p><b>Όνομα:</b> ' + name + '<br/><b>Ημερομηνία:</b> ' + date + '<br/><b>Ώρα:</b> ' + time + '<br/>' +
      '<b>Διαδρομή:</b> ' + route + '<br/><b>Επιβάτες:</b> ' + pass + '<br/>' + retLine + notesLine + '</p><br/>' +
      '<p><b>Τιμή: ' + price + ' EUR</b></p><br/>' +
      '<p><b>Επιλογές πληρωμής:</b></p>' +
      '<p>- Προκαταβολή 20% (<b>' + deposit + ' EUR</b>) — Εξόφληση με μετρητά ή κάρτα στο αυτοκίνητο<br/>' +
      '<a href="' + PAYPAL_BASE + deposit + '">' + PAYPAL_BASE + deposit + '</a></p>' +
      '<p>- Εξόφληση 100% με <b>10% έκπτωση</b> (<b>' + fullDisc + ' EUR</b>)<br/>' +
      '<a href="' + PAYPAL_BASE + fullDisc + '">' + PAYPAL_BASE + fullDisc + '</a></p><br/>' +
      '<p>Για περισσότερες διευκρινήσεις ή αν δεν έχετε PayPal, επικοινωνήστε μαζί μας στο ' +
      '<a href="' + WHATSAPP + '">WhatsApp</a> ή <a href="' + VIBER + '">Viber</a>.</p><br/>' +
      '<p>Με εκτίμηση,<br/><b>Taxi Marmaras</b><br/>Tel: +306909145400</p>';
  }

  if (lang === 'de') {
    return '<p>Sehr geehrte/r <b>' + name + '</b>,</p>' +
      '<p>Vielen Dank für Ihre Buchung! Hier sind die Details Ihrer Fahrt:</p><br/>' +
      '<p><b>Name:</b> ' + name + '<br/><b>Datum:</b> ' + date + '<br/><b>Uhrzeit:</b> ' + time + '<br/>' +
      '<b>Strecke:</b> ' + route + '<br/><b>Passagiere:</b> ' + pass + '<br/>' + retLine + notesLine + '</p><br/>' +
      '<p><b>Preis: ' + price + ' EUR</b></p><br/>' +
      '<p><b>Zahlungsoptionen:</b></p>' +
      '<p>- Anzahlung 20% (<b>' + deposit + ' EUR</b>) — Restzahlung bar oder per Karte im Fahrzeug<br/>' +
      '<a href="' + PAYPAL_BASE + deposit + '">' + PAYPAL_BASE + deposit + '</a></p>' +
      '<p>- Vollständige Zahlung mit <b>10% Rabatt</b> (<b>' + fullDisc + ' EUR</b>)<br/>' +
      '<a href="' + PAYPAL_BASE + fullDisc + '">' + PAYPAL_BASE + fullDisc + '</a></p><br/>' +
      '<p>Für weitere Informationen oder wenn Sie kein PayPal haben, kontaktieren Sie uns per ' +
      '<a href="' + WHATSAPP + '">WhatsApp</a> oder <a href="' + VIBER + '">Viber</a>.</p><br/>' +
      '<p>Mit freundlichen Grüßen,<br/><b>Taxi Marmaras</b><br/>Tel: +306909145400</p>';
  }

  return '<p>Dear <b>' + name + '</b>,</p>' +
    '<p>Thank you for your booking! Here are your transfer details:</p><br/>' +
    '<p><b>Name:</b> ' + name + '<br/><b>Date:</b> ' + date + '<br/><b>Time:</b> ' + time + '<br/>' +
    '<b>Route:</b> ' + route + '<br/><b>Passengers:</b> ' + pass + '<br/>' + retLine + notesLine + '</p><br/>' +
    '<p><b>Price: ' + price + ' EUR</b></p><br/>' +
    '<p><b>Payment options:</b></p>' +
    '<p>- 20% Deposit (<b>' + deposit + ' EUR</b>) — Balance payable by cash or card in the vehicle<br/>' +
    '<a href="' + PAYPAL_BASE + deposit + '">' + PAYPAL_BASE + deposit + '</a></p>' +
    '<p>- Full payment with <b>10% discount</b> (<b>' + fullDisc + ' EUR</b>)<br/>' +
    '<a href="' + PAYPAL_BASE + fullDisc + '">' + PAYPAL_BASE + fullDisc + '</a></p><br/>' +
    '<p>For further information or if you do not have PayPal, please contact us via ' +
    '<a href="' + WHATSAPP + '">WhatsApp</a> or <a href="' + VIBER + '">Viber</a>.</p><br/>' +
    '<p>Kind regards,<br/><b>Taxi Marmaras</b><br/>Tel: +306909145400</p>';
}

// ── Σημερινές κρατήσεις ──
function getTodayBookings() {
  var ss    = SpreadsheetApp.openById('1vClFz8rVs7xrrbBKUYrhfivzgzMz51CaXw_SS35xmuY');
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), 'Europe/Athens', 'yyyy-MM-dd');
  var result = 'Κρατήσεις σήμερα (' + today + '):\n';
  var found  = false;

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], 'UTC', 'yyyy-MM-dd')
      : String(data[i][0]);
    if (rowDate === today) {
      result += data[i][1] + ' — ' + data[i][2] + '\n';
      found = true;
    }
  }
  return found ? result : 'Δεν υπάρχουν κρατήσεις σήμερα!';
}

// ── Επόμενη κράτηση ──
function getNextBooking() {
  var ss    = SpreadsheetApp.openById('1vClFz8rVs7xrrbBKUYrhfivzgzMz51CaXw_SS35xmuY');
  var sheet = ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var now   = new Date();
  var next  = null;
  var nextDate = null;

  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
    if (d > now && (!nextDate || d < nextDate)) {
      nextDate = d;
      next = data[i];
    }
  }

  if (!next) return 'Δεν υπάρχει επόμενη κράτηση!';
  return 'Επόμενη κράτηση:\n' +
         Utilities.formatDate(nextDate, 'Europe/Athens', 'dd/MM/yyyy') +
         ' ' + next[1] + ' — ' + next[2];
}

// ============================================================
// WEBHOOK — ορισμός/διαγραφή (τρέξε μια φορά)
// ============================================================
function setWebhook() {
  var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwgSxsMXEFNipCGroCriuMZWtdi9IgpeVDo1XkYog6R2vNNFiyodGF8kmPaJapLFD7_/exec';
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/setWebhook?url=' + WEBHOOK_URL;
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function deleteWebhook() {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/deleteWebhook';
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function doPost(e) {
  return ContentService.createTextOutput('OK');
}
