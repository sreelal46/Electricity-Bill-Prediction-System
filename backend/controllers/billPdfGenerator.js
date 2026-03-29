/**
 * billPdfGenerator.js
 * Generates a styled KSEB Electricity Bill PDF using pdfkit.
 * Usage: import { generateBillPDF } from "./billPdfGenerator.js";
 *        generateBillPDF(doc, bill, billId);
 */

// ─── Color Palette ───────────────────────────────────────────────────────────
const COLORS = {
  primary: "#1A3C6E",       // Deep navy – header / section titles
  accent: "#E8A020",        // Amber – highlights / total bar
  accentLight: "#FFF8EC",   // Pale amber – total bar background
  success: "#1E7D44",       // Green – paid status
  danger: "#C0392B",        // Red – unpaid status
  tableHeader: "#EAF0FB",   // Light blue – table header rows
  rowAlt: "#F7F9FC",        // Very light blue – alternating rows
  divider: "#CBD5E1",       // Slate – horizontal rules
  bodyText: "#1E293B",      // Near-black – body copy
  mutedText: "#64748B",     // Slate-500 – secondary text
  white: "#FFFFFF",
};

// ─── Layout Constants ─────────────────────────────────────────────────────────
const LEFT = 50;
const RIGHT = 545;
const PAGE_WIDTH = 595;
const COL_LABEL = LEFT;
const COL_VALUE = 320;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Draw a filled rounded rectangle */
function roundedRect(doc, x, y, w, h, r, fillColor, strokeColor) {
  doc.save();
  if (fillColor) doc.fillColor(fillColor);
  if (strokeColor) doc.strokeColor(strokeColor);
  doc.roundedRect(x, y, w, h, r);
  if (fillColor && strokeColor) doc.fillAndStroke();
  else if (fillColor) doc.fill();
  else doc.stroke();
  doc.restore();
}

/** Thin horizontal rule */
function rule(doc, y, color = COLORS.divider) {
  doc.save().moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(color).lineWidth(0.5).stroke().restore();
}

