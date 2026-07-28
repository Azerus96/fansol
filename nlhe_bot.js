(function () {
    var oldHud = document.getElementById('nlhe-bot-hud');
    if (oldHud) oldHud.remove();

    window.__nlheBotActive = true;
    console.log('🚀 NLHE Nit-Bot v2.0 (Pokerdom Native Protocol) loaded!');

    // ==========================================
    // 1. БАЗА ДАННЫХ И СОСТОЯНИЯ СТОЛОВ
    // ==========================================
    let tables = new Map();

    function createTableState() {
        return {
            mySeat: -1,
            bbSize: 0,
            board: [],
            holeCards: [],
            currentStreet: 0, // 0-preflop, 1-flop, 2-turn, 3-river
            lastDecision: null
        };
    }

    // ==========================================
    // 2. ПОКЕРНАЯ МАТЕМАТИКА И СТРАТЕГИЯ (NIT-BOT)
    // ==========================================
    const PREMIUM_HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'KQs'];

    function getHandString(cards) {
        if (!cards || cards.length !== 2) return '';
        let ranks = "23456789TJQKA";
        let r1 = cards[0][0].toUpperCase(), s1 = cards[0][1].toLowerCase();
        let r2 = cards[1][0].toUpperCase(), s2 = cards[1][1].toLowerCase();
        
        if (ranks.indexOf(r1) < ranks.indexOf(r2)) {
            let temp = r1; r1 = r2; r2 = temp;
        }
        let suited = (s1 === s2) ? 's' : (r1 === r2 ? '' : 'o');
        return r1 + r2 + suited;
    }

    function decideAction(t) {
        let handStr = getHandString(t.holeCards);
        
        // Префлоп
        if (t.currentStreet === 0) {
            if (PREMIUM_HANDS.includes(handStr)) {
                if (['AA', 'KK', 'QQ', 'AKs'].includes(handStr)) {
                    return { action: 'RAISE 3x', amount: (t.bbSize || 800) * 3, type: 'RAISE' };
                } else {
                    return { action: 'CALL / RAISE', amount: (t.bbSize || 800) * 2.5, type: 'CALL' };
                }
            } else {
                return { action: 'FOLD', type: 'FOLD' };
            }
        }

        // Постфлоп
        return { action: 'CHECK / FOLD', type: 'CHECK' };
    }

    // ==========================================
    // 3. ПАРСЕР XML ПАКЕТОВ (АДАПТИРОВАН ПОД ЛОГ)
    // ==========================================
    function parseNLHE(xml, t, ws) {
        if (!xml || typeof xml !== 'string') return;

        // 1. Извлекаем размер ББ (highStake)
        let bbMatch = xml.match(/highStake="(\d+)"/);
        if (bbMatch) t.bbSize = parseInt(bbMatch[1]);

        // 2. Поиск нашего места и карманных карт (поиск не-xx карт)
        if (xml.includes('<DealingCards') || xml.includes('<NewHand')) {
            let seatMatches = xml.match(/<Seat id="(\d+)"><Cards>(.*?)<\/Cards><\/Seat>/g);
            if (seatMatches) {
                for (let sm of seatMatches) {
                    let seatId = sm.match(/<Seat id="(\d+)">/)[1];
                    let cardMatches = sm.match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                    if (cardMatches) {
                        let cards = cardMatches.map(c => c.replace(/<[^>]+>/g, ''));
                        let realCards = cards.filter(c => c.toLowerCase() !== 'xx');
                        if (realCards.length === 2) {
                            t.mySeat = parseInt(seatId);
                            t.holeCards = realCards;
                            t.board = [];
                            t.currentStreet = 0;
                            t.lastDecision = null;
                            updateHUD();
                        }
                    }
                }
            }
        }

        // 3. Доска (Флоп)
        if (xml.includes('<DealingFlop>')) {
            let flopCards = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/);
            if (flopCards) {
                let cards = flopCards[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (cards) {
                    t.board = cards.map(c => c.replace(/<[^>]+>/g, ''));
                    t.currentStreet = 1;
                    updateHUD();
                }
            }
        }

        // 4. Доска (Терн)
        if (xml.includes('<DealingTurn>')) {
            let turnCard = xml.match(/<DealingTurn><Cards>(.*?)<\/Cards><\/DealingTurn>/);
            if (turnCard) {
                let card = turnCard[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/);
                if (card) {
                    t.board.push(card[1]);
                    t.currentStreet = 2;
                    updateHUD();
                }
            }
        }

        // 5. Доска (Ривер)
        if (xml.includes('<DealingRiver>')) {
            let riverCard = xml.match(/<DealingRiver><Cards>(.*?)<\/Cards><\/DealingRiver>/);
            if (riverCard) {
                let card = riverCard[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/);
                if (card) {
                    t.board.push(card[1]);
                    t.currentStreet = 3;
                    updateHUD();
                }
            }
        }

        // 6. Наш ход
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
        if (decision.type === 'FOLD') xml += `<Fold/>`;
        else if (decision.type === 'CHECK' || decision.type === 'CALL') xml += `<Call/>`;
        else if (decision.type === 'RAISE') xml += `<Raise amount="${decision.amount}"/>`;
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
        hud.style.cssText = 'position:fixed;top:60px;left:10px;z-index:999999999;background:rgba(10,15,25,0.95);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:2px solid #eab308;width:270px;box-shadow:0 10px 30px rgba(0,0,0,0.8);user-select:none;';
        
        hud.innerHTML = `
            <div id="nlhe-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span id="nlhe-dot">🟢</span>
                    <strong style="color:#fde047;font-size:13px;">🤖 NLHE Nit-Bot v2.0</strong>
                </div>
                <span id="nlhe-arrow" style="font-size:14px;color:#3498db;">🔼</span>
            </div>
            <div id="nlhe-body">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(234,179,8,0.15);padding:6px 8px;border-radius:6px;margin-bottom:8px;border:1px solid rgba(234,179,8,0.3);">
                    <input type="checkbox" id="nlhe-automove" style="accent-color:#eab308;width:15px;height:15px;">
                    <span style="color:#fde047;font-weight:bold;font-size:11px;">⚡ Авто-Игра (Auto-Fold/Bet)</span>
                </label>
                <div id="nlhe-tables-container" style="max-height:220px;overflow-y:auto;">
                    <div style="color:#aaa;text-align:center;padding:10px;font-size:11px;">🟡 Бот активен. Ожидание раздачи...</div>
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
                let actionStr = t.lastDecision ? `<b style="color:#4ade80;font-size:13px;">${t.lastDecision.action}</b>` : 'Ожидание...';
                
                html += `
                <div style="background:#1f2937;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #374151;">
                    <div style="color:#9ca3af;font-size:10px;margin-bottom:2px;">Стол ${tableCount} | Место: ${t.mySeat} | ББ: ${t.bbSize}</div>
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
