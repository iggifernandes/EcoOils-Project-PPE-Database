# PPE Request • Approval • Store Issue System v2.10.1 – Setup (free, ~20 min)

Use your PERSONAL Gmail for steps 1–4 (not the work email).

## How people use it
• Employee: scans the QR (or opens the app link) > picks company and name > chooses PPE > submits.
• You (approver): get an email with a "Review & Approve" button. Open it, enter your PIN, tap Approve or Reject.
• Employee: gets the 6-digit code by email (valid 14 days). The email also has an "Open my QR pass" button: the employee shows the QR at the store.
• Storekeeper: opens the staff link (…/?mode=staff), enters own PIN, sees the approved queue, types the code the employee shows (or scans the QR pass with the phone camera: the code is pre-filled after PIN login), taps Issue.
• No-approval items (ear plugs, safety glasses, gloves, rubber gloves): the employee still requests them in the app so there is a record. They skip the approval step: the pass code is emailed at once and the store issues it the same way. If a request mixes both kinds it is split into two requests (the ★ part is ready at once, the rest waits for you).
• Receipt email goes to the employee. Stock is deducted. Everything is in the Sheet.

## 1. Google Sheet + code
• New Google Sheet "Mentari PPE Records" > Extensions > Apps Script > paste all of Code.gs > Save.
• Run function `setup` once and approve permissions (Sheets, Mail, Triggers). On a NEW sheet this also fills the Items tab with the procedure-based catalogue (32 items).
• Upgrading from v2.6: replace Code.gs, run `setup` again (it only adds the missing columns: Items.Approval, Loans.Type, Loans.Due, and the Training tab), then run `loadProcedureCatalog` once to replace the Items tab with the new catalogue. Re-enter opening stock for renamed items.

## 2. Fill the data
• Personnel tab (EcoOils employees only, no contractors): PersonID, Name, Company (use the department), Role, Email, Active (Yes), Sponsor (Yes for supervisors/managers who may sponsor a person with no email). The email is where the code goes, so it must be right. No phone numbers are used anywhere.
• Users tab: one row per PIN. Role = approver or store. Give each storekeeper their own PIN (you can switch one off by setting Active = No). Change the sample PINs.
• Items tab: PPE catalogue from the EcoOils PPE Procedure (EOCORP-QSP/HS/03 sections 5.2–5.9, PPE matrix and glove matrix). Columns: sizes (comma separated), ServiceLifeDays (early re-issue is flagged to you if requested sooner), Kit (Yes = part of the new-joiner kit), Loan, Approval.
• Approval column: No = self-service item (no approval, code issued at once, max 10 per line, still recorded and flagged if early re-issue or lost). Yes or blank = needs your approval. Currently No: ear plugs, safety glasses, nitrile / PU / leather gloves, rubber (Sol-vex) gloves. Change any row any time.
• Loan column: Only = visitor-only item (hidden from employees), Yes = visitors may borrow it, Always = always a loan (full body harness), blank/No = normal issue.
• Stock quantities are visible only to approver and store PIN holders. Employees never see stock. When a delivery arrives the storekeeper records it in the Stock tab of the staff app (item, size, quantity, delivery note / PO ref); every movement is logged.
• Stock tab in the staff app (approver and store only) shows availability per item with In stock / Low / Out of stock status and per-size counts, a bar chart of stock against the minimum level, and a 30-day issued / received trend.
• Stock tab (optional): Item, Size, OnHand, MinLevel. Items with no Stock row are not tracked. You can also add stock from the app.

## 3. Script Properties (Project Settings)
• FRONTEND_URL = your GitHub Pages address ending with "/"
• ADMIN_EMAIL = where "new request" emails go (separate several with commas)

## 4. Deploy backend
• Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone > copy the URL.

## 5. Front end
• In index.html replace PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE with that URL.
• Upload index.html to your GitHub repo (e.g. EcoOils-PPE-System) with Pages turned on.
• Open the staff link > log in as approver > QR poster tab > Print. Stick it at site gates, canteen and the PPE store.

