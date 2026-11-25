const ascii = new TextEncoder();
const maxZipSize = 0xffffffff;

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
    for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
    return byte;
});

function crc32(bytes: Uint8Array) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
    return (crc ^ 0xffffffff) >>> 0;
}

function zipSize(size: number) {
    if (size > maxZipSize) throw Error("导出包超过 ZIP32 的大小上限");
    return size;
}

export function zip(entries: [string, Uint8Array][]) {
    if (entries.length > 0xffff) throw Error("导出包的文件数超过 ZIP32 的上限");
    const files = entries.map(([path, data]) => ({ name: ascii.encode(path), data }));
    const localSize = 30, centralSize = 46, endSize = 22;
    const directoryAt = files.reduce((offset, { name, data }) => offset + localSize + name.length + zipSize(data.length), 0);
    const directorySize = files.reduce((size, { name }) => size + centralSize + name.length, 0);
    const bytes = new Uint8Array(zipSize(directoryAt + directorySize + endSize));
    const view = new DataView(bytes.buffer);
    let local = 0, central = directoryAt;
    for (const { name, data } of files) {
        const crc = crc32(data);
        view.setUint32(local, 0x04034b50, true);
        view.setUint16(local + 4, 20, true);
        view.setUint16(local + 12, 0x21, true);
        view.setUint32(local + 14, crc, true);
        view.setUint32(local + 18, data.length, true);
        view.setUint32(local + 22, data.length, true);
        view.setUint16(local + 26, name.length, true);
        bytes.set(name, local + localSize);
        bytes.set(data, local + localSize + name.length);

        view.setUint32(central, 0x02014b50, true);
        view.setUint16(central + 4, 20, true);
        view.setUint16(central + 6, 20, true);
        view.setUint16(central + 14, 0x21, true);
        view.setUint32(central + 16, crc, true);
        view.setUint32(central + 20, data.length, true);
        view.setUint32(central + 24, data.length, true);
        view.setUint16(central + 28, name.length, true);
        view.setUint32(central + 42, local, true);
        bytes.set(name, central + centralSize);

        local += localSize + name.length + data.length;
        central += centralSize + name.length;
    }
    view.setUint32(central, 0x06054b50, true);
    view.setUint16(central + 8, entries.length, true);
    view.setUint16(central + 10, entries.length, true);
    view.setUint32(central + 12, directorySize, true);
    view.setUint32(central + 16, directoryAt, true);
    return bytes;
}

export function npy(width: number, height: number, descr: "<f4" | "|u1") {
    const header = ascii.encode(`{'descr': '${descr}', 'fortran_order': False, 'shape': (${height}, ${width}), }`);
    const dataAt = Math.ceil((10 + header.length + 1) / 64) * 64;
    const bytes = new Uint8Array(zipSize(dataAt + width * height * (descr === "<f4" ? 4 : 1)));
    bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, dataAt - 10, true);
    bytes.set(header, 10);
    bytes.fill(0x20, 10 + header.length, dataAt - 1);
    bytes[dataAt - 1] = 0x0a;
    return { bytes, dataAt };
}

export async function png(width: number, height: number, pixels: Uint8ClampedArray) {
    const stride = width * 4, scanlines = new Uint8Array((stride + 1) * height);
    for (let row = 0; row < height; row++)
        scanlines.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
    const compressed = new Uint8Array(await new Response(new Blob([scanlines]).stream()
        .pipeThrough(new CompressionStream("deflate"))).arrayBuffer());

    const header = new Uint8Array(13), headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;

    const bytes = new Uint8Array(8 + 3 * 12 + header.length + compressed.length);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    let offset = 8;
    for (const [type, data] of [["IHDR", header], ["IDAT", compressed], ["IEND", new Uint8Array()]] as const) {
        const start = offset + 4, end = start + 4 + data.length;
        view.setUint32(offset, data.length);
        bytes.set(ascii.encode(type), start);
        bytes.set(data, start + 4);
        view.setUint32(end, crc32(bytes.subarray(start, end)));
        offset = end + 4;
    }
    return bytes;
}