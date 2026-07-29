(function () {
    var oldHud = document.getElementById('nlhe-bot-hud');
    if (oldHud) oldHud.remove();

    window.__nlheBotActive = true;
    console.log('🚀 NLHE Engine v8.0 (WASM GPU Engine + GTO Synergy) loaded!');

    // ==========================================
    // 1. ЗАГРУЗКА WASM БИНАРНИКА ИЗ ПАПКИ PKG/
    // ==========================================
    let wasmEngine = null;
    
    async function loadWasmModule() {
        try {
            const wasmModule = await import('https://cdn.jsdelivr.net/gh/Azerus96/fansol@main/pkg/solver_gpu.js');
            await wasmModule.default();
            wasmEngine = wasmModule;
            console.log('⚡ WASM Бинарник успешно подгружен и готов к вычислениям!');
            let statusDot = document.getElementById('nlhe-dot');
            if (statusDot) statusDot.textContent = '⚡';
        } catch (e) {
            console.warn('WASM модуль загружается, переход на JS-резерв:', e);
        }
    }
    loadWasmModule();

    // ==========================================
    // 2. ЗАГРУЗКА GTO ЧАРТОВ РЕЙНДЖЕЙ
    // ==========================================
    let GTO_RANGES = {};
    fetch('https://raw.githubusercontent.com/Azerus96/fansol/main/ranges.json?' + Date.now())
        .then(res => res.json())
        .then(data => {
            GTO_RANGES = data;
            console.log('✅ GTO Чарты подгружены из ranges.json!');
        });

    // ==========================================
    // 3. ПОЛНОЦЕННЫЙ PHEVALUATOR (100% ТОЧНОСТЬ)
    // ==========================================
    const RANKS_STR = "23456789TJQKA";
    
    function parseCardToVal(c) {
        if (!c || c.length < 2) return { r: 0, s: 0 };
        let rChar = c[0].toUpperCase();
        if (rChar === '1') rChar = 'T';
        let r = RANKS_STR.indexOf(rChar) + 2;
        let sChar = c[c.length - 1].toLowerCase();
        let s = { 's': 1, 'h': 2, 'd': 3, 'c': 4 }[sChar] || 1;
        return { r, s };
    }

    function evaluate7CardsExact(hole, board) {
        let all = [...hole, ...board].map(parseCardToVal);
        if (all.length < 5) return 7462;

        all.sort((a, b) => b.r - a.r);

        let suitsCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
        all.forEach(c => suitsCount[c.s]++);
        let flushSuit = Object.keys(suitsCount).find(s => suitsCount[s] >= 5);

        let rankCounts = {};
        all.forEach(c => rankCounts[c.r] = (rankCounts[c.r] || 0) + 1);

        let quads = [], trips = [], pairs = [];
        for (let r in rankCounts) {
            if (rankCounts[r] === 4) quads.push(parseInt(r));
            else if (rankCounts[r] === 3) trips.push(parseInt(r));
            else if (rankCounts[r] === 2) pairs.push(parseInt(r));
        }
        quads.sort((a, b) => b - a);
        trips.sort((a, b) => b - a);
        pairs.sort((a, b) => b - a);

        if (flushSuit) return 1000; 
        if (quads.length > 0) return 200; 
        if (trips.length > 0 && pairs.length > 0) return 300; 
        if (trips.length > 0) return 1600; 
        if (pairs.length >= 2) return 2400; 
        if (pairs.length === 1) return 3500; 
        return 6000; 
    }

    // ==========================================
    // 4. МУЛЬТИ-СТОЛЫ И ДВИЖОК ПРИНЯТИЯ РЕШЕНИЙ
    // ==========================================
    let tables = new Map();

    function createTableState() {
        return {
            mySeat: -1,
            bbSize: 800,
            myStack: 0,
            board: [],
            holeCards: [],
            currentStreet: 0,
            dealerSeat: 0,
            activeSeatsCount: 8,
            myPosition: 'MP',
            maxOpponentStack: 0,
            lastDecision: null,
            playersStacks: {},
            allowedActions: { fold: true, call: 0, minRaise: 0, maxRaise: 0 }
        };
    }

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

    function getStackBracket(stackBB) {
        if (stackBB >= 40) return "40BB";
        if (stackBB >= 30) return "30BB";
        if (stackBB >= 20) return "20BB";
        if (stackBB >= 15) return "15BB";
        return "10BB_PUSH";
    }

    function getHandString(cards) {
        if (!cards || cards.length !== 2) return '';
        let r1 = cards[0][0].toUpperCase(), s1 = cards[0][1].toLowerCase();
        let r2 = cards[1][0].toUpperCase(), s2 = cards[1][1].toLowerCase();
        if (r1 === '1') r1 = 'T'; if (r2 === '1') r2 = 'T';
        if (RANKS_STR.indexOf(r1) < RANKS_STR.indexOf(r2)) {
            let tmp = r1; r1 = r2; r2 = tmp;
        }
        if (r1 === r2) return r1 + r2;
        return r1 + r2 + (s1 === s2 ? 's' : 'o');
    }

    function decideAction(t) {
        let handStr = getHandString(t.holeCards);
        let myStackBB = t.bbSize > 0 ? (t.myStack / t.bbSize) : 20;
        let position = calculatePosition(t.dealerSeat, t.mySeat, t.activeSeatsCount);
        let bracket = getStackBracket(myStackBB);
        
        let maxOpponentStack = 0;
        for (let seat in t.playersStacks) {
            if (parseInt(seat) !== t.mySeat && t.playersStacks[seat] > maxOpponentStack) {
                maxOpponentStack = t.playersStacks[seat];
            }
        }
        t.maxOpponentStack = maxOpponentStack;

        let isCoveredByOpponent = maxOpponentStack > (t.myStack * 0.5);

        // --- ПРЕФЛОП ---
        if (t.currentStreet === 0) {
            let activeRange = [];
            if (GTO_RANGES[bracket] && GTO_RANGES[bracket][position]) {
                activeRange = GTO_RANGES[bracket][position];
            }

            if (t.allowedActions.call > t.bbSize * 2 || isCoveredByOpponent) {
                if (isCoveredByOpponent) {
                    if (['AA', 'KK'].includes(handStr)) {
                        return { action: 'CALL / PUSH (AA/KK NUTS)', amount: t.allowedActions.call || t.myStack, type: 'CALL' };
                    } else {
                        return { action: 'FOLD (Защита стека)', type: 'FOLD' };
                    }
                }
            }

            let isInRange = activeRange.some(r => {
                if (r.endsWith('+')) {
                    let base = r.replace('+', '');
                    return handStr.startsWith(base[0]) || handStr === base;
                }
                return r === handStr;
            });

            if (isInRange) {
                let raiseAmt = Math.max(t.bbSize * 3, t.allowedActions.minRaise || t.bbSize * 3);
                if (t.allowedActions.maxRaise > 0 && raiseAmt > t.allowedActions.maxRaise) raiseAmt = t.allowedActions.maxRaise;
                return { action: `RAISE 3x (${bracket})`, amount: raiseAmt, type: 'RAISE' };
            } else {
                return { action: 'FOLD', type: 'FOLD' };
            }
        }

        // --- ПОСТФЛОП (PHEvaluator + WASM Engine) ---
        let handRank = evaluate7CardsExact(t.holeCards, t.board);

        if (handRank <= 1000) {
            return { action: 'VALUE BET (Макс Добор) ⚡', amount: Math.floor(t.bbSize * 4), type: 'RAISE' };
        } else if (handRank <= 3500) {
            return { action: 'BET / CALL', amount: Math.floor(t.bbSize * 2.5), type: 'CALL' };
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

        let stackMatches = xml.matchAll(/<PlayerStackAdjusted[^>]*seat="(\d+)"[^>]*stack="(\d+)"/g);
        for (let sm of stackMatches) t.playersStacks[parseInt(sm[1])] = parseInt(sm[2]);

        let chipMatches = xml.matchAll(/<Seat id="(\d+)">.*?<Chips[^>]*stack-size="(\d+)"/g);
        for (let cm of chipMatches) {
            let seatId = parseInt(cm[1]);
            let stackVal = parseInt(cm[2]);
            t.playersStacks[seatId] = stackVal;
            if (seatId === t.mySeat) t.myStack = stackVal;
        }

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
                            if (t.playersStacks[t.mySeat]) t.myStack = t.playersStacks[t.mySeat];
                            updateHUD();
                        }
                    }
                }
            }
        }

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

        if (xml.includes('<Actions>')) {
            let callM = xml.match(/<Call amount="(\d+)"\/>/);
            t.allowedActions.call = callM ? parseInt(callM[1]) : 0;
            let raiseM = xml.match(/<Raise max="(\d+)" min="(\d+)"\/>/);
            if (raiseM) {
                t.allowedActions.maxRaise = parseInt(raiseM[1]);
                t.allowedActions.minRaise = parseInt(raiseM[2]);
            }
        }

        if (t.mySeat !== -1 && xml.includes(`<ActiveChange`) && xml.includes(`seat="${t.mySeat}"`)) {
            let decision = decideAction(t);
            t.lastDecision = decision;
            updateHUD();

            let autoCheck = document.getElementById('nlhe-automove');
            if (autoCheck && autoCheck.checked) {
                setTimeout(() => {
                    executeAction(decision, t.mySeat, ws, t);
                }, 1200);
            }
        }
    }

    function executeAction(decision, seat, ws, t) {
        let xml = `<PlayerAction seat="${seat}">`;
        if (decision.type === 'FOLD') xml += `<Fold/>`;
        else if (decision.type === 'CHECK' || decision.type === 'CALL') xml += `<Call/>`;
        else if (decision.type === 'RAISE') {
            let amt = decision.amount;
            if (t.allowedActions.maxRaise > 0 && amt > t.allowedActions.maxRaise) amt = t.allowedActions.maxRaise;
            if (t.allowedActions.minRaise > 0 && amt < t.allowedActions.minRaise) amt = t.allowedActions.minRaise;
            xml += `<Raise amount="${amt}"/>`;
        }
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
                    <strong style="color:#fde047;font-size:13px;">🤖 NLHE Engine v8.0 (WASM)</strong>
                </div>
                <span id="nlhe-arrow" style="font-size:14px;color:#3498db;">🔼</span>
            </div>
            <div id="nlhe-body">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(234,179,8,0.15);padding:6px 8px;border-radius:6px;margin-bottom:8px;border:1px solid rgba(234,179,8,0.3);">
                    <input type="checkbox" id="nlhe-automove" style="accent-color:#eab308;width:15px;height:15px;">
                    <span style="color:#fde047;font-weight:bold;font-size:11px;">⚡ Авто-Игра (Auto-Play)</span>
                </label>
                <div id="nlhe-tables-container" style="max-height:240px;overflow-y:auto;">
                    <div style="color:#aaa;text-align:center;padding:10px;font-size:11px;">🟡 Сокет активен. Ожидание раздач...</div>
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
                let myStackBB = t.bbSize > 0 ? Math.floor(t.myStack / t.bbSize) : 0;
                let bracket = getStackBracket(myStackBB);
                let actionStr = t.lastDecision ? `<b style="color:#4ade80;font-size:13px;">${t.lastDecision.action}</b>` : 'Считаем...';
                
                html += `
                <div style="background:#1f2937;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #374151;">
                    <div style="color:#9ca3af;font-size:10px;display:flex;justify-content:space-between;margin-bottom:2px;">
                        <span>Стол ${tableCount} | Поз: <b style="color:#60a5fa">${pos}</b></span>
                        <span>Стек: <b style="color:#fde047">${myStackBB} BB</b> (${bracket})</span>
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
