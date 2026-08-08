import { useEffect, useState } from "react";
import { FiLayers, FiSliders } from "react-icons/fi";

const commandButtonClasses =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-blue)] hover:bg-[var(--color-blue)] hover:text-[var(--color-page)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-blue)] disabled:pointer-events-none disabled:border-[var(--color-border)] disabled:bg-[var(--color-panel)] disabled:text-[var(--color-disabled)]";

function ShellButton({ label, icon, id, action, controls, disabled }) {
  function handleClick() {
    window.dispatchEvent(new CustomEvent(action));
  }

  return (
    <button
      id={id}
      className={commandButtonClasses}
      type="button"
      aria-haspopup="dialog"
      aria-controls={controls}
      aria-expanded="false"
      disabled={disabled}
      onClick={handleClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function AppMenu() {
  const [ready, setReady] = useState(false);

  useEffect(function bindShellReadiness() {
    const readiness = (window.__openBeatsShellReadiness ||= {
      page: false,
      patterns: false,
    });
    const update = () => setReady(Boolean(readiness.page && readiness.patterns));
    window.addEventListener("open-beats:page-consumer-ready", update);
    window.addEventListener("open-beats:patterns-consumer-ready", update);
    update();
    return function cleanup() {
      window.removeEventListener("open-beats:page-consumer-ready", update);
      window.removeEventListener("open-beats:patterns-consumer-ready", update);
    };
  }, []);

  return (
    <div
      className="app-menu flex items-center gap-1"
      role="group"
      aria-label="Application commands"
    >
      <ShellButton
        label="Patterns"
        id="patterns-menu-trigger"
        controls="patternsDialog"
        action="open-beats:patterns"
        disabled={!ready}
        icon={<FiLayers className="h-4 w-4" aria-hidden="true" />}
      />
      <ShellButton
        label="Effects"
        id="effects-menu-trigger"
        controls="effectsDialog"
        action="open-beats:effects"
        disabled={!ready}
        icon={<FiSliders className="h-4 w-4" aria-hidden="true" />}
      />
    </div>
  );
}
