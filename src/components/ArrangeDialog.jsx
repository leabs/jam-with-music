import { useEffect, useState } from "react";
import { FiPlus, FiXCircle } from "react-icons/fi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export default function ArrangeDialog() {
  const [open, setOpen] = useState(false);

  useEffect(
    function mirrorPatternDialogState() {
      const trigger = document.getElementById("patterns-menu-trigger");
      trigger?.setAttribute("aria-expanded", open ? "true" : "false");
      return function cleanup() {
        trigger?.setAttribute("aria-expanded", "false");
      };
    },
    [open]
  );

  useEffect(
    function bindArrangementEvents() {
      function handleOpen() {
        setOpen(true);
      }

      function handleEffectsOpen() {
        setOpen(false);
      }

      window.addEventListener("open-beats:patterns-ready", handleOpen);
      window.addEventListener("open-beats:effects", handleEffectsOpen);
      const readiness = (window.__openBeatsShellReadiness ||= {
        page: false,
        patterns: false,
      });
      readiness.patterns = true;
      window.dispatchEvent(new CustomEvent("open-beats:patterns-consumer-ready"));

      if (!open) {
        return function cleanupClosed() {
          window.removeEventListener("open-beats:patterns-ready", handleOpen);
          window.removeEventListener("open-beats:effects", handleEffectsOpen);
        };
      }

      let readinessFrame;

      function requestArrangementRender() {
        if (typeof window.renderPatternManager === "function") {
          window.renderPatternManager();
          return;
        }
        window.dispatchEvent(new CustomEvent("arrangement:ready"));
      }

      function renderWhenMounted() {
        const patternList = document.getElementById("patternList");
        if (!patternList || !patternList.isConnected) {
          readinessFrame = window.requestAnimationFrame(renderWhenMounted);
          return;
        }

        requestArrangementRender();
        if (patternList.childElementCount === 0) {
          readinessFrame = window.requestAnimationFrame(renderWhenMounted);
        }
      }

      readinessFrame = window.requestAnimationFrame(renderWhenMounted);

      return function cleanup() {
        window.cancelAnimationFrame(readinessFrame);
        window.removeEventListener("open-beats:patterns-ready", handleOpen);
        window.removeEventListener("open-beats:effects", handleEffectsOpen);
      };
    },
    [open]
  );

  function handleClearClickCapture(event) {
    const confirmed = window.confirm(
      "Clear the current pattern? This cannot be undone."
    );
    if (!confirmed) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
  }

  function handleCloseAutoFocus(event) {
    event.preventDefault();
    document.getElementById("patterns-menu-trigger")?.focus();
  }

  return (
    <section className="pattern-manager" aria-label="Pattern management">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          id="patternsDialog"
          className="pattern-manager-dialog"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>Patterns</DialogTitle>
            <DialogDescription>
              Select, reorder, repeat, duplicate, add, or remove patterns.
            </DialogDescription>
          </DialogHeader>

          <div id="patternList" className="pattern-manager-list" />

          <div className="pattern-manager-actions">
            <button id="newPatternBtn" type="button" className="pattern-manager-action">
              <FiPlus className="h-4 w-4" aria-hidden="true" />
              <span>New pattern</span>
            </button>
            <button
              id="clearPatternBtn"
              type="button"
              className="pattern-manager-action is-destructive"
              onClickCapture={handleClearClickCapture}
            >
              <FiXCircle className="h-4 w-4" aria-hidden="true" />
              <span>Clear pattern</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        .pattern-manager {
          --pattern-chassis: var(--color-page, #eceae4);
          --pattern-surface: var(--color-panel, #ffffff);
          --pattern-ink: var(--color-text, #171a1f);
          --pattern-gray: var(--color-border, #82878d);
          --pattern-on-accent: var(--color-accent-ink, #171a1f);
          --pattern-green: var(--color-green, #27ae60);
          --pattern-blue: var(--color-blue, #2f80ed);
          --pattern-orange: var(--color-orange, #f2994a);
          --pattern-destructive: var(--color-orange-strong, #f57c00);
          min-width: 0;
          color: var(--pattern-ink);
        }

        .pattern-manager-action:focus-visible,
        .arrange-pattern-button:focus-visible,
        .arrange-row-action:focus-visible,
        .arrange-repeat-input:focus-visible {
          outline: 3px solid var(--pattern-ink, #171a1f);
          outline-offset: 2px;
          box-shadow: 0 0 0 6px var(--pattern-blue, #2f80ed);
        }

        .pattern-manager-action {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .pattern-manager-dialog {
          --pattern-chassis: var(--color-page, #eceae4);
          --pattern-surface: var(--color-panel, #ffffff);
          --pattern-ink: var(--color-text, #171a1f);
          --pattern-gray: var(--color-border, #82878d);
          --pattern-on-accent: var(--color-accent-ink, #171a1f);
          --pattern-green: var(--color-green, #27ae60);
          --pattern-blue: var(--color-blue, #2f80ed);
          --pattern-orange: var(--color-orange, #f2994a);
          --pattern-destructive: var(--color-orange-strong, #f57c00);
          max-height: min(720px, calc(100dvh - 1.5rem));
          grid-template-rows: auto minmax(0, 1fr) auto;
          overflow: hidden;
        }

        .pattern-manager-list {
          display: flex;
          min-height: 132px;
          flex-direction: column;
          gap: 8px;
          overflow: auto;
          padding: 2px;
        }

        .pattern-manager-list .arrange-row {
          display: grid;
          min-width: 0;
          grid-template-columns: 28px minmax(180px, 1fr) 72px auto;
          align-items: stretch;
          gap: 8px;
          padding: 0;
          color: var(--pattern-ink);
          border: 1px solid var(--pattern-gray);
          border-radius: 8px;
          background: var(--pattern-surface);
        }

        .pattern-manager-list .arrange-drag-handle {
          display: flex;
          width: auto;
          min-height: 44px;
          align-items: center;
          justify-content: center;
          color: var(--pattern-ink);
        }

        .pattern-manager-list .arrange-pattern-card,
        .pattern-manager-list .arrange-row-actions {
          display: flex;
          min-width: 0;
          align-items: stretch;
        }

        .pattern-manager-list .arrange-pattern-card {
          gap: 4px;
          padding: 0;
          border: 0;
          background: transparent;
        }

        .pattern-manager-list .arrange-pattern-card.is-selected {
          background: var(--pattern-blue);
        }

        .pattern-manager-list .arrange-pattern-card.is-selected,
        .pattern-manager-list .arrange-pattern-card.is-selected .arrange-pattern-button {
          color: var(--pattern-on-accent);
        }

        .pattern-manager-list .arrange-pattern-button,
        .pattern-manager-list .arrange-row-action,
        .pattern-manager-list .arrange-repeat-input,
        .pattern-manager-action {
          min-height: 44px;
          color: var(--pattern-ink);
        }

        .pattern-manager-list .arrange-pattern-button {
          min-width: 0;
          flex: 1 1 auto;
          padding: 0 10px;
          border: 0;
          background: transparent;
        }

        .pattern-manager-list .arrange-row-action {
          width: 44px;
          border: 0;
          background: transparent;
        }

        .pattern-manager-list .arrange-row-action:hover {
          color: var(--pattern-on-accent);
          background: var(--pattern-green);
        }

        .pattern-manager-list .arrange-row-action.is-delete:hover:not(:disabled),
        .pattern-manager-list .arrange-row-action.is-delete:focus-visible,
        .pattern-manager-action.is-destructive:hover:not(:disabled),
        .pattern-manager-action.is-destructive:focus-visible {
          color: var(--pattern-on-accent);
          background: var(--pattern-destructive);
        }

        .pattern-manager-list .arrange-row-action:disabled {
          color: var(--color-disabled, #6d737a);
          background: transparent;
          cursor: not-allowed;
        }

        .pattern-manager-list .arrange-repeat-input {
          width: 72px;
          padding: 0 8px;
          border: 1px solid var(--pattern-gray);
          border-radius: 6px;
          background: var(--pattern-surface);
        }

        .pattern-manager-list .arrange-times-label {
          display: flex;
          width: auto;
          align-items: center;
          padding-right: 12px;
          color: var(--pattern-ink);
        }

        .pattern-manager-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
          border-top: 1px solid var(--pattern-gray);
        }

        .pattern-manager-action {
          justify-content: center;
          padding: 0 14px;
          font-weight: 800;
          border: 1px solid var(--pattern-gray);
          border-radius: 6px;
          background: var(--pattern-surface);
        }

        #newPatternBtn:hover {
          color: var(--pattern-on-accent);
          background: var(--pattern-orange);
        }

        @media (max-width: 640px) {
          .pattern-manager-dialog {
            padding: 16px;
          }

          .pattern-manager-list .arrange-row {
            grid-template-columns: 24px minmax(0, 1fr) 72px;
            gap: 4px;
          }

          .pattern-manager-list .arrange-pattern-card {
            flex-wrap: wrap;
          }

          .pattern-manager-list .arrange-pattern-button {
            flex: 1 0 100%;
            padding: 0 6px;
          }

          .pattern-manager-list .arrange-row-actions {
            flex: 0 0 90px;
            flex-wrap: wrap;
            gap: 2px;
            grid-column: 2 / 4;
            justify-content: flex-end;
            margin-left: auto;
          }

          .pattern-manager-list .arrange-repeat-input {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
          }

          .pattern-manager-list .arrange-times-label {
            display: none;
          }

          .pattern-manager-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pattern-manager *,
          .pattern-manager *::before,
          .pattern-manager *::after {
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </section>
  );
}
