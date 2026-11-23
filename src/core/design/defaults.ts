export const ridgeNoiseDefaults = { amount: 0, wavelength: 20 };
export const functionDefaults = {
    ground: { value: 0 }, flat: { value: 0 }, coast: { roughness: 6 }, mountain: { floor: -1000 },
    cliff: { factor: .6, seaLevel: 0 },
    erosion: { strength: 1, floor: -1000, droplets: 40000, inertia: .06, capacity: 5, minCapacity: .002,
        deposition: .25, erosion: .35, evaporation: .02, gravity: 6, lifetime: 50, radius: 2 },
    islets: { density: .5, reach: 12, threshold: .45, seaLevel: 0 }, slope: { radius: 5, value: 0, rate: .5 },
    add: { amount: 1, feather: 3 }, noise: { amplitude: 1, scale: 24, octaves: 5, feather: 0 },
    batter: { grade: .5 }, blend: {}, split: {}
};
export const routingDefaults = { viaTolerance: 1, landing: 3, clearLead: 1.5 };