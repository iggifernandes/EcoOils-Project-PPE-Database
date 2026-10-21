/**
 * EcoOils Mentari — PPE Request • Approval • Store Issue System
 * Backend (Google Apps Script bound to the Google Sheet)
 * VERSION 2.7.0
 *
 * Flow: Employee requests (app / QR)  ->  Approver approves  ->  employee gets OTP by email
 *       ->  Storekeeper enters OTP at the counter and issues  ->  receipt emailed + stock deducted + audit trail.
 */
const VERSION = '2.7.0';
const OTP_DAYS = 14;        // approved request must be collected within this many days
const MAX_OTP_TRIES = 5;
const MAX_OPEN_PER_PERSON = 3;
const MAX_OPEN_PER_SPONSOR = 5;
const AUTO_MAX_QTY = 10;    // max quantity per line for items that need no approval
const EMP_LOAN_DAYS = 30;   // employee loans (e.g. full body harness): reminder only after this many days
const SHEETS = {
  Personnel: ['PersonID', 'Name', 'Company', 'Role', 'Email', 'Active', 'Sponsor'],
  Items: ['Item', 'Category', 'Sizes', 'ServiceLifeDays', 'Kit', 'Loan', 'Approval'],
  Stock: ['Item', 'Size', 'OnHand', 'MinLevel'],
  StockLog: ['Timestamp', 'Item', 'Size', 'Change', 'Reason', 'Ref', 'Actor'],
  Users: ['Name', 'Role', 'PIN', 'Active'],
  Requests: ['ReqID', 'CreatedAt', 'PersonID', 'Name', 'Company', 'Email', 'Verified', 'Sponsor', 'Items', 'Reason', 'Remark',
    'PhotoId', 'Flags', 'Status', 'TokenHash', 'ApprovedBy', 'ApprovedAt', 'ApprovedItems', 'OtpHash', 'OtpExpires', 'Tries',
    'IssuedBy', 'IssuedAt', 'ReceiptCode', 'Note', 'Reminded'],
  Loans: ['LoanID', 'CreatedAt', 'Visitors', 'VisitorCompany', 'HostID', 'HostName', 'HostEmail', 'Items', 'Purpose', 'Status', 'OutBy', 'ReturnedAt', 'ReturnedBy', 'Condition', 'Note', 'LastChased', 'Chases', 'Type', 'Due'],
  Training: ['Timestamp', 'PersonID', 'Name', 'Company', 'Score', 'Total', 'Module'],
  Audit: ['Timestamp', 'ReqID', 'Event', 'Actor', 'Detail']
};
const REASONS = ['New', 'Replacement-Worn', 'Replacement-Damaged', 'Lost', 'Additional'];

/* ================= ONE-TIME SETUP ================= */
/* PPE catalogue = the PPE types in EOCORP-QSP-HS PPE Procedure (section 5 + PPE matrix + glove matrix).
 * Columns: Item, Category, Sizes, ServiceLifeDays, Kit (new-joiner kit), Loan (Only = visitor-only, Yes = visitors may borrow,
 * Always = always a LOAN, tracked until returned), Approval (No = self-service item, no approval needed, code issued at once). */
const SZ_BODY = 'XS,S,M,L,XL,2XL,3XL,4XL,5XL,6XL', SZ_FOOT = '37,38,39,40,41,42,43,44,45,46', SZ_GLV = 'M,L,XL,6,7,8,9';
const CATALOG = [
  ['Safety Helmet - White', 'Head', '', 1825, 'No', 'Yes', 'Yes'],
  ['Safety Helmet - Yellow (New Joiner, 1 year)', 'Head', '', 365, 'Yes', 'No', 'Yes'],
  ['Helmet Suspension / Liner', 'Head', '', 365, 'No', 'No', 'Yes'],
  ['Helmet Chin Strap', 'Head', '', 365, 'No', 'No', 'Yes'],
  ['Welding Helmet', 'Head', '', 0, 'No', 'No', 'Yes'],
  ['Ear Plugs', 'Hearing', '', 7, 'Yes', 'No', 'No'],
  ['Ear Muffs (Helmet-mounted)', 'Hearing', '', 365, 'No', 'No', 'Yes'],
  ['Safety Glasses', 'Eye & Face', 'Clear,Dark', 180, 'Yes', 'Yes', 'No'],
  ['Over Glasses (Fit-Over)', 'Eye & Face', 'Clear,Dark', 365, 'No', 'Yes', 'Yes'],
  ['Safety Goggles', 'Eye & Face', '', 365, 'No', 'No', 'Yes'],
  ['Face Shield', 'Eye & Face', '', 365, 'No', 'No', 'Yes'],
  ['Welding Visor', 'Eye & Face', '', 0, 'No', 'No', 'Yes'],
  ['High Visibility Garment', 'Body', 'S,M,L,XL,2XL,3XL,4XL', 365, 'No', 'No', 'Yes'],
  ['FR Coverall (Blue)', 'Body', SZ_BODY, 180, 'Yes', 'No', 'Yes'],
  ['Coverall (Regular)', 'Body', SZ_BODY, 180, 'No', 'No', 'Yes'],
  ['T-Shirt', 'Body', SZ_BODY, 180, 'No', 'No', 'Yes'],
  ['Visitor Coverall (Return)', 'Body', SZ_BODY, 0, 'No', 'Only', 'Yes'],
  ['Chemical Protective Coverall (CPC)', 'Body', 'S,M,L,XL,2XL,3XL', 0, 'No', 'No', 'Yes'],
  ['Apron', 'Body', '', 365, 'No', 'No', 'Yes'],
  ['Gloves - Nitrile Disposable (EN 374)', 'Hand', 'S,M,L,XL', 1, 'No', 'No', 'No'],
  ['Gloves - PU Coated General (EN 388)', 'Hand', SZ_GLV, 30, 'Yes', 'No', 'No'],
  ['Gloves - Leather (EN 388)', 'Hand', SZ_GLV, 60, 'No', 'No', 'No'],
  ['Rubber Gloves - Chemical Gauntlet (Sol-vex)', 'Hand', 'M,L,XL', 90, 'No', 'No', 'No'],
  ['Gloves - Impact Resistant (EN 388)', 'Hand', 'M,L,XL,2XL', 90, 'No', 'No', 'Yes'],
  ['Gloves - Welders Gauntlet', 'Hand', 'M,L,XL', 90, 'No', 'No', 'Yes'],
  ['Gloves - Electrician Insulated Class 2 (EN 60903)', 'Hand', 'M,L,XL', 0, 'No', 'No', 'Yes'],
  ['Safety Boots (S3)', 'Foot', SZ_FOOT, 365, 'Yes', 'No', 'Yes'],
  ['Chemical Safety Boots', 'Foot', SZ_FOOT, 365, 'No', 'No', 'Yes'],
  ['Full Body Harness', 'Fall Protection', 'S,M,L,XL', 0, 'No', 'Always', 'Yes'],
  ['N95 Dust Mask', 'Respiratory', '', 1, 'No', 'No', 'Yes'],
  ['Half Face Respirator (OV Cartridge)', 'Respiratory', 'S,M,L', 0, 'No', 'No', 'Yes'],
  ['Full Face Respirator (P3 Filter)', 'Respiratory', 'S,M,L', 0, 'No', 'No', 'Yes']
];
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (n) {
    const sh = ss.getSheetByName(n) || ss.insertSheet(n);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[n].length).setValues([SHEETS[n]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {   // upgrade from an older version: add any missing header columns at the end
      const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
      SHEETS[n].forEach(function (h) { if (have.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold'); have.push(h); } });
    }
  });
  const it = ss.getSheetByName('Items');
  if (it.getLastRow() === 1) it.getRange(2, 1, CATALOG.length, 7).setValues(CATALOG);
  const us = ss.getSheetByName('Users');
  if (us.getLastRow() === 1) us.getRange(2, 1, 2, 4).setValues([['Iggy', 'approver', 'CHANGE-ME-1', 'Yes'], ['Store 1', 'store', 'CHANGE-ME-2', 'Yes']]);
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SALT')) p.setProperty('SALT', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('FRONTEND_URL')) p.setProperty('FRONTEND_URL', 'https://YOURNAME.github.io/PPE-System/');
  if (!p.getProperty('ADMIN_EMAIL')) p.setProperty('ADMIN_EMAIL', Session.getEffectiveUser().getEmail());
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t); });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'eveningChase') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('eveningChase').timeBased().everyDays(1).atHour(17).create();
}

