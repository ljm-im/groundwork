import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
    base: "./",
    server: { host: "127.0.0.1", port: 18367, strictPort: true, headers },
    preview: { headers },
    worker: { format: "es" },
    plugins: [svelte({ configFile: resolve("configs/svelte.config.js") })]
});