import "./style.css";
import { initApp } from "./app.js";

const root = document.getElementById("app");
if (!root) throw new Error("contextscope: #app root element not found");
initApp(root);
