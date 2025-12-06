import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import { TigerIcon } from "./TigerIcon";

interface ErrorInfo {
  phase: string;
  summary: string | null;
  exitCode: number | null;
}

export interface Position {
  // Vertical anchor - only one should be set
  top?: number;
  bottom?: number;
  // Horizontal anchor - only one should be set
  left?: number;
  right?: number;
}

interface TigerButtonProps {
  isBuilding: boolean;
  hasError: boolean;
  hasWarning: boolean;
  isDisconnected: boolean;
  errorInfo: ErrorInfo | null;
  position: Position;
  onPositionChange: (pos: Position) => void;
  onClick: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  prebuild: "Prebuild Error",
  build: "Build Error",
  runtime: "Runtime Error",
};

/** Extract a one-line summary from error output */
function extractErrorSummary(error: string, phase: string): string | null {
  const lines = error.trim().split("\n").filter(l => l.trim());

  if (phase === "build") {
    // Match Go compiler error: ./file.go:line:col: message
    const goErrorMatch = error.match(/\.\/([^:]+):(\d+):\d+:\s*(.+)/);
    if (goErrorMatch) {
      const [, file, line, message] = goErrorMatch;
      const shortMsg = message.length > 40 ? message.slice(0, 37) + "..." : message;
      return `${file}:${line} ${shortMsg}`;
    }
  }

  if (phase === "runtime") {
    // For runtime, get the last log line (most relevant)
    // Strip Go log timestamp: 2025/11/29 15:26:08 message
    const lastLine = lines[lines.length - 1] || "";
    const logMatch = lastLine.match(/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+)/);
    if (logMatch) {
      const msg = logMatch[1];
      return msg.length > 50 ? msg.slice(0, 47) + "..." : msg;
    }
    // Check for panic
    const panicMatch = error.match(/^panic:\s*(.+)/m);
    if (panicMatch) {
      const msg = panicMatch[1];
      return msg.length > 50 ? msg.slice(0, 47) + "..." : msg;
    }
  }

  // Fallback: first non-empty line if short enough
  const firstLine = lines[0];
  if (firstLine && firstLine.length < 60) {
    return firstLine;
  }

  return null;
}