/** Two-column key/value row */
function kvRow(doc, label, value, y, opts = {}) {
  const { bold = false, valueColor = COLORS.bodyText, labelColor = COLORS.mutedText } = opts;
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

/** Section heading with colored left bar */
function sectionHeading(doc, title, y) {
  // Vertical accent bar
  doc.save().rect(LEFT, y, 3, 14).fillColor(COLORS.accent).fill().restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text(title, LEFT + 10, y + 1);
  return y + 20;
}

/** Format currency */
const rupee = (n) => `Rs. ${Number(n).toFixed(2)}`;

/** Format status badge colours */
function statusColors(status) {
  const s = (status || "").toLowerCase();
  if (s === "paid") return { bg: "#D1FAE5", text: COLORS.success };
  if (s === "overdue") return { bg: "#FEE2E2", text: COLORS.danger };
  return { bg: "#FEF9C3", text: "#854D0E" }; // pending → yellow
}

// ─── Main Generator ───────────────────────────────────────────────────────────

/**
 * @param {PDFDocument} doc  – A pdfkit PDFDocument instance (not yet ended)
 * @param {object}      bill – Bill data from Firebase
 * @param {string}      billId
 */
export function generateBillPDF(doc, bill, billId) {
  const pageW = PAGE_WIDTH;
  let y = 0;

  // ── 1. Header Banner ──────────────────────────────────────────────────────
  roundedRect(doc, 0, 0, pageW, 100, 0, COLORS.primary, null);

  // Lightning bolt icon (simple SVG-like polyline in pdfkit)
  doc.save().translate(44, 18).fillColor(COLORS.accent);
  doc.polygon([10, 0], [0, 30], [8, 30], [2, 55], [18, 20], [9, 20], [18, 0]).fill();
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(COLORS.white)
    .text("KSEB Electricity Bill", 72, 22, { width: pageW - 140 });

  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#93C5FD")
    .text("Kerala State Electricity Board Limited", 72, 46, { width: pageW - 140 });

  // Bill ID – top right
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#93C5FD")
    .text(`Bill ID: ${billId}`, RIGHT - 100, 22, { width: 105, align: "right" });

  // ── 2. Consumer Info Strip ────────────────────────────────────────────────
  roundedRect(doc, 0, 100, pageW, 56, 0, "#EFF6FF", null);

  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(COLORS.primary)
    .text(bill.user_name || "Consumer", LEFT, 114);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.mutedText)
    .text("Consumer No: KE-2847-5591", LEFT, 131);

  // Status badge (right side of strip)
  const sc = statusColors(bill.payment_status);
  const badgeLabel = (bill.payment_status || "Pending").toUpperCase();
  const badgeX = RIGHT - 80;
  roundedRect(doc, badgeX, 120, 84, 22, 6, sc.bg, null);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(sc.text)
    .text(badgeLabel, badgeX, 128, { width: 84, align: "center" });

  y = 175;

  // ── 3. Bill Details Section ───────────────────────────────────────────────
  y = sectionHeading(doc, "Bill Details", y);
  rule(doc, y + 2);
  y += 10;

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
      doc.save().rect(LEFT, rowY - 3, RIGHT - LEFT, 18).fillColor(COLORS.rowAlt).fill().restore();
    }
    kvRow(doc, label, value, rowY);
  });

  y += details.length * 20 + 16;

  // ── 4. Consumption Section ────────────────────────────────────────────────
  y = sectionHeading(doc, "Consumption", y);
  rule(doc, y + 2);
  y += 10;

  const consumption = [
    ["Month 1 Units", `${bill.month1_units} kWh`],
    ["Month 2 Units", `${bill.month2_units} kWh`],
    ["Total Units Consumed", `${bill.total_units} kWh`],
  ];

  consumption.forEach(([label, value], i) => {
    const rowY = y + i * 20;
    if (i % 2 === 1) {
      doc.save().rect(LEFT, rowY - 3, RIGHT - LEFT, 18).fillColor(COLORS.rowAlt).fill().restore();
    }
    const isTotalRow = i === consumption.length - 1;
    kvRow(doc, label, value, rowY, {
      bold: isTotalRow,
      valueColor: isTotalRow ? COLORS.primary : COLORS.bodyText,
      labelColor: isTotalRow ? COLORS.primary : COLORS.mutedText,
    });
  });

  y += consumption.length * 20 + 16;

  // ── 5. Slab Breakdown Table ───────────────────────────────────────────────
  y = sectionHeading(doc, "Slab Breakdown", y);

  // Table header row
  roundedRect(doc, LEFT, y + 4, RIGHT - LEFT, 20, 4, COLORS.tableHeader, null);
  const cols = { slab: LEFT + 6, units: 230, rate: 330, amount: 430 };

  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.primary);
  doc.text("Slab", cols.slab, y + 9);
  doc.text("Units (kWh)", cols.units, y + 9, { width: 90, align: "right" });
  doc.text("Rate (Rs./kWh)", cols.rate, y + 9, { width: 90, align: "right" });
  doc.text("Amount (Rs.)", cols.amount, y + 9, { width: RIGHT - cols.amount - 6, align: "right" });

  y += 26;

  const s = bill.slab_breakdown || {};
  const slabs = [
    { label: "Slab 1 (0–50 kWh)", units: s.slab1_units, rate: s.slab1_rate, amount: s.slab1_amount },
    { label: "Slab 2 (51–100 kWh)", units: s.slab2_units, rate: s.slab2_rate, amount: s.slab2_amount },
    { label: "Slab 3 (101–150 kWh)", units: s.slab3_units, rate: s.slab3_rate, amount: s.slab3_amount },
    { label: "Slab 4 (150+ kWh)", units: s.slab4_units, rate: s.slab4_rate, amount: s.slab4_amount },
  ].filter((r) => Number(r.units) > 0);

  slabs.forEach((row, i) => {
    const rowY = y + i * 20;
    if (i % 2 === 0) {
      doc.save().rect(LEFT, rowY - 3, RIGHT - LEFT, 18).fillColor(COLORS.rowAlt).fill().restore();
    }
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.bodyText);
    doc.text(row.label, cols.slab, rowY, { width: cols.units - cols.slab - 8 });
    doc.text(String(row.units), cols.units, rowY, { width: 90, align: "right" });
    doc.text(`${row.rate}`, cols.rate, rowY, { width: 90, align: "right" });
    doc.text(rupee(row.amount), cols.amount, rowY, { width: RIGHT - cols.amount - 6, align: "right" });
  });

  y += slabs.length * 20 + 4;

  // Fixed Charge row
  rule(doc, y + 2, "#CBD5E1");
  y += 8;
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.mutedText).text("Fixed Charge", cols.slab, y);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.bodyText).text(rupee(s.fixed_charge || 0), cols.amount, y, { width: RIGHT - cols.amount - 6, align: "right" });

  y += 28;

  // ── 6. Total Amount Bar ────────────────────────────────────────────────────
  roundedRect(doc, LEFT, y, RIGHT - LEFT, 40, 8, COLORS.accentLight, COLORS.accent);
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLORS.primary)
    .text("Total Amount Payable", LEFT + 14, y + 13, { width: 220 });
  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(COLORS.accent)
    .text(rupee(bill.total_bill_rupees), LEFT + 14, y + 10, { width: RIGHT - LEFT - 28, align: "right" });

  y += 56;

  // ── 7. Footer ─────────────────────────────────────────────────────────────
  rule(doc, y);
  y += 8;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLORS.mutedText)
    .text(
      "This is a computer-generated bill. For queries, contact KSEB at 1912 or visit www.kseb.in",
      LEFT,
      y,
      { width: RIGHT - LEFT, align: "center" }
    );

  y += 14;
  doc
    .fontSize(7.5)
    .fillColor("#94A3B8")
    .text(`Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, LEFT, y, {
      width: RIGHT - LEFT,
      align: "center",
    });

  doc.end();
}
