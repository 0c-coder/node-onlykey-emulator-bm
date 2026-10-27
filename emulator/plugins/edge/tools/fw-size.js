#!/usr/bin/env node
'use strict';
/*
 * THE FIRMWARE'S ROOM, WORKED OUT FROM THE BUILD (Brad, 2026-10-27: "a calculator script that will take the build
 * results and make sure there is enough ram and storage for all the features to the max full, so we can ensure no
 * overflow after a build").
 *
 *   node fw-size.js <OnlyKey.cpp.elf> [--tools <arm bin dir>] [--flash-limit 0x39800] [--top 15] [--json]
 *
 * Exit 1 when the build does not fit. What it checks:
 *
 * FLASH  code + initialised data (.text + .data, as flashed) must end below the flash limit - by default the Edge
 *        state region (0x39800, okplugin_edge.cpp EDGE_REGION), as build-hardkey.sh's guard.
 *
 * RAM    64 KB on the Teensy 3.2 (MK20DX256). Static (.data, .bss, the USB tables and buffers - fixed at link time)
 *        + the WORST-CASE STACK: the deepest chain of calls from main (setup, then loop and everything it calls)
 *        plus the deepest interrupt handler on top of it (an interrupt can land at the deepest point) and the
 *        exception frame the core pushes. "All the features to the max" is that chain: whatever path it is, the
 *        stack must reach it without running into the static data below.
 *
 * HOW THE STACK IS COUNTED (conservative - an upper bound, never an estimate that can come in low):
 *   - a function's frame = every byte it moves sp down by, anywhere in its body: push / stmdb sp! (4 per register),
 *     vpush (8 per d register), sub sp #N. Epilogues and early returns are not subtracted, so a function that
 *     pushes twice is counted twice.
 *   - a call's cost = the caller's whole frame + the callee's worst (bl, and b.w tail calls to another function).
 *   - INDIRECT CALLS (blx/bx through a register: function pointers, SoftTimer tasks, plugin hooks, virtual calls)
 *     cannot be followed from the code. They are bounded by the worst of every function whose address is stored in
 *     the image (the only functions a pointer can hold). Re-entry (handle_packets inside an RSA operation) is counted
 *     once more and listed: its depth is that assumption, not the code.
 *   - a frame whose size is set at run time (sub sp, rN with no constant before it) is listed and fails the check.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAM_SIZE = 64 * 1024;
const EXCEPTION_FRAME = 32;                         /* r0-r3, r12, lr, pc, xPSR: the MK20DX256's M4 has no FPU */
const RAM_SECTIONS = ['.data', '.bss', '.usbdescriptortable', '.dmabuffers', '.usbbuffers'];

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const elf = args.find((a) => a.endsWith('.elf'));
if (!elf || !fs.existsSync(elf)) { console.error('usage: node fw-size.js <OnlyKey.cpp.elf> [--tools <arm bin dir>] [--flash-limit 0x39800] [--top 15] [--json]'); process.exit(2); }
const tools = opt('--tools', path.join(process.env.HOME || '', 'project/onlykey/fw-3.1.0-pr/arduino-1.6.5-r5-teensy_127/arduino-1.6.5-r5/hardware/tools/arm/bin'));
const FLASH_LIMIT = Number(opt('--flash-limit', '0x39800'));
const TOP = Number(opt('--top', '15'));
const run = (tool, a) => execFileSync(path.join(tools, `arm-none-eabi-${tool}`), a, { encoding: 'utf8', maxBuffer: 256 << 20 });

