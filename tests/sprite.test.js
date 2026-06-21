const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SPRITE_PATH = path.join(__dirname, "..", "src", "assets", "cat", "cat-spritesheet.png");

test("all 8x5 sprite cells are populated, centered, unclipped, and baseline-stable", () => {
  const image = decodeRgbaPng(fs.readFileSync(SPRITE_PATH));
  assert.equal(image.width % 8, 0);
  assert.equal(image.height % 5, 0);
  const frameWidth = image.width / 8;
  const frameHeight = image.height / 5;
  const rowBaselines = [];

  for (let row = 0; row < 5; row += 1) {
    const baselines = [];
    const centers = [];
    for (let column = 0; column < 8; column += 1) {
      const bounds = alphaBounds(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight);
      assert.ok(bounds, `row ${row}, column ${column} is empty`);
      assert.ok(bounds.minX > 0 && bounds.minY > 0 && bounds.maxX < frameWidth - 1 && bounds.maxY < frameHeight - 1,
        `row ${row}, column ${column} touches its cell edge`);
      baselines.push(bounds.maxY);
      centers.push((bounds.minX + bounds.maxX) / 2);
    }
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 3, `row ${row} drifts horizontally`);
    rowBaselines.push(Math.max(...baselines) - Math.min(...baselines));
  }
  assert.ok(rowBaselines[0] <= 8, "idle baseline drifts");
  assert.ok(rowBaselines[1] <= 8, "walking baseline drifts");
  assert.ok(rowBaselines[2] <= 40, "running frames drift beyond their intended airborne motion");
  assert.ok(rowBaselines[3] <= 8, "sleeping baseline drifts");
  assert.ok(rowBaselines[4] <= 8, "loving baseline drifts");
});

function alphaBounds(image, startX, startY, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = image.pixels[((startY + y) * image.width + startX + x) * 4 + 3];
      if (alpha > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function decodeRgbaPng(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, "sprite must remain RGBA");
  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      pixels[y * stride + x] = unfilter(filter, value, left, above, upperLeft);
    }
    source += stride;
  }
  return { width, height, pixels };
}

function unfilter(filter, value, left, above, upperLeft) {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 255;
  if (filter === 2) return (value + above) & 255;
  if (filter === 3) return (value + Math.floor((left + above) / 2)) & 255;
  if (filter === 4) return (value + paeth(left, above, upperLeft)) & 255;
  throw new Error(`Unsupported PNG filter ${filter}`);
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}
