(function () {
    'use strict';

    if (window.__POKER_SOLVER_INITIALIZED__) return;
    window.__POKER_SOLVER_INITIALIZED__ = true;

    // 1. Изолированный Shadow DOM HUD
    const host = document.createElement('div');
    host.id = 'poker-solver-hud-host';
    (document.body || document.documentElement).appendChild(host);
    
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
        <style>
            .hud-card { position: fixed; top: 15px; right: 15px; z-index: 999999999; font-family: -apple-system, sans-serif; background: rgba(15, 23, 42, 0.95); border: 1px solid #3b82f6; border-radius: 10px; padding: 12px; color: #fff; width: 220px; box-shadow: 0 10px 25px rgba(0,0,0,0.6); backdrop-filter: blur(4px); user-select: none; }
            .hud-title { font-size: 10px; font-weight: 700; color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 5px; display: flex; justify-content: space-between; align-items: center; }
            .hud-action { font-size: 16px; font-weight: 900; color: #22c55e; margin: 8px 0 4px 0; text-transform: uppercase; }
            .hud-stats { font-size: 11px; color: #cbd5e1; }
            .badge-gpu { background: #15803d; color: #ffffff; padding: 2px 5px; border-radius: 4px; font-size: 9px; font-weight: 700; }
            .badge-cpu { background: #b45309; color: #ffffff; padding: 2px 5px; border-radius: 4px; font-size: 9px; font-weight: 700; }
        </style>
        <div class="hud-card">
            <div class="hud-title">
                <span>GTO SOLVER v2.0</span>
                <span id="backend-badge" class="badge-cpu">CONNECT...</span>
            </div>
            <div id="hud-action" class="hud-action">WAITING...</div>
            <div id="hud-stats" class="hud-stats">EV: - | Pot: -</div>
        </div>
    `;

    let engineInstance = null;

    // 2. Абсолютная загрузка WASM с CDN jsDelivr
    const CDN_BASE = 'https://cdn.jsdelivr.net/gh/Azerus96/fansol@main/pkg';
    import(`${CDN_BASE}/solver_gpu.js?${Date.now()}`).then(async (wasm) => {
        await wasm.default(`${CDN_BASE}/solver_gpu_bg.wasm`);
        
        engineInstance = new wasm.SolverEngine();
        const mode = await engineInstance.init_hardware();
        
        const badge = shadow.getElementById('backend-badge');
        if (mode === 0) {
            badge.textContent = '⚡ WebGPU';
            badge.className = 'badge-gpu';
        } else {
            badge.textContent = '💻 SIMD CPU';
            badge.className = 'badge-cpu';
        }
    }).catch(err => console.error("[GTO HUD] WASM Load Failed:", err));

    // 3. ИСПРАВЛЕННЫЙ XML ПАРСЕР ПОКЕРДОМА
    const originalSend = WebSocket.prototype.send;
    const wsHandler = function (event) {
        if (typeof event.data !== 'string') return;
        const xml = event.data;

        if (!xml.includes('<Dealing') && !xml.includes('<PlayerAction')) return;

        let eventType = null;
        let payload = {};

        // ИСПРАВЛЕНО: Извлечение карт из внутреннего текста <Card id="0">8h</Card>
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
            // ИСПРАВЛЕНО: Извлечение действий из дочерних тегов <Raise>, <Fold>, <Call>
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
