import { type Command, type Reply, type Request, TerrainSender, failure, transfers } from "./messages.ts";
import { parseDesign } from "../core/design/model.ts";
import { heightId } from "../core/design/defaults.ts";
import { exportProject } from "../core/export.ts";
import { resolveDesign } from "../core/design/parameters.ts";
import { constructionCenter } from "../core/design/regions.ts";
import { Project } from "../core/project.ts";
import { TerrainCache } from "../core/terrain/cache.ts";
import { type WorkPool } from "../core/math/work.ts";

const isPreview = (request: Request): request is Extract<Request, { kind: "number" | "coarse" }> =>
    request.kind === "number" || request.kind === "coarse";
type SendReply = (reply: Reply, buffers?: ArrayBuffer[]) => void;

export class TerrainQueue {
    private readonly sender = new TerrainSender();
    private readonly send: SendReply;
    private readonly pool: Promise<WorkPool>;
    private readonly schedule: (callback: () => void) => void;
    private readonly commit: string;
    private readonly previews = new Map<number, Project>();
    private readonly queue: Request[] = [];
    private scheduled = false;
    private current?: { id: number; project: Project };
    private cache = new TerrainCache();
    private previewCache?: TerrainCache;
    private coarsePreviewCache?: TerrainCache;

    constructor(pool: Promise<WorkPool>, send: SendReply, schedule = (callback: () => void) => {
        setTimeout(callback, 0);
    }, commit = "") {
        this.pool = pool;
        this.send = send;
        this.schedule = schedule;
        this.commit = commit;
    }

    receive(request: Command) {
        if (request.kind === "clearPreviews") {
            this.drop(isPreview);
            this.previewCache = this.coarsePreviewCache = undefined;
            return;
        }
        if (request.kind === "release") {
            this.previews.delete(request.source);
            return;
        }
        if (request.kind === "generate") this.drop(isPreview);
        else if (isPreview(request)) this.drop(queued => queued.kind === request.kind);
        this.queue.push(request);
        this.pump();
    }

    private drop(filter: (request: Request) => boolean) {
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const request = this.queue[i];
            if (!filter(request)) continue;
            this.queue.splice(i, 1);
            this.send({ kind: "dropped", id: request.id });
        }
    }

    private pump() {
        if (this.scheduled || !this.queue.length) return;
        this.scheduled = true;
        this.schedule(() => {
            void this.next();
        });
    }

    private async next() {
        let request: Request | undefined;
        try {
            const pool = await this.pool;
            request = this.queue.shift();
            if (request) await this.calculate(request, pool);
        }
        catch (error) {
            request ??= this.queue.shift();
            if (request) this.send({ kind: "error", id: request.id, error: failure(error) });
        }
        finally {
            this.scheduled = false;
            this.pump();
        }
    }

    private async calculate(request: Request, pool: WorkPool) {
        const { id } = request;
        if (request.kind === "generate") {
            const design = parseDesign(request.design, true, pool), resolved = resolveDesign(design);
            const source = request.reset ? new TerrainCache() : this.cache;
            this.send({ kind: "started", id, missing: source.missingResolved(resolved) });
            const cache = source.fork(), project = new Project(design, cache, resolved, pool);
            this.sendProject(id, project, request.known, pool.size);
            this.current = { id, project };
            this.cache = cache;
            this.previewCache = this.coarsePreviewCache = undefined;
            this.previews.clear();
            return;
        }
        if (isPreview(request)) {
            if (request.source !== this.current?.id) return this.send({ kind: "dropped", id });
            const coarse = request.kind === "coarse";
            const previous = coarse ? this.coarsePreviewCache ?? new TerrainCache() : this.previewCache ?? this.cache;
            const cache = previous.fork(), project = new Project(request.design, cache, request.resolved, pool);
            this.sendProject(id, project, request.known, pool.size);
            this.previews.set(id, project);
            if (coarse) this.coarsePreviewCache = cache;
            else this.previewCache = cache;
            return;
        }
        const current = request.source === this.current?.id ? this.current.project : undefined;
        if (request.kind === "export") {
            if (!current) return this.send({ kind: "dropped", id });
            const { terrain, resolved, issues } = current;
            // Transferred fields can be rebuilt by replaying the cached layers.
            const exportTerrain = terrain.fields[heightId].values.length === terrain.grid.size ? terrain :
                new Project(current.design, this.cache.fork(), resolved, pool).terrain;
            // Description edits live in the editor and do not require terrain generation.
            const bytes = await exportProject({ design: request.design, resolved, issues, terrain: exportTerrain }, this.commit);
            this.send({ kind: "export", id, bytes }, [bytes.buffer]);
            return;
        }
        const source = current ?? this.previews.get(request.source);
        if (!source) return this.send({ kind: "dropped", id });
        if (request.kind === "below") {
            const view = this.sender.view(source.viewBelow(request.through), request.known);
            this.send({ kind: "view", id, view }, transfers(view));
        }
        else if (request.kind === "reading") {
            const { owner, field, point } = request, { terrain, resolved } = source;
            const node = resolved.geoNodes.find(n => n.id === owner);
            const at = point ?? (node && constructionCenter(node.construction, resolved.grid.step, terrain.grid, terrain.regions.get(owner)));
            this.send({ kind: "reading", id, value: at && source.inputAt(owner, field, at) });
        }
    }

    private sendProject(id: number, project: Project, known: Parameters<TerrainSender["view"]>[1], helpers: number) {
        const view = this.sender.view(project.view(), known);
        this.send({ kind: "project", id, project: { design: project.design, view, helpers } }, transfers(view));
    }
}