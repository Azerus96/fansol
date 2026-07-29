(async function () {
    console.log("[GTO Solver v2.0] Инициализация бота...");

    // =============================================================
    // 1. ЕДИНОЕ СОСТОЯНИЕ ТЕКУЩЕЙ ИГРЫ (GAME STATE)
    // =============================================================
    const gameState = {
        heroSeat: null,       // Номер вашего места (0-5)
        heroCards: [],      // Ваши карты: ["6d", "4d"]
        boardCards: [],     // Карты стола: ["5h", "Qs", "9s"]
        dealerSeat: null,     // Номер баттона/дилера
        activeSeats: [],    // Массив активных игроков [0, 1, 2, 3, 4, 5]
        currentPot: 0,        // Текущий банк (в фишках/блайндах)
        isHeroTurn: false,    // Настал ли ваш ход
        lastHandId: null,     // Номер раздачи
        position: "-",        // Позиция: BTN, SB, BB, UTG, MP, CO
        lastDecision: null    // Последняя рекомендация солвера
    };

    let solverEngine = null;

    // =============================================================
    // 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И РАСЧЕТ ПОЗИЦИИ
    // =============================================================

    // Нормализация формата карт (6d -> 6d, qh -> Qh)
    function normalizeCard(cardStr) {
        if (!cardStr || cardStr === 'xx') return null;
        const rank = cardStr.slice(0, -1).toUpperCase();
        const suit = cardStr.slice(-1).toLowerCase();
        return rank + suit;
    }

    // Полный круг расчёта позиций (6-Max, 5-Max, 4-Max, 3-Max, Heads-Up)
    function calculatePosition(dealerSeat, heroSeat, activeSeats) {
        if (dealerSeat === null || heroSeat === null || !activeSeats || activeSeats.length < 2) {
            return "BTN";
        }

        const seats = [...new Set(activeSeats)].sort((a, b) => a - b);
        if (!seats.includes(heroSeat)) seats.push(heroSeat);
        seats.sort((a, b) => a - b);

        const numPlayers = seats.length;
        let dealerIdx = seats.indexOf(dealerSeat);
        if (dealerIdx === -1) {
            dealerIdx = 0;
            for (let i = 0; i < seats.length; i++) {
                if (seats[i] <= dealerSeat) dealerIdx = i;
            }
        }

        // Порядок хода от малого блайнда к баттону
        const orderedSeats = [];
        for (let i = 1; i <= numPlayers; i++) {
            const idx = (dealerIdx + i) % numPlayers;
            orderedSeats.push(seats[idx]);
        }

        const posNames6Max = ["SB", "BB", "UTG", "MP", "CO", "BTN"];
        let positionLabels;

        if (numPlayers === 2) {
            positionLabels = ["SB", "BB"]; // В Хедз-апе дилер — это SB/BTN
        } else {
            positionLabels = posNames6Max.slice(6 - numPlayers);
        }

        const heroIdx = orderedSeats.indexOf(heroSeat);
        if (heroIdx !== -1 && heroIdx < positionLabels.length) {
            return positionLabels[heroIdx];
        }

        return "BTN";
    }

    // =============================================================
    // 3. UI ИНТЕРФЕЙС (ОБНОВЛЕНИЕ ОКНА)
    // =============================================================
    function createOrUpdateUI() {
        let overlay = document.getElementById("gto-solver-ui");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "gto-solver-ui";
            overlay.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999999;
                background: rgba(15, 23, 42, 0.95);
                border: 2px solid #3b82f6;
                border-radius: 12px;
                padding: 16px;
                color: #fff;
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                box-shadow: 0 10px 25px rgba(0,0,0,0.6);
                min-width: 290px;
                backdrop-filter: blur(8px);
                user-select: none;
            `;
            document.body.appendChild(overlay);
        }

        const cardsDisplay = gameState.heroCards.length 
            ? gameState.heroCards.map(c => `<span style="background:#334155; padding:2px 6px; border-radius:4px; margin-right:4px;">${c}</span>`).join("")
            : "<span style='color:#64748b;'>Ожидание карт...</span>";

        const boardDisplay = gameState.boardCards.length 
            ? gameState.boardCards.join(" ") 
            : "—";

        const statusColor = gameState.isHeroTurn ? "#22c55e" : (gameState.heroCards.length ? "#3b82f6" : "#eab308");
        const statusText = gameState.isHeroTurn 
            ? "ВАШ ХОД!" 
            : (gameState.heroCards.length ? "Ожидание хода..." : "WAITING...");

        overlay.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #334155; padding-bottom:8px;">
                <span style="font-weight:800; color:#60a5fa; font-size:15px;">GTO SOLVER v2.0</span>
                <span style="background:#d97706; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:bold;">SIMD CPU</span>
            </div>

            <div style="font-size:13px; margin-bottom:8px;">
                <span style="color:#94a3b8;">Рука:</span> <div style="display:inline-block; margin-left:6px; font-weight:bold; color:#facc15;">${cardsDisplay}</div>
            </div>

            <div style="font-size:12px; margin-bottom:8px; color:#cbd5e1; display:flex; justify-content:space-between;">
                <span><b>Борд:</b> ${boardDisplay}</span>
                <span><b>Поз:</b> <span style="color:#38bdf8; font-weight:bold;">${gameState.position}</span></span>
            </div>

            <div style="font-size:12px; margin-bottom:12px; color:#cbd5e1;">
                <b>Банк:</b> <span style="color:#4ade80;">${gameState.currentPot}</span>
            </div>

            <div style="background:#1e293b; border:1px solid #334155; padding:10px; border-radius:8px; text-align:center; margin-bottom:10px;">
                <div style="color:${statusColor}; font-weight:bold; font-size:14px; text-transform:uppercase;">${statusText}</div>
                ${gameState.lastDecision ? `<div style="color:#f43f5e; font-size:17px; font-weight:900; margin-top:6px;">${gameState.lastDecision}</div>` : ""}
            </div>

            <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; color:#94a3b8;">
                <input type="checkbox" id="auto-play-chk" ${window.AUTO_PLAY ? "checked" : ""}> Авто-Ход (Auto-Play)
            </label>
        `;

        document.getElementById("auto-play-chk")?.addEventListener("change", (e) => {
            window.AUTO_PLAY = e.target.checked;
        });
    }

    // =============================================================
    // 4. XML ПАРСЕР СООБЩЕНИЙ СЕРВЕРА POKERDOM
    // =============================================================
    function parseXMLMessage(xmlString) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlString, "text/xml");

            // 1. Старт новой раздачи
            const newHand = xml.querySelector("NewHand");
            if (newHand) {
                gameState.lastHandId = newHand.getAttribute("number");
                gameState.dealerSeat = parseInt(newHand.getAttribute("dealer"));
                gameState.heroCards = [];
                gameState.boardCards = [];
                gameState.currentPot = 0;
                gameState.isHeroTurn = false;
                gameState.lastDecision = null;
                console.log(`[BOT] Старт раздачи #${gameState.lastHandId}, Дилер Seat ${gameState.dealerSeat}`);
            }

            // 2. Список активных мест
            const activeSeatsElem = xml.querySelector("ActiveSeats");
            if (activeSeatsElem) {
                gameState.activeSeats = Array.from(activeSeatsElem.querySelectorAll("Seat"))
                    .map(s => parseInt(s.getAttribute("id")));
            }

            // 3. Детект карманных карт (ТОЛЬКО из тега DealingCards)
            const dealingCards = xml.querySelector("DealingCards");
            if (dealingCards) {
                const seats = dealingCards.querySelectorAll("Seat");
                seats.forEach(seatElem => {
                    const seatId = parseInt(seatElem.getAttribute("id"));
                    const cardNodes = seatElem.querySelectorAll("Card");
                    const rawCards = Array.from(cardNodes).map(c => c.textContent.trim());

                    // Если карты НЕ 'xx' и их 2 штуки — это ВАШИ карты!
                    if (rawCards.length === 2 && rawCards[0] !== 'xx' && rawCards[1] !== 'xx') {
                        gameState.heroSeat = seatId;
                        gameState.heroCards = rawCards.map(c => normalizeCard(c)).filter(Boolean);
                        console.log(`[BOT] Игрок HERO обнаружен за Seat ${seatId}. Карты:`, gameState.heroCards);
                    }
                });

                // Вычисляем позицию
                gameState.position = calculatePosition(gameState.dealerSeat, gameState.heroSeat, gameState.activeSeats);
            }

            // 4. Детект Флопа, Тёрна и Ривера
            ["DealingFlop", "DealingTurn", "DealingRiver"].forEach(stage => {
                const stageElem = xml.querySelector(stage);
                if (stageElem) {
                    const cards = Array.from(stageElem.querySelectorAll("Card"))
                        .map(c => normalizeCard(c.textContent.trim()))
                        .filter(Boolean);

                    cards.forEach(card => {
                        if (!gameState.boardCards.includes(card)) {
                            gameState.boardCards.push(card);
                        }
                    });
                }
            });

            // 5. Расчет размера банка
            const potsChange = xml.querySelector("PotsChange");
            if (potsChange) {
                let totalChange = 0;
                potsChange.querySelectorAll("Pot").forEach(p => {
                    totalChange += parseInt(p.getAttribute("change") || "0");
                });
                if (totalChange > 0) gameState.currentPot += totalChange;
            }

            // 6. Очередь хода игроков (ActiveChange)
            const activeChange = xml.querySelector("ActiveChange");
            if (activeChange) {
                const activeSeat = parseInt(activeChange.getAttribute("seat"));
                gameState.isHeroTurn = (activeSeat === gameState.heroSeat);

                if (gameState.isHeroTurn) {
                    console.log("[BOT] ВАШ ХОД! Запуск расчёта SOLVER...");
                    runSolverEngine();
                }
            }

            // Обновляем виджет UI
            createOrUpdateUI();

        } catch (err) {
            console.error("[BOT] Ошибка обработки XML:", err);
        }
    }

    // =============================================================
    // 5. ВЫЗОВ Wasm SolverEngine
    // =============================================================
    async function runSolverEngine() {
        if (!solverEngine) {
            try {
                // Инициализация WASM из репозитория
                const wasmModule = await import("https://fastly.jsdelivr.net/gh/Azerus96/fansol@main/pkg/solver_gpu.js");
                await wasmModule.default();
                solverEngine = new wasmModule.SolverEngine();
                console.log("[BOT] WASM SolverEngine успешно загружен!");
            } catch (e) {
                console.warn("[BOT] Не удалось подгрузить WASM, работа в режиме эмуляции:", e);
            }
        }

        const payload = {
            hero_seat: gameState.heroSeat,
            hero_cards: gameState.heroCards,
            board: gameState.boardCards,
            pot: gameState.currentPot,
            position: gameState.position
        };

        let decision = "CHECK / FOLD";

        if (solverEngine) {
            try {
                const responseJson = solverEngine.solve_auto_step(JSON.stringify(payload));
                const parsed = JSON.parse(responseJson);
                decision = parsed.action || decision;
            } catch (e) {
                console.error("[BOT] Ошибка выполнения solve_auto_step:", e);
            }
        }

        gameState.lastDecision = decision;
        createOrUpdateUI();
    }

    // =============================================================
    // 6. АВТО-ПЕРЕХВАТ WEBSOCKET СЕРВЕРА
    // =============================================================
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);

        ws.addEventListener("message", function (event) {
            if (typeof event.data === "string" && event.data.includes("<Message>")) {
                parseXMLMessage(event.data);
            }
        });

        return ws;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;

    createOrUpdateUI();
    console.log("[GTO Solver v2.0] Перехватчик WebSocket успешно запущен!");
})();
