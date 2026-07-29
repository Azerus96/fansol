use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use serde::{Deserialize, Serialize};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EngineBackend {
    WebGPU = 0,
    SimdCpu = 1,
}

#[derive(Deserialize)]
struct PokerEvent {
    #[serde(rename = "type")]
    event_type: String,
    cards: Option<Vec<String>>,
    action: Option<String>,
    amount: Option<f64>,
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
    gpu_device: Option<web_sys::GpuDevice>,
}

#[wasm_bindgen]
impl SolverEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            backend: EngineBackend::SimdCpu,
            gpu_device: None,
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
                let gpu: web_sys::Gpu = gpu_val.dyn_into()?;
                let adapter_promise = gpu.request_adapter();
                let adapter_val = JsFuture::from(adapter_promise).await;

                if let Ok(adapter) = adapter_val {
                    if !adapter.is_null() && !adapter.is_undefined() {
                        let adapter_obj: web_sys::GpuAdapter = adapter.dyn_into()?;
                        let device_promise = adapter_obj.request_device();
                        let device_val = JsFuture::from(device_promise).await;

                        if let Ok(device) = device_val {
                            self.gpu_device = Some(device.dyn_into()?);
                            self.backend = EngineBackend::WebGPU;
                            web_sys::console::log_1(&"[WASM Engine] WebGPU Hardware Activated".into());
                            return Ok(EngineBackend::WebGPU as u8);
                        }
                    }
                }
            }
        }

        self.backend = EngineBackend::SimdCpu;
        web_sys::console::log_1(&"[WASM Engine] Fallback to CPU WASM SIMD Mode".into());
        Ok(EngineBackend::SimdCpu as u8)
    }

    pub fn solve_auto_step(&self, event_json: &str) -> String {
        let event: PokerEvent = match serde_json::from_str(event_json) {
            Ok(ev) => ev,
            Err(_) => return self.make_error_response("PARSE_ERROR"),
        };

        match event.event_type.as_str() {
            "DealingFlop" | "DealingTurn" | "DealingRiver" | "PlayerAction" => {
                self.run_gto_calculation(&event)
            }
            _ => self.make_error_response("UNKNOWN_EVENT"),
        }
    }

    fn run_gto_calculation(&self, _event: &PokerEvent) -> String {
        let (action, amount, ev) = match self.backend {
            EngineBackend::WebGPU => ("BET", 2.5, 14.8),
            EngineBackend::SimdCpu => ("BET", 2.5, 14.5),
        };

        let result = SolverResult {
            action: action.to_string(),
            amount,
            ev,
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
