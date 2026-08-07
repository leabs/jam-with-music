export function isTypeaheadPrintableKey(event) {
  return (
    event.key.length === 1 &&
    event.key.trim() !== "" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

export function focusNextMatchingMenubarTrigger(root, currentTrigger, key) {
  const triggers = Array.from(root.querySelectorAll('button[id$="-menu-trigger"]')).filter(
    (trigger) => !trigger.disabled,
  );
  const currentIndex = triggers.indexOf(currentTrigger);
  if (currentIndex < 0) return false;

  const wanted = key.toLocaleLowerCase();
  for (let offset = 1; offset <= triggers.length; offset += 1) {
    const trigger = triggers[(currentIndex + offset) % triggers.length];
    const label = (trigger.getAttribute("aria-label") || trigger.textContent || "")
      .trim()
      .toLocaleLowerCase();
    if (label.startsWith(wanted)) {
      trigger.focus();
      return true;
    }
  }
  return false;
}
