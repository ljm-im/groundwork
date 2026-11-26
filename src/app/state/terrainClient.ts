import { type Command, type KnownRegions, type Missing, type ProjectData, type Reply, type Request, type ViewData, replyError } from "../../compute/messages.ts";
import { type Design, type Point, type ResolvedDesign } from "../../core/design/v5.ts";
import { copyAt, type Address } from "../../core/design/address.ts";
import { rebuildShape, shapeData, type Region, type RegionShape } from "../../core/design/regions.ts";
import { createGrid } from "../../core/math/geometry.ts";
import { type ProjectView } from "../../core/project.ts";

export interface ComputeChannel {
    send(command: Command): void;
    close(): void;
}

type ReplyHandler = (reply: Reply) => void;
type ChannelFactory = (receive: ReplyHandler, fail: (error: Error) => void) => ComputeChannel;

function workerChannel(receive: ReplyHandler, fail: (error: Error) => void): ComputeChannel {
    const worker = new Worker(new URL("../../compute/terrainWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => receive(event.data);
    worker.onerror = event => fail(Error(event.message));
    worker.onmessageerror = () => fail(Error("地形计算结果无法读取"));
    return { send: command => worker.postMessage(command), close: () => worker.terminate() };
}

class TerrainReceiver {
    private readonly regions = new Map<number, WeakRef<Region>>();
    private readonly collected = new FinalizationRegistry<{ revision: number; ref: WeakRef<Region> }>(({ revision, ref }) => {
        if (this.regions.get(revision) === ref) this.regions.delete(revision);
    });

    retain() {
        const known: KnownRegions = [], retained = new Map<number, Region>();
        for (const [revision, ref] of this.regions) {
            const region = ref.deref();
            if (!region) continue;
            const data = shapeData(region.shape);
            known.push([revision, data?.type === "outline" || data?.contour !== undefined]);
            retained.set(revision, region);
        }
        return { known, retained };
    }

    view({ terrain, design, issues }: ViewData, retained: ReadonlyMap<number, Region>): ProjectView {
        const below = new Map<string, RegionShape>(), regions = new Map<string, Region>();
        for (const [id, { revision, data, contour }] of terrain.regions) {
            let region = retained.get(revision) ?? this.regions.get(revision)?.deref();
            if (region) {
                const geometry = shapeData(region.shape);
                if (geometry?.type === "strip" && contour !== undefined) geometry.contour = contour;
            }
            else {
                if (!data) throw Error("缺少地件区域");
                const { shape, ...layout } = data;
                region = { ...layout, shape: rebuildShape(shape, below, terrain.grid.step / 8) };
                const ref = new WeakRef(region);
                this.regions.set(revision, ref);
                this.collected.register(region, { revision, ref });
            }
            below.set(id, region.shape);
            regions.set(id, region);
        }
        return { design, issues, terrain: { ...terrain, grid: createGrid(terrain.grid), regions } };
    }
}

type Outcome = Exclude<Reply, { kind: "started" | "error" | "dropped" }>;
type RequestBody = Request extends infer T ? T extends Request ? Omit<T, "id"> : never : never;

export class TerrainClient {
    private readonly factory: ChannelFactory;
    private channel?: ComputeChannel;
    private failure?: Error;
    private lastId = 0;
    private readonly terrain = new TerrainReceiver();
    private readonly pending = new Map<number, {
        done: (reply?: Outcome) => void;
        error: (error: Error) => void;
        started?: (missing: Missing) => void;
    }>();

    constructor(factory = workerChannel) {
        this.factory = factory;
    }

    private receive(reply: Reply) {
        const request = this.pending.get(reply.id);
        if (!request) return;
        if (reply.kind === "started") {
            request.started?.(reply.missing);
            return;
        }
        this.pending.delete(reply.id);
        if (reply.kind === "error") request.error(replyError(reply.error));
        else request.done(reply.kind === "dropped" ? undefined : reply);
    }

    private fail(error: Error) {
        this.failure = error;
        for (const request of this.pending.values()) request.error(error);
        this.pending.clear();
        this.channel?.close();
        this.channel = undefined;
    }

    private request(body: RequestBody, started?: (missing: Missing) => void) {
        const id = ++this.lastId;
        return new Promise<Outcome | undefined>((done, error) => {
            if (this.failure) return error(this.failure);
            this.channel ??= this.factory(reply => this.receive(reply), reason => this.fail(reason));
            this.pending.set(id, { done, error, started });
            try {
                this.channel.send({ ...body, id });
            }
            catch (cause) {
                this.pending.delete(id);
                error(cause);
            }
        });
    }

    private model(id: number, project: ProjectData, retained: ReadonlyMap<number, Region>) {
        return new ProjectModel(project.design, this.terrain.view(project.view, retained), this, id, project.helpers);
    }

    async generate(design: Design | string, reset: boolean, started: (missing: Missing) => void) {
        const { known, retained } = this.terrain.retain();
        const reply = await this.request({ kind: "generate", design, reset, known }, started);
        if (reply?.kind !== "project") throw Error("缺少地形计算结果");
        return this.model(reply.id, reply.project, retained);
    }

    async preview(source: number, design: Design, resolved: ResolvedDesign, coarse: boolean) {
        const { known, retained } = this.terrain.retain();
        const reply = await this.request({ kind: coarse ? "coarse" : "number", source, design, resolved, known });
        if (reply?.kind === "project") return this.model(reply.id, reply.project, retained);
    }

    async below(source: number, through: string) {
        const { known, retained } = this.terrain.retain();
        const reply = await this.request({ kind: "below", source, through, known });
        if (reply?.kind === "view") return this.terrain.view(reply.view, retained);
    }

    async reading(source: number, owner: string, field: string, point?: Point) {
        const reply = await this.request({ kind: "reading", source, owner, field, point });
        if (reply?.kind === "reading") return reply.value;
    }

    async export(source: number, design: Design) {
        const reply = await this.request({ kind: "export", source, design });
        if (reply?.kind !== "export") throw Error("缺少导出结果");
        return reply.bytes;
    }

    hasPendingRequests() {
        return this.pending.size > 0;
    }

    clearPreviews() {
        this.channel?.send({ kind: "clearPreviews" });
    }

    release(source: number) {
        this.channel?.send({ kind: "release", source });
    }

    close() {
        this.fail(Error("地形计算已关闭"));
    }
}

export class ProjectModel {
    readonly design: Design;
    readonly resolved: ResolvedDesign;
    readonly terrain: ProjectView["terrain"];
    readonly issues: ProjectView["issues"];
    readonly client: TerrainClient;
    readonly id: number;
    readonly helpers: number;

    constructor(design: Design, { design: resolved, terrain, issues }: ProjectView, client: TerrainClient, id: number, helpers = 0) {
        this.design = design;
        this.resolved = resolved;
        this.terrain = terrain;
        this.issues = issues;
        this.client = client;
        this.id = id;
        this.helpers = helpers;
    }

    withPrompt(path: Address, value: string | undefined) {
        return new ProjectModel(copyAt(this.design, path, value), {
            ...this.view(), design: copyAt(this.resolved, path, value)
        }, this.client, this.id, this.helpers);
    }

    view(): ProjectView {
        return { design: this.resolved, terrain: this.terrain, issues: this.issues };
    }

    export() {
        return this.client.export(this.id, this.design);
    }

    viewBelow(id: string) {
        return this.client.below(this.id, id);
    }

    inputAt(owner: string, field: string, point?: Point) {
        return this.client.reading(this.id, owner, field, point);
    }
}