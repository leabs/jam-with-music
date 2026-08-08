import { useEffect, useState } from "react";
import { FiAlertTriangle, FiTrash2, FiX } from "react-icons/fi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const cancelBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm font-semibold tracking-wide text-[var(--color-text)] shadow-[0_1px_2px_rgba(23,26,31,0.10)] transition-colors hover:border-[var(--color-blue)] hover:bg-[var(--color-blue)] hover:text-[var(--color-accent-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-blue)]";

const clearBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--color-orange-strong-ink)] bg-[var(--color-orange-strong)] px-3 py-2 text-sm font-semibold tracking-wide text-[var(--color-accent-ink)] shadow-[0_2px_4px_rgba(23,26,31,0.16)] transition-colors hover:border-[var(--color-orange-ink)] hover:bg-[var(--color-orange)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-orange-strong)]";

export default function ClearProjectDialog() {
  const [open, setOpen] = useState(false);

  useEffect(function bindClearProjectDialogEvents() {
    function handleOpen() {
      setOpen(true);
    }

    window.addEventListener("project:clear:open", handleOpen);
    return function cleanup() {
      window.removeEventListener("project:clear:open", handleOpen);
    };
  }, []);

  function handleConfirm() {
    window.dispatchEvent(new CustomEvent("project:clear:confirm"));
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FiAlertTriangle className="h-5 w-5 text-[var(--color-orange-strong-ink)]" aria-hidden="true" />
            <span>Clear Project?</span>
          </DialogTitle>
          <DialogDescription>
            This will delete your current patterns and arrangement. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <button type="button" className={cancelBtn} onClick={() => setOpen(false)}>
            <FiX className="h-4 w-4" aria-hidden="true" />
            <span>Cancel</span>
          </button>
          <button type="button" className={clearBtn} onClick={handleConfirm}>
            <FiTrash2 className="h-4 w-4" aria-hidden="true" />
            <span>Clear Project</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
