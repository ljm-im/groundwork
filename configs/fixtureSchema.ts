import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = fileURLToPath(new URL("../src/core/design/v5.ts", import.meta.url));
const program = ts.createProgram([source], { strict: true, noEmit: true, skipLibCheck: true });
const checker = program.getTypeChecker();
const schema = program.getSourceFile(source)!;
const declaration = schema.statements.find((node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === "Design")!;
const design = checker.getTypeAtLocation(declaration);

// Match the declarations themselves so adding an index signature or a union branch
// has the same meaning here as it does in the editor. This runs only in tests.
function check(value: unknown, type: ts.Type, path: string): string | undefined {
    if (type.isUnion()) {
        const members = value && typeof value === "object" && "type" in value ? type.types.filter(member => {
            const tag = checker.getPropertyOfType(member, "type");
            if (!tag) return true;
            const literal = checker.getTypeOfSymbolAtLocation(tag, declaration);
            return !literal.isStringLiteral() || literal.value === value.type;
        }) : type.types;
        if (!members.length) return path + ".type has no matching variant";
        const errors = members.map(member => check(value, member, path));
        if (errors.includes(undefined)) return;
        return errors.find(error => error && error.startsWith(path + ".")) ?? errors[0];
    }
    if (value === null && type.flags & ts.TypeFlags.Null) return;
    if (typeof value === "number" && (type.flags & ts.TypeFlags.Number || type.isNumberLiteral() && value === type.value)) return;
    if (typeof value === "string" && (type.flags & ts.TypeFlags.String || type.isStringLiteral() && value === type.value)) return;
    if (typeof value === "boolean" && type.flags & ts.TypeFlags.BooleanLiteral && String(value) === checker.typeToString(type)) return;
    if (Array.isArray(value) && (checker.isTupleType(type) || checker.isArrayType(type))) {
        const elements = checker.getTypeArguments(type as ts.TypeReference);
        if (checker.isTupleType(type) && value.length < ((type as ts.TypeReference).target as ts.TupleType).minLength)
            return path + " is missing a tuple element";
        for (const [index, item] of value.entries()) {
            const entry = checker.isTupleType(type) ? elements[index] : elements[0];
            const child = path + "[" + index + "]";
            if (!entry) return child + " has no declared tuple element";
            const error = check(item, entry, child);
            if (error) return error;
        }
        return;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && (type.flags & ts.TypeFlags.Object || type.isIntersection())) {
        const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
        for (const property of checker.getPropertiesOfType(type))
            if (!(property.flags & ts.SymbolFlags.Optional) && !Object.hasOwn(value, property.name)) return path + "." + property.name + " is required";
        for (const [name, item] of Object.entries(value)) {
            const child = path + "." + name, property = checker.getPropertyOfType(type, name);
            const entry = property ? checker.getTypeOfSymbolAtLocation(property, declaration) : index;
            if (!entry) return child + " is missing from " + checker.typeToString(type);
            const error = check(item, entry, child);
            if (error) return error;
        }
        return;
    }
    return path + " does not match " + checker.typeToString(type);
}

export function undeclaredDesignField(value: unknown, name: string) {
    return check(value, design, name);
}