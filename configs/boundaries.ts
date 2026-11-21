import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = resolve(root, "test"), core = resolve(root, "src/core");
const testImports = new Set(["node:assert/strict", "node:crypto", "node:perf_hooks", "svelte/server"]);
const browserNames = new Set(["document", "window", "localStorage", "HTMLCanvasElement", "navigator", "Path2D", "requestAnimationFrame"]);
const ioNames = new Set(["require", "process", "fetch", "XMLHttpRequest", "Worker"]);

function checkDirectory(directory: string) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
        const path = resolve(entry.parentPath, entry.name);
        const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        const inCore = directory === core;
        function fail(node: ts.Node, reason: string): never {
            const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            assert.fail(`${relative(root, path)}:${line} ${reason}`);
        }
        function dependency(node: ts.Expression) {
            if (!ts.isStringLiteral(node)) fail(node, "Use a literal module specifier.");
            const name = node.text;
            if (!inCore && testImports.has(name)) return;
            if (!name.startsWith(".")) fail(node, "Unexpected dependency " + name);
            const target = resolve(entry.parentPath, name);
            if (inCore && target.startsWith(core + sep) && extname(target) === ".js") return;
            if (!inCore && (target === resolve(root, "configs/read-fixture.ts") ||
        (target.startsWith(tests + sep) && /\.[cm]?[jt]s$/.test(target)) ||
        (target.startsWith(resolve(root, "src") + sep) && /\.(?:js|ts|svelte)$/.test(target)))) return;
            fail(node, "Unexpected file dependency " + name);
        }
        function visit(node: ts.Node) {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                if (node.moduleSpecifier) dependency(node.moduleSpecifier);
            }
            else if (ts.isCallExpression(node)) {
                if (node.expression.kind === ts.SyntaxKind.ImportKeyword) dependency(node.arguments[0]);
                if (!inCore && ts.isIdentifier(node.expression) && node.expression.text === "readFixture") {
                    const arg = node.arguments[0];
                    if (!arg || !ts.isStringLiteral(arg) || !/^[\w-]+\.json$/.test(arg.text))
                        fail(node, "Use a JSON file in test/fixtures.");
                }
            }
            else if (ts.isIdentifier(node) && (inCore ? browserNames : ioNames).has(node.text)) {
                fail(node, "Unexpected API " + node.text);
            }
            ts.forEachChild(node, visit);
        }
        visit(file);
    }
}
checkDirectory(core);
checkDirectory(tests);
console.log("Core isolation and fixture-only test inputs passed.");