import { type GridSpec, type Point } from "../math/geometry.ts";

export { type GridSpec, type Point } from "../math/geometry.ts";

export type Height = number | LevelReference;
export type NoiseSettings = [amplitude: number, frequency: number, phase: number];
export type RoadPair = [incoming: string, outgoing: string];
export type RoadMode = "route" | "smooth" | "straight";
export type Species = "mixed" | "avenue" | "small" | "shrub" | "forest";
export type ClearingShape = Polygon | Ellipse | Sector;
export type Shape = ClearingShape | Circle | Band;

export interface Named {
    /** Stable identifier used by references in the design. */
    id: string;
    /** Display name shown in the editor. */
    name: string;
}

export interface LevelReference {
    /** Key in the design's named elevation table. */
    level: string;
    /** Vertical offset above the named level in metres. */
    offset?: number;
}

export interface Polygon {
    /** Selects a closed polygon. */
    type: "polygon";
    /** Ordered boundary vertices in metres. */
    points: Point[];
    /** Spline subdivisions per edge, omitted for straight sides. */
    smooth?: number;
}

export interface Band {
    /** Selects a constant-width strip. */
    type: "band";
    /** Ordered centreline vertices in metres. */
    points: Point[];
    /** Full strip width in metres. */
    width: number;
}

export interface Disk {
    /** Centre in world metres. */
    center: Point;
    /** Radius in metres. */
    radius: number;
}

export interface Circle extends Disk {
    /** Selects a circular boundary. */
    type: "circle";
    /** Maximum radial noise displacement in metres. */
    amplitude: number;
    /** Number of angular samples around the boundary. */
    samples: number;
}

export interface Ellipse {
    /** Selects an elliptical boundary. */
    type: "ellipse";
    /** Centre in world metres. */
    center: Point;
    /** East and north semi-axis lengths in metres. */
    radii: Point;
    /** Number of angular samples around the boundary. */
    samples: number;
}

export interface Sector {
    /** Selects an annular sector. */
    type: "sector";
    /** Centre in world metres. */
    center: Point;
    /** Inner radius in metres. */
    inner: number;
    /** Outer radius in metres. */
    outer: number;
    /** Start bearing counterclockwise from east in degrees. */
    start: number;
    /** End bearing counterclockwise from east in degrees. */
    end: number;
    /** Inner-boundary radial noise amplitude in metres. */
    innerNoise?: number;
    /** Outer-boundary radial noise amplitude in metres. */
    outerNoise?: number;
    /** Subdivisions along each arc. */
    samples: number;
}

export interface AxisRock {
    /** Coordinate axis, zero for east and one for north. */
    axis: 0 | 1;
    /** Direction along the chosen axis, positive or negative one. */
    sign: number;
    /** Signed coordinate at which the transition starts in metres. */
    start: number;
    /** Transition width in metres. */
    span: number;
    /** Dimensionless contribution to coastal roughness. */
    strength: number;
}

export interface RadialRock extends Disk {
    /** Dimensionless contribution to coastal roughness. */
    strength: number;
}

export interface Harbor extends Disk {
    /** Width of the offshore noise transition in metres. */
    span: number;
}

export interface Coast {
    /** Ordered coastal control vertices in metres. */
    points: Point[];
    /** Spline subdivisions per coastal segment. */
    smooth: number;
    /** Spatial weights controlling shoreline roughness. */
    rockiness: (AxisRock | RadialRock)[];
    /** Protected harbour where coastline noise fades out. */
    harbor: Harbor;
}

export interface RidgeVertex {
    /** Ridge control vertex in world metres. */
    point: Point;
    /** Absolute or named crest elevation in metres. */
    height: Height;
}

export interface Ridge extends Named {
    /** Ordered crest controls and elevations. */
    points: RidgeVertex[];
    /** Left and right falloff distances in metres. */
    widths: Point;
    /** Dimensionless width modulation along the ridge. */
    widthNoise: NoiseSettings;
    /** Dimensionless crest height modulation. */
    heightNoise: NoiseSettings;
}

