import assert from "node:assert/strict";
import { withLayeredMap } from "./layeredMapFixture.ts";

export async function checkNumericEditing(url: string) {
    await withLayeredMap(url, "numeric-editing", async ({ at, authored, cdp, click, d, evaluate, key, mouse, paint, panel, point, saved, tap, text, wait }) => {
        console.log("numeric caret, expanded commits and rejected step values");
        await panel("inputs"); await paint();
        const chip = "[data-input=seed] .numeric-face [data-ref=\"input:A\"]";
        const caretAt = (after: boolean) => evaluate(after => {
            const el = document.querySelector(".numeric-edit")!, selection = document.getSelection()!;
            const chip = el.querySelector(".ref-chip")!, at = [...el.childNodes].indexOf(chip);
            return selection.isCollapsed && selection.anchorNode === el && selection.anchorOffset === at + Number(after) &&
                !selection.toString() && !chip.hasAttribute("data-selected");
        }, after);
        async function clickCaret(selector: string, fraction: number) {
            const at = await point(selector, fraction);
            const hit = await evaluate(({ at, selector }) => {
                const expected = document.querySelector(selector)!, target = document.elementFromPoint(...at);
                return { matches: target === expected || !!target?.closest(selector), target: target?.outerHTML.slice(0, 260),
                    box: expected.getBoundingClientRect().toJSON(), panel: document.querySelector("#panel")!.getBoundingClientRect().toJSON() };
            }, { at, selector });
            assert(hit.matches, "The numeric click must land on " + selector + " " + JSON.stringify(hit));
            await mouse("mousePressed", ...at);
            await mouse("mouseReleased", ...at);
        }
        await clickCaret(chip, .75);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip"));
        assert(await caretAt(true));
        await key("ArrowLeft"); assert(await caretAt(false));
        await key("ArrowRight", 8);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip[data-selected]"));
        await key("Backspace");
        await wait(() => !document.querySelector(".numeric-edit .ref-chip"));
        await key("Escape");
        await clickCaret("[data-input=seed] .numeric-face", .04);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip"));
        assert(await caretAt(false));
        await clickCaret(".numeric-edit .ref-chip", .75);
        assert(await caretAt(true));
        await clickCaret(".numeric-edit", .04);
        assert(await caretAt(false));
        await key("Escape");

        const long = "[data-input=B] .numeric-face";
        let formula = String(d.inputs.B.value);
        async function editLong() {
            await panel("inputs");
            await click(long);
            await wait(() => document.activeElement?.matches(".expanded-edit .numeric-edit"));
            await evaluate(() => {
                const el = document.activeElement!;
                document.getSelection()!.setPosition(el, el.childNodes.length);
            });
        }
        async function confirmFormula(expected: string) {
            await saved();
            assert.equal(await evaluate(() => !!document.querySelector(".expanded-edit")), false);
            assert.equal((await authored()).inputs.B.value, expected);
            assert.doesNotMatch(expected, /[\r\n]/);
        }
        for (const [suffix, modifiers] of [[" + 3", 0], [" + 4", 8]] as const) {
            await editLong();
            await cdp("Input.insertText", { text: suffix });
            await key("Enter", modifiers);
            formula += suffix;
            await confirmFormula(formula);
        }
        await editLong();
        await cdp("Input.insertText", { text: " + 5" });
        await cdp("Input.dispatchKeyEvent", { type: "char", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
        formula += " + 5";
        await confirmFormula(formula);
        await editLong();
        await evaluate(() => {
            const clipboardData = new DataTransfer();
            clipboardData.setData("text/plain", " +\r\n6");
            document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        });
        await click("#map");
        formula += " + 6";
        await confirmFormula(formula);
        await editLong();
        await cdp("Input.insertText", { text: " / 0" });
        await click("#map");
        await confirmFormula(formula);
        assert.equal(await text("#toast"), "未保存：除数不能为 0");
        await editLong();
        await cdp("Input.insertText", { text: " + 7" });
        await key("Escape");
        await confirmFormula(formula);

        await tap(await at([70, 0]));
        assert.equal(await text("#properties .property-title h2"), "项目");
        const grid = "#properties [data-parameter=\"grid.step\"]";
        const step = grid + " button[aria-label=减小采样间距]";
        assert.equal(await text(grid + " .numeric-face"), "0.25");
        await evaluate(s => document.querySelector(s)!.scrollIntoView({ block: "nearest" }), step);
        const [stepX, stepY] = await point(step);
        await mouse("mousePressed", stepX, stepY);
        await wait(s => document.querySelector(s)?.textContent === "值 0.00 无效", grid + " [role=alert]");
        assert.equal(await text(grid + " .numeric-face"), "0.25");
        assert.equal(await text(grid + " [role=alert]"), "值 0.00 无效");
        await mouse("mouseReleased", stepX, stepY);
        assert.equal(await text(grid + " [role=alert]"), "");
        await evaluate(s => document.querySelector<HTMLButtonElement>(s)!.focus(), step);
        await key("Enter");
        assert.equal(await text(grid + " [role=alert]"), "值 0.00 无效");
        await click(grid + " .numeric-face");
        await wait(() => !!document.querySelector(".numeric-edit"));
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "0" });
        await key("Enter");
        assert.equal(await text(grid + " [role=alert]"), "无效");
        await key("Escape");
        assert.equal((await authored()).grid.step, .25);

        await panel("inputs");
        await click("[data-select-input=B]");
        for (const name of ["台地增量", "当前值"]) {
            await click("#properties .property-title input");
            await evaluate(() => (document.activeElement as HTMLInputElement).select());
            await cdp("Input.insertText", { text: name });
            await key("Tab");
            await wait(name => document.querySelector("[data-select-input=B] .row-text")?.textContent?.trim() === name, name);
            for (const action of ["减小“" + name + "”", "增大“" + name + "”"])
                assert(await evaluate(label => !!document.querySelector("[data-input=B] button[aria-label=" + JSON.stringify(label) + "]"), action));
            assert(await evaluate(() => !!document.querySelector("#properties button[aria-label=增大当前值]")));
            await editLong();
            assert.equal(await evaluate(() => document.querySelector(".expanded-edit")?.getAttribute("aria-label")), "编辑“" + name + "”");
            assert(await evaluate(label => !!document.querySelector(".expanded-edit button[aria-label=" + JSON.stringify(label) + "]"),
                "为“" + name + "”插入变量"));
            await key("Escape");
        }
        await editLong();
        await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
        await cdp("Input.insertText", { text: "1 + {var:A}" });
        await key("Enter");
        assert.match(await text(".expanded-edit [role=alert]"), /第 5 个字符无法识别，未知的变量“\{var:A\}”/);
        await key("Escape");
    });
}