/* Run once to REPLACE the Items tab with the procedure-based catalogue (v2.7). Re-enter opening stock for renamed items afterwards. */
function loadProcedureCatalog() {
  const it = sh_('Items'); if (it.getLastRow() > 1) it.getRange(2, 1, it.getLastRow() - 1, Math.max(7, it.getLastColumn())).clearContent();
  it.getRange(2, 1, CATALOG.length, 7).setValues(CATALOG);
}

/* ================= Entry points ================= */
function doGet() { return json_({ ok: true, app: 'PPE', version: VERSION }); }

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    // ---- public (employee) ----
    switch (p.action) {
      case 'people': return json_(people_());
      case 'items': return json_({ ok: true, items: rows_('Items').filter(function (x) { return String(x.Loan) !== 'Only'; }) });
      case 'submit': return json_(submit_(p));
      case 'status': return json_(status_(p));
      case 'cancel': return json_(cancel_(p));
      case 'trainDone': return json_(trainDone_(p));
    }
    // ---- staff (PIN) ----
    const u = auth_(p.pin);
    if (!u.ok) return json_(u);
    const isA = u.role === 'approver';
    switch (p.action) {
      case 'login': return json_({ ok: true, name: u.name, role: u.role, version: VERSION });
      case 'queue': return json_(queue_(isA));
      case 'issue': return json_(issue_(p, u));
      case 'stock': return json_(stock_(isA));
      case 'stockAdd': return json_(stockAdd_(p, u, isA));
      case 'records': return json_(records_(isA));
      case 'loanInfo': return json_(loanInfo_());
      case 'loanCreate': return json_(loanCreate_(p, u));
      case 'loans': return json_(loans_());
      case 'loanReturn': return json_(loanReturn_(p, u));
      case 'loanWriteOff': return json_(loanWriteOff_(p, u));
      case 'laundryDone': return json_(laundryDone_(p, u));
      case 'training': return json_(training_());
    }
    if (!isA) return json_({ ok: false, error: 'NOT_ALLOWED' });
    switch (p.action) {
      case 'approve': return json_(approve_(p, u));
      case 'reject': return json_(reject_(p, u));
      case 'void': return json_(void_(p, u));
      case 'report': return json_(report_());
      case 'history': return json_(history_(p));
    }
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: 'SERVER_ERROR', detail: String(err) });
  }
}

/* ================= Helpers ================= */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function sh_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function hash_(v) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, prop_('SALT') + String(v));
  return d.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function rows_(name) {
  const v = sh_(name).getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0];
  return v.slice(1).filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o;
  });
}
function findRow_(name, col, val) {
  const s = sh_(name), n = s.getLastRow(); if (n < 2) return 0;
  const v = s.getRange(1, col, n, 1).getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === String(val)) return i + 1;
  return 0;
}
function getReq_(row) {
  const h = SHEETS.Requests, v = sh_('Requests').getRange(row, 1, 1, h.length).getValues()[0], o = {};
  h.forEach(function (k, i) { o[k] = v[i] instanceof Date ? v[i].toISOString() : v[i]; }); return o;
}
function setReq_(row, obj) {
  Object.keys(obj).forEach(function (k) { sh_('Requests').getRange(row, SHEETS.Requests.indexOf(k) + 1).setValue(obj[k]); });
}
function audit_(id, ev, actor, detail) { sh_('Audit').appendRow([new Date(), id, ev, actor, detail || '']); }
function auth_(pin) {
  const c = CacheService.getScriptCache(), f = Number(c.get('pinfails') || 0);
  if (f >= 15) return { ok: false, error: 'LOCKED_TRY_LATER' };
  const u = rows_('Users').filter(function (x) { return String(x.Active).toLowerCase() !== 'no' && String(x.PIN) === String(pin) && pin; })[0];
  if (!u) { c.put('pinfails', String(f + 1), 600); return { ok: false, error: 'BAD_PIN' }; }
  c.remove('pinfails');
  return { ok: true, name: u.Name, role: String(u.Role).toLowerCase() === 'approver' ? 'approver' : 'store' };
}
function itemsText_(items) {
  return items.map(function (i) { return i.qty + ' x ' + i.item + (i.size ? ' (' + i.size + ')' : ''); }).join(', ');
}
function fmt_(d) { return Utilities.formatDate(new Date(d), 'Asia/Jakarta', 'dd MMM yyyy HH:mm') + ' WIB'; }
function mail_(to, subject, body, cc) { const o = { to: to, subject: subject, htmlBody: body, name: 'EcoOils Mentari HSSE' }; if (cc) o.cc = cc; MailApp.sendEmail(o); }
function tpl_(title, inner) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">' +
    '<div style="background:#0b5d3b;color:#fff;padding:14px 18px;font-size:18px"><b>' + title + '</b></div>' +
    '<div style="padding:18px;font-size:15px;line-height:1.5">' + inner + '</div>' +
    '<div style="background:#f4f4f4;padding:10px 18px;font-size:12px;color:#666">EcoOils Mentari HSSE · PPE System v' + VERSION + '</div></div>';
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function adminMail_(subject, body) { try { mail_(prop_('ADMIN_EMAIL'), subject, body); } catch (e) { } }
function cleanItems_(items, catalog, strict) {
  const out = [];
  (items || []).slice(0, 8).forEach(function (i) {
    const c = catalog.filter(function (x) { return x.Item === i.item; })[0];
    const q = Math.floor(Number(i.qty));
    if (!c || !(q > 0) || q > 20) return;
    const sizes = String(c.Sizes || '').split(',').filter(Boolean);
    if (sizes.length && sizes.indexOf(String(i.size)) < 0) return;
    out.push({ item: c.Item, size: sizes.length ? String(i.size) : '', qty: q });
  });
  return out;
}

/* ================= Employee (public) ================= */
function people_() {
  return { ok: true, people: rows_('Personnel').filter(function (x) { return String(x.Active).toLowerCase() !== 'no'; })
    .map(function (x) { return { PersonID: x.PersonID, Name: x.Name, Company: x.Company, Sponsor: String(x.Sponsor).toLowerCase() === 'yes' && !!x.Email, NoEmail: !x.Email }; }) };
}

function catItem_(catalog, name) { return catalog.filter(function (x) { return x.Item === name; })[0]; }
function isFree_(catalog, name) { const c = catItem_(catalog, name); return !!c && String(c.Approval).toLowerCase() === 'no'; }
function isLoanItem_(catalog, name) { const c = catItem_(catalog, name); return !!c && String(c.Loan) === 'Always'; }

/* Collection-code email. Used for approved requests and for self-service (no-approval) requests. */
function codeMail_(o) {
  const link = prop_('FRONTEND_URL') + '?pass=' + o.id + '#' + o.otp;
  mail_(o.to, (o.auto ? 'PPE pass code – no approval needed (' : 'PPE approved – collection code (') + o.id + ')' + (o.forName ? ' for ' + o.forName : ''),
    tpl_(o.auto ? 'PPE pass / Kode APD' : 'PPE Approved / APD Disetujui',
      '<p>Dear ' + esc_(o.dear) + ',</p><p>' + (o.auto ? 'These items need no approval. Your request is recorded' + (o.forName ? ' for <b>' + esc_(o.forName) + '</b>' : '') + ' / Item ini tidak perlu persetujuan. Permintaan tercatat:' :
        'The PPE request' + (o.forName ? ' for <b>' + esc_(o.forName) + '</b>' : '') + ' has been approved / Permintaan APD disetujui:') + '</p><p><b>' + esc_(o.items) + '</b></p>' +
      '<p>Collection code at the PPE store / Kode pengambilan di gudang APD:</p>' +
      '<p style="font-size:36px;letter-spacing:8px;text-align:center;font-weight:bold;color:#0b5d3b;background:#e8f3ee;padding:12px;border-radius:8px">' + o.otp + '</p>' +
      '<p style="text-align:center"><a href="' + link + '" style="background:#0b5d3b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open my QR pass / Buka QR pass</a><br><span style="font-size:12px;color:#555">Show the QR at the store – the storekeeper scans it. / Tunjukkan QR di gudang.</span></p>' +
      (o.forName ? '<p style="color:#b42318"><b>Give this code only to ' + esc_(o.forName) + ', in person. They must show their ID / badge at the store. You are the sponsor and are accountable for this issue.<br>Berikan kode ini hanya kepada ' + esc_(o.forName) + ' secara langsung. Wajib menunjukkan ID/badge di gudang. Anda bertanggung jawab sebagai sponsor.</b></p>' : '') +
      '<p style="font-size:13px;color:#555">Ref: ' + o.id + '. Collect before / Ambil sebelum: ' + fmt_(o.exp) + '. Do not share the code with anyone else. / Jangan bagikan kode ini.</p>'));
}

