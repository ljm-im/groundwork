import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compile, compileModule } from "svelte/compiler";

// Exercise the actual inspector and its rune modules in Node without a dev server.
registerHooks({
    load(url, context, nextLoad) {
        if (!url.endsWith(".svelte") && !url.endsWith(".svelte.ts")) return nextLoad(url, context);
        const { source } = nextLoad(url, { ...context, format: "module" });
        const options = { filename: fileURLToPath(url), generate: "server" as const };
        const code = String(source);
        const compiled = url.endsWith(".ts") ?
            compileModule(ts.transpile(code, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }), options) :
            compile(code, options);
        return { format: "module", source: compiled.js.code, shortCircuit: true };
    }
});