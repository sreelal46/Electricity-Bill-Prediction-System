/**
 * billPdfGenerator.js
 * Generates a styled EnergyGuard Electricity Bill PDF using pdfkit.
 * Usage: import { generateBillPDF } from "./billPdfGenerator.js";
 *        generateBillPDF(doc, bill, billId);
 */

// ─── Color Palette ───────────────────────────────────────────────────────────
const COLORS = {
  primary: "#1F2937", // Dark gray – header / headings
  accent: "#2563EB", // Blue – highlights / borders
  accentLight: "#EFF6FF", // Light blue – total bar background
  success: "#15803D", // Green – paid status
  danger: "#B91C1C", // Red – unpaid / overdue status
  tableHeader: "#F3F4F6", // Light gray – table header rows
  rowAlt: "#F9FAFB", // Very light gray – alternating rows
  divider: "#E5E7EB", // Gray – horizontal rules
  bodyText: "#111827", // Near-black – body copy
  mutedText: "#6B7280", // Gray-500 – secondary text
  white: "#FFFFFF",
};

// ─── Layout Constants ─────────────────────────────────────────────────────────
const LEFT = 50;
const RIGHT = 545;
const PAGE_WIDTH = 595;
const COL_LABEL = LEFT;
const COL_VALUE = 320;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Thin horizontal rule */
function rule(doc, y, color = COLORS.divider) {
  doc
    .save()
    .moveTo(LEFT, y)
    .lineTo(RIGHT, y)
    .strokeColor(color)
    .lineWidth(0.5)
    .stroke()
    .restore();
}

/** Two-column key/value row */
function kvRow(doc, label, value, y, opts = {}) {
  const {
    bold = false,
    valueColor = COLORS.bodyText,
    labelColor = COLORS.mutedText,
  } = opts;
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(labelColor)
    .text(label, COL_LABEL, y, { width: COL_VALUE - COL_LABEL - 10 });
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(9.5)
    .fillColor(valueColor)
    .text(value, COL_VALUE, y, { width: RIGHT - COL_VALUE, align: "right" });
}

/** Section heading – simple bold label with a bottom rule */
function sectionHeading(doc, title, y) {
  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor(COLORS.accent)
    .text(title.toUpperCase(), LEFT, y);
  rule(doc, y + 16, COLORS.accent);
  return y + 24;
}

/** Format currency */
const rupee = (n) => `Rs. ${Number(n).toFixed(2)}`;

/** Status badge colors */
function statusColors(status) {
  const s = (status || "").toLowerCase();
  if (s === "paid") return { bg: "#DCFCE7", text: COLORS.success };
  if (s === "overdue") return { bg: "#FEE2E2", text: COLORS.danger };
  return { bg: "#FEF9C3", text: "#92400E" }; // pending → amber
}

// ─── Main Generator ───────────────────────────────────────────────────────────

/**
 * @param {PDFDocument} doc    – A pdfkit PDFDocument instance (not yet ended)
 * @param {object}      bill   – Bill data from Firebase
 * @param {string}      billId
 */