function submit_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const catalog = rows_('Items'), items = cleanItems_(p.items, catalog);
    if (!items.length) return { ok: false, error: 'NO_ITEMS' };
    if (REASONS.indexOf(p.reason) < 0) return { ok: false, error: 'BAD_REASON' };
    // Split: self-service items (Approval = No) are recorded and given a code at once; the rest wait for the approver.
    const free = items.filter(function (i) { return isFree_(catalog, i.item); }), paid = items.filter(function (i) { return !isFree_(catalog, i.item); });
    if (free.some(function (i) { return i.qty > AUTO_MAX_QTY; })) return { ok: false, error: 'AUTO_QTY' };
    const parts = (free.length ? 1 : 0) + (paid.length ? 1 : 0);
    const base = []; let per, verified = 'Yes', sponsor = null;
    if (p.personId) {
      per = rows_('Personnel').filter(function (x) { return String(x.PersonID) === String(p.personId) && String(x.Active).toLowerCase() !== 'no'; })[0];
      if (!per) return { ok: false, error: 'PERSON_NOT_FOUND' };
    } else {
      const nn = p.newPerson || {};
      if (!String(nn.name || '').trim() || !String(nn.company || '').trim()) return { ok: false, error: 'DETAILS_REQUIRED' };
      per = { PersonID: 'NEW', Name: String(nn.name).trim().slice(0, 80), Company: String(nn.company).trim().slice(0, 60), Email: '' };
      verified = 'No'; base.push('NOT_IN_REGISTER');
    }
    const all = rows_('Requests');
    if (!per.Email) {   // no email on file: a sponsor receives the code and is accountable
      sponsor = rows_('Personnel').filter(function (x) { return String(x.PersonID) === String(p.sponsorId) && String(x.Active).toLowerCase() !== 'no' && String(x.Sponsor).toLowerCase() === 'yes' && x.Email; })[0];
      if (!sponsor) return { ok: false, error: 'SPONSOR_REQUIRED' };
      const open = all.filter(function (r) { return r.Sponsor && r.Email === sponsor.Email && (r.Status === 'Requested' || r.Status === 'Approved'); }).length;
      if (open + parts > MAX_OPEN_PER_SPONSOR) return { ok: false, error: 'SPONSOR_LIMIT' };
      base.push('SPONSORED|' + sponsor.Name); base.push('ID_CHECK');
    }
    const mine = all.filter(function (r) { return (per.PersonID !== 'NEW' ? String(r.PersonID) === String(per.PersonID) : (String(r.PersonID) === 'NEW' && String(r.Name).toLowerCase() === per.Name.toLowerCase())) && (r.Status === 'Requested' || r.Status === 'Approved'); });
    if (mine.length + parts > MAX_OPEN_PER_PERSON) return { ok: false, error: 'TOO_MANY_OPEN' };
    for (let a = 0; a < items.length; a++) for (let b = 0; b < mine.length; b++)
      if (JSON.parse(mine[b].Items).some(function (x) { return x.item === items[a].item; })) return { ok: false, error: 'DUPLICATE_OPEN', detail: items[a].item };
    // per-item flags: early re-issue, and a loan item the person already holds
    const itemFlags = [], loansOut = rows_('Loans').filter(function (l) { return l.Status === 'Out' && l.Type === 'Employee' && per.PersonID !== 'NEW' && String(l.HostID) === String(per.PersonID); });
    items.forEach(function (it) {
      const life = Number((catItem_(catalog, it.item) || {}).ServiceLifeDays || 0);
      if (life) {
        const last = all.filter(function (r) { return r.Status === 'Issued' && String(r.PersonID) === String(per.PersonID) && per.PersonID !== 'NEW' && JSON.parse(r.ApprovedItems || '[]').some(function (x) { return x.item === it.item; }); })
          .map(function (r) { return new Date(r.IssuedAt); }).sort(function (x, y) { return y - x; })[0];
        if (last && (Date.now() - last) / 86400000 < life) itemFlags.push({ item: it.item, f: 'EARLY_REISSUE|' + it.item + '|' + Utilities.formatDate(last, 'Asia/Jakarta', 'dd MMM yyyy') });
      }
      if (isLoanItem_(catalog, it.item) && loansOut.some(function (l) { return JSON.parse(l.Items).some(function (x) { return x.item === it.item; }); })) itemFlags.push({ item: it.item, f: 'ALREADY_ON_LOAN|' + it.item });
    });
    if (p.reason === 'Lost') { base.push('LOST'); if (!p.facilityReported) base.push('LOST_NOT_REPORTED'); }
    if (p.reason === 'Replacement-Damaged') base.push('DAMAGED');
    const day = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyMMdd');
    let seq = all.filter(function (r) { return String(r.ReqID).indexOf('REQ-' + day) === 0; }).length;
    const remark = (String(p.remark || '') + (p.reason === 'Lost' && p.facilityReported ? ' [Reported to Head of Facility' + (p.facilityName ? ': ' + String(p.facilityName).slice(0, 60) : '') + ']' : '')).slice(0, 300);
    const notifyTo = sponsor ? sponsor.Email : per.Email, out = [];
    function addPart(list, auto) {
      seq++;
      const id = 'REQ-' + day + '-' + ('00' + seq).slice(-3), token = Utilities.getUuid().replace(/-/g, '');
      const fl = base.concat(itemFlags.filter(function (x) { return list.some(function (i) { return i.item === x.item; }); }).map(function (x) { return x.f; }));
      if (auto) fl.push('AUTO');
      if (auto) {
        const otp = String(Math.floor(100000 + Math.random() * 900000)), exp = new Date(Date.now() + OTP_DAYS * 86400000), now = new Date();
        try { codeMail_({ to: notifyTo, id: id, dear: sponsor ? sponsor.Name : per.Name, forName: sponsor ? per.Name : '', items: itemsText_(list), otp: otp, exp: exp, auto: true }); }
        catch (e) { return 'EMAIL_FAILED'; }
        sh_('Requests').appendRow([id, now, per.PersonID, per.Name, per.Company, notifyTo, verified, sponsor ? sponsor.Name : '', JSON.stringify(list),
          p.reason, remark, '', JSON.stringify(fl), 'Approved', hash_(token), 'Auto (no approval needed)', now, JSON.stringify(list), hash_(otp), exp, 0, '', '', '', '', '']);
        audit_(id, 'REQUESTED', per.Name, itemsText_(list) + ' | ' + p.reason + (fl.length ? ' | ' + fl.join(',') : ''));
        audit_(id, 'AUTO_APPROVED', 'System', 'No approval needed – code emailed to ' + notifyTo);
      } else {
        sh_('Requests').appendRow([id, new Date(), per.PersonID, per.Name, per.Company, notifyTo, verified, sponsor ? sponsor.Name : '', JSON.stringify(list),
          p.reason, remark, '', JSON.stringify(fl), 'Requested', hash_(token), '', '', '', '', '', 0, '', '', '', '', '']);
        audit_(id, 'REQUESTED', per.Name, itemsText_(list) + ' | ' + p.reason + (fl.length ? ' | ' + fl.join(',') : ''));
        adminMail_('PPE request – ' + per.Name + ' (' + id + ')', tpl_('New PPE request',
          '<p><b>' + esc_(per.Name) + '</b> · ' + esc_(per.Company) + (verified === 'No' ? ' <span style="color:#b42318">(NOT IN REGISTER)</span>' : '') + (sponsor ? '<br>Sponsor: ' + esc_(sponsor.Name) + ' – ID check at store' : '') + '</p>' +
          '<p><b>' + esc_(itemsText_(list)) + '</b><br>' + esc_(p.reason) + (fl.length ? '<br><span style="color:#b42318">⚠ ' + esc_(fl.join(', ')) + '</span>' : '') + '</p>' +
          '<p style="text-align:center"><a href="' + prop_('FRONTEND_URL') + '?mode=staff&req=' + id + '" style="background:#0b5d3b;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Review &amp; Approve</a></p>'));
      }
      out.push({ id: id, token: token, auto: auto });
      return '';
    }
    if (free.length) { const e = addPart(free, true); if (e) return { ok: false, error: e }; }
    if (paid.length) addPart(paid, false);
    return { ok: true, id: out[0].id, token: out[0].token, parts: out };
  } finally { lock.releaseLock(); }
}

