import { defineConfig } from "eslint/config";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import stylistic from "@stylistic/eslint-plugin";
import css from "@eslint/css";
import json from "@eslint/json";
import yaml from "eslint-plugin-yml";
import local from "./css.js";
import imports from "./imports.js";
import svelteConfig from "./svelte.config.js";

const typeImport = {
    selector: "ImportDeclaration[importKind='type']",
    message: "Put type inside the braces of a named import."
};
const accessor = {
    selector: "Property[kind=/^(get|set)$/], MethodDefinition[kind=/^(get|set)$/], AccessorProperty",
    message: "Use ordinary functions for state operations."
};
const componentOrder = {
    meta: { type: "layout", schema: [] },
    create(context) {
        return {
            Program(node) {
                let previous = 0;
                for (const block of node.body) {
                    if (block.type === "SvelteText" && !block.value.trim()) continue;
                    const order = block.type === "SvelteScriptElement" ? 2 : block.type === "SvelteStyleElement" ? 1 : 0;
                    if (order < previous) {
                        context.report({ node: block, message: "Order component blocks as markup, style, script." });
                    }
                    previous = order;
                }
            }
        };
    }
};
export default defineConfig(
    { ignores: ["**/node_modules/**", "**/dist/**", "**/.local/**", "pnpm-lock.yaml"] },
    { files: ["**/*.{js,mjs,ts,svelte}"], extends: [svelte.configs.recommended] },
    {
        files: ["**/*.{js,mjs,ts,svelte}"],
        plugins: { "@stylistic": stylistic, imports },
        rules: {
            "imports/svelte-namespace": "error",
            "no-restricted-syntax": ["error", typeImport, accessor],
            "@stylistic/quotes": ["error", "double", { allowTemplateLiterals: "always" }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "never"],
            "@stylistic/keyword-spacing": "error",
            "@stylistic/space-infix-ops": "error",
            "@stylistic/space-before-blocks": "error",
            "@stylistic/comma-spacing": "error",
            "@stylistic/semi-spacing": "error",
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/key-spacing": "error",
            "@stylistic/arrow-spacing": ["error", { before: true, after: true }],
            "@stylistic/brace-style": ["error", "stroustrup"],
            "@stylistic/eol-last": ["error", "never"],
            "@stylistic/no-trailing-spaces": "error"
        }
    },
    {
        files: ["**/*.{ts,js,mjs}"],
        rules: { "@stylistic/indent": ["error", 4] }
    },
    { files: ["**/*.{js,mjs}"], rules: { "no-unused-vars": "error" } },
    { files: ["**/*.ts"], languageOptions: { parser: ts.parser } },
    {
        files: ["**/*.svelte"],
        languageOptions: { parserOptions: { parser: ts.parser, svelteConfig } },
        plugins: { local, groundwork: { rules: { "component-order": componentOrder } } },
        rules: {
            "groundwork/component-order": "error",
            "svelte/indent": ["error", { indent: 4 }],
            "svelte/no-restricted-html-elements": ["error", { elements: ["p"], message: "Use a div or a semantic section." }],
            "local/css-quotes": "error",
            "local/css-semi": "error"
        }
    },
    {
        files: ["**/*.{ts,svelte}"],
        plugins: { "@typescript-eslint": ts.plugin },
        rules: { "@typescript-eslint/no-unused-vars": "error" }
    },
    // Preserve the four original getters that form part of the JavaScript engine's public API.
    ...Object.entries({ "src/core/history.js": "dirty|canUndo|canRedo", "src/render/map.js": "scale" }).map(([file, names]) => ({
        files: [file],
        rules: { "no-restricted-syntax": ["error", typeImport, {
            ...accessor,
            selector: `Property[kind=/^(get|set)$/], MethodDefinition[kind='set'], MethodDefinition[kind='get']:not([key.name=/^(${names})$/]), AccessorProperty`
        }] }
    })),
    // Road ID sets batch engine work; components do not observe their contents.
    { files: ["src/app/session.svelte.ts"], rules: { "svelte/prefer-svelte-reactivity": "off" } },
    {
        files: ["src/core/**/*.js"],
        rules: {
            "no-restricted-globals": ["error", "document", "window", "localStorage", "HTMLCanvasElement"],
            "no-restricted-imports": ["error", { patterns: ["**/render/**", "**/app/**", "svelte", "svelte/*", "vite"] }]
        }
    },
    { files: ["**/*.css"], plugins: { css, local }, language: "css/css", rules: { "local/css-quotes": "error", "local/css-semi": "error" } },
    { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
    ...yaml.configs["flat/recommended"],
    {
        files: ["**/*.{css,json,yaml,yml}"],
        plugins: { "@stylistic": stylistic },
        rules: { "@stylistic/eol-last": ["error", "never"], "@stylistic/no-trailing-spaces": "error" }
    }
);