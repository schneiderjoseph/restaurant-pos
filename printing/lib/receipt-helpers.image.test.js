'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePaperWidthPx,
  resolveLogoOffsetX,
  prepareImageForPrint,
  writeBitmapD24,
  PAPER_IMAGE_WIDTH_PX,
  PAPER_IMAGE_WIDTH_80MM_PX,
  STORE_LOGO_BOX_PX,
} = require('./receipt-helpers');

test('resolvePaperWidthPx defaults to midpoint of 48-col and 72-col (480)', () => {
  assert.equal(PAPER_IMAGE_WIDTH_PX, 480);
  assert.equal(resolvePaperWidthPx({}), 480);
  assert.equal(resolvePaperWidthPx({ escposLineWidth: 42 }), 480);
});

test('resolvePaperWidthPx supports explicit 80mm width', () => {
  assert.equal(resolvePaperWidthPx({ paperWidthPx: PAPER_IMAGE_WIDTH_80MM_PX }), 576);
  assert.equal(resolvePaperWidthPx({ escposLineWidth: 72 }), 576);
});

test('resolvePaperWidthPx reads env override', () => {
  const prev = process.env.PRINT_PAPER_WIDTH_PX;
  process.env.PRINT_PAPER_WIDTH_PX = '400';
  try {
    assert.equal(resolvePaperWidthPx({}), 400);
  } finally {
    if (prev === undefined) delete process.env.PRINT_PAPER_WIDTH_PX;
    else process.env.PRINT_PAPER_WIDTH_PX = prev;
  }
});

test('resolveLogoOffsetX reads config', () => {
  assert.equal(resolveLogoOffsetX({}), 0);
  assert.equal(resolveLogoOffsetX({ logoOffsetX: -24 }), -24);
  assert.equal(resolveLogoOffsetX({ logoOffsetX: 8 }), 8);
});

// Alignment/offset are applied at print time via ESC $ in writeBitmapD24 (not baked
// into the bitmap by prepareImageForPrint — see its docblock). fakeImage below stands
// in for the escpos Image instance writeBitmapD24 expects ({ size, toBitmap() }).
// One fake 24-dot band so the per-band positioning branch actually runs.
function fakeImage(width) {
  return {
    size: { width, height: 8 },
    toBitmap: () => ({ data: ['\x00\x00\x00'] }),
  };
}

function fakePrinter() {
  const writes = [];
  return {
    buffer: { write: (b) => writes.push(b), writeUInt16LE: () => {} },
    lineSpace: () => {},
    _writes: writes,
  };
}

// writeBitmapD24 always ends with a reset-to-0 ESC $, so count occurrences rather
// than presence: >1 means a real per-band positioning offset was also written.
function countEscDollar(writes) {
  return writes.filter((w) => w.startsWith('\x1b\x24')).length;
}

test('writeBitmapD24 centers a narrower image on the paper width', () => {
  const printer = fakePrinter();
  writeBitmapD24(printer, fakeImage(150), { paperWidth: 480, hAlign: 'center' });
  assert.ok(countEscDollar(printer._writes) > 1, 'expected an ESC $ absolute-position command');
});

test('writeBitmapD24 skips the per-band ESC $ when the image already spans the paper width', () => {
  const printer = fakePrinter();
  writeBitmapD24(printer, fakeImage(480), { paperWidth: 480, hAlign: 'center' });
  // Only the trailing reset-to-0 should fire — no centering needed at 0 offset.
  assert.equal(countEscDollar(printer._writes), 1);
});

test('writeBitmapD24 logoOffsetX shifts the centered position and clamps on-paper', () => {
  const printer = fakePrinter();
  // paperWidth 480, imgW 150 -> centered offset = 165. +1000 must clamp to 480-150=330.
  writeBitmapD24(printer, fakeImage(150), { paperWidth: 480, hAlign: 'center', logoOffsetX: 1000 });
  assert.ok(countEscDollar(printer._writes) > 1);
});

test('prepareImageForPrint returns a PNG buffer for a boxSize logo via sharp', async () => {
  const sharp = require('sharp');
  const src = await sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const out = await prepareImageForPrint(src, 'image/png', {
    boxSize: STORE_LOGO_BOX_PX,
    forceMono: false,
  });
  assert.ok(out && out.length);
  const meta = await sharp(out).metadata();
  // boxSize contain fit — not paper-padded (alignment happens at print time instead).
  assert.ok(meta.width <= STORE_LOGO_BOX_PX + 2);
  assert.ok(meta.height <= STORE_LOGO_BOX_PX + 2);
});
