import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { createClient } from "@tygor/client";
import { registry as devserverRegistry } from "../devserver/manifest";
import type { GetStatusResponse } from "../devserver/types";
import { TigerButton, extractErrorSummary, type Position } from "./TigerButton";
import { Sidebar } from "./Sidebar";
import type { TygorRpcError } from "./types";

export type DevToolsMode = "overlay" | "sidebar";
export type SidebarSide = "left" | "right";

interface ConnectionStalledInfo {
  opId: string;
  message: string;
  docsUrl: string;
}

interface DevToolsState {
  status: GetStatusResponse | null;
  rpcError: TygorRpcError | null;
  disconnectedSince: number | null;
  errorSince: number | null;
  connectionStalled: ConnectionStalledInfo | null;
}

const RPC_ERROR_AUTO_DISMISS = 5000;
const SIDEBAR_WIDTH = 300;
const DOCKED_STYLE_ID = "tygor-docked-styles";
const POSITION_STORAGE_KEY = "tygor-tiger-position";
const DEFAULT_POSITION: Position = { top: 16, right: 16 };

// Load position from localStorage
function loadPosition(): Position {
  try {
    const stored = localStorage.getItem(POSITION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate that position has at least one horizontal and one vertical anchor
      const hasHorizontal = typeof parsed.left === "number" || typeof parsed.right === "number";
      const hasVertical = typeof parsed.top === "number" || typeof parsed.bottom === "number";
      if (hasHorizontal && hasVertical) {
        return parsed;
      }
    }
  } catch {}
  return DEFAULT_POSITION;
}

