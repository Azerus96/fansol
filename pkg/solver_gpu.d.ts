/* tslint:disable */
/* eslint-disable */

export enum EngineBackend {
    WebGPU = 0,
    SimdCpu = 1,
}

export class SolverEngine {
    free(): void;
    [Symbol.dispose](): void;
    init_hardware(): Promise<number>;
    constructor();
    solve_auto_step(event_json: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_solverengine_free: (a: number, b: number) => void;
    readonly solverengine_init_hardware: (a: number) => any;
    readonly solverengine_new: () => number;
    readonly solverengine_solve_auto_step: (a: number, b: number, c: number) => [number, number];
    readonly wasm_bindgen_1e05ddb24c0b7df4___convert__closures_____invoke___wasm_bindgen_1e05ddb24c0b7df4___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_1e05ddb24c0b7df4___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_1e05ddb24c0b7df4___convert__closures_____invoke___js_sys_839e637bf800dbc7___Function_fn_wasm_bindgen_1e05ddb24c0b7df4___JsValue_____wasm_bindgen_1e05ddb24c0b7df4___sys__Undefined___js_sys_839e637bf800dbc7___Function_fn_wasm_bindgen_1e05ddb24c0b7df4___JsValue_____wasm_bindgen_1e05ddb24c0b7df4___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
