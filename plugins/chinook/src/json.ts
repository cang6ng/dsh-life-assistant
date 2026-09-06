/** Local JsonValue mirror (recursive JSON type) for structured tool results. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
