import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = resolve(root, "test"), core = resolve(root, "src/core");
const testImports = new Set(["node:assert/strict", "node:crypto", "node:test", "svelte/server"]);
const browserNames = new Set(["document", "window", "localStorage", "HTMLCanvasElement", "navigator", "Path2D", "requestAnimationFrame"]);
const ioNames = new Set(["require", "process", "fetch", "XMLHttpRequest", "Worker"]);

const allowed: Record<string, string[]> = {
    math: [],
    design: ["math"],
    terrain: ["math", "design"],
    roads: ["math", "design"],
    vegetation: ["math", "design"],
    checks: ["math", "design", "roads"],
    edit: ["math", "design"],
    "island.ts": ["math", "design", "terrain", "roads", "vegetation", "checks", "edit"]
};
const testTools = new Set(["read-fixture", "fixtureSchema", "register-svelte", "boundaries"].map(name => resolve(root, "configs", name + ".ts")));

function checkDirectory(directory: string, graph: Map<string, Set<string>>) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
        const path = resolve(entry.parentPath, entry.name);
        const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        const inCore = directory === core;
        if (inCore) graph.set(path, new Set());
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
            if (inCore && target.startsWith(core + sep) && extname(target) === ".ts") {
                const group = relative(core, path).split(sep)[0];
                const dependencyGroup = relative(core, target).split(sep)[0];
                if (!Object.hasOwn(allowed, group) || group !== dependencyGroup && !allowed[group].includes(dependencyGroup))
                    fail(node, group + " cannot depend on " + dependencyGroup);
                graph.get(path)!.add(target);
                return;
            }
            if (!inCore && (testTools.has(target) ||
        (target.startsWith(tests + sep) && extname(target) === ".ts") ||
        (target.startsWith(resolve(root, "src") + sep) && /\.(?:ts|svelte)$/.test(target)))) return;
            fail(node, "Unexpected file dependency " + name);
        }
        function visit(node: ts.Node) {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                if (node.moduleSpecifier) dependency(node.moduleSpecifier);
            }
            else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) dependency(node.argument.literal);
            else if (ts.isCallExpression(node)) {
                if (node.expression.kind === ts.SyntaxKind.ImportKeyword) dependency(node.arguments[0]);
                if (!inCore && ts.isIdentifier(node.expression) && node.expression.text === "readFixture") {
                    const arg = node.arguments[0];
                    if (!arg || !ts.isStringLiteral(arg) || !/^[\w-]+\.json$/.test(arg.text))
                        fail(node, "Use a JSON file in test/fixtures.");
                }
            }
            else if (ts.isIdentifier(node) && (ioNames.has(node.text) || inCore && browserNames.has(node.text))) {
                fail(node, "Unexpected API " + node.text);
            }
            ts.forEachChild(node, visit);
        }
        visit(file);
    }
}

export function checkBoundaries() {
    const graph = new Map<string, Set<string>>();
    checkDirectory(core, graph);
    const visited = new Set<string>(), active = new Set<string>();
    function checkCycles(path: string) {
        assert(!active.has(path), "Circular dependency: " + [...active, path].map(p => relative(core, p)).join(" -> "));
        if (visited.has(path)) return;
        assert(graph.has(path), "Missing core module: " + relative(core, path));
        active.add(path);
        for (const target of graph.get(path)!) checkCycles(target);
        active.delete(path);
        visited.add(path);
    }
    for (const path of graph.keys()) checkCycles(path);
    checkDirectory(tests, graph);
}