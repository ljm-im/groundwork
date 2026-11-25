import { rebuildShape, sampleRasterRows, sampleTraceRows,
    type RasterTask, type RegionShape, type ShapeReference, type TraceTask } from "../core/design/regions.ts";
import { cliffReach, evaluateLayerCells, fillShoreMask, sampleBinding, type BindingTask, type CliffReachTask, type LayerTask, type ShoreMaskTask } from "../core/terrain/functions.ts";
import { distanceToOther, type ShoreTask } from "../core/terrain/shore.ts";
import { createGrid } from "../core/math/geometry.ts";
import { receiveTask, type TaskMessage } from "./pool.ts";

type Task = BindingTask | CliffReachTask | LayerTask | RasterTask | ShoreTask | ShoreMaskTask | TraceTask;

export function taskHandler() {
    let generation = -1;
    const shapes = new Map<number, RegionShape>();
    return (message: TaskMessage) => receiveTask(message, ({ references, task: request }) => {
        if (message.generation !== generation) {
            generation = message.generation;
            shapes.clear();
        }
        for (const { revision, data, below, tolerance } of references as readonly ShapeReference[]) {
            const parents = new Map(below.map(([id, revision]) => [id, shapes.get(revision)!]));
            shapes.set(revision, rebuildShape(data, parents, tolerance));
        }
        const task = request as Task;
        switch (task.kind) {
            case "binding":
                return sampleBinding(task);
            case "cliffReach":
                return cliffReach(task);
            case "shoreMask":
                return fillShoreMask(task);
            case "layer":
                return evaluateLayerCells(task, createGrid(task.spec), shapes.get(task.shape)!);
            case "raster": {
                const grid = createGrid(task.spec), shape = shapes.get(task.shape)!;
                return block => sampleRasterRows(task, grid, shape, block);
            }
            case "shore":
                return block => distanceToOther(task.frame, task.step, task.land, task.defined, 1 - block, task.distances[block]);
            case "trace": {
                const shape = shapes.get(task.shape)!;
                return block => sampleTraceRows(task, shape, block);
            }
            default:
                throw Error("Unknown calculation task: " + request.kind);
        }
    });
}