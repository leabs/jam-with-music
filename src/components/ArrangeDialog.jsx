import { useEffect, useState } from "react";
import { FiLayers, FiPlus, FiXCircle } from "react-icons/fi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export default function ArrangeDialog() {
  const [open, setOpen] = useState(false);

  useEffect(
    function bindArrangementEvents() {
      if (!open) return undefined;

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

  return (
    <section className="pattern-manager" aria-label="Pattern management">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className="pattern-manager-trigger">
            <span className="pattern-manager-trigger-label">
              <FiLayers className="h-4 w-4" aria-hidden="true" />
              <strong>Patterns</strong>
            </span>
            <span className="pattern-manager-summary">Pattern 1 · 1 total</span>
            <span className="pattern-manager-open">Manage</span>
          </button>
        </DialogTrigger>

        <DialogContent className="pattern-manager-dialog">
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
          --pattern-chassis: #e3e6eb;
          --pattern-surface: #f5f6f7;
          --pattern-ink: #171a1f;
          --pattern-gray: #a8adb5;
          --pattern-green: #00b578;
          --pattern-blue: #00a6d6;
          --pattern-orange: #f05a28;
          min-width: 0;
          color: var(--pattern-ink);
        }

        .pattern-manager-trigger {
          display: flex;
          width: 100%;
          height: 44px;
          min-width: 0;
          align-items: center;
          gap: 12px;
          padding: 0 12px;
          color: var(--pattern-ink);
          border: 0;
          background: var(--pattern-chassis);
          box-shadow: inset 0 0 0 1px var(--pattern-gray);
          text-align: left;
        }

        .pattern-manager-trigger:hover {
          background: var(--pattern-blue);
        }

        .pattern-manager-trigger:focus-visible,
        .pattern-manager-action:focus-visible,
        .arrange-pattern-button:focus-visible,
        .arrange-row-action:focus-visible,
        .arrange-repeat-input:focus-visible {
          outline: 3px solid var(--pattern-ink, #171a1f);
          outline-offset: 2px;
          box-shadow: 0 0 0 6px var(--pattern-green, #00b578);
        }

        .pattern-manager-trigger-label,
        .pattern-manager-action {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .pattern-manager-trigger-label {
          flex: 0 0 auto;
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .pattern-manager-summary {
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
          font-size: 0.78rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pattern-manager-open {
          flex: 0 0 auto;
          font-size: 0.72rem;
          font-weight: 800;
        }

        .pattern-manager-dialog {
          --pattern-chassis: #e3e6eb;
          --pattern-surface: #f5f6f7;
          --pattern-ink: #171a1f;
          --pattern-gray: #a8adb5;
          --pattern-green: #00b578;
          --pattern-blue: #00a6d6;
          --pattern-orange: #f05a28;
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
          background: var(--pattern-green);
        }

        .pattern-manager-list .arrange-row-action.is-delete:hover,
        .pattern-manager-list .arrange-row-action.is-delete:focus-visible,
        .pattern-manager-action.is-destructive:hover,
        .pattern-manager-action.is-destructive:focus-visible {
          color: white;
          background: #c83d3d;
        }

        .pattern-manager-list .arrange-row-action:disabled {
          color: #6e737b;
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
          background: var(--pattern-orange);
        }

        @media (max-width: 640px) {
          .pattern-manager-trigger {
            gap: 8px;
            padding: 0 8px;
          }

          .pattern-manager-open {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          .pattern-manager-dialog {
            padding: 16px;
          }

          .pattern-manager-list .arrange-row {
            grid-template-columns: 24px minmax(0, 1fr) 72px;
            gap: 4px;
          }

          .pattern-manager-list .arrange-row-actions {
            flex: 0 0 90px;
            flex-wrap: wrap;
            gap: 2px;
            grid-column: 2 / 4;
            justify-content: flex-end;
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
