import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { palette, treeStyles } from "../src/render/palette.ts";

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
    "export.ts": ["math", "design", "terrain", "roads", "vegetation", "checks", "edit", "island.ts"],
    "island.ts": ["math", "design", "terrain", "roads", "vegetation", "checks", "edit"]
};
const testTools = new Set(["read-fixture", "fixtureSchema", "register-svelte", "boundaries"].map(name => resolve(root, "configs", name + ".ts")));

function checkDirectory(directory: string, graph: Map<string, Set<string>>) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
        const path = resolve(entry.parentPath, entry.name);
        assert.equal(extname(path), ".ts", relative(root, path) + " must be TypeScript");
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
                if (!inCore && ts.isIdentifier(node.expression) && ["readFixture", "readLegacyFixture", "fixtureOptions"].includes(node.expression.text)) {
                    const filename = node.expression.text === "fixtureOptions" ? /^(?:v4\/)?[\w-]+\.json$/ : /^[\w-]+\.json$/;
                    if (!node.arguments.length || !node.arguments.every(arg => ts.isStringLiteral(arg) && filename.test(arg.text)))
                        fail(node, "Use a JSON filename from .local/fixtures/.");
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

export function checkEditorSource() {
    const tracked = execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    assert(tracked.length);
    for (const file of tracked) {
        const source = readFileSync(resolve(root, file), "utf8");
        assert.doesNotMatch(source, /[「」·]/u, file);
        if (/\.(?:ts|svelte)$/u.test(file) && !file.includes("/migrations/")) assert.doesNotMatch(source, /岛/u, file);
        assert.doesNotMatch(source, /<input\b[^>]*\btype=["']range["']/u, file);
        assert.doesNotMatch(source, /(?:disabled[^\n]*关闭|关闭[^\n]*disabled)/u, file);
    }
}

export function checkDesignTokens() {
    const colors = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\s*\(/iu;
    const pixelFont = /\bfont-size\s*:\s*[^;{}\n]*\b\d+(?:\.\d+)?px\b/i;
    const legacy = /--(?:ink|muted|line|paper|panel|teal|light|red)\s*[:)]/u;
    const tokens = resolve(root, "src/app/styles/tokens.css");
    const paletteFile = resolve(root, "src/render/palette.ts");
    for (const [directory, tokenFile] of [["app", tokens], ["render", paletteFile]]) {
        for (const entry of readdirSync(resolve(root, "src", directory), { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.(svelte|ts|css)$/u.test(entry.name)) continue;
            const path = resolve(entry.parentPath, entry.name);
            if (path === tokenFile) continue;
            const source = readFileSync(path, "utf8");
            assert.doesNotMatch(source, colors, relative(root, path) + " must use color tokens");
            if (directory === "app") {
                assert.doesNotMatch(source, pixelFont, relative(root, path) + " must use font tokens");
                assert.doesNotMatch(source, legacy, relative(root, path) + " uses a retired token");
            }
        }
    }
    const definitions = new Map([...readFileSync(tokens, "utf8").matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
    for (const key of ["bgApp", "bgPanel", "bgSelected", "text", "textSecondary", "border", "accent", "warning", "danger"] as const) {
        const token = "--" + key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
        assert.equal(definitions.get(token), palette[key], token);
    }
    for (const [species, [color]] of Object.entries(treeStyles))
        assert.equal(definitions.get("--map-tree-" + species), color, species);
}