export type Address = (string | number)[];

export function readAt(root: object, path: Address): unknown {
    return path.reduce<unknown>((v, k) => v && typeof v === "object" && Object.hasOwn(v, k) ? Reflect.get(v, k) : undefined, root);
}

export function writeAt(root: object, path: Address, value: unknown) {
    let parent = root;
    for (const [i, part] of path.slice(0, -1).entries()) {
        if (!Object.hasOwn(parent, part) || Reflect.get(parent, part) === undefined)
            Reflect.set(parent, part, typeof path[i + 1] === "number" ? [] : {});
        parent = Reflect.get(parent, part);
    }
    const key = path.at(-1)!;
    if (value === undefined) Reflect.deleteProperty(parent, key);
    else Reflect.set(parent, key, value);
}

export function jsonPath(path: Address) {
    return path.map((k, i) => typeof k === "number" ? "[" + k + "]" : (i ? "." : "") + k).join("");
}