export interface Peak extends Named {
    /** Summit location in world metres. */
    center: Point;
    /** Summit elevation in metres. */
    height: Height;
    /** Characteristic falloff radius in metres. */
    radius: number;
    /** Noise displacement of the radius in metres. */
    noise: number;
    /** Horizontal noise wavelength in metres. */
    scale: number;
    /** Radius protected from erosion in metres. */
    protect?: number;
    /** Minimum shore cliff gradient near the peak in metres per metre. */
    cliffMin?: number;
}

export interface LinearSlope {
    /** Selects a linear height ramp. */
    type: "linear";
    /** Coordinate axis, zero for east and one for north. */
    axis: 0 | 1;
    /** Starting coordinate in metres. */
    start: number;
    /** Signed horizontal run in metres. */
    distance: number;
    /** Vertical change over the run in metres. */
    rise: number;
    /** Ease the ramp at its ends. */
    smooth?: boolean;
}

export interface RadialSlope {
    /** Selects a radial height ramp. */
    type: "radial";
    /** Radius of zero additional elevation in metres. */
    baseline: number;
    /** Vertical rise per radial metre. */
    rate: number;
}

export interface EndRise {
    /** Named elevation supplying the height increment. */
    level: string;
    /** Angular origin in world metres. */
    center: Point;
    /** Beginning of the rising transition in degrees. */
    start: number;
    /** Angular width of the rising transition in degrees. */
    inSpan: number;
    /** Beginning of the falling transition in degrees. */
    end: number;
    /** Angular width of the falling transition in degrees. */
    outSpan: number;
    /** Inner and outer radial fade distances in metres. */
    fade: Point;
}

export interface ZoneHeight {
    /** Named base elevation, omitted for a fixed offset. */
    level?: string;
    /** Base elevation offset in metres. */
    offset?: number;
    /** Height noise amplitude in metres. */
    noise?: number;
    /** Horizontal multiplier for height noise coordinates. */
    noiseScale?: number;
    /** Optional spatial ramp added to base elevation. */
    slope?: LinearSlope | RadialSlope;
    /** Named elevation reached at the end of a band. */
    blendTo?: string;
    /** Localised rise around the end of a street. */
    endRise?: EndRise;
}

export interface Zone extends Named {
    /** Ascending overlap priority, lower values win. */
    priority: number;
    /** Plan boundary of the terrain zone. */
    shape: Shape;
    /** Elevation and blending rules. */
    height: ZoneHeight;
    /** Map fill colour. */
    fill?: string;
    /** Draw a retaining wall on the boundary. */
    retainingWall?: boolean;
    /** Draw the zone outline. */
    outline?: boolean;
}

export interface Door {
    /** Identifier within the owning building. */
    id: string;
    /** Optional door name on the map. */
    name?: string;
    /** Zero-based rectangular wall index. */
    wall?: number;
    /** Fraction along the wall from its first corner. */
    t?: number;
    /** Circular wall bearing in degrees. */
    angle?: number;
}

export interface Building extends Named {
    /** Identifier of the associated terrain zone. */
    zone?: string;
    /** Footprint geometry. */
    shape: "rect" | "circle" | "ring";
    /** Centre of the footprint in world metres. */
    center: Point;
    /** Rectangular length and width in metres. */
    size?: Point;
    /** Footprint rotation counterclockwise from east in degrees. */
    angle?: number;
    /** Building height above its foundation in metres. */
    height: number;
    /** Map footprint colour. */
    color: string;
    /** Entrances in authored order. */
    doors: Door[];
    /** Inner radius of a ring in metres. */
    inner?: number;
    /** Outer radius of a circular building or ring in metres. */
    radius?: number;
    /** Foundation pad reach in metres. */
    pad?: number;
    /** Additional routing exclusion distance in metres. */
    blockMargin?: number;
    /** Tree exclusion radius in metres. */
    treeRadius?: number;
    /** Level the pad to its sampled centre elevation. */
    summit?: boolean;
    /** Label displacement from the centre in metres. */
    titleOffset?: Point;
    /** Display the building name. */
    showTitle?: boolean;
}

export interface Yard extends Named {
    /** Enclosed yard or public plaza, defaults to yard. */
    kind?: "yard" | "plaza";
    /** Owning terrain zone. */
    zone: string;
    /** Identifiers of buildings belonging to the yard. */
    buildings?: string[];
    /** Explicit outline in metres, defaults to the zone boundary. */
    points?: Point[];
}

