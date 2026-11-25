import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";
import { type GroundworkExport } from "../src/core/export.ts";

const text = new TextDecoder();
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function readZip(bytes: Uint8Array) {
    const view = viewOf(bytes), end = bytes.length - 22;
    const u16 = (offset: number) => view.getUint16(offset, true);
    const u32 = (offset: number) => view.getUint32(offset, true);
    assert.equal(u32(end), 0x06054b50);
    assert.deepEqual([u16(end + 4), u16(end + 6), u16(end + 20)], [0, 0, 0]);
    const count = u16(end + 10), directory = u32(end + 16);
    assert.equal(u16(end + 8), count);
    assert.equal(directory + u32(end + 12), end);
    const files = new Map<string, Uint8Array>();
    let local = 0, central = directory;

    for (let i = 0; i < count; i++) {
        assert.equal(u32(central), 0x02014b50);
        assert.equal(u32(local), 0x04034b50);
        assert.equal(u32(central + 42), local);
        assert.deepEqual([u16(local + 6), u16(local + 8), u16(local + 10), u16(local + 12)], [0, 0, 0, 0x21]);
        assert.deepEqual([u16(central + 8), u16(central + 10), u16(central + 12), u16(central + 14)], [0, 0, 0, 0x21]);
        assert.deepEqual([u16(local + 28), u16(central + 30), u16(central + 32), u16(central + 34)], [0, 0, 0, 0]);
        const nameLength = u16(local + 26), size = u32(local + 18), start = local + 30 + nameLength;
        assert.equal(u16(central + 28), nameLength);
        const nameBytes = bytes.subarray(local + 30, start);
        assert(nameBytes.every(byte => byte < 128));
        assert.deepEqual(bytes.subarray(central + 46, central + 46 + nameLength), nameBytes);
        assert.deepEqual([u32(local + 22), u32(central + 20), u32(central + 24)], [size, size, size]);
        const data = bytes.subarray(start, start + size), checksum = crc32(data), name = text.decode(nameBytes);
        assert.equal(u32(local + 14), checksum);
        assert.equal(u32(central + 16), checksum);
        assert(!files.has(name));
        files.set(name, data);
        local = start + size;
        central += 46 + nameLength;
    }
    assert.equal(local, directory);
    assert.equal(central, end);
    return files;
}

export function readProject(files: ReturnType<typeof readZip>): GroundworkExport {
    const metadata = files.get("project.json");
    assert(metadata);
    return JSON.parse(text.decode(metadata));
}

export function readNpy(bytes: Uint8Array) {
    const view = viewOf(bytes);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
    const offset = 10 + view.getUint16(8, true);
    assert.equal(offset % 64, 0);
    const header = text.decode(bytes.subarray(10, offset));
    const match = /^\{'descr': '(<f4|\|u1)', 'fortran_order': False, 'shape': \((\d+), (\d+)\), \} *\n$/.exec(header);
    assert(match, header);
    const [, dtype, rows, columns] = match, height = Number(rows), width = Number(columns);
    const data = bytes.subarray(offset);
    assert.equal(data.length, width * height * (dtype === "<f4" ? 4 : 1));
    return { dtype, width, height, data, view: viewOf(data) };
}

export function decodePreview(bytes: Uint8Array) {
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = viewOf(bytes), data: Uint8Array[] = [];
    let offset = 8, width = 0, height = 0, ended = false;
    while (offset < bytes.length) {
        const length = view.getUint32(offset), type = text.decode(bytes.subarray(offset + 4, offset + 8));
        const end = offset + 8 + length;
        assert.equal(view.getUint32(end), crc32(bytes.subarray(offset + 4, end)));
        if (type === "IHDR") {
            assert.equal(offset, 8);
            assert.equal(length, 13);
            width = view.getUint32(offset + 8);
            height = view.getUint32(offset + 12);
            assert.deepEqual([...bytes.subarray(offset + 16, end)], [8, 6, 0, 0, 0]);
        }
        else if (type === "IDAT") {
            assert(width > 0 && height > 0);
            data.push(bytes.subarray(offset + 8, end));
        }
        else {
            assert.equal(type, "IEND");
            assert.equal(length, 0);
            assert.equal(end + 4, bytes.length);
            ended = true;
        }
        offset = end + 4;
    }
    assert(ended && data.length);
    const rows = inflateSync(Buffer.concat(data)), stride = width * 4;
    assert.equal(rows.length, (stride + 1) * height);
    const pixels = new Uint8Array(stride * height);
    for (let row = 0; row < height; row++) {
        const at = row * (stride + 1);
        assert.equal(rows[at], 0);
        pixels.set(rows.subarray(at + 1, at + 1 + stride), row * stride);
    }
    return { width, height, pixels };
}