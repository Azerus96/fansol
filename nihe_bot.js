(function () {
    // Удаляем старый HUD, если он был
    var oldHud = document.getElementById('nlhe-bot-hud');
    if (oldHud) oldHud.remove();

    window.__nlheBotActive = true;
    console.log('🚀 NLHE Nit-Bot v1.1 loaded!');

    // ==========================================
    // 1. БАЗА ДАННЫХ И СОСТОЯНИЯ СТОЛОВ
    // ==========================================
    let tables = new Map();
    let playersDB = {};

    function createTableState() {
        return {
            mySeat: -1,
            bbSize: 0,
            pot: 0,
            board: [],
            holeCards: [],
            players: {},
            currentStreet: 0,
            maxBet: 0,
            lastDecision: null
        };
    }

    // ==========================================
    // 2. ПОКЕРНАЯ МАТЕМАТИКА И СТРАТЕГИЯ (NIT-BOT)
    // ==========================================
    const PREMIUM_HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'KQs'];

    function getHandString(cards) {
        if (!cards || cards.length !== 2) return '';
        let ranks = "23456789TJQKA";
        let r1 = cards[0][0], s1 = cards[0][1];
        let r2 = cards[1][0], s2 = cards[1][1];
        
        if (ranks.indexOf(r1) < ranks.indexOf(r2)) {
            let temp = r1; r1 = r2; r2 = temp;
        }
        let suited = (s1 === s2) ? 's' : (r1 === r2 ? '' : 'o');
        return r1 + r2 + suited;
    }

    function decideAction(t) {
        let handStr = getHandString(t.holeCards);
        let myStack = t.players[t.mySeat] ? t.players[t.mySeat].stack : 0;
        
        let largestOpponentStack = 0;
        for (let seat in t.players) {
            if (parseInt(seat) !== t.mySeat && t.players[seat].active) {
                if (t.players[seat].stack > largestOpponentStack) {
                    largestOpponentStack = t.players[seat].stack;
                }
            }
        }

        let isSafeToAllin = largestOpponentStack <= (myStack / 2);

        // Префлоп
        if (t.currentStreet === 0) {
            if (PREMIUM_HANDS.includes(handStr)) {
                if (t.maxBet > t.bbSize) {
                    if (isSafeToAllin || ['AA', 'KK', 'QQ', 'AKs'].includes(handStr)) {
                        return { action: 'RAISE', amount: t.maxBet * 3 };
                    } else {
                        return { action: 'FOLD' };
                    }
                } else {
                    return { action: 'RAISE', amount: Math.max(t.bbSize * 3, 300) };
                }
            } else {
                return { action: 'FOLD' };
            }
        }

        // Постфлоп (Пассивно-безопасный)
        if (t.maxBet > 0) {
            return { action: 'FOLD' };
        } else {
            return { action: 'CHECK' };
        }
    }

    // ==========================================
    // 3. ПАРСЕР XML ПАКЕТОВ
    // ==========================================
    function parseNLHE(xml, t, ws) {
        if (!xml || typeof xml !== 'string') return;

        let bbMatch = xml.match(/<CurrentLevel[^>]*pointScore="(\d+)"/);
        if (bbMatch) t.bbSize = parseInt(bbMatch[1]);

        let meMatch = xml.match(/<NewPlayer[^>]*me="true"[^>]*seat="(\d+)"/);
        if (meMatch) t.mySeat = parseInt(meMatch[1]);

        if (xml.includes('<NewHand')) {
            t.board = [];
            t.holeCards = [];
            t.currentStreet = 0;
            t.maxBet = t.bbSize;
            updateHUD();
        }

        if (t.mySeat !== -1 && xml.includes('<DealingCards') && xml.includes(`seat="${t.mySeat}"`)) {
            let cards = xml.match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
            if (cards) {
                t.holeCards = cards.map(c => c.replace(/<[^>]+>/g, ''));
                updateHUD();
            }
        }

        let boardMatch = xml.match(/<DealingCards street="(2|3|4)">.*?<Cards>(.*?)<\/Cards>/);
        if (boardMatch) {
            t.currentStreet = parseInt(boardMatch[1]) - 1;
            let bCards = boardMatch[2].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
            if (bCards) {
                t.board.push(...bCards.map(c => c.replace(/<[^>]+>/g, '')));
                updateHUD();
            }
        }

        if (t.mySeat !== -1 && xml.includes(`<ActiveChange`) && xml.includes(`seat="${t.mySeat}"`)) {
            let decision = decideAction(t);
            t.lastDecision = decision;
            updateHUD();

            let autoCheck = document.getElementById('nlhe-automove');
            if (autoCheck && autoCheck.checked) {
                setTimeout(() => {
                    executeAction(decision, t.mySeat, ws);
                }, 1200);
            }
        }
    }

    function executeAction(decision, seat, ws) {
        let xml = `<PlayerAction seat="${seat}">`;
        if (decision.action === 'FOLD') xml += `<Fold/>`;
        else if (decision.action === 'CHECK' || decision.action === 'CALL') xml += `<Call/>`;
        else if (decision.action === 'RAISE') xml += `<Raise amount="${decision.amount}"/>`;
        xml += `</PlayerAction>`;
        
        try {
            ws.send(xml);
            console.log('🤖 Бот сделал ход:', xml);
        } catch (e) {}
    }

    // ==========================================
    // 4. ПЕРЕХВАТ СОКЕТОВ
    // ==========================================
    function hookSocket(ws) {
        if (!ws || ws.__nlheHooked) return;
        ws.__nlheHooked = true;
        tables.set(ws, createTableState());

        ws.addEventListener('message', function (e) {
            let rawData = typeof e.data === 'string' ? e.data : (window.TextDecoder ? new TextDecoder().decode(e.data) : '');
            let t = tables.get(ws);
            parseNLHE(rawData, t, ws);
        });
    }

    var origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        hookSocket(this);
        return origSend.apply(this, arguments);
    };

    var OrigWS = window.WebSocket;
    function HookedWS(url, protocols) {
        var ws = new OrigWS(url, protocols);
        hookSocket(ws);
        return ws;
    }
    HookedWS.prototype = OrigWS.prototype;
    window.WebSocket = HookedWS;

    try {
        for (var key in window) {
            if (window[key] && window[key] instanceof OrigWS) hookSocket(window[key]);
        }
    } catch (e) {}

    // ==========================================
    // 5. ИНТЕРФЕЙС (HUD)
    // ==========================================
    function renderHUD() {
        var parent = document.body || document.documentElement;
        if (!parent) return;

        var hud = document.createElement('div');
        hud.id = 'nlhe-bot-hud';
        hud.style.cssText = 'position:fixed;top:60px;left:10px;z-index:999999999;background:rgba(10,15,25,0.96);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:2px solid #eab308;width:270px;box-shadow:0 10px 30px rgba(0,0,0,0.8);user-select:none;';
        
        hud.innerHTML = `
            <div id="nlhe-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span id="nlhe-dot">🟢</span>
                    <strong style="color:#fde047;font-size:13px;">🤖 NLHE Nit-Bot v1.1</strong>
                </div>
                <span id="nlhe-arrow" style="font-size:14px;color:#3498db;">🔼</span>
            </div>
            <div id="nlhe-body">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(234,179,8,0.15);padding:6px 8px;border-radius:6px;margin-bottom:8px;border:1px solid rgba(234,179,8,0.3);">
                    <input type="checkbox" id="nlhe-automove" style="accent-color:#eab308;width:15px;height:15px;">
                    <span style="color:#fde047;font-weight:bold;font-size:11px;">⚡ Авто-Игра (Auto-Play)</span>
                </label>
                <div id="nlhe-tables-container" style="max-height:220px;overflow-y:auto;">
                    <div style="color:#aaa;text-align:center;padding:10px;font-size:11px;">🟡 Бот активен. Ожидание раздач...</div>
                </div>
            </div>
        `;
        parent.appendChild(hud);

        let isCollapsed = false;
        document.getElementById('nlhe-header').onclick = function () {
            isCollapsed = !isCollapsed;
            document.getElementById('nlhe-body').style.display = isCollapsed ? 'none' : 'block';
            document.getElementById('nlhe-arrow').textContent = isCollapsed ? '🔽' : '🔼';
        };
    }

    window.updateHUD = function() {
        let container = document.getElementById('nlhe-tables-container');
        if (!container) return;
        
        let html = '';
        let tableCount = 1;
        tables.forEach((t) => {
            if (t.holeCards.length > 0) {
                let handStr = getHandString(t.holeCards);
                let actionStr = t.lastDecision ? `<b style="color:#4ade80;font-size:13px;">${t.lastDecision.action}</b>` : 'Считаем...';
                
                html += `
                <div style="background:#1f2937;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #374151;">
                    <div style="color:#9ca3af;font-size:10px;margin-bottom:2px;">Стол ${tableCount} | ББ: ${t.bbSize}</div>
                    <div>Карты: <b style="color:#fde047;font-size:13px;">${t.holeCards.join(' ')}</b> (${handStr})</div>
                    <div>Борд: <b style="color:#60a5fa">${t.board.length ? t.board.join(' ') : '—'}</b></div>
                    <div style="margin-top:4px;border-top:1px dashed #444;padding-top:4px;">Совет: ${actionStr}</div>
                </div>`;
                tableCount++;
            }
        });
        
        if (html !== '') container.innerHTML = html;
    };

    renderHUD();
})();