## New hires with no email (sponsor flow)
• Anyone not in the register, or in the register without an email, must pick a SPONSOR (a person with Sponsor = Yes in Personnel).
• You see it flagged red: sponsored, ID check required.
• The code is emailed to the sponsor only, with "give it only to NAME, in person". The store must tick "I checked the ID / badge" before issuing.
• Receipt goes to the sponsor, copy to you. Max 5 open sponsored requests per sponsor.
• New people are not added to Personnel automatically. When HR gives them an email, add them to Personnel.

## Visitors / temporary loans
• Store taps Visitors > enters visitor name(s), company, picks a REQUIRED host (must be in Personnel with an email) and the items. No approval or code needed.
• The host gets an email at once. If the PPE is not back by 17:00 the host gets a reminder; every morning after that the host is reminded and you are copied. Your 07:00 summary lists everything still out.
• On return the store picks Good (back to stock), Needs washing (goes to a "(Laundry)" stock line, then "Washed" moves it back) or Damaged (not restocked, you are emailed). Partial returns keep the rest out. "Not returned – write off" needs a reason and emails host and you.
• Items tab column "Loan": Only = visitor-only item (hidden from employee requests), Yes = can be lent and also requested, blank/No = not lendable.
• Set the Apps Script project time zone to Jakarta (Project Settings) so the 07:00 and 17:00 triggers run on Indonesian time.

## Full body harness (employee loan)
• The harness is requested like other PPE and needs your approval. At issue the store gets a red LOAN banner; the system creates an Employee loan (EMP-… in the Visitors tab) due back in 30 days (EMP_LOAN_DAYS in Code.gs). Stock is reduced as "Loan out".
• No reminders before the due date. After it the borrower gets a weekly reminder and you are copied; your 07:00 summary lists overdue employee loans.
• Return in the Visitors tab: Good (back to stock), Needs washing, or Damaged. If the harness stopped a fall or is damaged choose Damaged: it is not restocked, you are emailed, and the email states it stays out of service until a competent person (PPE Verifier) has inspected it, as the procedure requires.
• You get a flag if someone asks for a harness while already holding one.

## New-joiner training (Training tab on the employee page, ?tab=train)
• 6 sections (why PPE, basic PPE, extra PPE per task from the PPE matrix, how to request here, each PPE type with its standard / rules / care, responsibilities) plus a 10-question quiz (pass mark 80%). English and Bahasa Indonesia, printable as PDF.
• On a pass the person records completion (choose name from the register, or "not in list" for a new joiner). It goes to the Training tab of the Sheet and to the staff app (Training tab). Then a button takes them to the full joiner kit request.
• Content is taken from the procedure; harness pre-use checks are general wording only, ask your fall-protection competent person to confirm or add the maker manual checklist (edit TR_PPE harness / CARE harness in index.html).

## PPE care & replacement (from the EcoOils PPE Care & Replacement guide)
• Care is guidance only, never required. A "PPE care" tab on the employee page (also in Bahasa Indonesia) covers FR coverall, helmet, safety shoes, gloves and safety glasses. Care tips also show when an item is picked on the request form, on the store's issue screen (for the verbal briefing) and in the receipt email. Care entries now also cover full body harness, hearing protection and respirators (from the procedure). Items with no guide show none.
• Replacement (worn / damaged): the form reminds the employee to bring the old item. For FRC coverall, safety glasses, gloves and ear muffs the store records "old item returned: yes / no (note)". It is recorded in the Note, never blocks the issue.
• Lost: the form asks the employee to report to the Head of Facility first and tick that they have. If not ticked you see a red flag, the request is not blocked.
• Needed now (for procurement): the Stock tab lists what is requested/approved per item and size, with names, and how much stock is short, so procurement can order with names.

## Controls built in
• Employee only picks a name from the register: the email always comes from your Personnel list, so the code can only reach the real person.
• Max 3 open requests per person, no duplicate open request for the same item.
• Flags for you: early re-issue, lost, damaged, not in register.
• You can change quantities before approving.
• 5 wrong codes lock the request. Not collected in 14 days = Expired. Reminder after 3 days.
• Store cannot issue without the code, cannot issue more than stock, cannot edit records. Only approver can void, reject or correct stock.
• Audit tab logs every event with who and when. Daily 07:00 summary email: requests waiting over 24 h and low stock.

