use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn solve_eval(card_val: u32) -> u32 {
    // Ядро вычислений на Rust
    card_val * 2
}

#[wasm_bindgen]
pub fn init_solver() -> String {
    "OFC/NLHE WASM Engine Ready".to_string()
}