function status_(p) {
  const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'INVALID_LINK' };
  const r = getReq_(row);
  if (hash_(p.token) !== r.TokenHash) return { ok: false, error: 'INVALID_LINK' };
  return { ok: true, id: r.ReqID, status: r.Status, items: JSON.parse(r.Items), approvedItems: r.ApprovedItems ? JSON.parse(r.ApprovedItems) : null,
    auto: String(r.ApprovedBy).indexOf('Auto') === 0, reason: r.Reason, createdAt: r.CreatedAt, approvedAt: r.ApprovedAt, expires: r.OtpExpires, issuedAt: r.IssuedAt, receipt: r.ReceiptCode, note: r.Note, name: r.Name };
}

function cancel_(p) {
  const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'INVALID_LINK' };
  const r = getReq_(row);
  if (hash_(p.token) !== r.TokenHash) return { ok: false, error: 'INVALID_LINK' };
  if (r.Status !== 'Requested') return { ok: false, error: 'CANNOT_CANCEL' };
  setReq_(row, { Status: 'Cancelled', Note: 'Cancelled by employee' });
  audit_(r.ReqID, 'CANCELLED', r.Name, 'by employee');
  return { ok: true };
}

/* ================= Approver ================= */
function queue_(isA) {
  const all = rows_('Requests'), out = [];
  all.forEach(function (r) {
    if (r.Status === 'Approved' || (isA && r.Status === 'Requested')) out.push({
      ReqID: r.ReqID, CreatedAt: r.CreatedAt, PersonID: r.PersonID, Name: r.Name, Company: r.Company, Verified: r.Verified,
      Items: r.Items, Reason: r.Reason, Remark: r.Remark, HasPhoto: !!r.PhotoId, Flags: r.Flags, Status: r.Status,
      ApprovedBy: r.ApprovedBy, ApprovedAt: r.ApprovedAt, ApprovedItems: r.ApprovedItems, OtpExpires: r.OtpExpires, Sponsor: r.Sponsor
    });
  });
  return { ok: true, queue: out.reverse(), loanItems: rows_('Items').filter(function (x) { return String(x.Loan) === 'Always'; }).map(function (x) { return x.Item; }) };
}

function approve_(p, u) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
    const r = getReq_(row);
    if (r.Status !== 'Requested') return { ok: false, error: 'ALREADY_' + String(r.Status).toUpperCase() };
    const items = p.items ? cleanItems_(p.items, rows_('Items')) : JSON.parse(r.Items);
    if (!items.length) return { ok: false, error: 'NO_ITEMS' };
    const otp = String(Math.floor(100000 + Math.random() * 900000)), exp = new Date(Date.now() + OTP_DAYS * 86400000);
    try { codeMail_({ to: r.Email, id: r.ReqID, dear: r.Sponsor || r.Name, forName: r.Sponsor ? r.Name : '', items: itemsText_(items), otp: otp, exp: exp, auto: false }); }
    catch (e) { return { ok: false, error: 'EMAIL_FAILED', detail: String(e) }; }
    setReq_(row, { Status: 'Approved', ApprovedBy: u.name, ApprovedAt: new Date(), ApprovedItems: JSON.stringify(items), OtpHash: hash_(otp), OtpExpires: exp, Tries: 0, Note: '' });
    audit_(r.ReqID, 'APPROVED', u.name, itemsText_(items));
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function reject_(p, u) {
  const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
  const r = getReq_(row);
  if (r.Status !== 'Requested') return { ok: false, error: 'ALREADY_' + String(r.Status).toUpperCase() };
  if (!String(p.reason || '').trim()) return { ok: false, error: 'REASON_REQUIRED' };
  setReq_(row, { Status: 'Rejected', ApprovedBy: u.name, ApprovedAt: new Date(), Note: String(p.reason) });
  audit_(r.ReqID, 'REJECTED', u.name, p.reason);
  try { mail_(r.Email, 'PPE request not approved (' + r.ReqID + ')', tpl_('PPE not approved / APD tidak disetujui',
    '<p>Dear ' + esc_(r.Sponsor || r.Name) + ',</p>' + (r.Sponsor ? '<p>Request for <b>' + esc_(r.Name) + '</b></p>' : '') + '<p>' + esc_(itemsText_(JSON.parse(r.Items))) + '</p><p>Reason / Alasan: <b>' + esc_(p.reason) + '</b></p>')); } catch (e) { }
  return { ok: true };
}

function void_(p, u) {
  const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
  const r = getReq_(row);
  if (r.Status !== 'Requested' && r.Status !== 'Approved') return { ok: false, error: 'CANNOT_VOID_' + String(r.Status).toUpperCase() };
  if (!String(p.reason || '').trim()) return { ok: false, error: 'REASON_REQUIRED' };
  setReq_(row, { Status: 'Voided', OtpHash: '', Note: 'VOID: ' + p.reason });
  audit_(r.ReqID, 'VOIDED', u.name, p.reason);
  return { ok: true };
}

