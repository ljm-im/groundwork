import { mount } from "svelte";
import "./app/styles/tokens.css";
import "./app/styles/editor.css";
import App from "./app/components/App.svelte";

mount(App, { target: document.getElementById("app")! });