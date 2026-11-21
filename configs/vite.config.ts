import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    server: { host: "127.0.0.1", port: 18367, strictPort: true },
    plugins: [svelte({ configFile: resolve("configs/svelte.config.js") })]
});