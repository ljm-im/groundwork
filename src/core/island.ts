import { resolveDesign } from "./design/parameters.ts";
import { validateGeo } from "./design/validateGeo.ts";
import { type Design, type ResolvedDesign, type Point } from "./design/v5.ts";
import { type Terrain, type Tree, type Route, type Graded, type Issue } from "./design/results.ts";
import { TerrainCache } from "./terrain/cache.ts";
import { terrainSurface } from "./terrain/surface.ts";
import { plantTrees, visibleTrees } from "./vegetation/vegetation.ts";
import { routeAll } from "./roads/routing.ts";
import { gradeRoads } from "./roads/profiles.ts";
import { networkProfiles } from "./roads/networkProfiles.ts";
import { terrainIssues } from "./checks/terrain.ts";
import { validateDesign, validateRoads } from "./checks/validation.ts";

export type IslandView = { design: ResolvedDesign } & Pick<Island, "terrain" | "graded" | "routes" | "issues" | "trees">;

export class Island {
    declare design: Design;
    declare resolved: ResolvedDesign;
    declare terrain: Terrain;
    declare treeCandidates: Tree[];
    declare routes: Route[];
    declare graded: Graded;
    declare trees: Tree[];
    declare issues: Issue[];

    private readonly cache: TerrainCache;

    private padKey = "";
    private buildingGeometry(d: ResolvedDesign) {
        return JSON.stringify(d.buildings.map(b => [b.id, b.shape, b.center, b.size, b.radius, b.inner, b.angle, b.pad, b.blockMargin, b.summit]));
    }
    private structural: Issue[] = [];
    private evaluated(design: ResolvedDesign) {
        const problems = validateGeo(design, true);
        const broken = new Set(problems.map(p => p.index));
        this.structural = problems.map(({ index, message }) => {
            const n = index === undefined ? undefined : design.geoNodes[index];
            const c = n?.construction;
            const ref = c?.type === "strip" ? design.geoNodes.findLast(v => c.of.some(id => id === v.id))?.construction : c;
            const point: Point = ref?.type === "free" ? ref.paths[0].nodes[0].p : [0, 0];
            return { kind: "geo-reference", severity: "error", point, geoNode: n?.id, label: n?.name, message };
        });
        return broken.size ? { ...design, geoNodes: design.geoNodes.map((n, i) => broken.has(i) ? { ...n, disabled: true as const } : n) } : design;
    }

    constructor(design: Design, cache = new TerrainCache()) {
        this.cache = cache;
        this.design = design;
        this.resolved = resolveDesign(design);
        this.padKey = this.buildingGeometry(this.resolved);
        this.terrain = cache.generateResolved(this.evaluated(this.resolved));
        this.treeCandidates = plantTrees(this.resolved, this.terrain);
        this.route();
    }

    view(): IslandView {
        return { design: this.resolved, terrain: this.terrain, routes: this.routes, graded: this.graded, trees: this.trees, issues: this.issues };
    }

    inputAt(owner: string, field: string, point: Point) {
        return this.cache.inputAt(this.resolved, this.terrain, owner, field, point);
    }

    viewBelow(id: string): IslandView {
        const design = { ...this.resolved, geoNodes: this.resolved.geoNodes.slice(0, this.resolved.geoNodes.findIndex(n => n.id === id)),
            buildings: [], nodes: [], edges: [], labels: [], vegetation: { ...this.design.vegetation, rooms: [], yardTree: { center: [0, 0] as Point, radius: 0 } } };
        const broken = new Set(this.structural.map(i => i.geoNode));
        const terrain = this.cache.preview({ ...design, geoNodes: design.geoNodes.map(n => broken.has(n.id) ? { ...n, disabled: true } : n) });
        return { design, terrain, graded: { heights: terrain.heights, weight: new Float32Array(terrain.grid.size) }, routes: [], issues: [], trees: [] };
    }

    reroute(ids?: ReadonlySet<string>) {
        this.resolved = resolveDesign(this.design);
        const pads = this.buildingGeometry(this.resolved);
        if (this.cache.missingResolved(this.resolved) || pads !== this.padKey) {
            this.terrain = this.cache.generateResolved(this.evaluated(this.resolved));
            this.treeCandidates = plantTrees(this.resolved, this.terrain);
            ids = undefined;
        }
        this.padKey = pads;
        this.route(ids);
    }

    private route(ids?: ReadonlySet<string>) {
        const { resolved: design, terrain } = this;
        this.routes = networkProfiles(design, terrain, routeAll(design, terrain, ids ? this.routes : [], ids));
        this.finish();
    }

    variables(release = false) {
        this.resolved = resolveDesign(this.design);
        this.terrain = this.cache.generateResolved(this.evaluated(this.resolved));
        this.padKey = this.buildingGeometry(this.resolved);
        if (release) {
            this.treeCandidates = plantTrees(this.resolved, this.terrain);
            this.route();
        }
        else {
            const edges = new Map(this.resolved.edges.map(e => [e.id, e]));
            this.routes = networkProfiles(this.resolved, this.terrain, this.routes.map(r => ({ ...r, edge: edges.get(r.id)! })), () => true);
            this.finish();
        }
    }

    replant() {
        this.resolved = resolveDesign(this.design);
        this.treeCandidates = plantTrees(this.resolved, this.terrain);
        this.filterTrees();
    }

    private filterTrees() {
        const surfaceAt = terrainSurface(this.terrain, this.graded.heights);
        this.trees = visibleTrees(this.treeCandidates, this.terrain, this.graded, this.routes, surfaceAt);
    }

    finish() {
        this.graded = gradeRoads(this.resolved, this.terrain, this.routes);
        this.filterTrees();
        this.issues = validateRoads(this.resolved, this.terrain, this.routes);
        const broken = new Set(this.structural.map(i => i.geoNode));
        this.issues.push(...this.structural, ...terrainIssues(this.resolved, this.terrain, this.graded.heights).filter(i => !broken.has(i.geoNode)));
        this.issues.push(...validateDesign(this.resolved, this.terrain, this.graded.heights, this.routes));
    }
}