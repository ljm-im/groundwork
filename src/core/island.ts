import { validateGeo } from "./design/validateGeo.ts";
import { type Design, type Point } from "./design/v5.ts";
import { type Terrain, type Tree, type Route, type Graded, type Issue } from "./design/results.ts";
import { TerrainCache } from "./terrain/cache.ts";
import { terrainSurface } from "./terrain/surface.ts";
import { plantTrees, visibleTrees } from "./vegetation/vegetation.ts";
import { routeAll } from "./roads/routing.ts";
import { gradeRoads } from "./roads/profiles.ts";
import { networkProfiles } from "./roads/networkProfiles.ts";
import { terrainIssues } from "./checks/terrain.ts";
import { validateDesign, validateRoads } from "./checks/validation.ts";

export type IslandView = Pick<Island, "design" | "terrain" | "graded" | "routes" | "issues" | "trees">;

export class Island {
    declare design: Design;
    declare terrain: Terrain;
    declare treeCandidates: Tree[];
    declare routes: Route[];
    declare graded: Graded;
    declare trees: Tree[];
    declare issues: Issue[];

    private readonly cache: TerrainCache;

    private structural: Issue[] = [];
    private evaluated(design: Design) {
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
        this.terrain = cache.generate(this.evaluated(design));
        this.treeCandidates = plantTrees(design, this.terrain);
        this.reroute();
    }

    inputAt(owner: string, field: string, point: Point) {
        return this.cache.inputAt(this.design, this.terrain, owner, field, point);
    }

    viewThrough(id: string): IslandView {
        const design = { ...this.design, geoNodes: this.design.geoNodes.slice(0, this.design.geoNodes.findIndex(n => n.id === id) + 1),
            buildings: [], nodes: [], edges: [], labels: [], vegetation: { ...this.design.vegetation, rooms: [], yardTree: { center: [0, 0] as Point, radius: 0 } } };
        const broken = new Set(this.structural.map(i => i.geoNode));
        const terrain = this.cache.preview({ ...design, geoNodes: design.geoNodes.map(n => broken.has(n.id) ? { ...n, disabled: true } : n) });
        return { design, terrain, graded: { heights: terrain.heights, weight: new Float32Array(terrain.grid.size) }, routes: [], issues: [], trees: [] };
    }

    reroute(ids?: ReadonlySet<string>) {
        const { design, terrain } = this;
        this.routes = networkProfiles(design, terrain, routeAll(design, terrain, ids ? this.routes : [], ids));
        this.finish();
    }

    variables(release = false) {
        this.terrain = this.cache.generate(this.evaluated(this.design));
        if (release) {
            this.treeCandidates = plantTrees(this.design, this.terrain);
            this.reroute();
        }
        else {
            this.routes = networkProfiles(this.design, this.terrain, this.routes, () => true);
            this.finish();
        }
    }

    replant() {
        this.treeCandidates = plantTrees(this.design, this.terrain);
        this.filterTrees();
    }

    private filterTrees() {
        const surfaceAt = terrainSurface(this.terrain, this.graded.heights);
        this.trees = visibleTrees(this.treeCandidates, this.terrain, this.graded, this.routes, surfaceAt);
    }

    finish() {
        this.graded = gradeRoads(this.design, this.terrain, this.routes);
        this.filterTrees();
        this.issues = validateRoads(this.design, this.terrain, this.routes);
        const broken = new Set(this.structural.map(i => i.geoNode));
        this.issues.push(...this.structural, ...terrainIssues(this.design, this.terrain, this.graded.heights).filter(i => !broken.has(i.geoNode)));
        this.issues.push(...validateDesign(this.design, this.terrain, this.graded.heights, this.routes));
    }
}