## Limits and notes
• Code is sent by email only. Free SMS is not possible from Google; WhatsApp/SMS gateways are paid.
• Free Gmail sends about 100 emails a day. Each approval request uses about 3 emails (to you, code, receipt); a no-approval request uses 2 (code, receipt). Plan for about 30 to 40 requests a day.

## After changing Code.gs later
• Deploy > Manage deployments > edit > New version > Deploy (URL stays the same).


## What is new in v2.10.1 – Project and Asset pools

**The rule:** Project is a tight list that Iggy maintains. **Everyone and everything else is Asset.**

• **Personnel > Pool column:** write `Project` only for the Project team. Blank or anything else = Asset.
• **No choice screens.** The pool is decided automatically:
  • A registered person → their own Pool.
  • A new joiner with a sponsor → the sponsor's pool. A new joiner with their own email → Asset.
  • A visitor loan → the host's pool.
• **Two approvers:** Users has new **Email** and **Pool** columns. Iggy = approver, Pool = Project. Irfan = approver, Pool = Asset. Store = store, Pool = All. Each approver gets the emails, queue, stock, records and reports of their own pool only; the other pool's requests are refused.
• **Store uploads stock per pool:** Stock tab > Upload stock. Choose the pool and paste lines `Item, Size, Quantity`. Quantities are added.
• **Interchange between pools:** if the requester's pool is short at issue, the app asks "Issue from the other pool and record it as a pool loan?". Both approvers get an email. When stock arrives, tap **Repay** (Stock > Pool loans); stock moves back automatically, partial repayment allowed.
• **Admin tab (approvers):** Yes / No switch per item for "approval required". No = self-service. Logged in the audit trail.
• Existing stock rows with a blank Pool count as **Asset**.
• Phone numbers: not needed.

## What is new in v2.10.1 – team, recipients and reports

• **Team in Users (one click):** in Apps Script run `loadTeamUsers` once. It adds or updates, without touching existing PINs:
  • Iggy – approver – Ignatius.Ambrosio@ecooils.com.my – Pool Project
  • Irfan – approver – irfan.amin@ecooils.co.id – Pool Asset
  • Store 1 – Anthony Akbar – Anthony.Akbar@ecooils.co.id – Pool All
  • Store 2 – Edolando Sembiring – Edolando.Sembiring@ecooils.co.id – Pool All
  New people get a PIN of `CHANGE-ME-n`. **Replace each PIN in the Users sheet** (6+ digits, different for everyone, column formatted as Plain text).
• **Recipients sheet (new):** who gets report emails. Columns: Email, Name, Type, Active.
  • `MonthlyProject` – Darren.Lim@ecooils.com.my: on the 1st of each month at 08:00 WIB he gets the previous month's Project-only PPE issued (by item and by person) plus the total to date. No Asset information.
  • `IssueAsset` – satish@ecooils.co.id: an email for **every Asset PPE issue**, sent when the store hands the PPE over (after HSSE approval, or self-service), showing who, what, approver, store person and receipt.
  • To add or remove a recipient just edit this sheet. Set Active = No to pause.
• **Both recipients start with Active = No, so no report email is sent until you switch them on.** When you are ready, set Active = Yes in the Recipients sheet (Darren, Satish). Nothing else needs to change.
• To test Darren's report: set him Yes, then Apps Script > run `monthlyProjectReport`.

## Upgrade steps (Action needed)

1. Apps Script: replace Code.gs, Save, run `setup`, then run `loadTeamUsers`. Deploy > Manage deployments > edit > New version > Deploy.
2. Users sheet: replace every `CHANGE-ME` PIN. Give each person their PIN privately.
3. Personnel sheet: mark the Project team `Project` in the Pool column (everyone else = Asset).
4. Stock tab: upload Project stock and Asset stock separately.
5. GitHub: upload the new index.html (exact name). Hard refresh (Ctrl+F5).