/* ================= Store ================= */
function issue_(p, u) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const row = findRow_('Requests', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
    const r = getReq_(row);
    if (r.Status !== 'Approved') return { ok: false, error: 'ALREADY_' + String(r.Status).toUpperCase() };
    if (new Date() > new Date(r.OtpExpires)) { setReq_(row, { Status: 'Expired' }); audit_(r.ReqID, 'EXPIRED', 'System', ''); return { ok: false, error: 'EXPIRED' }; }
    if (Number(r.Tries) >= MAX_OTP_TRIES) return { ok: false, error: 'LOCKED' };
    if (r.Sponsor && !p.idChecked) return { ok: false, error: 'ID_CHECK_REQUIRED' };
    if (hash_(String(p.otp || '').trim()) !== r.OtpHash) {
      const t = Number(r.Tries) + 1; setReq_(row, { Tries: t });
      audit_(r.ReqID, 'BAD_OTP', u.name, 'attempt ' + t);
      return { ok: false, error: t >= MAX_OTP_TRIES ? 'LOCKED' : 'BAD_OTP', left: MAX_OTP_TRIES - t };
    }
    const items = JSON.parse(r.ApprovedItems), cat = rows_('Items');
    // stock check (only for items that have stock rows)
    const sh = sh_('Stock'), sv = sh.getDataRange().getValues(), low = [];
    for (let k = 0; k < items.length; k++) {
      const tracked = sv.slice(1).some(function (x) { return x[0] === items[k].item; });
      if (!tracked) continue;
      const idx = sv.findIndex(function (x, i) { return i > 0 && x[0] === items[k].item && String(x[1]) === String(items[k].size); });
      if (idx < 1 || Number(sv[idx][2]) < items[k].qty) return { ok: false, error: 'STOCK_LOW', detail: items[k].item + (items[k].size ? ' ' + items[k].size : '') };
    }
    items.forEach(function (it) {
      const idx = sv.findIndex(function (x, i) { return i > 0 && x[0] === it.item && String(x[1]) === String(it.size); });
      if (idx < 1) return;
      const left = Number(sv[idx][2]) - it.qty; sv[idx][2] = left; sh.getRange(idx + 1, 3).setValue(left);
      sh_('StockLog').appendRow([new Date(), it.item, it.size, -it.qty, isLoanItem_(cat, it.item) ? 'Loan out' : 'Issued', r.ReqID, u.name]);
      if (Number(sv[idx][3]) && left <= Number(sv[idx][3])) low.push(it.item + (it.size ? ' ' + it.size : '') + ' = ' + left);
    });
    const now = new Date();
    const receipt = hash_([r.ReqID, r.PersonID, r.ApprovedItems, u.name, now.toISOString()].join('|')).slice(0, 12).toUpperCase();
    let oldNote = '';
    if (String(r.Reason).indexOf('Replacement') === 0 && items.some(function (i) { return needsReturn_(i.item); })) {
      oldNote = p.oldReturned === 'Yes' ? 'Old item returned' : p.oldReturned === 'No' ? 'Old item NOT returned' + (p.oldNote ? ': ' + String(p.oldNote).slice(0, 100) : '') : 'Old item return not recorded';
    }
    // loan items (e.g. full body harness): create an employee loan, tracked until returned
    const lo = items.filter(function (i) { return isLoanItem_(cat, i.item); }); let due = null, loanId = '';
    if (lo.length) {
      due = new Date(now.getTime() + EMP_LOAN_DAYS * 86400000);
      const dd = Utilities.formatDate(now, 'Asia/Jakarta', 'yyMMdd');
      loanId = 'EMP-' + dd + '-' + ('00' + (rows_('Loans').filter(function (x) { return String(x.LoanID).indexOf('EMP-' + dd) === 0; }).length + 1)).slice(-3);
      sh_('Loans').appendRow([loanId, now, r.Name, r.Company, r.PersonID, r.Sponsor || r.Name, r.Email, JSON.stringify(lo), 'Employee loan – ' + r.ReqID, 'Out', u.name, '', '', '', '', '', 0, 'Employee', due]);
      audit_(loanId, 'LOAN_OUT', u.name, r.Name + ' / ' + itemsText_(lo) + ' / due ' + jDay_(due) + ' / ' + r.ReqID);
    }
    setReq_(row, { Status: 'Issued', IssuedBy: u.name, IssuedAt: now, ReceiptCode: receipt, OtpHash: '', Note: oldNote + (loanId ? (oldNote ? ' | ' : '') + 'Loan ' + loanId : '') });
    audit_(r.ReqID, 'ISSUED', u.name, 'Receipt ' + receipt + (r.Sponsor ? ' | ID checked | sponsor ' + r.Sponsor : '') + (oldNote ? ' | ' + oldNote : ''));
    try { mail_(r.Email, 'PPE received – ' + r.ReqID, tpl_('PPE Issued / APD Diterima',
      '<p>Dear ' + esc_(r.Sponsor || r.Name) + ',</p><p>' + (r.Sponsor ? '<b>' + esc_(r.Name) + '</b> received / menerima:' : 'You received / Anda menerima:') + '</p><p><b>' + esc_(itemsText_(items)) + '</b></p>' +
      '<p>Issued by / Oleh: ' + esc_(u.name) + '<br>' + fmt_(now) + '<br>Ref: ' + r.ReqID + '<br>Receipt / Bukti: <b>' + receipt + '</b></p>' +
      (lo.length ? '<p style="background:#fef0c7;padding:8px 12px;border-radius:8px"><b>On loan / Pinjaman:</b> ' + esc_(itemsText_(lo)) + '<br>This stays store property. Return it to the PPE store when the job is finished (reminder after ' + fmt_(due) + '). Check it before every use. If it is damaged or has stopped a fall, do not use it – return it to the store.<br>Tetap milik gudang. Kembalikan ke gudang APD setelah pekerjaan selesai. Periksa sebelum dipakai; jika rusak atau pernah menahan jatuh, jangan dipakai – kembalikan.</p>' : '') +
      careMail_(items) + '<p style="font-size:13px;color:#555">If this is wrong, contact HSSE immediately. / Jika tidak benar, hubungi HSSE segera.</p>'), r.Sponsor ? prop_('ADMIN_EMAIL') : ''); } catch (e) { }
    if (low.length) adminMail_('Low PPE stock', tpl_('Low stock', '<p>' + low.map(esc_).join('<br>') + '</p>'));
    return { ok: true, receipt: receipt, at: now.toISOString() };
  } finally { lock.releaseLock(); }
}

function stock_(isA) {
  const all = rows_('StockLog'), lg = all.slice().reverse().slice(0, 40);
  const days = {}, now = Date.now();
  for (let i = 29; i >= 0; i--) days[Utilities.formatDate(new Date(now - i * 86400000), 'Asia/Jakarta', 'yyyy-MM-dd')] = { d: '', out: 0, inn: 0 };
  all.forEach(function (l) {
    const k = Utilities.formatDate(new Date(l.Timestamp), 'Asia/Jakarta', 'yyyy-MM-dd'); if (!days[k]) return;
    const ch = Number(l.Change), rs = String(l.Reason);
    if (ch < 0 && (rs === 'Issued' || rs === 'Loan out')) days[k].out += -ch;
    if (ch > 0 && rs.indexOf('Received') === 0) days[k].inn += ch;
  });
  const trend = Object.keys(days).sort().map(function (k) { return { d: k, out: days[k].out, inn: days[k].inn }; });
  const dm = {};
  rows_('Requests').forEach(function (r) {
    if (r.Status !== 'Approved' && !(isA && r.Status === 'Requested')) return;
    JSON.parse(r.Status === 'Approved' ? r.ApprovedItems : r.Items).forEach(function (i) {
      const k = i.item + '|' + i.size; dm[k] = dm[k] || { item: i.item, size: i.size, qty: 0, names: [] }; dm[k].qty += i.qty; dm[k].names.push(r.Name + (i.qty > 1 ? ' ×' + i.qty : ''));
    });
  });
  return { ok: true, stock: rows_('Stock'), items: rows_('Items'), log: lg, trend: trend, demand: Object.keys(dm).map(function (k) { return dm[k]; }) };
}