export interface RoadNode extends Named {
    /** Road network node category. */
    type: "door" | "gate" | "endpoint" | "junction" | "viewpoint";
    /** Position of a free node in world metres. */
    point?: Point;
    /** Owning building of a door node. */
    building?: string;
    /** Entrance identifier within the building. */
    door?: string;
    /** Boundary to which a gate is attached. */
    yard?: string;
    /** Gate position as a fraction of the closed perimeter. */
    at?: number;
    /** Manual departure bearing in degrees. */
    direction?: number;
    /** Ordered incoming and outgoing edges of a continuous road. */
    through?: RoadPair;
    /** Additional through pairs at the same junction. */
    otherThrough?: RoadPair[];
    /** Former building name retained on a disconnected entrance. */
    detachedDoor?: string;
}

export interface Segment {
    /** Override for one span between controls. */
    mode?: RoadMode;
    /** Require the segment to pass exactly through its final control. */
    exactEnd?: boolean;
}

export interface Edge extends Named {
    /** Starting node identifier. */
    from: string;
    /** Ending node identifier. */
    to: string;
    /** Ordered intermediate controls in world metres. */
    via: Point[];
    /** Key in the road class table. */
    grade: string;
    /** Full road width in metres. */
    width: number;
    /** Preferred gradient in metres per metre. */
    comfort: number;
    /** Maximum gradient used in route search in metres per metre. */
    maxGrade: number;
    /** Search corridor radius in metres. */
    corridor: number;
    /** Alignment method, defaults to routed. */
    mode?: RoadMode;
    /** Overrides for the spans between controls. */
    segments?: (Segment | null)[];
    /** Force steps along the entire road. */
    stairs?: boolean;
    /** Keep the profile at the first sampled height. */
    levelDeck?: boolean;
    /** Map road colour override. */
    color?: string;
    /** End station of forced steps in metres. */
    stairUntil?: number;
}

export interface RoadClass {
    /** Display name of the road class. */
    name: string;
    /** Default road width in metres. */
    width: number;
    /** Preferred gradient in metres per metre. */
    comfort: number;
    /** Maximum search gradient in metres per metre. */
    maxGrade: number;
    /** Default search corridor radius in metres. */
    corridor: number;
    /** Maximum ramp gradient, or null for unrestricted ramps. */
    rampLimit: number | null;
    /** Permit stair runs on this class of road. */
    allowStairs: boolean;
    /** Maximum stair gradient in metres per metre. */
    stairLimit: number;
    /** Gradient at which stair classification starts. */
    enter: number;
    /** Gradient at which stair classification ends. */
    exit: number;
    /** Minimum continuous stair or ramp run in metres. */
    minRun: number;
    /** Gradient above which a short stair run is retained. */
    keep: number;
    /** Width of the graded shoulder in metres. */
    shoulder: number;
    /** Minimum permitted bend radius in metres. */
    minRadius: number;
    /** Radius of a rounded straight-line corner in metres. */
    cornerRadius: number;
}

export interface Routing {
    /** Maximum soft waypoint deviation in metres. */
    viaTolerance?: number;
    /** Length of a level approach in metres. */
    landing?: number;
    /** Straight clearance length outside an entrance in metres. */
    clearLead?: number;
    /** Weight of direction changes during route search. */
    turnCost: number;
    /** Weight of excess gradient during route search. */
    overGradePenalty: number;
    /** Minimum passable elevation in metres. */
    minHeight: number;
    /** Number of horizontal smoothing passes. */
    relaxPasses: number;
    /** Centreline sampling interval in metres. */
    sampleStep: number;
    /** Number of vertical smoothing passes. */
    profilePasses: number;
    /** Profile smoothing radius in samples. */
    profileRadius: number;
    /** Gradient measurement window in metres. */
    gradeWindow: number;
    /** Additional half-width of the graded bed in metres. */
    roadBedExtra: number;
    /** Maximum ratio of routed length to direct length. */
    detourLimit: number;
    /** Required gap between road edges in metres. */
    clearance: number;
    /** Minimum sustained conflict length in metres. */
    overlapLength: number;
    /** Exemption radius around a shared junction in metres. */
    junctionRadius: number;
}

