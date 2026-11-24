export function niceStep(minimum: number) {
    if (!(minimum > 0) || !Number.isFinite(minimum)) return 1;
    const unit = 10 ** Math.floor(Math.log10(minimum));
    return ([1, 2, 2.5, 5, 10].find(v => v * unit >= minimum) ?? 10) * unit;
}

export function shiftDecimal(value: number, places: number) {
    const [digits, exponent] = value.toExponential().split("e");
    return Number(digits + "e" + (Number(exponent) + places));
}