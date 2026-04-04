/**
 * OWNERSHIP TRANSFER SYSTEM — Google Apps Script Backend
 * 
 * HOW TO DEPLOY:
 * 1. Go to script.google.com → New Project
 * 2. Paste this code
 * 3. Run initSheet() ONCE to create the spreadsheet
 * 4. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone (or Anyone within your domain)
 * 5. Copy the Web App URL → paste into ownership-dashboard.html CONFIG.APPS_SCRIPT_URL
 * 
 * SPREADSHEET COLUMNS:
 * A: reqId | B: fileId | C: fileName | D: mimeType | E: isFolder
 * F: senderEmail | G: sentAt | H: status | I: adminEmail | J: actedAt | K: notes
 */

// =============================================================
// CONFIGURATION
// =============================================================
const SPREADSHEET_NAME = 'DriveOwnershipTransferLog';
const SHEET_NAME       = 'Requests';

// =============================================================
// ENTRY POINT — HTTP GET (read requests)
// =============================================================
function doGet(e) {
  const p = e.parameter;
  const action = p.action || 'getPending';

  try {
    // READ actions
    if (action === 'getPending')    return jsonResponse(getPendingRequests());
    if (action === 'getAll')        return jsonResponse(getAllRequests());
    if (action === 'getStats')      return jsonResponse(getStats());

    // WRITE actions via GET params (avoids browser no-cors POST issues)
    if (action === 'submitRequest') {
      return jsonResponse(addTransferRequest({
        fileId:      p.fileId,
        fileName:    decodeURIComponent(p.fileName || ''),
        mimeType:    p.mimeType || '',
        isFolder:    p.isFolder === 'true',
        senderEmail: p.senderEmail
      }));
    }

    if (action === 'updateStatus') {
      return jsonResponse(updateRequestStatus(
        p.reqId, p.status, p.adminEmail, p.actedAt
      ));
    }

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch(err) {
    return jsonResponse({ error: err.message });
  }
}

// =============================================================
// ENTRY POINT — HTTP POST (submit request / update status)
// =============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'submitRequest') {
      // Called by employee app when they send a file/folder
      const result = addTransferRequest(body);
      return jsonResponse(result);
    }

    if (action === 'updateStatus') {
      // Called by admin dashboard when they accept/reject
      const result = updateRequestStatus(body.reqId, body.status, body.adminEmail, body.actedAt);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch(err) {
    return jsonResponse({ error: err.message });
  }
}

// =============================================================
// INIT: Create spreadsheet if it doesn't exist
// =============================================================
function initSheet() {
  let ss;
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  }

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Write headers if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'reqId', 'fileId', 'fileName', 'mimeType', 'isFolder',
      'senderEmail', 'sentAt', 'status', 'adminEmail', 'actedAt', 'notes'
    ]);
    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, 11);
    headerRange.setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 11, 160);
  }

  Logger.log('Sheet initialized: ' + ss.getUrl());
  return ss.getUrl();
}

// =============================================================
// GET SHEET
// =============================================================
function getSheet() {
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (!files.hasNext()) throw new Error('Spreadsheet not found. Please run initSheet() first.');
  const ss = SpreadsheetApp.open(files.next());
  return ss.getSheetByName(SHEET_NAME);
}

// =============================================================
// ADD A NEW TRANSFER REQUEST (called by employee app)
// =============================================================
function addTransferRequest(body) {
  const { fileId, fileName, mimeType, isFolder, senderEmail } = body;

  // Check for duplicate pending request for same fileId
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === fileId && data[i][7] === 'pending') {
      return { success: false, message: 'A pending request already exists for this file.' };
    }
  }

  const reqId = 'REQ-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const sentAt = new Date().toISOString();

  sheet.appendRow([
    reqId,
    fileId,
    fileName,
    mimeType || '',
    isFolder ? 'TRUE' : 'FALSE',
    senderEmail,
    sentAt,
    'pending',
    '',   // adminEmail (filled on accept)
    '',   // actedAt (filled on accept)
    ''    // notes
  ]);

  // Color row based on status (yellow = pending)
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 1, 1, 11).setBackground('#fffde7');

  // Send email notification to admin
  notifyAdmin(senderEmail, fileName, isFolder, reqId);

  return { success: true, reqId };
}

