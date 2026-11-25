import { copyAt, type Address } from "./design/address.ts";
import { resolveDesign } from "./design/parameters.ts";
import { validateGeo } from "./design/validateGeo.ts";
import { type Design, type ResolvedDesign, type Point } from "./design/v5.ts";
import { type Terrain, type Issue } from "./design/results.ts";
import { TerrainCache } from "./terrain/cache.ts";
import { terrainIssues } from "./checks/terrain.ts";
import { type WorkPool } from "./math/work.ts";

export type ProjectView = { design: ResolvedDesign } & Pick<Project, "terrain" | "issues">;

export class Project {
    declare design: Design;
    declare resolved: ResolvedDesign;
    declare terrain: Terrain;
    declare issues: Issue[];

    private readonly cache: TerrainCache;
    private readonly pool?: WorkPool;
    private structural: Issue[] = [];
    private evaluated(design: ResolvedDesign) {
        const problems = validateGeo(design, true);
        const broken = new Set(problems.flatMap(p => p.location?.kind === "geo" ? [p.location.id] : []));
        this.structural = problems.map(({ location, message }) => {
            const n = location?.kind === "geo" ? design.geoNodes[location.index!] : undefined;
            const c = n?.construction;
            const ref = c?.type === "strip" ? design.geoNodes.findLast(v => c.of.some(id => id === v.id))?.construction : c;
            const point: Point = ref?.type === "free" ? ref.paths[0].nodes[0].p : [0, 0];
            return { kind: "geo-reference", severity: "error", point, geoNode: n?.id, label: n?.label, message, location };
        });
        return broken.size ? { ...design, geoNodes: design.geoNodes.map(n => broken.has(n.id) ? { ...n, disabled: true as const } : n) } : design;
    }

    constructor(design: Design, cache = new TerrainCache(), resolved?: ResolvedDesign, pool?: WorkPool) {
        this.cache = cache;
        this.pool = pool;
        this.design = design;
        this.update(resolved);
    }

    update(resolved = resolveDesign(this.design)) {
        this.resolved = resolved;
        this.terrain = this.cache.generateResolved(this.evaluated(this.resolved), this.pool);
        const broken = new Set(this.structural.map(i => i.geoNode));
        this.issues = [...this.structural, ...terrainIssues(this.resolved, this.terrain).filter(i => !broken.has(i.geoNode))];
    }

    withPrompt(path: Address, value: string | undefined): Project {
        const next: Project = Object.assign(Object.create(Project.prototype), this);
        next.design = copyAt(this.design, path, value);
        next.resolved = copyAt(this.resolved, path, value);
        return next;
    }

    view(): ProjectView {
        return { design: this.resolved, terrain: this.terrain, issues: this.issues };
    }

    inputAt(owner: string, field: string, point: Point) {
        return this.cache.inputAt(this.resolved, this.terrain, owner, field, point);
    }

    viewBelow(id: string): ProjectView {
        const design = { ...this.resolved, geoNodes: this.resolved.geoNodes.slice(0, this.resolved.geoNodes.findIndex(n => n.id === id)) };
        const broken = new Set(this.structural.map(i => i.geoNode));
        const terrain = this.cache.preview({ ...design, geoNodes: design.geoNodes.map(n => broken.has(n.id) ? { ...n, disabled: true } : n) }, this.pool);
        return { design, terrain, issues: [] };
    }
}