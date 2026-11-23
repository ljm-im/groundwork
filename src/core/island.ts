import { type Design } from "./design/v5.ts";
import { type Terrain, type Tree, type Route, type Graded, type Issue } from "./design/results.ts";
import { TerrainCache } from "./terrain/cache.ts";
import { terrainSurface } from "./terrain/surface.ts";
import { plantTrees, visibleTrees } from "./vegetation/vegetation.ts";
import { routeAll } from "./roads/routing.ts";
import { gradeRoads } from "./roads/profiles.ts";
import { networkProfiles } from "./roads/networkProfiles.ts";
import { validateDesign, validateRoads } from "./checks/validation.ts";

export class Island {
    declare design: Design;
    declare terrain: Terrain;
    declare treeCandidates: Tree[];
    declare routes: Route[];
    declare graded: Graded;
    declare trees: Tree[];
    declare issues: Issue[];

    private readonly cache: TerrainCache;

    constructor(design: Design, cache = new TerrainCache()) {
        this.cache = cache;
        this.design = design;
        this.terrain = cache.generate(design);
        this.treeCandidates = plantTrees(design, this.terrain);
        this.reroute();
    }

    reroute(ids?: ReadonlySet<string>) {
        const { design, terrain } = this;
        this.routes = networkProfiles(design, terrain, routeAll(design, terrain, ids ? this.routes : [], ids));
        this.finish();
    }

    variables(release = false) {
        this.terrain = this.cache.generate(this.design);
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
        this.issues.push(...validateDesign(this.design, this.terrain, this.graded.heights, this.routes));
    }
}