/* ---- sections: flash end and static RAM */
const sections = {};
for (const l of run('objdump', ['-h', elf]).split('\n')) {
  const m = l.match(/^\s*\d+\s+(\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/);
  if (m) sections[m[1]] = { size: parseInt(m[2], 16), vma: parseInt(m[3], 16), lma: parseInt(m[4], 16) };
}
const text = sections['.text'] || { size: 0, lma: 0 };
const data = sections['.data'] || { size: 0, lma: 0 };
const flashEnd = Math.max(text.lma + text.size, data.lma + data.size);
const staticRam = RAM_SECTIONS.reduce((a, s) => a + (sections[s] ? sections[s].size : 0), 0);

/* ---- symbols: the biggest RAM and flash users */
const symbols = run('nm', ['-S', '--size-sort', '-C', elf]).split('\n')
  .map((l) => l.match(/^([0-9a-f]+) ([0-9a-f]+) (\w) (.+)$/)).filter(Boolean)
  .map((m) => ({ size: parseInt(m[2], 16), type: m[3], name: m[4] }));
const ramSyms = symbols.filter((s) => /[bBdD]/.test(s.type)).sort((a, b) => b.size - a.size);
const flashSyms = symbols.filter((s) => /[tTrRW]/.test(s.type)).sort((a, b) => b.size - a.size);
const heap = symbols.some((s) => /^(_sbrk|malloc|_malloc_r)$/.test(s.name));

/* ---- functions: frames and calls, from the disassembly */
const fns = new Map();                               /* name -> {frame, calls:Set, indirect, dynamic} */
let cur = null;
let recent = [];                                     /* the last few instructions, for sub sp, rN */
const regCount = (list) => list.split(',').reduce((n, r) => {
  const range = r.trim().match(/^[rd](\d+)-[rd](\d+)$/);
  return n + (range ? Number(range[2]) - Number(range[1]) + 1 : (r.trim() ? 1 : 0));
}, 0);
for (const line of run('objdump', ['-d', '--no-show-raw-insn', '-C', elf]).split('\n')) {
  const head = line.match(/^([0-9a-f]+) <(.+)>:$/);
  if (head) { cur = { name: head[2], addr: parseInt(head[1], 16), frame: 0, calls: new Set(), indirect: false, dynamic: false }; fns.set(head[2], cur); recent = []; continue; }
  if (!cur) continue;
  const ins = line.match(/^\s+[0-9a-f]+:\s+(\S+)\s*(.*)$/);
  if (!ins) continue;
  const [, op, rest] = ins;
  let m;
  if ((op === 'push' || op === 'push.w') && (m = rest.match(/\{([^}]*)\}/))) cur.frame += 4 * regCount(m[1]);
  else if (op.startsWith('stmdb') && /^sp!/.test(rest) && (m = rest.match(/\{([^}]*)\}/))) cur.frame += 4 * regCount(m[1]);
  else if (op.startsWith('vpush') && (m = rest.match(/\{([^}]*)\}/))) cur.frame += 8 * regCount(m[1]);
  else if (/^sub(w|\.w)?$/.test(op) && /^sp,\s*(sp,\s*)?#/.test(rest) && (m = rest.match(/#(\d+)/))) cur.frame += Number(m[1]);
  else if (/^sub(\.w)?$/.test(op) && (m = rest.match(/^sp,\s*(?:sp,\s*)?(r\d+|sl|fp|ip)/))) {
    /* sub sp, rN: a constant only when the LAST instruction to write rN loaded one; anything else is sized at run
     * time (a VLA) and takes its bound from VLA_BOUNDS */
    const write = recent.slice().reverse().find((r) => new RegExp(`^\\S+ ${m[1]},`).test(r));
    const k = write && write.match(new RegExp(`^(movw|mov\\.w|mov) ${m[1]}, #(\\d+)$`));
    if (k) cur.frame += Number(k[2]); else cur.dynamic = true;
  } else if (/^bl(x)?$/.test(op) && (m = rest.match(/<(.+?)(\+0x[0-9a-f]+)?>/)) && !m[2]) cur.calls.add(m[1]);
  else if (/^b(\.w)?$/.test(op) && (m = rest.match(/<(.+?)(\+0x[0-9a-f]+)?>/)) && !m[2] && m[1] !== cur.name) cur.calls.add(m[1]);
  else if (op === 'blx' && /^r\d+/.test(rest)) cur.indirect = true;
  else if (op === 'bx' && /^r\d+/.test(rest) && !/^lr/.test(rest)) cur.indirect = true;
  recent.push(`${op} ${rest}`); if (recent.length > 8) recent.shift();
}

/*
 * ---- frames sized at run time (VLAs), each bounded from its source. A new one, or one whose function is gone, is
 * reported; an unbounded one fails the check. +8 covers the compiler's alignment of the size.
 */
const VLA_BOUNDS = {
  okcrypto_rsasign: { bytes: 512 + 8, why: 'rsa_signature[type * 128], type <= 4 (RSA-4096) - libraries onlykey/okcrypto.cpp:603' },
  mbedtls_rsa_rsassa_pkcs1_v15_sign: { bytes: 512 + 8, why: 'temp1[ctx->len], ctx->len <= 512 (RSA-4096) - libraries mbedtls-2.4.0/rsa.cpp:1138' },
  crypto_ed25519_sign: { bytes: 1024 + 8, why: 'data[len1 + len2], each refused above 512 - libraries fido2/crypto.cpp:339' },
};
for (const f of fns.values()) {
  if (!f.dynamic) continue;
  const b = VLA_BOUNDS[f.name];
  if (b) { f.frame += b.bytes; f.dynamic = false; f.vla = b.why; }
}
/* crash handlers end in a loop that never returns to the code they interrupted: not part of the worst case */
const CRASH_HANDLERS = new Set(['fault_isr', 'unused_isr', 'hard_fault_isr']);

