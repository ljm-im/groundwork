export const ridgeNoiseDefaults = { amount: 0, wavelength: 20 };
export const functionDefaults = {
    ground: { value: 0 }, flat: { amount: 1 }, coast: { roughness: 6 }, mountain: { floor: -1000 },
    cliff: { factor: .6, seaLevel: 0 },
    erosion: { strength: 1, floor: -1000, droplets: 40000, inertia: .06, capacity: 5, minCapacity: .002,
        deposition: .25, erosion: .35, evaporation: .02, gravity: 6, lifetime: 50, radius: 2 },
    islets: { density: .5, reach: 12, threshold: .45, seaLevel: 0 }, slope: { radius: 5, value: 2, rate: -.2 },
    add: { amount: 1, feather: 3 }, noise: { amplitude: 1, scale: 24, octaves: 5, feather: 0 },
    batter: { grade: .5 }, blend: {}, split: {}
};
export const routingDefaults = { viaTolerance: 1, landing: 3, clearLead: 1.5, turnCost: 2, overGradePenalty: 32,
    minHeight: .5, relaxPasses: 32, sampleStep: 1, profilePasses: 1, profileRadius: 1, gradeWindow: 3,
    roadBedExtra: .2, detourLimit: 2, clearance: 1, overlapLength: 3, junctionRadius: 4 };

export const unrestrictedRampGrade = 1000;