export interface Erosion {
    /** Number of simulated droplets. */
    droplets: number;
    /** Fraction of the previous direction retained. */
    inertia: number;
    /** Sediment capacity multiplier. */
    capacity: number;
    /** Minimum sediment carrying capacity. */
    minCapacity: number;
    /** Fraction of surplus sediment deposited per step. */
    deposition: number;
    /** Fraction of the sediment deficit eroded per step. */
    erosion: number;
    /** Fraction of water lost per step. */
    evaporation: number;
    /** Acceleration coefficient used to update droplet speed. */
    gravity: number;
    /** Maximum number of steps per droplet. */
    lifetime: number;
    /** Erosion brush radius in grid cells. */
    radius: number;
}

export interface Planting extends Named {
    /** Ordered polygon boundary in world metres. */
    points: Point[];
    /** Planting probability from zero to one. */
    density: number;
    /** Strength of spatial clustering from zero to one. */
    clump: number;
    /** Minimum and maximum crown radii in metres. */
    size: Point;
    /** Species or mixture to plant. */
    species: Species;
    /** Plant a row along the boundary. */
    rows: boolean;
    /** Target row spacing in metres. */
    spacing: number;
    /** Modulate density with natural terrain conditions. */
    natural: boolean;
    /** Edge fade distance in metres. */
    feather: number;
    /** Optional list of eligible terrain zones. */
    zones?: string[];
}

export interface Clearing extends Named {
    /** Zone supplying the centre of an implicit ellipse. */
    zone?: string;
    /** Implicit ellipse semi-axes in metres. */
    radii?: Point;
    /** Remove planted trees while preserving ambient scatter. */
    cover?: "ambient";
    /** Explicit clearing boundary. */
    shape?: ClearingShape;
}

export interface Vegetation {
    /** Ambient planting probabilities keyed by terrain zone. */
    density: Record<string, number>;
    /** Circular spaces kept clear of trees. */
    rooms: Disk[];
    /** Position and crown radius of the yard landmark in metres. */
    yardTree: Disk;
    /** Ordered planting regions, later regions take precedence. */
    plantings: Planting[];
    /** Tree removal areas in authored order. */
    clearings: Clearing[];
}

export interface Section extends Named {
    /** Start and end of the section in world metres. */
    points: [Point, Point];
    /** Captions at stations in metres with world-space anchors. */
    marks: [station: number, label: string, point: Point][];
}

export interface Label {
    /** Text displayed on the map. */
    name: string;
    /** Anchor of a free-standing label in metres. */
    point?: Point;
    /** Named elevation against which to compare surveyed terrain. */
    level?: string;
    /** Building supplying the label anchor. */
    building?: string;
    /** Label displacement from the anchor in metres. */
    offset?: Point;
    /** Display the measured elevation. */
    spot?: boolean;
    /** Minimum map zoom factor for visibility. */
    minZoom?: number;
    /** Display only the caption. */
    titleOnly?: boolean;
}

export interface Design {
    /** On-disk island design format version. */
    version: 4;
    /** Integer seed for deterministic generation. */
    seed: number;
    /** Sampling bounds and spacing in metres. */
    grid: GridSpec;
    /** Named elevations or vertical increments in metres. */
    levels: Record<string, number>;
    /** Slider labels and ranges in metres. */
    levelControls: Record<string, [label: string, minimum: number, maximum: number, step: number]>;
    /** Coastline controls and near-shore conditions. */
    coast: Coast;
    /** Authored mountain ridges. */
    ridges: Ridge[];
    /** Isolated summit controls. */
    peaks: Peak[];
    /** Terrain platforms and transition rules. */
    zones: Zone[];
    /** Footprints, foundations and door anchors. */
    buildings: Building[];
    /** Enclosed yards and plazas. */
    yards?: Yard[];
    /** Topological vertices of the road network. */
    nodes: RoadNode[];
    /** Roads connecting the vertices. */
    edges: Edge[];
    /** Default geometry and validation limits per road class. */
    roadClasses: Record<string, RoadClass>;
    /** Route search, sampling and grading settings. */
    routing: Routing;
    /** Hydraulic erosion settings. */
    erosion: Erosion;
    /** Vegetation rules and exclusion areas. */
    vegetation: Vegetation;
    /** Cross-sections in display order. */
    sections: Section[];
    /** Cartographic labels in display order. */
    labels: Label[];
}