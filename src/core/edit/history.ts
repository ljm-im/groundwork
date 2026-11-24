import { type Design } from "../design/v5.ts";
import { parseDesign, serializeDesign } from "../design/model.ts";

import { type SelectionState } from "./types.ts";

export type PromptTarget = { group: "design" } | { group: "geoNodes" | "sections"; id: string };

export function promptOwner(design: Design, target: PromptTarget): { prompt?: string } {
    return target.group === "design" ? design : design[target.group].find(object => object.id === target.id)!;
}

interface EditStep { prompt?: PromptTarget; before?: SelectionState; after?: SelectionState }

export class History {
    private edits: EditStep[] = [];
    declare limit: number;
    declare states: string[];
    declare index: number;
    declare saved: string;

    constructor(design: Design, limit = 80) {
        this.limit = limit;
        this.reset(design);
    }
    reset(design: Design) {
        this.states = [serializeDesign(design)];
        this.edits = [];
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
    editStep(forward: boolean): EditStep | undefined {
        return this.edits[forward ? this.index : this.index - 1];
    }
    record(design: Design, edit: EditStep = {}) {
        const state = serializeDesign(design);
        if (state === this.states[this.index]) return false;
        this.states.splice(this.index + 1);
        this.edits.splice(this.index, this.edits.length, edit);
        this.states.push(state);
        if (this.states.length > this.limit + 1) {
            this.states.shift();
            this.edits.shift();
        }
        this.index = this.states.length - 1;
        return true;
    }
    peek(forward: boolean) {
        if (forward ? !this.canRedo : !this.canUndo) return null;
        return parseDesign(this.states[this.index + (forward ? 1 : -1)], true);
    }
    step(forward: boolean) {
        const restored = this.peek(forward);
        if (restored) this.index += forward ? 1 : -1;
        return restored;
    }
}