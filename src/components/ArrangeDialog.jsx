import { useEffect } from "react";
import { FiPlus, FiXCircle } from "react-icons/fi";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-sm bg-zinc-800/90 px-3 py-2 text-sm font-semibold tracking-wide text-zinc-100 transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-orange-400";

export default function ArrangeDialog() {
  useEffect(function bindArrangementEvents() {
    window.dispatchEvent(new CustomEvent("arrangement:ready"));
  }, []);

  return (
    <section className="mt-4 rounded-md bg-zinc-900/70 p-4 text-zinc-100">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-200">
        Patterns
      </h3>
      <div
        id="patternList"
        className="mt-3 max-h-80 space-y-2 overflow-auto pr-1"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button id="newPatternBtn" type="button" className={primaryBtn}>
          <FiPlus className="h-4 w-4" aria-hidden="true" />
          <span>New</span>
        </button>
        <button id="clearPatternBtn" type="button" className={primaryBtn}>
          <FiXCircle className="h-4 w-4" aria-hidden="true" />
          <span>Clear</span>
        </button>
      </div>
    </section>
  );
}
