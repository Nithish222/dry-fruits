import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This app is deployed on Vercel, not a GCP-hosted runtime, so bare
// initializeApp() (Application Default Credentials) has no metadata server
// to resolve against and fails in production. Uses the same service
// account already provisioned as GOOGLE_CLOUD_PROJECT_ID/
// GOOGLE_CLOUD_CLIENT_EMAIL/GOOGLE_CLOUD_PRIVATE_KEY in both Preview and
// Production on Vercel (confirmed via `vercel env ls`) - provisioned
// already, just never wired to any code until now. Private keys stored in
// env vars typically have their newlines escaped as literal "\n"
// sequences, hence the .replace() below.
function getAdminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      clientEmail: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      privateKey: (process.env.GOOGLE_CLOUD_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatTallyDate(timestamp) {
  const d = timestamp.toDate();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// Splits one POS sale into its distinct debit "components" - a mixed
// cash+credit sale genuinely has two debit legs in our own books (Cash +
// Sundry Debtors), which Tally's simple 2-ledger-per-voucher import format
// can't hold in a single voucher. Emitting one small Sales voucher per
// component (both crediting Sales Account) keeps every voucher exactly
// 2-ledger, keeps the totals reconciling, and loses nothing.
function debitComponentsForTransaction(tx) {
  const payment = tx.payment || {};
  const components = [];

  if (payment.mode === "cash") {
    components.push({ ledgerName: "Cash", amount: tx.grandTotal });
  } else if (payment.mode === "gpay") {
    components.push({ ledgerName: "UPI/GPay Clearing", amount: tx.grandTotal });
  } else if (payment.mode === "credit") {
    const receivedNow = Number(payment.amountReceived || 0);
    const credit = Number(payment.creditAmount || 0);
    if (receivedNow > 0) components.push({ ledgerName: "Cash", amount: receivedNow });
    if (credit > 0) {
      const customerLedgerName = `${tx.customer?.name || "Unknown Customer"} (${tx.customer?.phoneNumber || "no-phone"})`;
      components.push({ ledgerName: customerLedgerName, amount: credit });
    }
  }

  return components.filter((c) => c.amount > 0);
}

function buildVoucherXml({ tx, component, suffix }) {
  const date = formatTallyDate(tx.createdAt);
  const amount = Math.round(component.amount * 100) / 100;
  const voucherNumber = `${tx.id}${suffix}`;
  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create">
        <DATE>${date}</DATE>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${escapeXml(voucherNumber)}</VOUCHERNUMBER>
        <PARTYLEDGERNAME>${escapeXml(component.ledgerName)}</PARTYLEDGERNAME>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(component.ledgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Sales Account</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
}

function buildTallyXml(transactions) {
  const messages = transactions.flatMap((tx) =>
    debitComponentsForTransaction(tx).map((component, i) => buildVoucherXml({ tx, component, suffix: i === 0 ? "" : `-${i + 1}` }))
  );
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>${messages.join("")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminApp = getAdminApp();

  try {
    await getAuth(adminApp).verifyIdToken(idToken);
  } catch (error) {
    console.error("Tally export - invalid token: ", error);
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const todayStr = new Date().toISOString().slice(0, 10);
  const from = searchParams.get("from") || todayStr;
  const to = searchParams.get("to") || todayStr;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const db = getFirestore(adminApp);
    const fromTs = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const toExclusive = new Date(`${to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);
    const toTs = Timestamp.fromDate(toExclusive);

    const snapshot = await db
      .collection("transactions")
      .where("createdAt", ">=", fromTs)
      .where("createdAt", "<", toTs)
      .orderBy("createdAt", "asc")
      .get();

    const transactions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    const xml = buildTallyXml(transactions);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="tally-export-${from}_to_${to}.xml"`,
      },
    });
  } catch (error) {
    console.error("Tally export failed: ", error);
    return NextResponse.json({ error: "Failed to export - try again." }, { status: 500 });
  }
}
