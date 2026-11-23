import { type Design, type Section } from "../../core/design/v5.ts";
import { promptOwner, type PromptTarget } from "../../core/edit/history.ts";

export type DescriptionTarget = PromptTarget | { group: "sections"; id: string };

export function descriptionOwner(design: Design, target: DescriptionTarget) {
    if (target.group !== "sections") return promptOwner(design, target);
    // The reader already retains optional properties on a section, including a prompt.
    const section: Section & { prompt?: string } = design.sections.find(item => item.id === target.id)!;
    return section;
}