import { readAt, type Address } from "./address.ts";
import { defaultFieldPrecision, isBuiltin } from "./defaults.ts";
import { gridStep, numericValid } from "./functionTable.ts";
import { literalPattern } from "./expression.ts";
import { expressionGraph, expressionLookup, resolveParameterValues, resolvedPaths, slotDependencies, type Slot } from "./parameters.ts";
import { check, type Location } from "./problems.ts";
import { validFieldPrecision, validInputRange, validStripWidths } from "./validateGeo.ts";
import { type Design, type Expression, type ResolvedDesign } from "./v5.ts";

export interface NumberChange {
    address: Address;
    value: Expression;
    resolved: { address: Address; value: Expression }[];
}

function literalChange(design: Design, address: Address, value: Expression): NumberChange {
    const [group, id, property, index] = address;
    if (group === "inputs" && property === "range" && typeof id === "string" && typeof index === "number") {
        const range: Expression[] = [...design.inputs[id].range];
        range[index] = value;
        check(validInputRange(range), "无效", { kind: "input", id, path: ["range"] });
    }
    else if (group === "fields" && property === "precision" && typeof id === "string") {
        const location: Location = { kind: "field", id, path: ["precision"] };
        check(validFieldPrecision(value), "必须是正的有限数", location);
        if (isBuiltin("field", id)) check(value === defaultFieldPrecision, "必须是 " + defaultFieldPrecision, location);
    }
    else check(group === "grid" && id === "step" && numericValid(gridStep, value), "无效", { kind: "project", path: address });
    return { address, value, resolved: [{ address, value }] };
}

export function numberEdits(design: Design, resolved: ResolvedDesign) {
    const graph = expressionGraph(design), slots = graph.slots;
    const byAddress = new Map<string, Slot>(), order = new Map<string, number>(), readers = new Map<string, string[]>();
    for (const slot of slots.values()) {
        byAddress.set(JSON.stringify(slot.path), slot);
        order.set(slot.key, order.size);
        for (const ref of slotDependencies(slot)) {
            const key = graph.key(ref);
            const list = readers.get(key);
            if (list) list.push(slot.key);
            else readers.set(key, [slot.key]);
        }
    }

    function affected(roots: Iterable<string>) {
        const dirty = new Set([...roots].map(key => graph.key(key)));
        for (const key of dirty) for (const reader of readers.get(key) ?? []) dirty.add(reader);
        return dirty;
    }

    function validate(address: Address, value: Expression): NumberChange {
        const slot = byAddress.get(JSON.stringify(address));
        if (!slot) return literalChange(design, address, value);
        if (typeof value === "string" && literalPattern.test(value.trim())) value = Number(value);
        check(!slot.output, "请先覆盖插值", slot.location);
        const replacement = { ...slot, value };
        const dirty = affected([slot.key]);
        const lookup = (key: string) => key === slot.key ? replacement : slots.get(key);
        const get = expressionLookup(design, lookup, key => dirty.has(key) ? undefined : graph.get(key), graph.key);
        const ordered = [...dirty].sort((a, b) => order.get(a)! - order.get(b)!);
        const values = resolveParameterValues(ordered.map(key => lookup(key)!), get);

        const widths = new Map<number, Expression[]>();
        for (const [target, result] of values) {
            const [group, index, section, property, part] = target.path;
            if (group !== "geoNodes" || section !== "construction" || property !== "widths") continue;
            const i = Number(index), construction = resolved.geoNodes[i].construction;
            if (construction.type !== "strip") continue;
            const pair = widths.get(i) ?? [...construction.widths];
            pair[Number(part)] = result;
            widths.set(i, pair);
        }
        for (const [target, result] of values) {
            const [, index] = target.path;
            const pair = target.owner === "geo" ? widths.get(Number(index)) : undefined;
            if (pair) {
                check(validStripWidths(pair), "无效", { ...target.location, path: ["construction", "widths"] });
                widths.delete(Number(index));
            }
            if (target.spec) check(numericValid(target.spec, result), "无效", target.location);
        }
        return {
            address, value,
            resolved: [...values].flatMap(([s, value]) => resolvedPaths(s).filter(path => value !== readAt(resolved, path))
                .map(address => ({ address, value })))
        };
    }

    return { slots, key: graph.key, get: graph.get, affected, validate };
}