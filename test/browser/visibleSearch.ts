import assert from "node:assert/strict";
import { defaultInputRange } from "../../src/core/design/defaults.ts";
import { type Design } from "../../src/core/design/v5.ts";
import { layer, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkVisibleSearch(url: string) {
    const d: Design = syntheticDesign(), [ground, terrace] = d.geoNodes;
    ground.id = "ground-key";
    ground.label = "底盘";
    terrace.id = "terrace-key";
    terrace.label = "台块甲";
    terrace.function = { type: "flat", amount: 27 };
    d.inputs["input-key"] = { label: "水位", value: 1, range: defaultInputRange("input-key") };
    d.inputs["shown-key"] = { value: 1, range: defaultInputRange("shown-key") };
    d.fields["field-key"] = { label: "砂率" };
    d.geoNodes.push(
        { ...layer("mountain-key", rect(1, 1, 8, 8), { type: "mountain", ridges: [], valleys: [], peaks: [] }), label: "山体乙" },
        { ...layer("strip-key", { type: "strip", of: [terrace.id], widths: [1, 2] }, { type: "blend" }), label: "过渡带丙" },
        { ...layer("field-writer", rect(2, 2, 7, 7), { type: "ground", value: 2 }, "field-key"), label: "覆盖区丁" }
    );
    d.marks.push({ id: "mark-key", label: "测点", kind: "text", follow: "map", point: [25, 13], elevation: 2 });
    return withCurveMap(url, "round41-visible-search", async page => {
        const { cdp, click, evaluate, key, paint, wait } = page;
        const search = async (id: string, value: string) => {
            await evaluate(({ id, value }) => {
                const input = document.getElementById(id) as HTMLInputElement;
                input.value = value;
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
            }, { id, value });
            await paint();
        };
        async function has(selector: string, present: boolean) {
            assert.equal(await evaluate(s => !!document.querySelector(s), selector), present, selector);
        }
        for (const [term, id] of [["山脉", "mountain-key"], ["+27", "terrace-key"], ["沿 “台块甲”", "strip-key"], ["砂率", "field-writer"]]) {
            await search("terrain-search", term);
            await has("[data-geo-node=" + id + "]", true);
        }
        for (const term of ["mountain", "ground", "terrace-key", "高度", "台块甲 升降", "升降+27"]) {
            await search("terrain-search", term);
            await has("[data-geo-node]", false);
        }
        await search("terrain-search", "");
        await click("[data-tab=inputs]");
        for (const [term, selector, present] of [
            ["水位", "[data-select-input=input-key]", true], ["input-key", "[data-select-input]", false], ["shown-key", "[data-select-input=shown-key]", true],
            ["砂率", "[data-select-field=field-key]", true], ["field-key", "[data-select-field]", false]
        ] as const) {
            await search("variable-search", term);
            await has(selector, present);
        }
        await click("[data-tab=marks]");
        for (const [term, present] of [["测点", true], ["文字标记", true], ["mark-key", false], ["测点 文字标记", false]] as const) {
            await search("mark-search", term);
            await has("[data-mark=mark-key]", present);
        }
        await click("[data-tab=terrain]");
        await click("[data-geo-node=terrace-key]");
        await click("[data-property-tab=function]");
        const editor = ".numeric-edit[aria-label=增量]", menu = ".reference-menu[aria-label=可用变量]";
        const option = (id: string) => menu + " [data-option=" + JSON.stringify(id) + "]";
        await click(".numeric-face[aria-label=增量]");
        await wait(s => document.activeElement?.matches(s), editor);
        const word = async (value: string) => {
            await evaluate(s => document.getSelection()!.selectAllChildren(document.querySelector(s)!), editor);
            await cdp("Input.insertText", { text: value });
            await paint();
        };
        for (const [term, id, present] of [
            ["水位", "input:input-key", true], ["input-key", "input:input-key", false], ["shown-key", "input:shown-key", true],
            ["ground-key", "geo:ground-key", false], ["数值", "geo:ground-key", false], ["高度", "field:height", true],
            ["测点", "mark:mark-key", true], ["mark-key", "mark:mark-key", false], ["底盘", "geo:ground-key", true]
        ] as const) {
            await word(term);
            await has(option(id), present);
        }
        await click(option("geo:ground-key"));
        await word("数值");
        await has(option("geo:ground-key.value"), true);
        await word("value");
        await has(option("geo:ground-key.value"), false);
        await key("Escape");
    }, d);
}