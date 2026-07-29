// ИСПРАВЛЕНО: Выравнивание ровно 16 байт (Adreno / Apple GPU Spec)
struct HandCombo {
    cards: vec2<u32>,        // 8 байт
    weight: f32,             // 4 байта
    _padding: u32,           // 4 байта Паддинг -> Итого: 16 байт
};

struct CFRData {
    regrets: vec4<f32>,      // 16 байт
    strategy: vec4<f32>,     // 16 байт -> Итого: 32 байта
};

@group(0) @binding(0) var<storage, read> combos: array<HandCombo, 1326>;
@group(0) @binding(1) var<storage, read_write> cfr_tree: array<CFRData, 1326>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let id = global_id.x;
    if (id >= 1326u) {
        return;
    }

    let combo = combos[id];
    if (combo.weight <= 0.0) {
        return;
    }

    var data = cfr_tree[id];

    // Regret Matching
    let pos_regrets = max(data.regrets, vec4<f32>(0.0));
    let sum = pos_regrets.x + pos_regrets.y + pos_regrets.z;

    if (sum > 0.0) {
        data.strategy = pos_regrets / sum;
    } else {
        data.strategy = vec4<f32>(0.3333333, 0.3333333, 0.3333333, 0.0);
    }

    cfr_tree[id] = data;
}
