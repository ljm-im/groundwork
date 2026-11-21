import { generateTerrain, updateHeights } from "./terrain.js";
import { plantTrees, visibleTrees } from "./vegetation.js";
import { routeAll } from "./routing.js";
import { gradeRoads, profile } from "./profiles.js";
import { validateDesign, validateRoads } from "./validation.js";

export class Island {
    constructor(design) {
        this.design = design;
        this.terrain = generateTerrain(design);
        this.treeCandidates = plantTrees(design, this.terrain);
        this.reroute();
    }

    reroute(ids) {
        const { design, terrain } = this;
        this.routes = routeAll(design, terrain, ids ? this.routes : [], ids).map(r => r.h ? r : profile(design, terrain, r));
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