use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EngineBackend {
    WebGPU = 0,
    SimdCpu = 1,
}

#[derive(Deserialize, Debug)]
pub struct PokerEvent {
    pub hero_seat: Option<u32>,
    pub hero_cards: Vec<String>,
    pub board: Vec<String>,
    pub pot: f64,
    pub position: String,
}

#[derive(Serialize)]
struct SolverResult {
    action: String,
    amount: f64,
    ev: f64,
    backend: String,
}

#[wasm_bindgen]
pub struct SolverEngine {
    backend: EngineBackend,
}

#[wasm_bindgen]
impl SolverEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            backend: EngineBackend::SimdCpu,
        }
    }

    pub async fn init_hardware(&mut self) -> Result<u8, JsValue> {
        let window = match web_sys::window() {
            Some(w) => w,
            None => return Ok(EngineBackend::SimdCpu as u8),
        };
        let navigator = window.navigator();

        if js_sys::Reflect::has(&navigator, &JsValue::from_str("gpu")).unwrap_or(false) {
            let gpu_val = js_sys::Reflect::get(&navigator, &JsValue::from_str("gpu"))?;
            if !gpu_val.is_undefined() && !gpu_val.is_null() {
                self.backend = EngineBackend::WebGPU;
                web_sys::console::log_1(&"[WASM Engine] WebGPU Hardware Activated".into());
                return Ok(EngineBackend::WebGPU as u8);
            }
        }

        self.backend = EngineBackend::SimdCpu;
        web_sys::console::log_1(&"[WASM Engine] Fallback to CPU WASM SIMD Mode".into());
        Ok(EngineBackend::SimdCpu as u8)
    }

    pub fn solve_auto_step(&self, event_json: &str) -> String {
        let event: PokerEvent = match serde_json::from_str(event_json) {
            Ok(ev) => ev,
            Err(e) => return self.make_error_response(&format!("PARSE_ERROR: {}", e)),
        };

        self.run_gto_calculation(&event)
    }

    fn run_gto_calculation(&self, event: &PokerEvent) -> String {
        // Temporary logic to test the auto-play execution.
        // Replace this with your actual CFR/WGSL solver logic!
        let action = if event.hero_cards.len() == 2 {
            "CALL"
        } else {
            "FOLD"
        };

        let result = SolverResult {
            action: action.to_string(),
            amount: 0.0,
            ev: 0.0,
            backend: match self.backend {
                EngineBackend::WebGPU => "WebGPU".to_string(),
                EngineBackend::SimdCpu => "CPU_SIMD".to_string(),
            },
        };

        serde_json::to_string(&result).unwrap_or_else(|_| self.make_error_response("SERIALIZE_ERROR"))
    }

    fn make_error_response(&self, err_msg: &str) -> String {
        format!(r#"{{"action":"ERROR","amount":0.0,"ev":0.0,"backend":"{}"}}"#, err_msg)
    }
}
