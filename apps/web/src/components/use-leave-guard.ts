"use client";

import { useEffect } from "react";

const eventName = "recall:before-leave";
export function canLeavePage() {
  return window.dispatchEvent(new Event(eventName, { cancelable: true }));
}

export function useLeaveGuard(dirty: boolean, saving: boolean) {
  useEffect(() => {
    if (!dirty && !saving) return;
    function ask(event: Event) {
      if (saving || !window.confirm("Leave without saving your changes?")) event.preventDefault();
    }
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    function click(event: MouseEvent) {
      // Opening another tab does not discard this page's work.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const anchor = (event.target as Element).closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href) return;
      if (!canLeavePage()) { event.preventDefault(); event.stopPropagation(); }
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    function traverse(event: Event) {
      if ((event as Event & { navigationType?: string }).navigationType === "traverse" && event.cancelable && !canLeavePage()) event.preventDefault();
    }
    window.addEventListener(eventName, ask);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", traverse);
    return () => {
      window.removeEventListener(eventName, ask); window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", traverse);
    };
  }, [dirty, saving]);
}
