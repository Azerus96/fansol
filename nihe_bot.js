(function () {
    if (window.__nlheBotActive) {
        alert('⚠️ NLHE Bot уже запущен!');
        return;
    }
    window.__nlheBotActive = true;
    console.log('🚀 NLHE Nit-Bot v1.0 (Multi-Table Edition) loaded!');

    // ==========================================
    // 1. БАЗА ДАННЫХ И СОСТОЯНИЯ СТОЛОВ
    // ==========================================
    let tables = new Map(); // Привязка WebSocket -> Состояние стола
    let playersDB = {};     // Глобальное досье на игроков { nickname: { hands: 0, vpip: 0, pfr: 0 } }

    function createTableState() {
        return {
            mySeat: -1,
            bbSize: 0,
            pot: 0,
            board: [],
            holeCards: [],
            players: {}, // seat -> { nick, stack, isAllin, active }
            currentStreet: 0, // 0-preflop, 1-flop, 2-turn, 3-river
            maxBet: 0
        };
    }

    // ==========================================
    // 2. ПОКЕРНАЯ МАТЕМАТИКА И СТРАТЕГИЯ
    // ==========================================
    const PREMIUM_HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'KQs'];

    function getHandString(cards) {
        if (cards.length !== 2) return '';
        let ranks = "23456789TJQKA";
        let r1 = cards[0][0], s1 = cards[0][1];
        let r2 = cards[1][0], s2 = cards[1][1];
        
        if (ranks.indexOf(r1) < ranks.indexOf(r2)) {
            let temp = r1; r1 = r2; r2 = temp;
        }
        let suited = (s1 === s2) ? 's' : (r1 === r2 ? '' : 'o');
        return r1 + r2 + suited;
    }

    // Главный мозг бота
    function decideAction(t) {
        let handStr = getHandString(t.holeCards);
        let myStack = t.players[t.mySeat] ? t.players[t.mySeat].stack : 0;
        
        // 1. Проверка правила "Защита стека" (Не рисковать всем стеком)
        let largestOpponentStack = 0;
        for (let seat in t.players) {
            if (parseInt(seat) !== t.mySeat && t.players[seat].active) {
                if (t.players[seat].stack > largestOpponentStack) {
                    largestOpponentStack = t.players[seat].stack;
                }
            }
        }

        let isSafeToAllin = largestOpponentStack <= (myStack / 2);

        // 2. ПРЕФЛОП СТРАТЕГИЯ
        if (t.currentStreet === 0) {
            if (PREMIUM_HANDS.includes(handStr)) {
                if (t.maxBet > t.bbSize) {
                    // Кто-то уже рейзил. Если безопасно - пушим/коллим, иначе фолд (кроме AA/KK)
                    if (isSafeToAllin || ['AA', 'KK', 'QQ', 'AKs'].includes(handStr)) {
                        return { action: 'RAISE', amount: t.maxBet * 3 };
                    } else {
                        return { action: 'FOLD' };
                    }
                } else {
                    // Никто не рейзил, мы открываемся 3x BB
                    return { action: 'RAISE', amount: t.bbSize * 3 };
                }
            } else {
                // Мусорные карты -> Мгновенный фолд
                return { action: 'FOLD' };
            }
        }

        // 3. ПОСТФЛОП СТРАТЕГИЯ (Упрощенная: играем только от совпадений)
        // В v1.0 бот играет постфлоп ОЧЕНЬ осторожно. Если есть агрессия - фолд.
        if (t.maxBet > 0) {
            return { action: 'FOLD' }; // Бот-нит сбрасывает на агрессию без натса
        } else {
            return { action: 'CHECK' }; // Бесплатно смотрим следующую карту
        }
    }

    // ==========================================
    // 3. ПАРСЕР XML ПАКЕТОВ ПОКЕРДОМА
    // ==========================================
    function parseNLHE(xml, t, ws) {
        // Узнаем размер ББ
        let bbMatch = xml.match(/<CurrentLevel[^>]*pointScore="(\d+)"/);
        if (bbMatch) t.bbSize = parseInt(bbMatch[1]);

        // Узнаем наше место
        let meMatch = xml.match(/<NewPlayer[^>]*me="true"[^>]*seat="(\d+)"/);
        if (meMatch) t.mySeat = parseInt(meMatch[1]);

        // Парсинг стеков и ников
        let playerMatch = /<PlayerInfo[^>]*nickname="([^"]+)"[^>]*>.*?<Chips[^>]*stack-size="(\d+)"/g;
        let pm;
        while ((pm = playerMatch.exec(xml)) !== null) {
            // В реальном логе нужно сопоставлять seat и nickname, здесь упрощенно
        }

        // Начало новой раздачи
        if (xml.includes('<NewHand')) {
            t.board = [];
            t.holeCards = [];
            t.currentStreet = 0;
            t.maxBet = t.bbSize;
            updateHUD();
        }

        // Раздача карманных карт
        if (xml.includes(`<DealingCards street="1"><Seat id="${t.mySeat}">`)) {
            let cards = xml.match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
            if (cards) {
                t.holeCards = cards.map(c => c.replace(/<[^>]+>/g, ''));
                updateHUD();
            }
        }

        // Раздача борда (Флоп, Терн, Ривер)
        let boardMatch = xml.match(/<DealingCards street="(2|3|4)">.*?<Cards>(.*?)<\/Cards>/);
        if (boardMatch) {
            t.currentStreet = parseInt(boardMatch[1]) - 1;
            let bCards = boardMatch[2].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
            if (bCards) {
                t.board.push(...bCards.map(c => c.replace(/<[^>]+>/g, '')));
                updateHUD();
            }
        }

        // Отслеживание VPIP (кто-то сделал Call или Raise)
        if (xml.includes('<Call/>') || xml.includes('<Raise')) {
            // Логика пополнения досье playersDB
        }

        // НАШ ХОД!
        let activeMatch = new RegExp(`<ActiveChange[^>]*seat="${t.mySeat}"`);
        if (activeMatch.test(xml)) {
            let decision = decideAction(t);
            
            // Выводим решение в HUD
            t.lastDecision = decision;
            updateHUD();

            // АВТО-ИГРА (Если включена галочка)
            if (document.getElementById('nlhe-automove').checked) {
                setTimeout(() => {
                    executeAction(decision, t.mySeat, ws);
                }, 1500); // Пауза 1.5 секунды для имитации человека
            }
        }
    }

    function executeAction(decision, seat, ws) {
        let xml = `<PlayerAction seat="${seat}">`;
        if (decision.action === 'FOLD') xml += `<Fold/>`;
        else if (decision.action === 'CHECK') xml += `<Call/>`; // В XML чек часто передается как колл 0
        else if (decision.action === 'CALL') xml += `<Call/>`;
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
    // 5. ИНТЕРФЕЙС (HUD) ДЛЯ 4 СТОЛОВ
    // ==========================================
    let isCollapsed = false;

    function renderHUD() {
        var parent = document.body || document.documentElement;
        if (document.getElementById('nlhe-bot-hud')) return;

        var hud = document.createElement('div');
        hud.id = 'nlhe-bot-hud';
        hud.style.cssText = 'position:fixed;top:55px;left:10px;z-index:9999999;background:rgba(10,15,25,0.95);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:1px solid #eab308;width:260px;transition:all 0.2s;';
        
        hud.innerHTML = `
            <div id="nlhe-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:5px;margin-bottom:5px;">
                <strong style="color:#eab308;font-size:13px;">🤖 NLHE Nit-Bot</strong>
                <span id="nlhe-arrow">🔼</span>
            </div>
            <div id="nlhe-body">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(234,179,8,0.15);padding:6px;border-radius:6px;margin-bottom:8px;">
                    <input type="checkbox" id="nlhe-automove" style="accent-color:#eab308;width:14px;height:14px;">
                    <span style="color:#fde047;font-weight:bold;">⚡ Авто-Игра (Auto-Fold/Bet)</span>
                </label>
                <div id="nlhe-tables-container" style="max-height:200px;overflow-y:auto;">
                    <div style="color:#888;text-align:center;">Ожидание раздач...</div>
                </div>
            </div>
        `;
        parent.appendChild(hud);

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
        tables.forEach((t, ws) => {
            if (t.holeCards.length > 0) {
                let handStr = getHandString(t.holeCards);
                let actionStr = t.lastDecision ? `<b style="color:#4ade80">${t.lastDecision.action}</b>` : 'Ожидание...';
                
                html += `
                <div style="background:#1f2937;padding:6px;border-radius:6px;margin-bottom:6px;">
                    <div style="color:#9ca3af;font-size:10px;">Стол ${tableCount} | ББ: ${t.bbSize}</div>
                    <div>Карты: <b style="color:#fff">${t.holeCards.join(' ')}</b> (${handStr})</div>
                    <div>Борд: <b style="color:#60a5fa">${t.board.join(' ')}</b></div>
                    <div style="margin-top:4px;border-top:1px dashed #444;padding-top:4px;">Совет: ${actionStr}</div>
                </div>`;
                tableCount++;
            }
        });
        
        if (html !== '') container.innerHTML = html;
    };

    renderHUD();
})();
