import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "./index.css";
import { App } from "./App.jsx";
import { sidepanelTheme } from "./theme.js";

createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <ConfigProvider theme={sidepanelTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
