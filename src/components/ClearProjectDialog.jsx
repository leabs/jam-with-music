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
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#A8ADB5] bg-[#F5F6F7] px-3 py-2 text-sm font-semibold tracking-wide text-[#171A1F] transition-colors hover:border-[#00A6D6] hover:bg-[#00A6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171A1F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#00B578]";

const clearBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#C83D3D] bg-[#C83D3D] px-3 py-2 text-sm font-semibold tracking-wide text-white shadow-[0_2px_0_rgba(23,26,31,0.16)] transition-colors hover:border-[#171A1F] hover:bg-[#9C302F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171A1F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#00B578]";

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
      <DialogContent className="max-w-md border-[#A8ADB5] bg-[#F5F6F7] p-5 text-[#171A1F]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FiAlertTriangle className="h-5 w-5 text-[#C83D3D]" aria-hidden="true" />
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
