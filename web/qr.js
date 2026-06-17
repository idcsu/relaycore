(function () {
  "use strict";

  const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172];
  const ECC_CODEWORDS = [0, 7, 10, 15, 20, 26, 18];
  const NUM_BLOCKS = [0, 1, 1, 1, 1, 1, 2];
  const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

  function renderSVG(text, options = {}) {
    const qr = encode(text);
    const border = options.border ?? 4;
    const scale = options.scale ?? 6;
    const size = qr.size + border * 2;
    let paths = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          paths.push(`M${x + border},${y + border}h1v1h-1z`);
        }
      }
    }
    return `<svg class="qr-svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" role="img" aria-label="TOTP QR code" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><path d="${paths.join("")}" fill="#111827"/></svg>`;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = chooseVersion(bytes.length);
    const size = version * 4 + 17;
    const dataCodewords = TOTAL_CODEWORDS[version] - ECC_CODEWORDS[version] * NUM_BLOCKS[version];
    const data = makeDataCodewords(bytes, version, dataCodewords);
    const codewords = addErrorCorrection(data, version);
    const matrix = makeMatrix(size);
    drawFunctionPatterns(matrix, version);
    drawCodewords(matrix, codewords);
    applyMask(matrix, 0);
    drawFormatBits(matrix, 0);
    return { size, modules: matrix.modules };
  }

  function chooseVersion(byteLength) {
    for (let version = 1; version <= 6; version++) {
      const dataCodewords = TOTAL_CODEWORDS[version] - ECC_CODEWORDS[version] * NUM_BLOCKS[version];
      const lengthBits = version < 10 ? 8 : 16;
      if (4 + lengthBits + byteLength * 8 <= dataCodewords * 8) return version;
    }
    throw new Error("QR payload too long");
  }

  function makeDataCodewords(bytes, version, dataCodewords) {
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) appendBits(bits, b, 8);
    const capacity = dataCodewords * 8;
    appendBits(bits, 0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
    }
    for (let pad = 0xec; out.length < dataCodewords; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }

  function appendBits(out, value, length) {
    for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
  }

  function addErrorCorrection(data, version) {
    const eccLen = ECC_CODEWORDS[version];
    const blocks = NUM_BLOCKS[version];
    const shortLen = Math.floor(data.length / blocks);
    const numShort = blocks - data.length % blocks;
    const divisor = reedSolomonDivisor(eccLen);
    const dataBlocks = [];
    const eccBlocks = [];
    let offset = 0;
    for (let i = 0; i < blocks; i++) {
      const len = shortLen + (i >= numShort ? 1 : 0);
      const block = data.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      eccBlocks.push(reedSolomonRemainder(block, divisor));
    }
    const result = [];
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
      for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
    }
    for (let i = 0; i < eccLen; i++) {
      for (const block of eccBlocks) result.push(block[i]);
    }
    return result;
  }

  function reedSolomonDivisor(degree) {
    const result = Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function reedSolomonRemainder(data, divisor) {
    const result = Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function makeMatrix(size) {
    return {
      size,
      modules: Array.from({ length: size }, () => Array(size).fill(false)),
      reserved: Array.from({ length: size }, () => Array(size).fill(false))
    };
  }

  function setModule(matrix, x, y, dark, reserved = true) {
    if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) return;
    matrix.modules[y][x] = !!dark;
    if (reserved) matrix.reserved[y][x] = true;
  }

  function drawFunctionPatterns(matrix, version) {
    const size = matrix.size;
    drawFinder(matrix, 3, 3);
    drawFinder(matrix, size - 4, 3);
    drawFinder(matrix, 3, size - 4);
    for (let i = 0; i < size; i++) {
      if (!matrix.reserved[6][i]) setModule(matrix, i, 6, i % 2 === 0);
      if (!matrix.reserved[i][6]) setModule(matrix, 6, i, i % 2 === 0);
    }
    for (const x of ALIGNMENT[version]) {
      for (const y of ALIGNMENT[version]) {
        if (matrix.reserved[y][x]) continue;
        drawAlignment(matrix, x, y);
      }
    }
    setModule(matrix, 8, size - 8, true);
    drawFormatBits(matrix, 0);
  }

  function drawFinder(matrix, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setModule(matrix, cx + dx, cy + dy, dist <= 3 && dist !== 2);
      }
    }
  }

  function drawAlignment(matrix, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setModule(matrix, cx + dx, cy + dy, dist !== 1);
      }
    }
  }

  function drawCodewords(matrix, codewords) {
    const bits = [];
    for (const b of codewords) appendBits(bits, b, 8);
    let i = 0;
    const size = matrix.size;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      const upward = ((size - 1 - right) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (!matrix.reserved[y][x]) {
            matrix.modules[y][x] = i < bits.length && bits[i++] === 1;
          }
        }
      }
    }
  }

  function applyMask(matrix, mask) {
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (!matrix.reserved[y][x] && maskCondition(mask, x, y)) matrix.modules[y][x] = !matrix.modules[y][x];
      }
    }
  }

  function maskCondition(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      default: return false;
    }
  }

  function drawFormatBits(matrix, mask) {
    const bits = formatBits(mask);
    const size = matrix.size;
    for (let i = 0; i <= 5; i++) setModule(matrix, 8, i, getBit(bits, i));
    setModule(matrix, 8, 7, getBit(bits, 6));
    setModule(matrix, 8, 8, getBit(bits, 7));
    setModule(matrix, 7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setModule(matrix, 14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) setModule(matrix, size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setModule(matrix, 8, size - 15 + i, getBit(bits, i));
    setModule(matrix, 8, size - 8, true);
  }

  function formatBits(mask) {
    const data = (1 << 3) | mask;
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) {
      if (((rem >>> i) & 1) !== 0) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  const api = { renderSVG, encode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.RelayCoreQR = api;
})();
