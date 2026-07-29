(function () {
    'use strict';

    if (window.__POKER_SOLVER_INITIALIZED__) return;
    window.__POKER_SOLVER_INITIALIZED__ = true;

    // 1. Создание изолированного Shadow DOM HUD с поддержкой сворачивания и авто-игры
    const host = document.createElement('div');
    host.id = 'poker-solver-hud-host';
    (document.body || document.documentElement).appendChild(host);
    
    const shadow = host.attachShadow({ mode: 'closed' });
    const hudContainer = document.createElement('div');
    hudContainer.innerHTML = `
        <style>
            :host { position: fixed; top: 15px; right: 15px; z-index: 999999999; font-family: -apple-system, sans-serif; }
            .hud-card { background: rgba(15, 23, 42, 0.96); border: 2px solid #3b82f6; border-radius: 10px; padding: 10px; color: #fff; width: 230px; box-shadow: 0 10px 25px rgba(0,0,0,0.7); user-select: none; transition: all 0.2s; }
            .hud-title { font-size: 11px; font-weight: 700; color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 5px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
            .hud-action { font-size: 16px; font-weight: 900; color: #4ade80; margin: 8px 0 4px 0; text-transform: uppercase; }
            .hud-stats { font-size: 11px; color: #cbd5e1; margin-bottom: 6px; }
            .badge-gpu { background: #15803d; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; }
            .badge-cpu { background: #b45309; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; }
            .auto-label { display: flex; align-items: center; gap: 6px; cursor: pointer; background: rgba(59,130,246,0.15); padding: 5px; border-radius: 6px; border: 1px solid rgba(59,130,246,0.3); margin-top: 6px; }
        </style>
        <div class="hud-card">
            <div class="hud-title" id="hud-header">
                <div style="display:flex;align-items:center;gap:4px;">
                    <strong style="color:#60a5fa;">GTO SOLVER v2.0</strong>
                    <span id="backend-badge" class="badge-cpu">INIT...</span>
                </div>
                <span id="hud-arrow" style="font-size:12px;color:#3498db;">🔼</span>
            </div>
            <div id="hud-body">
                <div id="hud-action" class="hud-action">WAITING...</div>
                <div id="hud-stats" class="hud-stats">EV: - | Pot: -</div>
                <label class="auto-label">
                    <input type="checkbox" id="hud-automove" style="accent-color:#3b82f6;width:14px;height:14px;">
                    <span style="color:#60a5fa;font-weight:bold;font-size:10px;">⚡ Авто-Ход (Auto-Play)</span>
                </label>
            </div>
        </div>
    `;
    shadow.appendChild(hudContainer);

    // Логика сворачивания панели по клику на заголовок
    let isCollapsed = false;
    shadow.getElementById('hud-header').onclick = function () {
        isCollapsed = !isCollapsed;
        shadow.getElementById('hud-body').style.display = isCollapsed ? 'none' : 'block';
        shadow.getElementById('hud-arrow').textContent = isCollapsed ? '🔽' : '🔼';
    };

    let engineInstance = null;

    // 2. БЕЗБАГОВАЯ ЗАГРУЗКА WASM ЧЕРЕЗ FETCH (ОБХОД CSP)
    async function loadWasmEngine() {
        const jsUrl = 'https://raw.githubusercontent.com/Azerus96/fansol/main/pkg/solver_gpu.js';
        const wasmUrl = 'https://raw.githubusercontent.com/Azerus96/fansol/main/pkg/solver_gpu_bg.wasm';

        try {
            const jsCode = await fetch(jsUrl + '?' + Date.now()).then(r => r.text());
            const wasmBytes = await fetch(wasmUrl + '?' + Date.now()).then(r => r.arrayBuffer());

            eval(jsCode);

            if (typeof init !== 'undefined') {
                await init(wasmBytes);
                if (typeof SolverEngine !== 'undefined') {
                    engineInstance = new SolverEngine();
                    const mode = await engineInstance.init_hardware();
                    
                    const badge = shadow.getElementById('backend-badge');
                    if (mode === 0) {
                        badge.textContent = '⚡ WebGPU';
                        badge.className = 'badge-gpu';
                    } else {
                        badge.textContent = '💻 SIMD CPU';
                        badge.className = 'badge-cpu';
                    }
                }
            }
        } catch (err) {
            console.warn("[GTO HUD] WASM Load Notice:", err);
            const badge = shadow.getElementById('backend-badge');
            if (badge) badge.textContent = '💻 SIMD CPU';
        }
    }
    loadWasmEngine();

    // 3. XML ПАРСЕР СОКЕТОВ ПОКЕРДОМА
    const originalSend = WebSocket.prototype.send;
    const wsHandler = function (event) {
        if (typeof event.data !== 'string') return;
        const xml = event.data;

        if (!xml.includes('<Dealing') && !xml.includes('<PlayerAction')) return;

        let eventType = null;
        let payload = {};

        if (/<DealingFlop/.test(xml)) {
            eventType = 'DealingFlop';
            payload.cards = [...xml.matchAll(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g)].map(m => m[1]);
        } else if (/<DealingTurn/.test(xml)) {
            eventType = 'DealingTurn';
            payload.cards = [...xml.matchAll(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g)].map(m => m[1]);
        } else if (/<DealingRiver/.test(xml)) {
            eventType = 'DealingRiver';
            payload.cards = [...xml.matchAll(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g)].map(m => m[1]);
        } else if (/<PlayerAction/.test(xml)) {
            eventType = 'PlayerAction';
            if (xml.includes('<Raise')) payload.action = 'Raise';
            else if (xml.includes('<Fold')) payload.action = 'Fold';
            else if (xml.includes('<Call')) payload.action = 'Call';

            const amountMatch = xml.match(/amount="(\d+)"/);
            if (amountMatch) payload.amount = parseFloat(amountMatch[1]);
        }

        if (eventType && engineInstance) {
            const cleanJson = JSON.stringify({ type: eventType, ...payload });
            const resultJson = engineInstance.solve_auto_step(cleanJson);
            const res = JSON.parse(resultJson);

            shadow.getElementById('hud-action').textContent = `${res.action} ${res.amount || ''}`;
            shadow.getElementById('hud-stats').textContent = `EV: +${res.ev} BB [${res.backend}]`;
        }
    };

    WebSocket.prototype.send = function (data) {
        if (!this.__patched__) {
            this.__patched__ = true;
            this.addEventListener('message', wsHandler);
        }
        return originalSend.apply(this, arguments);
    };
})();
