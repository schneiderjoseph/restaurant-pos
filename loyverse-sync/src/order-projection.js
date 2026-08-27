'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');
const { loadMirrorPayloads } = require('./mirror-upsert');

function orderRecordId(receiptNumber) {
  const safe = String(receiptNumber).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `order:loyverse_${safe}`;
}

function parseMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Minimal read-only projection: Loyverse receipt → POSR order shell.
 * Does not overwrite native POSR orders.
 * @param {import('surrealdb').Surreal} db
 * @param {{ since?: string, limit?: number, receiptNumbers?: string[] }} [opts]
 */
async function projectReceiptsFromMirror(db, opts = {}) {
  let receipts = await loadMirrorPayloads(db, 'receipt', { activeOnly: true });
  if (opts.receiptNumbers?.length) {
    const wanted = new Set(opts.receiptNumbers.map(String));
    receipts = receipts.filter((r) => wanted.has(String(r.receipt_number)));
  }
  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    receipts = receipts.filter((r) => {
      const t = new Date(r.created_at || r.updated_at || 0).getTime();
      return t >= sinceMs;
    });
  }
  if (opts.limit && receipts.length > opts.limit) {
    receipts = receipts.slice(-opts.limit);
  }

  let upserted = 0;
  let skipped = 0;

  for (const receipt of receipts) {
    const receiptNumber = String(receipt.receipt_number || '');
    if (!receiptNumber) {
      skipped += 1;
      continue;
    }

    const orderId = orderRecordId(receiptNumber);
    const existing = await queryRows(db, `SELECT id FROM ${orderId}`);
    const createdAt = receipt.created_at || new Date().toISOString();
    const total = parseMoney(receipt.total_money);
    const note = `Loyverse receipt ${receiptNumber}${receipt.note ? ` — ${receipt.note}` : ''}`;

    const payload = {
      status: receipt.cancelled_at ? 'cancelled' : 'completed',
      created_at: createdAt,
      completed_at: receipt.updated_at || createdAt,
      notes: note,
      loyverse_receipt_number: receiptNumber,
      tags: ['loyverse', 'read_only'],
      invoice_number: Number(receipt.receipt_number) || 0,
      items: [],
      payments: [],
    };

    // Attach line totals as notes-only shell — full line mapping is mirror-only for now
    const lineCount = Array.isArray(receipt.line_items) ? receipt.line_items.length : 0;
    if (lineCount > 0) {
      payload.notes = `${note} (${lineCount} lines, total ${total})`;
    }

    if (existing[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          status = $status,
          completed_at = $completed_at,
          notes = $notes,
          loyverse_receipt_number = $loyverse_receipt_number,
          tags = $tags`,
        { id: asRecord(existing[0].id), ...payload },
      );
    } else {
      // Need order_type — pick first active
      const types = await queryRows(
        db,
        `SELECT id FROM order_type WHERE (deleted_at = NONE OR deleted_at = NULL) LIMIT 1`,
      );
      const orderType = types[0]?.id ? asRecord(types[0].id) : null;
      if (!orderType) {
        skipped += 1;
        continue;
      }
      await queryRows(
        db,
        `CREATE ${orderId} SET
          status = $status,
          created_at = type::datetime($created_at),
          completed_at = type::datetime($completed_at),
          notes = $notes,
          loyverse_receipt_number = $loyverse_receipt_number,
          tags = $tags,
          invoice_number = $invoice_number,
          items = $items,
          payments = $payments,
          order_type = $order_type`,
        { ...payload, order_type: orderType },
      );
    }
    upserted += 1;
  }

  return { upserted, skipped, scanned: receipts.length };
}

module.exports = {
  projectReceiptsFromMirror,
  orderRecordId,
};
