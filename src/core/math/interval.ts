export function shiftDecimal(value: number, places: number) {
    const [digits, exponent] = value.toExponential().split("e");
    return Number(digits + "e" + (Number(exponent) + places));
}