// =============================================================
// UPDATE REQUEST STATUS (accept / reject)
// =============================================================
function updateRequestStatus(reqId, status, adminEmail, actedAt) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === reqId) {
      const row = i + 1; // 1-indexed
      sheet.getRange(row, 8).setValue(status);    // status
      sheet.getRange(row, 9).setValue(adminEmail); // adminEmail
      sheet.getRange(row, 10).setValue(actedAt || new Date().toISOString()); // actedAt

      // Color row based on final status
      const bg = status === 'accepted' ? '#e8f5e9' : '#fce4ec';
      sheet.getRange(row, 1, 1, 11).setBackground(bg);

      return { success: true };
    }
  }
  return { success: false, message: 'Request not found: ' + reqId };
}

// =============================================================
// GET PENDING REQUESTS
// =============================================================
function getPendingRequests() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const requests = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[7] === 'pending') {
      requests.push(rowToObject(row));
    }
  }

  // Sort by sentAt (newest first)
  requests.sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));

  return {
    requests,
    stats: computeStats(data)
  };
}

// =============================================================
// GET ALL REQUESTS (for history)
// =============================================================
function getAllRequests() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const requests = [];

  for (let i = 1; i < data.length; i++) {
    requests.push(rowToObject(data[i]));
  }

  requests.sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));

  return {
    requests,
    stats: computeStats(data)
  };
}

// =============================================================
// STATS
// =============================================================
function computeStats(data) {
  let total = 0, pending = 0, accepted = 0, rejected = 0;
  for (let i = 1; i < data.length; i++) {
    const status = data[i][7];
    if (!status) continue;
    total++;
    if (status === 'pending')  pending++;
    if (status === 'accepted') accepted++;
    if (status === 'rejected') rejected++;
  }
  return { total, pending, accepted, rejected };
}

function getStats() {
  const sheet = getSheet();
  return { stats: computeStats(sheet.getDataRange().getValues()) };
}

// =============================================================
// ROW → OBJECT
// =============================================================
function rowToObject(row) {
  return {
    id:          row[0],
    fileId:      row[1],
    fileName:    row[2],
    mimeType:    row[3],
    isFolder:    row[4] === 'TRUE' || row[4] === true,
    senderEmail: row[5],
    sentAt:      row[6] ? new Date(row[6]).toISOString() : '',
    status:      row[7],
    adminEmail:  row[8],
    actedAt:     row[9] ? new Date(row[9]).toISOString() : '',
    notes:       row[10]
  };
}

// =============================================================
// EMAIL NOTIFICATION to Admin
// =============================================================
function notifyAdmin(senderEmail, fileName, isFolder, reqId) {
  try {
    const adminEmails = ['mithunpm76@gmail.com'];
    const subject = `[Drive Transfer] New ownership request from ${senderEmail}`;
    const body = `
Hello Admin,

An employee has sent a new ownership transfer request:

📄 File/Folder : ${fileName}
👤 Sent By     : ${senderEmail}
📁 Type        : ${isFolder ? 'Folder (includes sub-items)' : 'File'}
🆔 Request ID  : ${reqId}
🕐 Time        : ${new Date().toLocaleString('en-IN')}

Please log in to the Drive Ownership Portal to Accept or Reject this request.

— Drive Ownership System
    `;

    adminEmails.forEach(email => {
      MailApp.sendEmail({ to: email, subject, body });
    });
  } catch(e) {
    Logger.log('Email notification failed: ' + e.message);
  }
}

// =============================================================
// JSON RESPONSE HELPER
// =============================================================
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