export function DevTools() {
  const [mode, setMode] = createSignal<DevToolsMode>("overlay");
  const [docked, setDocked] = createSignal(false);
  const [position, setPosition] = createSignal<Position>(loadPosition());

  // Compute sidebar side based on tiger button position
  const side = (): SidebarSide => {
    const pos = position();
    // If tiger is anchored to right side, sidebar opens on right
    // If tiger is anchored to left side, sidebar opens on left
    return pos.right !== undefined ? "right" : "left";
  };
  const [state, setState] = createSignal<DevToolsState>({
    status: null,
    rpcError: null,
    disconnectedSince: null,
    errorSince: null,
    connectionStalled: null,
  });

  let rpcErrorTimeout: ReturnType<typeof setTimeout> | null = null;

  // Save position to localStorage when it changes
  createEffect(() => {
    const pos = position();
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
  });

  // Sync position from other tabs via storage event
  createEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === POSITION_STORAGE_KEY && e.newValue) {
        try {
          const newPos = JSON.parse(e.newValue);
          // Validate that position has at least one horizontal and one vertical anchor
          const hasHorizontal = typeof newPos.left === "number" || typeof newPos.right === "number";
          const hasVertical = typeof newPos.top === "number" || typeof newPos.bottom === "number";
          if (hasHorizontal && hasVertical) {
            setPosition(newPos);
          }
        } catch {}
      }
    };

    window.addEventListener("storage", handleStorageChange);
    onCleanup(() => window.removeEventListener("storage", handleStorageChange));
  });

  // Manage docked styles in the main document (outside shadow DOM)
  createEffect(() => {
    const isDocked = docked() && mode() === "sidebar";
    const currentSide = side();

    let styleEl = document.getElementById(DOCKED_STYLE_ID) as HTMLStyleElement | null;

    if (isDocked) {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = DOCKED_STYLE_ID;
        document.head.appendChild(styleEl);
      }

      const prop = currentSide === "right" ? "margin-right" : "margin-left";

      styleEl.textContent = `
        /* Tygor DevTools: Docked mode - shifts page content */
        html {
          ${prop}: ${SIDEBAR_WIDTH}px !important;
          transition: ${prop} 0.2s ease-out;
        }
      `;
    } else {
      styleEl?.remove();
    }
  });

  // Cleanup docked styles on unmount
  onCleanup(() => {
    document.getElementById(DOCKED_STYLE_ID)?.remove();
  });

  // Create client for tygor dev API
  // emitErrors: false prevents devtools' own RPC errors from showing in the UI
  // (e.g., when vite server shuts down, we handle disconnection separately)
  const devClient = createClient(devserverRegistry, { baseUrl: "/__tygor", emitErrors: false });

  // Subscribe to status stream from server
  createEffect(() => {
    const unsubscribe = devClient.Devtools.GetStatus({}).subscribe((result) => {
      if (result.isError || result.isDisconnected) {
        // Error/disconnected - server disconnected
        setState((prev) => ({
          ...prev,
          status: { status: "vite_disconnected" },
          disconnectedSince: prev.disconnectedSince ?? Date.now(),
        }));
        return;
      }

      const data = result.data;
      if (!data) return;

      setState((prev) => {
        const next = { ...prev, status: data };

        if (data.status === "ok") {
          next.disconnectedSince = null;
        } else if (data.status === "error") {
          next.disconnectedSince = null;
          if (prev.status?.status !== "error" || (prev.status?.status === "error" && prev.status.error !== data.error)) {
            next.errorSince = Date.now();
          }
        } else {
          // reloading, starting, disconnected
          if (prev.disconnectedSince === null) {
            next.disconnectedSince = Date.now();
          }
        }

        return next;
      });
    });

    onCleanup(unsubscribe);
  });

  // Listen for RPC errors
  createEffect(() => {
    const handleRpcError = (event: CustomEvent<TygorRpcError>) => {
      if (rpcErrorTimeout) clearTimeout(rpcErrorTimeout);

      setState((prev) => ({ ...prev, rpcError: event.detail }));

      rpcErrorTimeout = setTimeout(() => {
        setState((prev) => ({ ...prev, rpcError: null }));
      }, RPC_ERROR_AUTO_DISMISS);
    };

    window.addEventListener("tygor:rpc-error", handleRpcError as EventListener);

    onCleanup(() => {
      window.removeEventListener("tygor:rpc-error", handleRpcError as EventListener);
      if (rpcErrorTimeout) clearTimeout(rpcErrorTimeout);
    });
  });

  // Listen for connection stalled warnings (HTTP/1.1 limit)
  createEffect(() => {
    const handleConnectionStalled = (event: CustomEvent<ConnectionStalledInfo>) => {
      setState((prev) => ({ ...prev, connectionStalled: event.detail }));
    };

    window.addEventListener("tygor:connection-stalled", handleConnectionStalled as EventListener);

    onCleanup(() => {
      window.removeEventListener("tygor:connection-stalled", handleConnectionStalled as EventListener);
    });
  });

  const isBuilding = () => {
    const s = state().status;
    return s?.status === "reloading" || s?.status === "starting";
  };

  const hasError = () => {
    const s = state().status;
    return s?.status === "error";
  };

  const isDisconnected = () => {
    const s = state().status;
    return s?.status === "disconnected" || s?.status === "vite_disconnected";
  };

  const errorInfo = () => {
    const s = state().status;
    if (s?.status !== "error") return null;
    return {
      phase: s.phase,
      summary: extractErrorSummary(s.error, s.phase),
      exitCode: s.exitCode,
    };
  };

  const toggleMode = () => {
    setMode((m) => (m === "overlay" ? "sidebar" : "overlay"));
  };

  const toggleDocked = () => {
    setDocked((d) => !d);
  };

  const dismissRpcError = () => {
    if (rpcErrorTimeout) clearTimeout(rpcErrorTimeout);
    setState((prev) => ({ ...prev, rpcError: null }));
  };

  return (
    <>
      <Show when={mode() === "overlay"}>
        <TigerButton
          isBuilding={isBuilding()}
          hasError={hasError()}
          hasWarning={state().connectionStalled !== null}
          isDisconnected={isDisconnected()}
          errorInfo={errorInfo()}
          position={position()}
          onPositionChange={setPosition}
          onClick={toggleMode}
        />
      </Show>
      <Show when={mode() === "sidebar"}>
        <Sidebar
          state={state()}
          side={side()}
          docked={docked()}
          onCollapse={toggleMode}
          onToggleDocked={toggleDocked}
          onDismissRpcError={dismissRpcError}
        />
      </Show>
    </>
  );
}
