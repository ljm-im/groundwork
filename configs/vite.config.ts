import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
};

let commit = "";
try {
    commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
catch {
    // Builds outside a Git checkout have no commit to record.
}

export default defineConfig({
    base: "./",
    define: { __GROUNDWORK_COMMIT__: JSON.stringify(commit) },
    server: { host: "127.0.0.1", port: 18367, strictPort: true, headers },
    preview: { headers },
    worker: { format: "es" },
    plugins: [svelte({ configFile: resolve("configs/svelte.config.js") })]
});