(function () {
    var oldHud = document.getElementById('nlhe-bot-hud');
    if (oldHud) oldHud.remove();

    window.__nlheBotActive = true;
    console.log('🚀 NLHE Pro Engine v3.0 (Full GTO/Exploit Engine) loaded!');

    // ==========================================
    // 1. БАЗА ДАННЫХ И МУЛЬТИ-СТОЛЫ
    // ==========================================
    let tables = new Map();

    function createTableState() {
        return {
            mySeat: -1,
            bbSize: 800,
            myStack: 0,
            board: [],
            holeCards: [],
            currentStreet: 0, // 0-pre, 1-flop, 2-turn, 3-river
            dealerSeat: 0,
            activeSeatsCount: 8,
            myPosition: 'MP',
            maxOpponentStack: 0,
            lastDecision: null,
            playersHud: {} // seat -> { vpip, pfr, afq, style }
        };
    }

    // ==========================================
    // 2. ДИАПАЗОНЫ И МАТРИЦЫ РУК (14-30 ББ)
    // ==========================================
    const RANGES = {
        BTN: ['22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','A2o','A3o','A4o','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','K7o','K8o','K9o','KTo','KJo','KQo','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','Q8o','Q9o','QTo','QJo','J7s','J8s','J9s','JTs','J8o','J9o','JTo','T7s','T8s','T9s','T8o','T9o','97s','98s','87s','76s','65s'],
        CO:  ['22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','A7o','A8o','A9o','ATo','AJo','AQo','AKo','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','K9o','KTo','KJo','KQo','Q8s','Q9s','QTs','QJs','QTo','QJo','J8s','J9s','JTs','JTo','T8s','T9s','98s','87s'],
        MP:  ['44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','ATo','AJo','AQo','AKo','K8s','K9s','KTs','KJs','KQs','KJo','KQo','Q9s','QTs','QJs','QJo','J9s','JTs','T9s'],
        UTG: ['66','77','88','99','TT','JJ','QQ','KK','AA','A9s','ATs','AJs','AQs','AKs','ATo','AJo','AQo','AKo','KTs','KJs','KQs','KQo','QTs','QJs','JTs'],
        SB:  ['22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','A4o','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','K8o','K9o','KTo','KJo','KQo','Q6s','Q7s','Q8s','Q9s','QTs','QJs','Q9o','QTo','QJo','J7s','J8s','J9s','JTs','T8s','T9s']
    };

    function getHandString(cards) {
        if (!cards || cards.length !== 2) return '';
        const ranks = "23456789TJQKA";
        let r1 = cards[0][0].toUpperCase(), s1 = cards[0][1].toLowerCase();
        let r2 = cards[1][0].toUpperCase(), s2 = cards[1][1].toLowerCase();
        if (r1 === '1') r1 = 'T'; if (r2 === '1') r2 = 'T';
        if (ranks.indexOf(r1) < ranks.indexOf(r2)) {
            let tmp = r1; r1 = r2; r2 = tmp;
        }
        if (r1 === r2) return r1 + r2;
        return r1 + r2 + (s1 === s2 ? 's' : 'o');
    }

    // ==========================================
    // 3. ПОЗИЦИОННЫЙ И ПОСТФЛОП ОЦЕНЩИК
    // ==========================================
    function calculatePosition(dealerSeat, mySeat, activeSeatsCount) {
        if (mySeat === -1) return 'MP';
        let diff = (mySeat - dealerSeat + activeSeatsCount) % activeSeatsCount;
        if (diff === 0) return 'BTN';
        if (diff === 1) return 'SB';
        if (diff === 2) return 'BB';
        if (diff === 3) return 'UTG';
        if (diff === activeSeatsCount - 1) return 'CO';
        return 'MP';
    }

    function evaluatePostflop(holeCards, board) {
        if (!holeCards || holeCards.length !== 2 || !board || board.length < 3) {
            return { category: 'UNKNOWN', power: 0 };
        }

        const ranksStr = "23456789TJQKA";
        let allCards = [...holeCards, ...board];
        
        let holeRanks = holeCards.map(c => c[0].toUpperCase() === '1' ? 'T' : c[0].toUpperCase());
        let boardRanks = board.map(c => c[0].toUpperCase() === '1' ? 'T' : c[0].toUpperCase());
        let holeSuits = holeCards.map(c => c[c.length - 1].toLowerCase());
        let boardSuits = board.map(c => c[c.length - 1].toLowerCase());

        let maxBoardRankIdx = Math.max(...boardRanks.map(r => ranksStr.indexOf(r)));

        // Подсчет совпадений пар
        let matches = 0;
        let isTopPair = false;
        let isSet = false;

        holeRanks.forEach(hr => {
            if (boardRanks.includes(hr)) {
                matches++;
                if (ranksStr.indexOf(hr) === maxBoardRankIdx) isTopPair = true;
            }
        });

        if (holeRanks[0] === holeRanks[1] && boardRanks.includes(holeRanks[0])) {
            isSet = true;
        }

        // Подсчет Флеш-дро / Флеша
        let suitCounts = {};
        [...holeSuits, ...boardSuits].forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
        let maxSuitCount = Math.max(...Object.values(suitCounts));

        if (isSet || matches >= 2) return { category: 'NUTS', power: 90 };
        if (maxSuitCount >= 5) return { category: 'NUTS', power: 95 };
        if (isTopPair) return { category: 'STRONG', power: 70 };
        if (maxSuitCount === 4) return { category: 'FLUSH_DRAW', power: 55 };
        if (matches === 1) return { category: 'PAIR', power: 45 };

        return { category: 'WEAK', power: 10 };
    }

    // ==========================================
    // 4. ДВИЖОК ПРИНЯТИЯ РЕШЕНИЙ (DECISION BRAIN)
    // ==========================================
    function decideAction(t) {
        let handStr = getHandString(t.holeCards);
        let myStackBB = t.bbSize > 0 ? (t.myStack / t.bbSize) : 20;
        let position = calculatePosition(t.dealerSeat, t.mySeat, t.activeSeatsCount);
        
        // Правило защиты стека (Не рисковать против стека > 50% нашего)
        let isSafeToAllIn = t.maxOpponentStack <= (t.myStack * 0.5);

        // --- ПРЕФЛОП ---
        if (t.currentStreet === 0) {
            let activeRange = RANGES[position] || RANGES.MP;
            
            // Если стек совсем короткий (< 12 ББ) - активируем Пуш-Фолд Нэша
            if (myStackBB <= 12) {
                if (activeRange.includes(handStr)) {
                    if (isSafeToAllIn || ['AA', 'KK', 'QQ', 'AKs'].includes(handStr)) {
                        return { action: 'ALL-IN ⚡', amount: t.myStack, type: 'RAISE' };
                    }
                }
                return { action: 'FOLD', type: 'FOLD' };
            }

            // Стандартная игра (14-30 ББ)
            if (activeRange.includes(handStr)) {
                // Если премиум - делаем умеренный рейз 3x BB
                return { action: 'RAISE 3x', amount: t.bbSize * 3, type: 'RAISE' };
            } else {
                return { action: 'FOLD', type: 'FOLD' };
            }
        }

        // --- ПОСТФЛОП ---
        let evalRes = evaluatePostflop(t.holeCards, t.board);

        if (evalRes.category === 'NUTS') {
            return { action: 'BET / VALUE 66%', amount: Math.floor(t.bbSize * 4), type: 'RAISE' };
        } else if (evalRes.category === 'STRONG') {
            return { action: 'BET 33% / CALL', amount: Math.floor(t.bbSize * 2), type: 'CALL' };
        } else if (evalRes.category === 'FLUSH_DRAW') {
            return { action: 'CHECK / CALL SMALL', amount: t.bbSize, type: 'CALL' };
        } else {
            return { action: 'CHECK / FOLD', type: 'CHECK' };
        }
    }

    // ==========================================
    // 5. ПАРСЕР XML СОКЕТОВ
    // ==========================================
    function parseNLHE(xml, t, ws) {
        if (!xml || typeof xml !== 'string') return;

        let bbMatch = xml.match(/highStake="(\d+)"/);
        if (bbMatch) t.bbSize = parseInt(bbMatch[1]);

        let dealerMatch = xml.match(/dealer="(\d+)"/);
        if (dealerMatch) t.dealerSeat = parseInt(dealerMatch[1]);

        // Парсинг HUD соперников
        if (xml.includes('<HudStats')) {
            let seatHudMatch = xml.match(/<HudChange[^>]*seat="(\d+)"/);
            if (seatHudMatch) {
                let seatId = seatHudMatch[1];
                let vpipM = xml.match(/type="VPIP"\s+value="([\d.]+)"/);
                if (vpipM) {
                    let vpipVal = parseFloat(vpipM[1]);
                    let style = vpipVal > 50 ? 'FISH 🐟' : (vpipVal < 15 ? 'NIT 🪨' : 'REG 🎯');
                    t.playersHud[seatId] = { vpip: vpipVal, style: style };
                }
            }
        }

        // Поиск нашего места и карт
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

        // Парсинг борда
        if (xml.includes('<DealingFlop>')) {
            let cards = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/);
            if (cards) {
                let c = cards[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (c) { t.board = c.map(x => x.replace(/<[^>]+>/g, '')); t.currentStreet = 1; updateHUD(); }
            }
        }
        if (xml.includes('<DealingTurn>')) {
            let card = xml.match(/<DealingTurn><Cards>(.*?)<\/Cards><\/DealingTurn>/);
            if (card) {
                let c = card[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/);
                if (c) { t.board.push(c[1]); t.currentStreet = 2; updateHUD(); }
            }
        }
        if (xml.includes('<DealingRiver>')) {
            let card = xml.match(/<DealingRiver><Cards>(.*?)<\/Cards><\/DealingRiver>/);
            if (card) {
                let c = card[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/);
                if (c) { t.board.push(c[1]); t.currentStreet = 3; updateHUD(); }
            }
        }

        // НАШ ХОД!
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
        try { ws.send(xml); } catch (e) {}
    }

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
    // 6. ИНТЕРФЕЙС И ОТОБРАЖЕНИЕ (HUD)
    // ==========================================
    function renderHUD() {
        var parent = document.body || document.documentElement;
        if (!parent) return;

        var hud = document.createElement('div');
        hud.id = 'nlhe-bot-hud';
        hud.style.cssText = 'position:fixed;top:60px;left:10px;z-index:999999999;background:rgba(10,15,25,0.96);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:2px solid #eab308;width:280px;box-shadow:0 10px 30px rgba(0,0,0,0.8);user-select:none;';
        
        hud.innerHTML = `
            <div id="nlhe-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span id="nlhe-dot">🟢</span>
                    <strong style="color:#fde047;font-size:13px;">🤖 NLHE Pro Engine v3.0</strong>
                </div>
                <span id="nlhe-arrow" style="font-size:14px;color:#3498db;">🔼</span>
            </div>
            <div id="nlhe-body">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(234,179,8,0.15);padding:6px 8px;border-radius:6px;margin-bottom:8px;border:1px solid rgba(234,179,8,0.3);">
                    <input type="checkbox" id="nlhe-automove" style="accent-color:#eab308;width:15px;height:15px;">
                    <span style="color:#fde047;font-weight:bold;font-size:11px;">⚡ Авто-Игра (Auto-Play)</span>
                </label>
                <div id="nlhe-tables-container" style="max-height:240px;overflow-y:auto;">
                    <div style="color:#aaa;text-align:center;padding:10px;font-size:11px;">🟡 Сокет подключен. Ожидание раздач...</div>
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
                let pos = calculatePosition(t.dealerSeat, t.mySeat, t.activeSeatsCount);
                let actionStr = t.lastDecision ? `<b style="color:#4ade80;font-size:13px;">${t.lastDecision.action}</b>` : 'Считаем...';
                
                html += `
                <div style="background:#1f2937;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #374151;">
                    <div style="color:#9ca3af;font-size:10px;display:flex;justify-content:space-between;margin-bottom:2px;">
                        <span>Стол ${tableCount} | Поз: <b style="color:#60a5fa">${pos}</b></span>
                        <span>ББ: ${t.bbSize}</span>
                    </div>
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
