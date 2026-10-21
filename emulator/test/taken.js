#!/usr/bin/env node
'use strict';

/*
 * writeHidTaken (src/ok_hal.cpp okemu_hid_wait_taken; from ok-rn's okemu, a236976): a vendor
 * write resolves once the firmware has TAKEN the report - the order a hard key's USB OUT transfer
 * gives - and the wait does not hold the JS thread: a timer keeps ticking through it.
 *
 *   node test/taken.js [storageDir]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const emu = require('..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const storageDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'okemu-taken-'));

function vendor(cmd) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0xFFFFFFFF, 0);
  b[4] = cmd;
  return b;
}

(async () => {
  emu.start({ storageDir });
  /*
   * A blank store's first boot keeps the firmware busy for seconds (measured: the first vendor
   * report taken ~9 s after start on Windows) - and the first write proves the point: it resolves
   * the moment the firmware takes it, together with the reply, not when it was queued.
   */
  const first = await emu.writeHidTaken(vendor(0xE1), emu.IFACE.VENDOR, 20000);
  if (!first) throw new Error('the firmware never took a vendor report in 20 s');

  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 5);
  const results = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const taken = await emu.writeHidTaken(vendor(0xE1), emu.IFACE.VENDOR, 1000); /* OKSETPIN: asks for a PIN, harmless here */
    results.push({ taken, ms: Date.now() - t0 });
  }
  clearInterval(timer);
  emu.stop();

  console.log(`writes: ${JSON.stringify(results)}; timer ticks meanwhile: ${ticks}`);
  if (!results.every((r) => r.taken)) throw new Error('a vendor write was not taken before its deadline');
  if (!results.every((r) => r.ms < 1000)) throw new Error('a write waited the whole deadline');
  if (ticks < 1) throw new Error('the JS thread did not run while the writes waited');
  let refused = false;
  try { await emu.writeHidTaken(vendor(0xE1), emu.IFACE.KEYBOARD); } catch (_) { refused = true; }
  if (!refused) throw new Error('a write to the keyboard interface (device to host only) was accepted');
  console.log('PASS: vendor writes resolve when taken, the JS thread keeps running, the keyboard interface is refused');
})().catch((e) => {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
});