/*
 * ---- what a call through a pointer can reach: only a function whose ADDRESS is stored somewhere - a vtable, a
 * callback table, a literal loaded into a register. Every 32-bit word of the flashed image that equals a function's
 * start (Thumb: +1) marks it. A word that only happens to match is counted too (conservative).
 */
const bin = path.join(require('os').tmpdir(), `fw-size-${process.pid}.bin`);
run('objcopy', ['-O', 'binary', elf, bin]);
const image = fs.readFileSync(bin);
fs.rmSync(bin, { force: true });
const byAddr = new Map([...fns.values()].map((f) => [f.addr | 1, f.name]));
const addressTaken = new Set();
for (let i = 0; i + 4 <= image.length; i += 2) { const n = byAddr.get(image.readUInt32LE(i)); if (n) addressTaken.add(n); }

/* ---- the worst stack from a root: frame + the worst callee; indirect calls bounded by the address-taken functions */
const isIsr = (n) => /_isr$|_Handler$|^fault_isr$/.test(n);
const ROOTS = ['main', 'ResetHandler', 'Reset_Handler', 'setup', 'loop'];
const isMember = (n) => /^[A-Za-z_][A-Za-z0-9_]*::/.test(n);
/*
 * THE POINTER MAP. Timer tasks (signature (Task*)) are called through a pointer only by the two SoftTimer dispatchers;
 * a C++ method's pointer call is a virtual call to a stored member function; any other pointer call (libc's qsort
 * and init, the RNG and curve callbacks of mbedTLS and uECC, the EEPROM and clock hooks) reaches a stored plain
 * function, never a timer task. A new dispatcher of tasks belongs in TASK_DISPATCHERS.
 */
const TASK_DISPATCHERS = /^(SoftTimerClass::testAndCall|DelayRun::step)\(/;
const isTask = (n) => /\(Task\*\)$/.test(n);
const kindOfTarget = (n) => (isTask(n) ? 'task' : isMember(n) ? 'member' : 'plain');
const kindOfSite = (n) => (TASK_DISPATCHERS.test(n) ? 'task' : isMember(n) ? 'member' : 'plain');
const orphans = [...addressTaken].filter((n) => !isIsr(n) && !ROOTS.includes(n));
/*
 * RE-ENTRY IS COUNTED ONCE: the firmware's patched mbedTLS calls handle_packets in the middle of an RSA operation
 * (mbedtls_rsa_private), so packet handling re-enters itself, and its flags stop it going deeper. A cycle's back edge
 * therefore costs the re-entered function's worst once more (pass 2, from pass 1's acyclic worst) - and every
 * function on a cycle is listed, as its depth is that assumption, not the code.
 */
let memo = new Map();
const recursion = new Set();
const onPath = new Set();
let indirectBound = null;
let pointerTargets = [];
let reentry = null;                                  /* pass 1's results: the cost of one re-entry */
function worst(name) {
  if (memo.has(name)) return memo.get(name);
  const f = fns.get(name);
  if (!f) return { bytes: 0, chain: [name] };
  if (onPath.has(name)) {
    recursion.add(name);
    const again = reentry && reentry.get(name);
    return again ? { bytes: again.bytes, chain: [`${name} (re-entered once)`] } : { bytes: 0, chain: [`${name} (re-entry)`] };
  }
  onPath.add(name);
  let best = { bytes: 0, chain: [] };
  for (const c of f.calls) { const w = worst(c); if (w.bytes > best.bytes) best = w; }
  /* a pointer call in a C++ method is a virtual call: it reaches stored member functions; any other, plain ones */
  const ib = indirectBound && indirectBound[kindOfSite(name)];
  if (f.indirect && ib && ib.bytes > best.bytes) best = { bytes: ib.bytes, chain: [`(through a pointer) ${ib.chain.join(' > ')}`] };
  onPath.delete(name);
  const r = { bytes: f.frame + best.bytes, chain: [name, ...best.chain] };
  memo.set(name, r);
  return r;
}
/* the indirect bound first, with indirect calls inside it not followed again (a callback calling a callback is
 * already counted by taking the worst callback) */
const root = ['main', 'ResetHandler', 'Reset_Handler'].find((n) => fns.has(n)) || 'loop';
function solve() {
  const ib = { task: { bytes: 0, chain: [] }, member: { bytes: 0, chain: [] }, plain: { bytes: 0, chain: [] } };
  indirectBound = null;
  for (const n of orphans) { const w = worst(n); const k = kindOfTarget(n); if (w.bytes > ib[k].bytes) ib[k] = w; }
  indirectBound = ib;
  pointerTargets = orphans.map((n) => [n, worst(n).bytes]).sort((a, b) => b[1] - a[1]);
  memo = new Map();
  const m = worst(root);
  let isr = { bytes: 0, chain: [] };
  for (const n of fns.keys()) if (isIsr(n) && !CRASH_HANDLERS.has(n)) { const w = worst(n); if (w.bytes > isr.bytes) isr = w; }
  return { m, isr };
}
solve();                                             /* pass 1: back edges free */
reentry = memo;
memo = new Map();
const { m: mainWorst, isr: isrWorst } = solve();     /* pass 2: each back edge = one re-entry */
const stack = mainWorst.bytes + isrWorst.bytes + EXCEPTION_FRAME;
const ramFree = RAM_SIZE - staticRam - stack;
const flashFree = FLASH_LIMIT - flashEnd;
const dynamic = [...fns.values()].filter((f) => f.dynamic).map((f) => f.name);
const vlas = [...fns.values()].filter((f) => f.vla).map((f) => `${f.name}: ${f.vla}`);
const indirectHolders = [...fns.values()].filter((f) => f.indirect).map((f) => f.name);
const frames = [...fns.values()].sort((a, b) => b.frame - a.frame);
const ok = flashFree >= 0 && ramFree >= 0 && !dynamic.length;

const report = {
  ok, flash: { end: flashEnd, limit: FLASH_LIMIT, free: flashFree },
  ram: { size: RAM_SIZE, static: staticRam, stack, free: ramFree, heapLinked: heap,
    stackParts: { main: mainWorst.bytes, interrupt: isrWorst.bytes, exceptionFrame: EXCEPTION_FRAME } },
  worstChain: mainWorst.chain, worstInterrupt: isrWorst.chain,
  reentered: [...recursion], boundedFrames: vlas, dynamicFrames: dynamic, indirectCallers: indirectHolders.length,
  topRam: ramSyms.slice(0, TOP).map((s) => [s.name, s.size]), topFlash: flashSyms.slice(0, TOP).map((s) => [s.name, s.size]),
  topFrames: frames.slice(0, TOP).map((f) => [f.name, f.frame]),
};
if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(ok ? 0 : 1); }

