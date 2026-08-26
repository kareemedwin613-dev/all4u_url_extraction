import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/applications.css";
import "./styles/resume-upload.css";
import "./styles/antd-dashboard.css";
import "./styles/tailoring.css";
import { App, ConfigurationError } from "./App.jsx";
import { initializeSupabase } from "./services/supabase-client.js";
import { dashboardTheme } from "./theme.js";
import { APP_MESSAGE_CONFIG, APP_NOTIFICATION_CONFIG } from "./shared/notifications.js";

const configured = initializeSupabase();
createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <ConfigProvider theme={dashboardTheme}>
      <AntApp message={APP_MESSAGE_CONFIG} notification={APP_NOTIFICATION_CONFIG}>
        {configured.error ? (
          <ConfigurationError message={configured.error.message} />
        ) : (
          <App
            client={configured.client}
            apiBaseUrl={configured.config.apiBaseUrl}
          />
        )}
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
