import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { interfaceColors, mapColors } from "../src/render/palette.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = resolve(root, "test"), core = resolve(root, "src/core"), render = resolve(root, "src/render");
const browserTests = resolve(tests, "browser");
const testImports = new Set(["node:assert/strict", "node:crypto", "node:test", "svelte/server"]);
const browserImports = new Set(["vite", "node:child_process", "node:fs", "node:fs/promises", "node:os", "node:path", "node:stream", "node:timers/promises"]);
const browserNames = new Set(["document", "window", "localStorage", "HTMLCanvasElement", "navigator", "Path2D", "requestAnimationFrame"]);
const ioNames = new Set(["require", "process", "fetch", "XMLHttpRequest", "Worker"]);

const allowed: Record<string, string[]> = {
    math: [],
    design: ["math"],
    terrain: ["math", "design"],
    checks: ["math", "design"],
    edit: ["math", "design"],
    "export.ts": ["math", "design", "terrain", "project.ts"],
    "project.ts": ["math", "design", "terrain", "checks"]
};
const testTools = new Set(["read-fixture", "fixtureSchema", "register-svelte", "boundaries"].map(name => resolve(root, "configs", name + ".ts")));

function checkDirectory(directory: string, graph: Map<string, Set<string>>) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
        const path = resolve(entry.parentPath, entry.name);
        assert.equal(extname(path), ".ts", relative(root, path) + " must be TypeScript");
        const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        const inCore = directory === core, inRender = directory === render, inTests = directory === tests;
        const inBrowser = inTests && path.startsWith(browserTests + sep);
        const inPoolTest = inTests && ["parallelBlocks.ts", "parallelTerrain.test.ts"].includes(entry.name);
        if (inCore) graph.set(path, new Set());
        function fail(node: ts.Node, reason: string): never {
            const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            assert.fail(`${relative(root, path)}:${line} ${reason}`);
        }
        function dependency(node: ts.Expression, dynamic = false) {
            // CDP callbacks import the running app by its Vite URL and type it with a local import.
            if (inBrowser && dynamic && ts.isIdentifier(node)) return;
            if (!ts.isStringLiteral(node)) fail(node, "Use a literal module specifier.");
            const name = node.text;
            if (inTests && testImports.has(name) || inBrowser && browserImports.has(name) ||
                inPoolTest && name === "node:worker_threads") return;
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
            if (inRender && (target.startsWith(core + sep) || target.startsWith(render + sep)) && extname(target) === ".ts") return;
            if (inTests && (testTools.has(target) ||
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
                if (node.expression.kind === ts.SyntaxKind.ImportKeyword) dependency(node.arguments[0], true);
                if (inTests && ts.isIdentifier(node.expression) && ["readFixture", "fixtureOptions"].includes(node.expression.text)) {
                    const filename = /^[\w-]+\.json$/;
                    if (!node.arguments.length || !node.arguments.every(arg => ts.isStringLiteral(arg) && filename.test(arg.text)))
                        fail(node, "Use a JSON filename from .local/fixtures/.");
                }
            }
            else if (ts.isIdentifier(node) && (ioNames.has(node.text) || inCore && browserNames.has(node.text) || inRender && node.text === "document") &&
                !(inBrowser && (node.text === "process" || node.text === "fetch")) && !(inPoolTest && node.text === "Worker")) {
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
    checkDirectory(render, graph);
    checkDirectory(tests, graph);
    checkMapState();
}

function checkMapState() {
    const state = "selection|draft|vertex|geometry|objectGeometry|displayField|hovered|drag\\w*|layers|gridDisplay|referencedGeo";
    const field = new RegExp("^(?:" + state + ")$");
    const map = resolve(render, "map.ts");
    const file = ts.createSourceFile(map, readFileSync(map, "utf8"), ts.ScriptTarget.Latest, true);
    const projectMap = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "ProjectMap");
    assert(projectMap && ts.isClassDeclaration(projectMap));
    for (const member of projectMap.members) {
        if (!ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) continue;
        assert.doesNotMatch(member.name.getText(file).replace(/^["']|["']$/g, ""), field, "ProjectMap must receive editor state with its view");
    }

    const assignment = new RegExp("\\bmap\\s*(?:\\.\\s*(?:" + state + ")\\b|\\[\\s*[\"'](?:" + state + ")[\"']\\s*\\])\\s*=(?!=|>)");
    for (const entry of readdirSync(resolve(root, "src/app"), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:ts|svelte)$/.test(entry.name)) continue;
        const path = resolve(entry.parentPath, entry.name);
        const source = readFileSync(path, "utf8"), name = relative(root, path);
        assert.doesNotMatch(source, assignment, name);
        assert.doesNotMatch(source, /\b(?:editor|this)\s*\.\s*revision\b|\{#key\s+editor\s*\./, name);
        if (["controller.ts", "geoTools.ts"].includes(entry.name))
            assert.doesNotMatch(source, /\.\s*(?:hint|position)\s*=(?!=|>)/, name);
    }
}

export function checkEditorSource() {
    const tracked = execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    assert(tracked.length);
    for (const file of tracked) {
        const path = resolve(root, file);
        if (!existsSync(path)) continue;
        const source = readFileSync(path, "utf8");
        assert.doesNotMatch(file, /island/i, file);
        assert.doesNotMatch(source, /island/i, file);
        assert.doesNotMatch(source, /[「」·]/u, file);
        if (/\.(?:ts|svelte)$/u.test(file)) assert.doesNotMatch(source, /岛/u, file);
        assert.doesNotMatch(source, /<input\b[^>]*\btype=["']range["']/u, file);
        assert.doesNotMatch(source, /(?:disabled[^\n]*关闭|关闭[^\n]*disabled)/u, file);
        if (/^src\/(?:app|render)\//.test(file)) {
            assert.doesNotMatch(source, /["'](?:geoNodes\[|inputs\.|fields\.|marks\[)/u, file + " uses a JSON path in editor text");
            assert.doesNotMatch(source, /校验/u, file + " uses the retired issue wording");
            assert.doesNotMatch(source, /(?<!变量)标签/u, file + " uses the retired name wording");
        }
    }
}

export function checkDesignTokens() {
    const colors = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\s*\(/iu;
    const pixelFont = /\bfont-size\s*:\s*[^;{}\n]*\b\d+(?:\.\d+)?px\b/i;
    const legacy = /--(?:ink|muted|line|paper|panel|teal|light|red|status-h)\s*[:)]/u;
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

    const blocks = [...readFileSync(tokens, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    function definitions(selector: string) {
        const matching = blocks.filter(([, rule]) => rule.trim() === selector);
        assert.equal(matching.length, 1, "Expected one token block for " + selector);
        const pairs = [...matching[0][2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()] as const);
        const result = new Map(pairs);
        assert.equal(result.size, pairs.length, "Duplicate token in " + selector);
        return result;
    }
    const light = definitions(":root"), dark = definitions(":root[data-theme=\"dark\"]");
    const colorNames = new Set(["--shadow-pop", ...[...light].filter(([, value]) => colors.test(value)).map(([name]) => name)]);
    assert(light.has("--shadow-pop"));
    assert(!light.has("--status-h"));
    assert.deepEqual(new Set(dark.keys()), colorNames, "Dark mode overrides every color token and the popup shadow only");
    for (const [name, value] of dark) assert.match(value, colors, name);

    const tokenName = (key: string) => "--" + key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
    for (const key of ["bgApp", "textSecondary", "border"] as const) {
        const token = tokenName(key);
        assert.equal(interfaceColors.light[key], light.get(token), "Light canvas " + token);
        assert.equal(interfaceColors.dark[key], dark.get(token), "Dark canvas " + token);
    }
    for (const key of ["bgPanel", "bgSelected", "text", "borderRegion", "accent", "warning", "danger"] as const) {
        const token = tokenName(key);
        assert.equal(mapColors.light[key], light.get(token), "Light map overlay " + token);
        assert.equal(mapColors.dark[key], dark.get(token), "Dark map overlay " + token);
    }

    const html = readFileSync(resolve(root, "index.html"), "utf8");
    assert.doesNotMatch(html, colors, "index.html must use color tokens");
    const startup = html.match(/<head>[^]*?<script>([^]*?)<\/script>/u)?.[1];
    assert(startup, "The head must set the initial appearance");
    const theme = readFileSync(resolve(root, "src/app/state/theme.ts"), "utf8");
    const key = theme.match(/\bconst key = "([^"]+)";/u)?.[1];
    assert.equal(key, "groundwork/appearance-v1");
    assert.equal(startup.match(/\blocalStorage\.getItem\("([^"]+)"\)/u)?.[1], key, "The initial appearance uses the same storage key");
}

export function checkParameterSource() {
    const retired = /\b(?:functionDefaults|ridgeNoiseDefaults|randomFunctions|fieldFunctions|advancedErosion|displayExpression)\b/u;
    const keyBased = /(?:\.at\(-1\)|\.includes\([^\n]*(?:address|key|path)[^\n]*\)|\bheight)\s*(?:===\s*"[^"]+"\s*)?\?\s*(?:["']m(?:\/m)?["']|\.?\d)\s*:/u;
    for (const entry of readdirSync(resolve(root, "src"), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:ts|svelte)$/.test(entry.name) || entry.name === "functionTable.ts") continue;
        const path = resolve(entry.parentPath, entry.name), source = readFileSync(path, "utf8");
        assert.doesNotMatch(source, retired, relative(root, path));
        assert.doesNotMatch(source, keyBased, relative(root, path));
        assert.doesNotMatch(source, /<Parameter\s[^>]*\b(?:unit|step)=/u, relative(root, path));
    }
}