const kb = (n) => `${n.toLocaleString('en-US')} B`;
const hex = (n) => `0x${n.toString(16)}`;
console.log(`FLASH  ends at ${hex(flashEnd)}, limit ${hex(FLASH_LIMIT)}: ${flashFree >= 0 ? `${kb(flashFree)} free` : `OVER by ${kb(-flashFree)}`}`);
console.log(`RAM    ${kb(RAM_SIZE)} = static ${kb(staticRam)} + worst-case stack ${kb(stack)} ` +
  `(main ${kb(mainWorst.bytes)} + interrupt ${kb(isrWorst.bytes)} + exception frame ${EXCEPTION_FRAME}) ` +
  `${ramFree >= 0 ? `+ ${kb(ramFree)} free` : `- OVER by ${kb(-ramFree)}`}${heap ? '; malloc is linked: the heap is not counted' : ''}`);
/* each step with its own frame: where the bytes are, not only the total */
const step = (n) => { const f = fns.get(n.replace(/ \(re-entered once\)$| \(re-entry\)$/, '')); return `${n.replace(/\(.*\)\s*\[clone.*$|\(.*\)$/, '')}[${f ? f.frame : '?'}]`; };
console.log(`       worst chain: ${mainWorst.chain.map(step).join(' > ')}`);
console.log(`       worst interrupt: ${isrWorst.chain.slice(0, 6).join(' > ')}`);
console.log(`       ${indirectHolders.length} functions call through a pointer - bounded by the worst of the ${addressTaken.size} functions whose address is stored`);
if (recursion.size) console.log(`       re-entered once (an assumption, not the code): ${[...recursion].join(', ')}`);
for (const v of vlas) console.log(`       run-time frame, bounded: ${v}`);
if (dynamic.length) console.log(`       FRAMES SIZED AT RUN TIME WITH NO BOUND (add one to VLA_BOUNDS from the source): ${dynamic.join(', ')}`);
const table = (title, rows) => { console.log(`\n${title}`); for (const [n, s] of rows) console.log(`  ${String(s).padStart(7)}  ${n.slice(0, 90)}`); };
table(`top ${TOP} static RAM`, report.topRam);
table(`top ${TOP} stack frames`, report.topFrames);
table(`top ${TOP} pointer targets (worst stack through each)`, pointerTargets.slice(0, TOP));
table(`top ${TOP} flash`, report.topFlash);
console.log(`\n${ok ? 'FITS' : 'DOES NOT FIT'}`);
process.exit(ok ? 0 : 1);
