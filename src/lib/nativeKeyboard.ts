const KEYBOARD_CONTROL_URL = "http://127.0.0.1:4174";

const TEXT_INPUT_TYPES = new Set(["email", "number", "password", "search", "tel", "text", "url"]);
const visibilityListeners = new Set<(visible: boolean) => void>();
let visibilityRequest = 0;

function needsNativeKeyboard(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !target.disabled && !target.readOnly && TEXT_INPUT_TYPES.has(target.type);
  }
  return target.isContentEditable;
}

function notifyVisibility(visible: boolean) {
  for (const listener of visibilityListeners) listener(visible);
}

function updateNativeKeyboard(visible: boolean) {
  const request = ++visibilityRequest;

  // Hiding the control immediately keeps the app state in sync even if the
  // kiosk controller is restarting or unavailable.
  if (!visible) notifyVisibility(false);

  // This controller only exists on the mirror. Only reveal the dismiss button
  // after the loopback request succeeds, so ordinary desktop browsers do not
  // show a control for a keyboard they do not have.
  void fetch(`${KEYBOARD_CONTROL_URL}/${visible ? "show" : "hide"}`, {
    mode: "no-cors",
    cache: "no-store",
    keepalive: true,
  })
    .then(() => {
      if (visible && request === visibilityRequest) notifyVisibility(true);
    })
    .catch(() => {
      if (visible && request === visibilityRequest) notifyVisibility(false);
    });
}

export function dismissNativeKeyboard() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  updateNativeKeyboard(false);
}

export function installNativeKeyboard(onVisibilityChange: (visible: boolean) => void = () => undefined) {
  visibilityListeners.add(onVisibilityChange);

  const showForEditableTarget = (event: Event) => {
    if (needsNativeKeyboard(event.target)) {
      updateNativeKeyboard(true);
    } else if (event.target instanceof HTMLInputElement) {
      // Date, time, colour and other picker-based inputs should use Chromium's
      // built-in control without leaving the Wayland keyboard over the screen.
      updateNativeKeyboard(false);
    }
  };

  const hideAfterFocusMoves = () => {
    // focusout fires before the next field receives focus. Wait one frame so
    // moving between inputs does not flash the keyboard closed and open.
    window.requestAnimationFrame(() => {
      if (!needsNativeKeyboard(document.activeElement)) updateNativeKeyboard(false);
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
    updateNativeKeyboard(false);
    visibilityListeners.delete(onVisibilityChange);
  };
}
