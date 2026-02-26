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
  "inline-flex items-center gap-1.5 rounded-sm bg-zinc-800/90 px-3 py-2 text-sm font-semibold tracking-wide text-zinc-100 transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-orange-400";

const clearBtn =
  "inline-flex items-center gap-1.5 rounded-sm bg-red-900/90 px-3 py-2 text-sm font-semibold tracking-wide text-red-100 transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-400";

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
      <DialogContent className="max-w-md border-zinc-700/90 bg-zinc-950 p-5 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FiAlertTriangle className="h-5 w-5 text-red-300" aria-hidden="true" />
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