export function generateBillPDF(doc, bill, billId, user) {
  let y = 0;

  // ── 1. Header ─────────────────────────────────────────────────────────────
  // White background with a solid top accent bar
  doc
    .save()
    .rect(0, 0, PAGE_WIDTH, 4)
    .fillColor(COLORS.accent)
    .fill()
    .restore();

  // Logo placeholder – simple circle + "E"
  doc
    .save()
    .circle(LEFT + 14, 36, 14)
    .fillColor(COLORS.accent)
    .fill()
    .restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(COLORS.white)
    .text("E", LEFT + 8, 29);

  // Company name
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(COLORS.primary)
    .text("EnergyGuard", LEFT + 36, 24);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.mutedText)
    .text("Smart Energy Management", LEFT + 36, 44);

  // "ELECTRICITY BILL" label – top right
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.primary)
    .text("ELECTRICITY BILL", 0, 24, { width: RIGHT + 0, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLORS.mutedText)
    .text(`Bill ID: ${billId}`, 0, 40, { width: RIGHT + 0, align: "right" });

  y = 72;
  rule(doc, y, COLORS.divider);
  y += 12;

  // ── 2. Consumer + Status Row ───────────────────────────────────────────────
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(COLORS.primary)
    .text(user.name || "Consumer", LEFT, y);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.mutedText)
    .text(`Consumer No: ${user.consumerNumber}`, LEFT, y + 17);

  // Status badge
  const sc = statusColors(bill.payment_status);
  const badgeLabel = (bill.payment_status || "Pending").toUpperCase();
  const badgeX = RIGHT - 78;
  doc
    .save()
    .roundedRect(badgeX, y + 2, 82, 20, 4)
    .fillColor(sc.bg)
    .fill()
    .restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(sc.text)
    .text(badgeLabel, badgeX, y + 8, { width: 82, align: "center" });

  y += 46;
  rule(doc, y);
  y += 16;

  // ── 3. Bill Details ────────────────────────────────────────────────────────
  y = sectionHeading(doc, "Bill Details", y);

  const details = [
    ["Bill Period", bill.bill_period],
    ["Bill Date", bill.bill_generated_date],
    ["Due Date", bill.due_date],
    ["Payment Status", (bill.payment_status || "").toUpperCase()],
  ];
  if (bill.payment_date) {
    details.push(["Paid On", bill.payment_date]);
    details.push(["Payment Method", bill.payment_method || "—"]);
  }

  details.forEach(([label, value], i) => {
    const rowY = y + i * 20;
    if (i % 2 === 1) {
      doc
        .save()
        .rect(LEFT, rowY - 3, RIGHT - LEFT, 18)
        .fillColor(COLORS.rowAlt)
        .fill()
        .restore();
    }
    kvRow(doc, label, value, rowY);
  });

  y += details.length * 20 + 16;

  // ── 4. Consumption ─────────────────────────────────────────────────────────
  y = sectionHeading(doc, "Consumption", y);

  const consumption = [
    ["Month 1 Units", `${bill.month1_units} kWh`],
    ["Month 2 Units", `${bill.month2_units} kWh`],
    ["Total Units Consumed", `${bill.total_units} kWh`],
  ];

  consumption.forEach(([label, value], i) => {
    const rowY = y + i * 20;
    if (i % 2 === 1) {
      doc
        .save()
        .rect(LEFT, rowY - 3, RIGHT - LEFT, 18)
        .fillColor(COLORS.rowAlt)
        .fill()
        .restore();
    }
    const isTotal = i === consumption.length - 1;
    kvRow(doc, label, value, rowY, {
      bold: isTotal,
      valueColor: isTotal ? COLORS.accent : COLORS.bodyText,
      labelColor: isTotal ? COLORS.primary : COLORS.mutedText,
    });
  });

  y += consumption.length * 20 + 16;

  // ── 5. Slab Breakdown Table ────────────────────────────────────────────────
  y = sectionHeading(doc, "Slab Breakdown", y);

  // Table header
  doc
    .save()
    .rect(LEFT, y, RIGHT - LEFT, 20)
    .fillColor(COLORS.tableHeader)
    .fill()
    .restore();

  const cols = { slab: LEFT + 6, units: 230, rate: 330, amount: 430 };

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.primary);
  doc.text("Slab", cols.slab, y + 6);
  doc.text("Units (kWh)", cols.units, y + 6, { width: 90, align: "right" });
  doc.text("Rate (Rs./kWh)", cols.rate, y + 6, { width: 90, align: "right" });
  doc.text("Amount (Rs.)", cols.amount, y + 6, {
    width: RIGHT - cols.amount - 6,
    align: "right",
  });

  y += 22;

  const s = bill.slab_breakdown || {};
  const slabs = [
    {
      label: "Slab 1 (0–50 kWh)",
      units: s.slab1_units,
      rate: s.slab1_rate,
      amount: s.slab1_amount,
    },
    {
      label: "Slab 2 (51–100 kWh)",
      units: s.slab2_units,
      rate: s.slab2_rate,
      amount: s.slab2_amount,
    },
    {
      label: "Slab 3 (101–150 kWh)",
      units: s.slab3_units,
      rate: s.slab3_rate,
      amount: s.slab3_amount,
    },
    {
      label: "Slab 4 (150+ kWh)",
      units: s.slab4_units,
      rate: s.slab4_rate,
      amount: s.slab4_amount,
    },
  ].filter((r) => Number(r.units) > 0);

  slabs.forEach((row, i) => {
    const rowY = y + i * 20;
    if (i % 2 === 0) {
      doc
        .save()
        .rect(LEFT, rowY - 3, RIGHT - LEFT, 18)
        .fillColor(COLORS.rowAlt)
        .fill()
        .restore();
    }
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.bodyText);
    doc.text(row.label, cols.slab, rowY, { width: cols.units - cols.slab - 8 });
    doc.text(String(row.units), cols.units, rowY, {
      width: 90,
      align: "right",
    });
    doc.text(`${row.rate}`, cols.rate, rowY, { width: 90, align: "right" });
    doc.text(rupee(row.amount), cols.amount, rowY, {
      width: RIGHT - cols.amount - 6,
      align: "right",
    });
  });

  y += slabs.length * 20 + 4;

  // Fixed Charge row
  rule(doc, y + 2);
  y += 8;
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.mutedText)
    .text("Fixed Charge", cols.slab, y);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLORS.bodyText)
    .text(rupee(s.fixed_charge || 0), cols.amount, y, {
      width: RIGHT - cols.amount - 6,
      align: "right",
    });

  y += 28;

  // ── 6. Total Amount Bar ────────────────────────────────────────────────────
  doc
    .save()
    .rect(LEFT, y, RIGHT - LEFT, 38)
    .fillColor(COLORS.accentLight)
    .fill()
    .restore();

  // Left border accent line
  doc.save().rect(LEFT, y, 3, 38).fillColor(COLORS.accent).fill().restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text("Total Amount Payable", LEFT + 12, y + 12, { width: 220 });

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(COLORS.accent)
    .text(rupee(bill.total_bill_rupees), LEFT + 12, y + 10, {
      width: RIGHT - LEFT - 20,
      align: "right",
    });

  y += 54;

  // ── 7. Footer ──────────────────────────────────────────────────────────────
  rule(doc, y);
  y += 10;

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLORS.mutedText)
    .text(
      "This is a computer-generated document. For support, contact EnergyGuard at support@energyguard.in or call 1800-XXX-XXXX.",
      LEFT,
      y,
      { width: RIGHT - LEFT, align: "center" },
    );

  y += 14;
  doc
    .fontSize(7.5)
    .fillColor("#9CA3AF")
    .text(
      `Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      LEFT,
      y,
      { width: RIGHT - LEFT, align: "center" },
    );

  doc.end();
}
