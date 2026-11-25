const commitEvent = "groundwork:commit-input";

export function isEditableText(target: EventTarget | null) {
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
    return target instanceof HTMLInputElement && !target.disabled && !target.readOnly &&
        ["text", "search", "email", "url", "tel", "password", "number"].includes(target.type);
}

export function pendingInput<T extends HTMLElement>(element: T, commit: (element: T) => void) {
    function flush() {
        commit(element);
    }
    element.addEventListener(commitEvent, flush);
    return {
        update(next: (element: T) => void) {
            commit = next;
        },
        destroy: () => element.removeEventListener(commitEvent, flush)
    };
}

export function commitFocusedInput() {
    if (typeof document !== "undefined") document.activeElement?.dispatchEvent(new Event(commitEvent));
}