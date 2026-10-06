'use strict';

const escpos = require('escpos');
const { createDevice } = require('./drivers');
const { getBuilder } = require('./print-builders');
const printQueue = require('./print-queue');

// Thermal printers do not understand UTF-8: accented letters (é, è, à, ç…) must be sent in a PC
// code page and that page selected on the printer (ESC t n). CP850 covers French/Western Europe.
const DEFAULT_OPTIONS = { encoding: process.env.PRINT_ENCODING || 'cp850', width: 42 };
// ESC t table numbers (Epson numbering, followed by most ESC/POS clones).
const CODE_TABLES = { cp437: 0, cp850: 2, cp860: 3, cp863: 4, cp865: 5, cp1252: 16, cp858: 19 };
// A powered-off network printer can leave the TCP connect hanging; give up and queue instead.
const OPEN_TIMEOUT_MS = Math.max(1000, Number(process.env.PRINT_OPEN_TIMEOUT_MS) || 5000);

/**
 * Open device, create Printer, run build, then close.
 * @param {Object} device - escpos adapter
 * @param {Object} escposOptions - { encoding, width }
 * @param {string} printType - temp | summary | kitchen | delivery | final | refund
 * @param {Object} data - payload for the print builder
 * @param {Object} config - normalized printer config (margins, logo, companyName, show*, vat*)
 * @returns {Promise<void>}
 */
function printOnDevice(device, escposOptions, printType, data, config) {
  const escposOpts = { ...DEFAULT_OPTIONS, ...escposOptions };
  const printer = new escpos.Printer(device, escposOpts);
  const codeTable = CODE_TABLES[String(escposOpts.encoding).toLowerCase()];
  if (codeTable != null) printer.buffer.write(Buffer.from([0x1b, 0x74, codeTable]));
  const configWithPrinter = {
    ...config,
    escposLineWidth: escposOpts.width,
  };

  return new Promise((resolve, reject) => {
    let opened = false;
    const openTimer = setTimeout(() => {
      if (opened) return;
      opened = true;
      try {
        device.close();
      } catch (e) {
        // ignore
      }
      reject(new Error(`Printer did not answer within ${OPEN_TIMEOUT_MS} ms`));
    }, OPEN_TIMEOUT_MS);

    device.open((openErr) => {
      // The network adapter reuses this callback for later socket errors; only the first call counts.
      if (opened) return;
      opened = true;
      clearTimeout(openTimer);
      if (openErr) {
        return reject(openErr);
      }

      const builder = getBuilder(printType);

      Promise.resolve(builder.build(printer, data, configWithPrinter))
        .then(() => {
          return new Promise((res, rej) => {
            printer.close((closeErr) => (closeErr ? rej(closeErr) : res()));
          });
        })
        .then(resolve)
        .catch(reject);
    });
  });
}

function printOnce(p, printType, data, config) {
  let device;
  try {
    device = createDevice(p);
  } catch (err) {
    // Bad printer config (unknown type, IP not allowed…): retrying will never help.
    err.permanent = true;
    return Promise.reject(err);
  }
  return printOnDevice(device, p.escposOptions || {}, printType, data, config);
}

printQueue.start((job) => printOnce(job.printer, job.printType, job.data, job.config));

/**
 * Handle print request: for each printer, create device from driver, run the selected print builder, then close.
 * @param {Object} body - { printers: Array<{ type, ... }>, data: { printType, ... }, config?: { companyName, logo, margins, show*, vat* } }
 * @returns {Promise<{ success: boolean, results: Array<{ index: number, ok: boolean, error?: string }> }>}
 */
async function handlePrint(body) {
  const { printers = [], data = {}, config: rawConfig = {} } = body;
  const printType = data.printType || 'final';
  const copies = Math.max(1, Number(data.copies) || 1);

  if (!Array.isArray(printers) || printers.length === 0) {
    throw new Error('Request must include a non-empty "printers" array');
  }

  const { normalizeConfig } = require('./lib/receipt-helpers');
  const config = normalizeConfig(rawConfig);

  const results = [];

  for (let i = 0; i < printers.length; i++) {
    const p = printers[i];
    // Keep tickets in order: while this printer has a backlog, new prints wait behind it.
    if (printQueue.hasPending(p)) {
      printQueue.enqueue({ printer: p, printType, data, config, copies });
      results.push({ index: i, ok: false, queued: true, error: 'Printer has pending prints; queued' });
      printQueue.flush();
      continue;
    }
    let printed = 0;
    try {
      for (let c = 0; c < copies; c++) {
        await printOnce(p, printType, data, config);
        printed += 1;
      }
      results.push({ index: i, ok: true });
    } catch (err) {
      const message = err && (err.message || String(err));
      const queued = !(err && err.permanent);
      if (queued) {
        printQueue.enqueue({ printer: p, printType, data, config, copies: copies - printed, error: message });
      }
      results.push({
        index: i,
        ok: false,
        queued,
        error: message,
      });

      // SECURITY: was console.log(Object.keys(err), Object.values(err)) —
      // leaked err object contents (including potentially sensitive device
      // info) to stdout. Replaced with sanitized error logging.
      console.error(`[print] Printer ${i} failed:`, err && err.message ? err.message : String(err));
    }
  }

  const success = results.every((r) => r.ok);
  const queued = results.some((r) => r.queued);
  return { success, queued, results };
}

module.exports = { handlePrint, printOnDevice, getBuilder, createDevice };
