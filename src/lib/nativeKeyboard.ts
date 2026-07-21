const KEYBOARD_CONTROL_URL = "http://127.0.0.1:4174";

function isEditable(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  if (target instanceof HTMLInputElement) return !target.disabled && !target.readOnly;
  return target.isContentEditable;
}

function setNativeKeyboardVisible(visible: boolean) {
  // This controller only exists on the mirror. Local browser checks will
  // harmlessly fail, while the kiosk receives the request over loopback.
  void fetch(`${KEYBOARD_CONTROL_URL}/${visible ? "show" : "hide"}`, {
    mode: "no-cors",
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}

export function installNativeKeyboard() {
  const showForEditableTarget = (event: Event) => {
    if (isEditable(event.target)) setNativeKeyboardVisible(true);
  };

  const hideAfterFocusMoves = () => {
    // focusout fires before the next field receives focus. Wait one frame so
    // moving between inputs does not flash the keyboard closed and open.
    window.requestAnimationFrame(() => {
      if (!isEditable(document.activeElement)) setNativeKeyboardVisible(false);
    });
  };

  // pointerdown matters as well as focusin. It reopens the keyboard when a
  // child taps an input that already has focus after the panel was dismissed.
  document.addEventListener("pointerdown", showForEditableTarget, true);
  document.addEventListener("focusin", showForEditableTarget, true);
  document.addEventListener("focusout", hideAfterFocusMoves, true);

  return () => {
    document.removeEventListener("pointerdown", showForEditableTarget, true);
    document.removeEventListener("focusin", showForEditableTarget, true);
    document.removeEventListener("focusout", hideAfterFocusMoves, true);
    setNativeKeyboardVisible(false);
  };
}