export function TigerButton(props: TigerButtonProps) {
  const showRunning = () => props.isBuilding && !props.isDisconnected;
  const showExpanded = () => props.hasError && !props.isDisconnected && props.errorInfo;
  const showWarningBadge = () => props.hasWarning && !props.hasError && !props.isDisconnected;

  const phaseLabel = () => {
    if (!props.errorInfo) return "Error";
    return PHASE_LABELS[props.errorInfo.phase] || "Error";
  };

  const summarySuffix = () => {
    // For runtime errors, show exit code instead of log snippet
    if (props.errorInfo?.phase === "runtime" && props.errorInfo.exitCode !== null) {
      return `exit ${props.errorInfo.exitCode}`;
    }
    return props.errorInfo?.summary ?? null;
  };

  // Drag handling with spring physics
  const [isDragging, setIsDragging] = createSignal(false);
  const [displayPos, setDisplayPos] = createSignal(props.position);
  let dragStartPos = { x: 0, y: 0 };
  let startPosition: Position = { ...props.position };
  let hasMoved = false;
  let targetPos = { ...props.position };
  let velocity = { top: 0, bottom: 0, left: 0, right: 0 };
  let animationFrame: number | null = null;

  // Spring physics constants
  const SPRING = 0.3;  // stiffness
  const DAMPING = 0.7; // friction

  const animateSpring = () => {
    const current = displayPos();
    const newPos: Position = {};
    let totalVelocity = 0;
    let totalDelta = 0;

    // Animate horizontal position
    if (targetPos.left !== undefined) {
      const dx = (targetPos.left ?? 0) - (current.left ?? 0);
      velocity.left = (velocity.left + dx * SPRING) * DAMPING;
      newPos.left = (current.left ?? 0) + velocity.left;
      totalVelocity += Math.abs(velocity.left);
      totalDelta += Math.abs(dx);
    } else if (targetPos.right !== undefined) {
      const dx = (targetPos.right ?? 0) - (current.right ?? 0);
      velocity.right = (velocity.right + dx * SPRING) * DAMPING;
      newPos.right = (current.right ?? 0) + velocity.right;
      totalVelocity += Math.abs(velocity.right);
      totalDelta += Math.abs(dx);
    }

    // Animate vertical position
    if (targetPos.top !== undefined) {
      const dy = (targetPos.top ?? 0) - (current.top ?? 0);
      velocity.top = (velocity.top + dy * SPRING) * DAMPING;
      newPos.top = (current.top ?? 0) + velocity.top;
      totalVelocity += Math.abs(velocity.top);
      totalDelta += Math.abs(dy);
    } else if (targetPos.bottom !== undefined) {
      const dy = (targetPos.bottom ?? 0) - (current.bottom ?? 0);
      velocity.bottom = (velocity.bottom + dy * SPRING) * DAMPING;
      newPos.bottom = (current.bottom ?? 0) + velocity.bottom;
      totalVelocity += Math.abs(velocity.bottom);
      totalDelta += Math.abs(dy);
    }

    setDisplayPos(newPos);

    // Keep animating if still moving
    if (totalVelocity > 0.1 || totalDelta > 0.1) {
      animationFrame = requestAnimationFrame(animateSpring);
    } else {
      setDisplayPos(targetPos);
      animationFrame = null;
    }
  };

  const startAnimation = () => {
    if (!animationFrame) {
      animationFrame = requestAnimationFrame(animateSpring);
    }
  };

  // Sync with external position changes (e.g., from other tabs via localStorage)
  // Only sync if the position actually changed from what we have
  createEffect(() => {
    const newTarget = props.position;
    if (!isDragging() && (
      newTarget.top !== targetPos.top ||
      newTarget.bottom !== targetPos.bottom ||
      newTarget.left !== targetPos.left ||
      newTarget.right !== targetPos.right
    )) {
      targetPos = { ...newTarget };
      startAnimation();
    }
  });

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;

    setIsDragging(true);
    hasMoved = false;
    dragStartPos = { x: e.clientX, y: e.clientY };
    startPosition = { ...props.position };
    velocity = { top: 0, bottom: 0, left: 0, right: 0 }; // Reset velocity on grab

    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;

    const deltaX = e.clientX - dragStartPos.x;
    const deltaY = e.clientY - dragStartPos.y;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      hasMoved = true;
    }

    const newPos: Position = {};

    // Handle horizontal movement based on which anchor was used
    if (startPosition.left !== undefined) {
      newPos.left = Math.max(8, Math.min(window.innerWidth - 60, startPosition.left + deltaX));
    } else if (startPosition.right !== undefined) {
      newPos.right = Math.max(8, Math.min(window.innerWidth - 60, startPosition.right - deltaX));
    }

    // Handle vertical movement based on which anchor was used
    if (startPosition.top !== undefined) {
      newPos.top = Math.max(8, Math.min(window.innerHeight - 60, startPosition.top + deltaY));
    } else if (startPosition.bottom !== undefined) {
      newPos.bottom = Math.max(8, Math.min(window.innerHeight - 60, startPosition.bottom - deltaY));
    }

    targetPos = newPos;
    startAnimation();
  };

  const handleMouseUp = () => {
    if (isDragging()) {
      // Determine which quadrant the button is in and snap to closest edge
      // Calculate button's center position in absolute coordinates
      const buttonElement = document.querySelector('.tygor-tiger-btn') as HTMLElement;
      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const distToLeft = centerX;
        const distToRight = window.innerWidth - centerX;
        const distToTop = centerY;
        const distToBottom = window.innerHeight - centerY;

        const finalPos: Position = {};

        // Set horizontal anchor (closest edge)
        if (distToLeft < distToRight) {
          finalPos.left = Math.max(8, rect.left);
        } else {
          finalPos.right = Math.max(8, window.innerWidth - rect.right);
        }

        // Set vertical anchor (closest edge)
        if (distToTop < distToBottom) {
          finalPos.top = Math.max(8, rect.top);
        } else {
          finalPos.bottom = Math.max(8, window.innerHeight - rect.bottom);
        }

        // Save final position BEFORE setting isDragging to false
        // Otherwise the sync effect runs and resets targetPos to old props.position
        props.onPositionChange(finalPos);
        targetPos = finalPos;
      }

      setIsDragging(false);
      if (!hasMoved) {
        props.onClick();
      }
    }
  };

  // Add global mouse listeners
  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    onCleanup(() => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    });
  }

  return (
    <button
      class="tygor-tiger-btn"
      classList={{
        "tygor-tiger-btn--building": showRunning(),
        "tygor-tiger-btn--error": props.hasError && !props.isDisconnected,
        "tygor-tiger-btn--warning": showWarningBadge(),
        "tygor-tiger-btn--disconnected": props.isDisconnected,
        "tygor-tiger-btn--expanded": showExpanded(),
        "tygor-tiger-btn--dragging": isDragging(),
      }}
      style={{
        top: displayPos().top !== undefined ? `${displayPos().top}px` : undefined,
        bottom: displayPos().bottom !== undefined ? `${displayPos().bottom}px` : undefined,
        left: displayPos().left !== undefined ? `${displayPos().left}px` : undefined,
        right: displayPos().right !== undefined ? `${displayPos().right}px` : undefined,
      }}
      onMouseDown={handleMouseDown}
      title={props.isDisconnected ? "Tygor DevTools (disconnected)" : props.hasWarning ? "Tygor DevTools (connection stalled)" : "Open Tygor DevTools"}
    >
      <span class="tygor-tiger-btn-icon">
        <TigerIcon running={showRunning()} />
        <Show when={showWarningBadge()}>
          <span class="tygor-tiger-warning-badge">⚠️</span>
        </Show>
      </span>
      <Show when={showExpanded()}>
        <span class="tygor-tiger-btn-content">
          <span class="tygor-tiger-btn-title">{phaseLabel()}</span>
          <Show when={summarySuffix()}>
            <span class="tygor-tiger-btn-summary">{summarySuffix()}</span>
          </Show>
        </span>
      </Show>
    </button>
  );
}

export { extractErrorSummary };
