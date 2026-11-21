import { parseDesign, serializeDesign } from "./model.js";

export class History {
    constructor(design, limit = 80) {
        this.limit = limit;
        this.reset(design);
    }
    reset(design) {
        this.states = [serializeDesign(design)];
        this.index = 0;
        this.saved = this.states[0];
    }
    get dirty() {
        return this.states[this.index] !== this.saved;
    }
    get canUndo() {
        return this.index > 0;
    }
    get canRedo() {
        return this.index + 1 < this.states.length;
    }
    record(design) {
        const state = serializeDesign(design);
        if (state === this.states[this.index]) return false;
        this.states.splice(this.index + 1);
        this.states.push(state);
        if (this.states.length > this.limit + 1) this.states.shift();
        this.index = this.states.length - 1;
        return true;
    }
    step(forward) {
        if (forward ? !this.canRedo : !this.canUndo) return null;
        this.index += forward ? 1 : -1;
        return parseDesign(this.states[this.index]);
    }
}