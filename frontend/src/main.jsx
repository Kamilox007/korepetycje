import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";
import { ConfirmProvider } from "./Confirm.jsx";
import "./styles.css";

// Fonty Excalidrawa serwujemy sami (scripts/copy-excalidraw-assets.mjs kopiuje
// je do public/excalidraw/), zamiast pozwolić edytorowi ciągnąć je z unpkg.
// Musi być ustawione, zanim moduł Excalidrawa się załaduje - a ten jest
// ładowany leniwie, więc tutaj jest na to bezpieczne miejsce.
window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </BrowserRouter>
  </React.StrictMode>
);