function stockAdd_(p, u, isA) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const q = Math.floor(Number(p.qty)), it = String(p.item || ''), sz = String(p.size || '');
    if (!it || !q) return { ok: false, error: 'BAD_INPUT' };
    if (!rows_('Items').some(function (x) { return x.Item === it; })) return { ok: false, error: 'BAD_INPUT' };
    const sh = sh_('Stock'), v = sh.getDataRange().getValues();
    const idx = v.findIndex(function (x, i) { return i > 0 && x[0] === it && String(x[1]) === sz; });
    if (q < 0 && !isA) return { ok: false, error: 'NOT_ALLOWED' };   // only approver may reduce / correct stock
    if (idx < 1) { if (q < 0) return { ok: false, error: 'BAD_INPUT' }; sh.appendRow([it, sz, q, isA ? Number(p.minLevel || 0) : 0]); }
    else {
      const nv = Number(v[idx][2]) + q; if (nv < 0) return { ok: false, error: 'BAD_INPUT' };
      sh.getRange(idx + 1, 3).setValue(nv);
      if (isA && p.minLevel !== undefined && p.minLevel !== '') sh.getRange(idx + 1, 4).setValue(Number(p.minLevel));
    }
    sh_('StockLog').appendRow([new Date(), it, sz, q, String(p.reason || (q > 0 ? 'Received' : 'Correction')).slice(0, 80), String(p.ref || '').slice(0, 60), u.name]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ================= Records / reports ================= */
function records_(isA) {
  let list = rows_('Requests').map(function (r) {
    return { ReqID: r.ReqID, CreatedAt: r.CreatedAt, PersonID: r.PersonID, Name: r.Name, Company: r.Company, Items: r.Items, Reason: r.Reason, Status: r.Status,
      ApprovedBy: r.ApprovedBy, ApprovedAt: r.ApprovedAt, ApprovedItems: r.ApprovedItems, IssuedBy: r.IssuedBy, IssuedAt: r.IssuedAt, ReceiptCode: r.ReceiptCode, Note: r.Note, Flags: r.Flags };
  }).reverse();
  if (!isA) list = list.filter(function (r) { return r.Status === 'Issued'; }).slice(0, 150);
  return { ok: true, records: list.slice(0, 600) };
}

function history_(p) {
  return { ok: true, records: rows_('Requests').filter(function (r) { return String(r.PersonID) === String(p.personId); })
    .map(function (r) { return { ReqID: r.ReqID, Status: r.Status, Items: r.ApprovedItems || r.Items, IssuedAt: r.IssuedAt, CreatedAt: r.CreatedAt }; }).reverse().slice(0, 30) };
}

function report_() {
  const all = rows_('Requests'), cnt = {}, byMonth = {}, byItem = {}, byCo = {}, byReason = {}; let a1 = 0, n1 = 0, a2 = 0, n2 = 0;
  all.forEach(function (r) {
    cnt[r.Status] = (cnt[r.Status] || 0) + 1;
    byReason[r.Reason] = (byReason[r.Reason] || 0) + 1;
    if (r.ApprovedAt && r.Status !== 'Rejected') { a1 += (new Date(r.ApprovedAt) - new Date(r.CreatedAt)) / 3600000; n1++; }
    if (r.Status === 'Issued') {
      a2 += (new Date(r.IssuedAt) - new Date(r.ApprovedAt)) / 3600000; n2++;
      const m = Utilities.formatDate(new Date(r.IssuedAt), 'Asia/Jakarta', 'yyyy-MM');
      JSON.parse(r.ApprovedItems).forEach(function (i) {
        byMonth[m] = (byMonth[m] || 0) + i.qty; byItem[i.item] = (byItem[i.item] || 0) + i.qty; byCo[r.Company] = (byCo[r.Company] || 0) + i.qty;
      });
    }
  });
  const low = rows_('Stock').filter(function (s) { return Number(s.MinLevel) && Number(s.OnHand) <= Number(s.MinLevel); });
  return { ok: true, counts: cnt, byMonth: byMonth, byItem: byItem, byCompany: byCo, byReason: byReason, low: low,
    avgApproveHours: n1 ? Math.round(a1 / n1 * 10) / 10 : null, avgCollectHours: n2 ? Math.round(a2 / n2 * 10) / 10 : null };
}

/* ================= Daily trigger ================= */
function dailyMaintenance() {
  const now = new Date(); const pend = [], low = [];
  rows_('Requests').forEach(function (r) {
    const row = findRow_('Requests', 1, r.ReqID);
    if (r.Status === 'Requested' && now - new Date(r.CreatedAt) > 86400000) pend.push(r.Name + ' – ' + itemsText_(JSON.parse(r.Items)) + ' (' + r.ReqID + ')');
    if (r.Status === 'Approved') {
      if (now > new Date(r.OtpExpires)) { setReq_(row, { Status: 'Expired' }); audit_(r.ReqID, 'EXPIRED', 'System', 'Not collected'); }
      else if (!r.Reminded && now - new Date(r.ApprovedAt) > 3 * 86400000) {
        try { mail_(r.Email, 'Reminder: collect your PPE (' + r.ReqID + ')', tpl_('Reminder / Pengingat', '<p>Dear ' + esc_(r.Sponsor || r.Name) + ', approved PPE' + (r.Sponsor ? ' for ' + esc_(r.Name) : '') + ' is waiting at the store. Use the code in the approval email. Valid until ' + fmt_(r.OtpExpires) + '.<br>APD Anda sudah disetujui dan menunggu di gudang. Gunakan kode di email persetujuan.</p>')); } catch (e) { }
        setReq_(row, { Reminded: 'Yes' }); audit_(r.ReqID, 'REMINDER_SENT', 'System', r.Email);
      }
    }
  });
  rows_('Stock').forEach(function (x) { if (Number(x.MinLevel) && Number(x.OnHand) <= Number(x.MinLevel)) low.push(x.Item + (x.Size ? ' ' + x.Size : '') + ' = ' + x.OnHand + ' (min ' + x.MinLevel + ')'); });
  const out = rows_('Loans').filter(function (l) { return l.Status === 'Out' && (l.Type !== 'Employee' || (l.Due && jDay_(l.Due) < jDay_(now))); }).map(function (l) { return l.Visitors + (l.Type === 'Employee' ? ' (employee loan, due ' + jDay_(l.Due) + ')' : ' (host ' + l.HostName + ')') + ' – ' + itemsText_(JSON.parse(l.Items)) + ' – ' + l.LoanID; });
  const selfFlag = rows_('Requests').filter(function (r) { return r.Status === 'Issued' && String(r.ApprovedBy).indexOf('Auto') === 0 && now - new Date(r.IssuedAt) < 86400000 && /EARLY_REISSUE|LOST/.test(r.Flags); }).map(function (r) { return r.Name + ' – ' + itemsText_(JSON.parse(r.ApprovedItems)) + ' – ' + String(r.Flags).replace(/[\[\]"]/g, '') + ' (' + r.ReqID + ')'; });
  try { chase_(false); } catch (e) { }
  if (pend.length || low.length || out.length || selfFlag.length) adminMail_('PPE daily summary', tpl_('PPE daily summary',
    (selfFlag.length ? '<p><b>Self-service items issued in the last 24h with a flag:</b><br>' + selfFlag.map(esc_).join('<br>') + '</p>' : '') +
    (out.length ? '<p><b>Visitor loans out / employee loans overdue:</b><br>' + out.map(esc_).join('<br>') + '</p>' : '') +
    (pend.length ? '<p><b>Waiting for your approval (&gt;24h):</b><br>' + pend.map(esc_).join('<br>') + '</p>' : '') +
    (low.length ? '<p><b>Low stock:</b><br>' + low.map(esc_).join('<br>') + '</p>' : '')));
}

/* ================= Visitor / temporary loans (v2.3) ================= */
function loanItems_() { return rows_('Items').filter(function (x) { return String(x.Loan) === 'Yes' || String(x.Loan) === 'Only' || String(x.Loan) === 'Always'; }); }
function jDay_(d) { return Utilities.formatDate(new Date(d), 'Asia/Jakarta', 'yyyy-MM-dd'); }
function loanRec_(row) {
  const h = SHEETS.Loans, v = sh_('Loans').getRange(row, 1, 1, h.length).getValues()[0], o = {};
  h.forEach(function (k, i) { o[k] = v[i] instanceof Date ? v[i].toISOString() : v[i]; }); return o;
}
function setLoan_(row, obj) { Object.keys(obj).forEach(function (k) { sh_('Loans').getRange(row, SHEETS.Loans.indexOf(k) + 1).setValue(obj[k]); }); }
function stockMove_(item, size, delta, reason, ref, actor, checkOnly) {
  const sh = sh_('Stock'), v = sh.getDataRange().getValues();
  const tracked = v.slice(1).some(function (x) { return x[0] === item; });
  if (!tracked) return null;
  const idx = v.findIndex(function (x, i) { return i > 0 && x[0] === item && String(x[1]) === String(size); });
  if (delta < 0) { if (idx < 1 || Number(v[idx][2]) < -delta) return item + (size ? ' ' + size : ''); }
  if (checkOnly) return null;
  if (idx < 1) sh.appendRow([item, size, delta, 0]); else sh.getRange(idx + 1, 3).setValue(Number(v[idx][2]) + delta);
  sh_('StockLog').appendRow([new Date(), item, size, delta, reason, ref, actor]);
  return null;
}
function loanInfo_() {
  const people = rows_('Personnel').filter(function (x) { return String(x.Active).toLowerCase() !== 'no' && x.Email; })
    .map(function (x) { return { PersonID: x.PersonID, Name: x.Name, Company: x.Company }; });
  return { ok: true, hosts: people, items: loanItems_() };
}
function loanCreate_(p, u) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const host = rows_('Personnel').filter(function (x) { return String(x.PersonID) === String(p.hostId) && String(x.Active).toLowerCase() !== 'no'; })[0];
    if (!host || !host.Email) return { ok: false, error: 'HOST_REQUIRED' };
    const vis = String(p.visitors || '').trim().slice(0, 200), co = String(p.company || '').trim().slice(0, 80);
    if (!vis || !co) return { ok: false, error: 'DETAILS_REQUIRED' };
    const items = cleanItems_(p.items, loanItems_());
    if (!items.length) return { ok: false, error: 'NO_ITEMS' };
    for (let i = 0; i < items.length; i++) { const bad = stockMove_(items[i].item, items[i].size, -items[i].qty, '', '', '', true); if (bad) return { ok: false, error: 'STOCK_LOW', detail: bad }; }
    const day = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyMMdd');
    const n = rows_('Loans').filter(function (r) { return String(r.LoanID).indexOf('VIS-' + day) === 0; }).length + 1;
    const id = 'VIS-' + day + '-' + ('00' + n).slice(-3);
    items.forEach(function (it) { stockMove_(it.item, it.size, -it.qty, 'Loan out', id, u.name, false); });
    sh_('Loans').appendRow([id, new Date(), vis, co, host.PersonID, host.Name, host.Email, JSON.stringify(items), String(p.purpose || '').slice(0, 120), 'Out', u.name, '', '', '', '', '', 0, 'Visitor', '']);
    audit_(id, 'LOAN_OUT', u.name, vis + ' / host ' + host.Name + ' / ' + itemsText_(items));
    try { mail_(host.Email, 'You are host: PPE loaned to your visitor (' + id + ')', tpl_('Visitor PPE on loan / APD pinjaman tamu',
      '<p>Dear ' + esc_(host.Name) + ',</p><p>You are the host of <b>' + esc_(vis) + '</b> (' + esc_(co) + ').</p><p>PPE on loan: <b>' + esc_(itemsText_(items)) + '</b></p>' +
      '<p>Please make sure it is returned to the PPE store before the visitor leaves. If it is not returned today you will receive a reminder.<br>Pastikan APD dikembalikan ke gudang sebelum tamu pulang.</p><p style="font-size:13px;color:#555">Ref: ' + id + '</p>')); } catch (e) { }
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}
function loans_() {
  return { ok: true, loans: rows_('Loans').map(function (l) { return { LoanID: l.LoanID, CreatedAt: l.CreatedAt, Visitors: l.Visitors, VisitorCompany: l.VisitorCompany, HostName: l.HostName, Items: l.Items, Purpose: l.Purpose,
    Status: l.Status, OutBy: l.OutBy, ReturnedAt: l.ReturnedAt, ReturnedBy: l.ReturnedBy, Condition: l.Condition, Note: l.Note, Type: l.Type || 'Visitor', Due: l.Due }; }).reverse().slice(0, 300) };
}
function loanReturn_(p, u) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const row = findRow_('Loans', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
    const l = loanRec_(row); if (l.Status !== 'Out') return { ok: false, error: 'ALREADY_' + String(l.Status).toUpperCase() };
    if (['Good', 'Wash', 'Damaged'].indexOf(p.condition) < 0) return { ok: false, error: 'BAD_INPUT' };
    const items = JSON.parse(l.Items), rest = [];
    let any = false;
    items.forEach(function (it, k) {
      const r = Math.max(0, Math.min(it.qty, Math.floor(Number((p.returned || [])[k] != null ? p.returned[k] : it.qty))));
      if (r > 0) {
        any = true;
        if (p.condition === 'Good') stockMove_(it.item, it.size, r, 'Loan returned', l.LoanID, u.name, false);
        else if (p.condition === 'Wash') stockMove_(it.item, (it.size ? it.size + ' ' : '') + '(Laundry)', r, 'Returned – to laundry', l.LoanID, u.name, false);
      }
      if (it.qty - r > 0) rest.push({ item: it.item, size: it.size, qty: it.qty - r });
    });
    if (!any) return { ok: false, error: 'NOTHING_RETURNED' };
    const note = (l.Note ? l.Note + ' | ' : '') + fmt_(new Date()) + ' ' + p.condition + ' by ' + u.name;
    if (rest.length) { setLoan_(row, { Items: JSON.stringify(rest), Note: note + ' (partial)' }); audit_(l.LoanID, 'LOAN_PARTIAL_RETURN', u.name, p.condition + ' | still out: ' + itemsText_(rest)); return { ok: true, remaining: rest.length }; }
    setLoan_(row, { Status: 'Returned', ReturnedAt: new Date(), ReturnedBy: u.name, Condition: p.condition, Note: note });
    audit_(l.LoanID, 'LOAN_RETURNED', u.name, p.condition);
    if (p.condition === 'Damaged') adminMail_((l.Type === 'Employee' ? 'Loaned PPE returned damaged – ' : 'Visitor PPE returned damaged – ') + l.LoanID, tpl_('Returned damaged', '<p>' + esc_(l.Visitors) + (l.Type === 'Employee' ? '' : ' / host ' + esc_(l.HostName)) + '<br>' + esc_(itemsText_(items)) + '</p>' + (/harness/i.test(l.Items) ? '<p><b>Harness: keep out of service until a competent person (PPE Verifier) has inspected it.</b></p>' : '')));
    return { ok: true, remaining: 0 };
  } finally { lock.releaseLock(); }
}
function loanWriteOff_(p, u) {
  const row = findRow_('Loans', 1, p.id); if (!row) return { ok: false, error: 'NOT_FOUND' };
  const l = loanRec_(row); if (l.Status !== 'Out') return { ok: false, error: 'ALREADY_' + String(l.Status).toUpperCase() };
  if (!String(p.reason || '').trim()) return { ok: false, error: 'REASON_REQUIRED' };
  setLoan_(row, { Status: 'Written off', ReturnedAt: new Date(), ReturnedBy: u.name, Condition: 'Lost', Note: (l.Note ? l.Note + ' | ' : '') + 'WRITTEN OFF: ' + p.reason });
  audit_(l.LoanID, 'LOAN_WRITTEN_OFF', u.name, p.reason);
  try { mail_(l.HostEmail, 'PPE not returned – written off (' + l.LoanID + ')', tpl_('PPE written off', '<p>Dear ' + esc_(l.HostName) + ',</p><p>' + esc_(itemsText_(JSON.parse(l.Items))) + ' loaned to ' + esc_(l.Visitors) + ' was not returned and has been written off.<br>Reason: ' + esc_(p.reason) + '</p>'), prop_('ADMIN_EMAIL')); } catch (e) { }
  return { ok: true };
}
function laundryDone_(p, u) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const q = Math.floor(Number(p.qty)), it = String(p.item || ''), sz = String(p.size || '').replace(/\s*\(Laundry\)$/, '');
    if (!it || !(q > 0)) return { ok: false, error: 'BAD_INPUT' };
    const bad = stockMove_(it, sz ? sz + ' (Laundry)' : '(Laundry)', -q, '', '', '', true); if (bad) return { ok: false, error: 'STOCK_LOW', detail: bad };
    stockMove_(it, sz ? sz + ' (Laundry)' : '(Laundry)', -q, 'Washed', '', u.name, false);
    stockMove_(it, sz, q, 'Back from laundry', '', u.name, false);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
/* Overdue chase: host gets an email if loaned PPE is not back (evening same day, then every morning). */
function eveningChase() { chase_(true); }
function chase_(evening) {
  const today = jDay_(new Date()), hour = Number(Utilities.formatDate(new Date(), 'Asia/Jakarta', 'H'));
  rows_('Loans').forEach(function (l) {
    if (l.Status !== 'Out') return;
    const emp = l.Type === 'Employee';
    let past = jDay_(l.CreatedAt) < today;
    if (emp) {   // employee loans: only reminded after the due date, then weekly (admin copied)
      if (evening || !l.Due || jDay_(l.Due) >= today) return;
      if (l.LastChased && (Date.now() - new Date(l.LastChased)) / 86400000 < 7) return;
      past = true;
    } else {
      if (!past && !(evening && hour >= 17)) return;
      if (l.LastChased && jDay_(l.LastChased) === today) return;
    }
    const row = findRow_('Loans', 1, l.LoanID), items = JSON.parse(l.Items);
    try {
      mail_(l.HostEmail, 'PPE not returned – please return (' + l.LoanID + ')', tpl_('PPE not returned / APD belum dikembalikan',
        '<p>Dear ' + esc_(l.HostName) + ',</p><p>' + (emp ? '<b>' + esc_(l.Visitors) + '</b> has loaned PPE that was due back ' + fmt_(l.Due) + ':' : 'Your visitor <b>' + esc_(l.Visitors) + '</b> has not returned:') + ' <b>' + esc_(itemsText_(items)) + '</b> (loaned ' + fmt_(l.CreatedAt) + ').</p>' +
        '<p>' + (emp ? 'If the job is finished please return it to the PPE store. If you still need it, tell the store. ' : 'Please arrange the return to the PPE store today. ') + '/ Mohon segera dikembalikan ke gudang APD.</p><p style="font-size:13px;color:#555">Ref: ' + l.LoanID + '</p>'), past ? prop_('ADMIN_EMAIL') : '');
    } catch (e) { return; }
    setLoan_(row, { LastChased: new Date(), Chases: Number(l.Chases || 0) + 1 });
    audit_(l.LoanID, emp ? 'LOAN_OVERDUE_CHASED' : 'HOST_CHASED', 'System', l.HostEmail);
  });
}

/* ================= PPE care & replacement rules (v2.6) ================= */
const RETURN_KEYS = ['coverall', 'glass', 'glove', 'ear muff'];   // old item is returned on replacement (per PPE care & replacement guide)
function needsReturn_(name) { const n = String(name).toLowerCase(); if (/disposable|chemical protective|visitor/.test(n)) return false; return RETURN_KEYS.some(function (k) { return n.indexOf(k) >= 0; }); }
function careKey_(name) {
  const n = String(name).toLowerCase();
  if (n.indexOf('coverall') >= 0 && n.indexOf('visitor') < 0 && n.indexOf('chemical') < 0 && n.indexOf('regular') < 0) return 'coverall';
  if (n.indexOf('welding') < 0 && (n.indexOf('hard hat') >= 0 || n.indexOf('helmet') >= 0 || n.indexOf('suspension') >= 0 || n.indexOf('chin strap') >= 0)) return 'helmet';
  if (n.indexOf('shoe') >= 0 || n.indexOf('boot') >= 0) return 'shoes';
  if (n.indexOf('harness') >= 0) return 'harness';
  if (n.indexOf('ear plug') >= 0 || n.indexOf('ear muff') >= 0) return 'hearing';
  if (n.indexOf('respirator') >= 0 || n.indexOf('n95') >= 0 || n.indexOf('dust mask') >= 0) return 'resp';
  if (n.indexOf('glove') >= 0 && n.indexOf('electrician') < 0) return 'gloves';
  if (n.indexOf('glass') >= 0 || n.indexOf('spec') >= 0) return 'glasses';
  return '';
}
const CARE_MAIL = {
  coverall: ['FR coverall: wash as per maker instructions with mild detergent (no bleach or softener) in warm water; tumble dry low or hang dry; check for holes and tears; do not cut, sew or add non-FR patches. Wear it as the outermost garment, sleeves down, zip and buttons closed.',
    'Coverall FR: cuci sesuai petunjuk pabrik dengan deterjen lembut (tanpa pemutih/pelembut) air hangat; keringkan panas rendah atau digantung; periksa lubang/robek; jangan memotong, menjahit atau menambah tambalan non-FR. Pakai sebagai pakaian terluar, lengan turun, ritsleting dan kancing tertutup.'],
  helmet: ['Helmet: clean with mild soap and warm water; check for cracks, dents and worn suspension; keep away from heat, sunlight and chemicals; do not drop, sit on, or hang it on hooks. Chin strap worn at all times on site. Replace after an impact or drop, or 5 years after the manufacture date.',
    'Helm: bersihkan dengan sabun lembut dan air hangat; periksa retak, penyok, dan suspensi aus; jauhkan dari panas, sinar matahari, dan bahan kimia; jangan dijatuhkan, diduduki, atau digantung pada pengait. Tali dagu dipakai setiap saat di lokasi. Ganti setelah terbentur/jatuh atau 5 tahun sejak tanggal produksi.'],
  shoes: ['Safety boots: wipe clean after each shift and clean muddy soles; dry at room temperature (never heater or direct sun); replace if the sole is worn or the toe cap is exposed.',
    'Sepatu safety: lap bersih setiap selesai shift dan bersihkan sol berlumpur; keringkan pada suhu ruang (jangan pemanas/matahari langsung); ganti jika sol aus atau pelindung ujung terlihat.'],
  gloves: ['Gloves: check for holes or thinning before each use; rinse reusable gloves after use and air-dry; do not wash disposable gloves; never wear gloves near rotating equipment.',
    'Sarung tangan: periksa lubang/menipis sebelum dipakai; bilas sarung tangan pakai ulang lalu angin-anginkan; jangan cuci sarung tangan sekali pakai; jangan dipakai di dekat peralatan berputar.'],
  glasses: ['Safety glasses: clean with mild soap or lens cleaner and a microfibre cloth (no paper towels); keep in a case; replace if badly scratched or cracked.',
    'Kacamata safety: bersihkan dengan sabun lembut atau cairan lensa dan kain mikrofiber (bukan tisu); simpan di kotak; ganti jika tergores parah atau retak.'],
  harness: ['Full body harness (on loan): check the webbing, stitching, buckles and D-rings before every use and do not use it if anything is damaged. After a fall or full load stop using it and hand it to the store – it stays out of service until a competent person has inspected it. Use it only for personal fall protection. Follow the maker manual for cleaning and storage.',
    'Full body harness (pinjaman): periksa webbing, jahitan, gesper dan D-ring sebelum dipakai; jangan dipakai jika ada kerusakan. Setelah jatuh atau menahan beban penuh, hentikan pemakaian dan serahkan ke gudang – tidak boleh dipakai sampai diperiksa orang kompeten. Gunakan hanya untuk perlindungan jatuh pribadi. Ikuti buku petunjuk pabrik untuk pembersihan dan penyimpanan.'],
  hearing: ['Ear plugs / muffs: fit them with clean hands, free of dirt or grease, so they seal tightly. You look after and check your own muffs; supervisors include hearing protection in their regular inspections. Noise above 85 dB(A) needs hearing protection and an annual hearing test.',
    'Ear plug / ear muff: pasang dengan tangan bersih, bebas kotoran atau gemuk agar rapat. Anda merawat dan memeriksa ear muff sendiri; supervisor memasukkan pelindung pendengaran dalam inspeksi rutin. Kebisingan di atas 85 dB(A) wajib memakai pelindung pendengaran dan tes audiometri tahunan.'],
  resp: ['Respirators: tight-fitting respirators need a medical clearance and a fit test (at least every 2 years); you must be clean-shaven where the mask seals. The type to use is set by the site risk assessment or the chemical safety data sheet.',
    'Respirator: respirator ketat wajib lolos pemeriksaan medis dan uji kecocokan (minimal setiap 2 tahun); wajib bersih cukur di area penyegelan masker. Jenis yang dipakai ditentukan oleh penilaian risiko lokasi atau lembar data keselamatan bahan kimia.']
};
function careMail_(items) {
  const seen = {}, out = [];
  items.forEach(function (i) { const k = careKey_(i.item); if (k && !seen[k]) { seen[k] = 1; out.push('<li style="margin-bottom:6px">' + esc_(CARE_MAIL[k][0]) + '<br><span style="color:#667085">' + esc_(CARE_MAIL[k][1]) + '</span></li>'); } });
  if (!out.length) return '';
  return '<div style="background:#e8f3ee;border-radius:8px;padding:10px 14px;margin:12px 0"><b>Looking after your PPE / Merawat APD Anda</b><ul style="padding-left:18px;margin:6px 0;font-size:13px">' + out.join('') +
    '</ul><a href="' + prop_('FRONTEND_URL') + '?tab=care" style="font-size:13px">Full care guide / Panduan lengkap</a></div>';
}

/* ================= New-joiner training record (v2.7) ================= */
const TRAIN_MODULE = 'New-joiner PPE training v1';
function trainDone_(p) {
  const score = Math.floor(Number(p.score)), total = Math.floor(Number(p.total));
  if (!(total > 0 && total <= 50) || !(score >= 0) || score > total) return { ok: false, error: 'BAD_INPUT' };
  let pid = 'NEW', name, co;
  if (p.personId) {
    const per = rows_('Personnel').filter(function (x) { return String(x.PersonID) === String(p.personId) && String(x.Active).toLowerCase() !== 'no'; })[0];
    if (!per) return { ok: false, error: 'PERSON_NOT_FOUND' };
    pid = per.PersonID; name = per.Name; co = per.Company;
  } else {
    name = String(p.name || '').trim().slice(0, 80); co = String(p.company || '').trim().slice(0, 60);
    if (!name || !co) return { ok: false, error: 'DETAILS_REQUIRED' };
  }
  sh_('Training').appendRow([new Date(), pid, name, co, score, total, TRAIN_MODULE]);
  audit_('TRAINING', 'TRAINING_DONE', name, score + '/' + total);
  return { ok: true };
}
function training_() {
  return { ok: true, records: rows_('Training').map(function (t) { return { Timestamp: t.Timestamp, PersonID: t.PersonID, Name: t.Name, Company: t.Company, Score: t.Score, Total: t.Total }; }).reverse().slice(0, 400) };
}
