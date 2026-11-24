const commitEvent = "groundwork:commit-input";

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