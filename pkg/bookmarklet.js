(async function () {
    console.log("[GTO Solver v2.0] Инициализация бота...");

    const gameState = {
        heroSeat: null,
        heroCards: [],
        boardCards: [],
        dealerSeat: null,
        activeSeats: [],
        currentPot: 0,
        isHeroTurn: false,
        lastHandId: null,
        position: "-",
        lastDecision: null,
        availableActions: {} // Доступные действия (Fold, Check, Call, Raise)
    };

    let solverEngine = null;
    window.GTO_MINIMIZED = window.GTO_MINIMIZED || false;
    window.AUTO_PLAY = window.AUTO_PLAY || false;

    function normalizeCard(cardStr) {
        if (!cardStr || cardStr === 'xx') return null;
        return cardStr.slice(0, -1).toUpperCase() + cardStr.slice(-1).toLowerCase();
    }

    // ИСПРАВЛЕНО: Точный расчет позиций для любого количества игроков
    function calculatePosition(dealerSeat, heroSeat, activeSeats) {
        if (dealerSeat === null || heroSeat === null || !activeSeats || activeSeats.length < 2) return "BTN";
        
        let seats = [...new Set(activeSeats)].sort((a, b) => a - b);
        let dealerIdx = seats.indexOf(dealerSeat);
        if (dealerIdx === -1) dealerIdx = 0;

        // Выстраиваем очередь ходов, начиная со следующего после дилера (SB)
        let ordered = [];
        for (let i = 1; i <= seats.length; i++) {
            ordered.push(seats[(dealerIdx + i) % seats.length]);
        }

        let heroIdx = ordered.indexOf(heroSeat);
        if (heroIdx === -1) return "-";

        let n = seats.length;
        if (n === 2) return heroIdx === 0 ? "SB" : "BB";
        if (n === 3) return ["SB", "BB", "BTN"][heroIdx];
        if (n === 4) return ["SB", "BB", "CO", "BTN"][heroIdx];
        if (n === 5) return ["SB", "BB", "MP", "CO", "BTN"][heroIdx];
        return ["SB", "BB", "UTG", "MP", "CO", "BTN"][heroIdx];
    }

    // ИСПРАВЛЕНО: Добавлена стрелочка сворачивания
    function createOrUpdateUI() {
        let overlay = document.getElementById("gto-solver-ui");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "gto-solver-ui";
            overlay.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 999999;
                background: rgba(15, 23, 42, 0.95); border: 2px solid #3b82f6;
                border-radius: 12px; padding: 16px; color: #fff;
                font-family: ui-sans-serif, system-ui, sans-serif;
                box-shadow: 0 10px 25px rgba(0,0,0,0.6); min-width: 290px;
                backdrop-filter: blur(8px); user-select: none;
            `;
            document.body.appendChild(overlay);
        }

        const cardsDisplay = gameState.heroCards.length 
            ? gameState.heroCards.map(c => `<span style="background:#334155; padding:2px 6px; border-radius:4px; margin-right:4px;">${c}</span>`).join("")
            : "<span style='color:#64748b;'>Ожидание карт...</span>";

        const boardDisplay = gameState.boardCards.length ? gameState.boardCards.join(" ") : "—";
        const statusColor = gameState.isHeroTurn ? "#22c55e" : (gameState.heroCards.length ? "#3b82f6" : "#eab308");
        const statusText = gameState.isHeroTurn ? "ВАШ ХОД!" : (gameState.heroCards.length ? "Ожидание хода..." : "WAITING...");

        overlay.innerHTML = `
            <div id="gto-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #334155; padding-bottom:8px; cursor:pointer;">
                <span style="font-weight:800; color:#60a5fa; font-size:15px;">GTO SOLVER v2.0</span>
                <div>
                    <span style="background:#d97706; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:8px;">SIMD CPU</span>
                    <span style="font-size:14px;">${window.GTO_MINIMIZED ? '▼' : '▲'}</span>
                </div>
            </div>
            <div id="gto-content" style="display: ${window.GTO_MINIMIZED ? 'none' : 'block'};">
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
            </div>
        `;

        document.getElementById("gto-header").onclick = () => {
            window.GTO_MINIMIZED = !window.GTO_MINIMIZED;
            createOrUpdateUI();
        };
        document.getElementById("auto-play-chk")?.addEventListener("change", (e) => {
            window.AUTO_PLAY = e.target.checked;
        });
    }

    function parseXMLMessage(xmlString) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlString, "text/xml");

            // ИСПРАВЛЕНО: Очистка карт на шоудауне
            if (xml.querySelector("EndHand") || xml.querySelector("Winners")) {
                gameState.heroCards = [];
                gameState.boardCards = [];
                gameState.isHeroTurn = false;
                gameState.lastDecision = null;
            }

            const newHand = xml.querySelector("NewHand");
            if (newHand) {
                gameState.lastHandId = newHand.getAttribute("number");
                gameState.dealerSeat = parseInt(newHand.getAttribute("dealer"));
                gameState.heroCards = [];
                gameState.boardCards = [];
                gameState.currentPot = 0;
                gameState.isHeroTurn = false;
                gameState.lastDecision = null;
            }

            const activeSeatsElem = xml.querySelector("ActiveSeats");
            if (activeSeatsElem) {
                gameState.activeSeats = Array.from(activeSeatsElem.querySelectorAll("Seat")).map(s => parseInt(s.getAttribute("id")));
            }

            const dealingCards = xml.querySelector("DealingCards");
            if (dealingCards) {
                dealingCards.querySelectorAll("Seat").forEach(seatElem => {
                    const seatId = parseInt(seatElem.getAttribute("id"));
                    const rawCards = Array.from(seatElem.querySelectorAll("Card")).map(c => c.textContent.trim());
                    if (rawCards.length === 2 && rawCards[0] !== 'xx' && rawCards[1] !== 'xx') {
                        gameState.heroSeat = seatId;
                        gameState.heroCards = rawCards.map(c => normalizeCard(c)).filter(Boolean);
                    }
                });
                gameState.position = calculatePosition(gameState.dealerSeat, gameState.heroSeat, gameState.activeSeats);
            }

            ["DealingFlop", "DealingTurn", "DealingRiver"].forEach(stage => {
                const stageElem = xml.querySelector(stage);
                if (stageElem) {
                    Array.from(stageElem.querySelectorAll("Card")).map(c => normalizeCard(c.textContent.trim())).forEach(card => {
                        if (card && !gameState.boardCards.includes(card)) gameState.boardCards.push(card);
                    });
                }
            });

            const potsChange = xml.querySelector("PotsChange");
            if (potsChange) {
                let totalChange = 0;
                potsChange.querySelectorAll("Pot").forEach(p => totalChange += parseInt(p.getAttribute("change") || "0"));
                if (totalChange > 0) gameState.currentPot += totalChange;
            }

            const activeChange = xml.querySelector("ActiveChange");
            if (activeChange) {
                const activeSeat = parseInt(activeChange.getAttribute("seat"));
                gameState.isHeroTurn = (activeSeat === gameState.heroSeat);

                // ИСПРАВЛЕНО: Парсим доступные действия для Авто-хода
                if (gameState.isHeroTurn) {
                    const actionsNode = activeChange.querySelector("Actions");
                    gameState.availableActions = {};
                    if (actionsNode) {
                        if (actionsNode.querySelector("Fold")) gameState.availableActions.fold = true;
                        if (actionsNode.querySelector("Check")) gameState.availableActions.check = true;
                        const callNode = actionsNode.querySelector("Call");
                        if (callNode) gameState.availableActions.call = parseInt(callNode.getAttribute("amount") || "0");
                        const raiseNode = actionsNode.querySelector("Raise");
                        if (raiseNode) {
                            gameState.availableActions.raiseMin = parseInt(raiseNode.getAttribute("min") || "0");
                            gameState.availableActions.raiseMax = parseInt(raiseNode.getAttribute("max") || "0");
                        }
                    }
                    runSolverEngine();
                }
            }
            createOrUpdateUI();
        } catch (err) { console.error("[BOT] Ошибка XML:", err); }
    }

    // ИСПРАВЛЕНО: Логика выполнения Авто-хода через WebSocket
    function executeAutoPlay(decision) {
        if (!window.AUTO_PLAY || !window.pokerSocket || !gameState.isHeroTurn) return;

        let cmd = "";
        if (decision === "FOLD") {
            cmd = gameState.availableActions.check ? "<Check/>" : "<Fold/>";
        } else if (decision === "CHECK") {
            cmd = "<Check/>";
        } else if (decision === "CALL") {
            if (gameState.availableActions.call !== undefined) cmd = `<Call amount="${gameState.availableActions.call}"/>`;
            else if (gameState.availableActions.check) cmd = "<Check/>";
        } else if (decision === "RAISE") {
            if (gameState.availableActions.raiseMin !== undefined) cmd = `<Raise amount="${gameState.availableActions.raiseMin}"/>`;
            else if (gameState.availableActions.call !== undefined) cmd = `<Call amount="${gameState.availableActions.call}"/>`;
        }

        if (cmd) {
            console.log("[BOT] Выполняю авто-ход:", cmd);
            setTimeout(() => {
                if (window.pokerSocket && window.pokerSocket.readyState === 1) {
                    window.pokerSocket.send(cmd);
                }
            }, 800 + Math.random() * 1000); // Рандомная задержка 0.8 - 1.8 сек
        }
    }

    async function runSolverEngine() {
        if (!solverEngine) {
            try {
                const wasmModule = await import("https://fastly.jsdelivr.net/gh/Azerus96/fansol@main/pkg/solver_gpu.js");
                await wasmModule.default();
                solverEngine = new wasmModule.SolverEngine();
            } catch (e) { console.warn("[BOT] Ошибка WASM:", e); }
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
            } catch (e) { console.error("[BOT] Ошибка solve_auto_step:", e); }
        }

        gameState.lastDecision = decision;
        createOrUpdateUI();
        
        // Запускаем авто-ход
        executeAutoPlay(decision);
    }

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        ws.addEventListener("message", function (event) {
            if (typeof event.data === "string" && event.data.includes("<Message>")) {
                window.pokerSocket = ws; // ИСПРАВЛЕНО: Сохраняем сокет для отправки команд
                parseXMLMessage(event.data);
            }
        });
        return ws;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;

    createOrUpdateUI();
})();
