import { type Design } from "../design/v5.ts";
import { parseDesign, serializeDesign } from "../design/model.ts";

export type PromptTarget = { group: "design" } | { group: "buildings" | "edges" | "nodes"; id: string };

export function promptOwner(design: Design, target: PromptTarget): { prompt?: string } {
    return target.group === "design" ? design : design[target.group].find(object => object.id === target.id)!;
}

export class History {
    private promptSteps: (PromptTarget | undefined)[] = [];
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
        this.promptSteps = [];
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
    promptStep(forward: boolean) {
        return this.promptSteps[forward ? this.index : this.index - 1];
    }
    record(design: Design, target?: PromptTarget) {
        const state = serializeDesign(design);
        if (state === this.states[this.index]) return false;
        this.states.splice(this.index + 1);
        this.promptSteps.splice(this.index, this.promptSteps.length, target);
        this.states.push(state);
        if (this.states.length > this.limit + 1) {
            this.states.shift();
            this.promptSteps.shift();
        }
        this.index = this.states.length - 1;
        return true;
    }
    peek(forward: boolean) {
        if (forward ? !this.canRedo : !this.canUndo) return null;
        return parseDesign(this.states[this.index + (forward ? 1 : -1)]);
    }
    step(forward: boolean) {
        const restored = this.peek(forward);
        if (restored) this.index += forward ? 1 : -1;
        return restored;
    }
}