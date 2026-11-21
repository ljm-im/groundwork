import { type Design } from "./design/types.ts";
import { type Terrain, type Tree, type Route, type Graded, type Issue } from "./design/results.ts";
import { generateTerrain, updateHeights } from "./terrain/terrain.ts";
import { plantTrees, visibleTrees } from "./vegetation/vegetation.ts";
import { routeAll } from "./roads/routing.ts";
import { gradeRoads, profile } from "./roads/profiles.ts";
import { validateDesign, validateRoads } from "./checks/validation.ts";

export class Island {
    declare design: Design;
    declare terrain: Terrain;
    declare treeCandidates: Tree[];
    declare routes: Route[];
    declare graded: Graded;
    declare trees: Tree[];
    declare issues: Issue[];

    constructor(design: Design) {
        this.design = design;
        this.terrain = generateTerrain(design);
        this.treeCandidates = plantTrees(design, this.terrain);
        this.reroute();
    }

    reroute(ids?: ReadonlySet<string>) {
        const { design, terrain } = this;
        this.routes = routeAll(design, terrain, ids ? this.routes : [], ids).map(r => "h" in r && r.h ? r : profile(design, terrain, r));
        this.finish();
    }

    levels(release = false) {
        updateHeights(this.terrain, this.design, release);
        if (release) {
            this.treeCandidates = plantTrees(this.design, this.terrain);
            this.reroute();
        }
        else {
            this.routes = this.routes.map(r => profile(this.design, this.terrain, r));
            this.finish();
        }
    }

    replant() {
        this.treeCandidates = plantTrees(this.design, this.terrain);
        this.trees = visibleTrees(this.treeCandidates, this.terrain, this.graded, this.routes);
    }

    finish() {
        this.graded = gradeRoads(this.design, this.terrain, this.routes);
        this.trees = visibleTrees(this.treeCandidates, this.terrain, this.graded, this.routes);
        this.issues = validateRoads(this.design, this.terrain, this.routes);
        this.issues.push(...validateDesign(this.design, this.terrain, this.graded.heights, this.routes));
    }
}