export type Address = (string | number)[];

export function readAt(root: object, path: Address): unknown {
    return path.reduce<unknown>((v, k) => v && typeof v === "object" && Object.hasOwn(v, k) ? Reflect.get(v, k) : undefined, root);
}

function setOwn(root: object, key: string | number, value: unknown) {
    if (key === "__proto__") Object.defineProperty(root, key, { value, enumerable: true, configurable: true, writable: true });
    else Reflect.set(root, key, value);
}

export function writeAt(root: object, path: Address, value: unknown) {
    let parent = root;
    for (const [i, part] of path.slice(0, -1).entries()) {
        if (!Object.hasOwn(parent, part) || Reflect.get(parent, part) === undefined)
            setOwn(parent, part, typeof path[i + 1] === "number" ? [] : {});
        parent = Reflect.get(parent, part);
    }
    const key = path.at(-1)!;
    if (value === undefined) Reflect.deleteProperty(parent, key);
    else setOwn(parent, key, value);
}

export function copyAt<T extends object>(root: T, path: Address, value: unknown): T {
    const [key, ...rest] = path;
    const copy = (Array.isArray(root) ? root.slice() : { ...root }) as T;
    if (rest.length) {
        const child = readAt(root, [key]) as object | undefined;
        setOwn(copy, key, copyAt(child ?? (typeof rest[0] === "number" ? [] : {}), rest, value));
    }
    else if (value === undefined) Reflect.deleteProperty(copy, key);
    else Reflect.set(copy, key, value);
    return copy;
}

export function jsonPath(path: Address) {
    return path.map((k, i) => typeof k === "number" ? "[" + k + "]" : (i ? "." : "") + k).join("");
}