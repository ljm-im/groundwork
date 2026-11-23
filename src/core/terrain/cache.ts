import { type Design } from "../design/v5.ts";
import { generateTerrain } from "./terrain.ts";

export class TerrainCache {
    generate(design: Design) {
        return generateTerrain(design);
    }
}