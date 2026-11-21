import { snapshots } from "../test/golden.ts";

// Print the reference to stdout so a verification run cannot overwrite it.
console.log(JSON.stringify(await snapshots(), null, 4));