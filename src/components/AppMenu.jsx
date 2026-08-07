import { useEffect, useRef, useState } from "react";
import { FiLayers, FiSliders } from "react-icons/fi";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "./ui/menubar";
import {
  focusNextMatchingMenubarTrigger,
  isTypeaheadPrintableKey,
} from "./menubar-typeahead";

function ShellMenu({ label, icon, triggerId, action, children, disabled }) {
  const [pendingAction, setPendingAction] = useState(null);

  function handleOpenChangeComplete(open) {
    if (open || !pendingAction) return;
    const eventName = pendingAction;
    setPendingAction(null);
    window.dispatchEvent(new CustomEvent(eventName));
  }

  return (
    <MenubarMenu onOpenChangeComplete={handleOpenChangeComplete}>
      <MenubarTrigger id={triggerId} disabled={disabled}>
        {icon}
        {label}
      </MenubarTrigger>
      <MenubarContent>
        <MenubarItem onClick={() => setPendingAction(action)}>{children}</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

export default function AppMenu() {
  const [ready, setReady] = useState(false);
  const menubarRef = useRef(null);

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

  function handleMenubarKeyDown(event) {
    if (!isTypeaheadPrintableKey(event)) return;
    const trigger = event.target.closest?.('button[id$="-menu-trigger"]');
    if (!trigger || !menubarRef.current?.contains(trigger)) return;
    if (focusNextMatchingMenubarTrigger(menubarRef.current, trigger, event.key)) {
      event.preventDefault();
    }
  }

  return (
    <nav className="app-menu" aria-label="Application menu">
      <Menubar
        ref={menubarRef}
        modal={false}
        aria-label="Application menu"
        onKeyDown={handleMenubarKeyDown}
      >
        <ShellMenu
          label="Patterns"
          triggerId="patterns-menu-trigger"
          action="open-beats:patterns"
          disabled={!ready}
          icon={<FiLayers className="mr-2 h-4 w-4" aria-hidden="true" />}
        >
          <FiLayers className="mr-2 h-4 w-4" aria-hidden="true" />
          Open Patterns
        </ShellMenu>
        <ShellMenu
          label="Effects"
          triggerId="effects-menu-trigger"
          action="open-beats:effects"
          disabled={!ready}
          icon={<FiSliders className="mr-2 h-4 w-4" aria-hidden="true" />}
        >
          <FiSliders className="mr-2 h-4 w-4" aria-hidden="true" />
          Open Effects
        </ShellMenu>
      </Menubar>
    </nav>
  );
}
