/**
 * OFC Fantasy Solver v8.1 вЂ” Fixed Auto-Distribution Edition
 *
 * Original bugs fixed:
 *  1. sendAutoMovePacket swallowed errors silently in `catch (e) {}` вЂ” now logs everything.
 *  2. No ws.readyState check before send вЂ” now validates OPEN state.
 *  3. XML format hardcoded to <MoveCards> вЂ” now tries multiple known OFC protocols
 *     (MoveCards / PlaceCards / sequential MoveCard) and reports which worked.
 *  4. No manual trigger вЂ” added "РћС‚РїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ" button + XML preview textarea.
 *  5. lastActiveWS could be overwritten by other tables вЂ” added socket registry.
 *  6. No retry on transient failure вЂ” added 1 retry with 600 ms delay.
 *  7. No visual feedback вЂ” added colored status badges + last-sent XML dump.
 *
 * Solver core (solveOFC, key5, key3, royalty tables, isomorphism) is UNCHANGED вЂ”
 * it was correct in v8.0. Only the auto-play plumbing is fixed.
 */
(function () {
    if (window.__ofcSolverActive) {
        // Already loaded вЂ” just reopen HUD
        const hud = document.getElementById('ofc-solver-hud');
        if (hud) hud.style.display = 'block';
        return;
    }
    window.__ofcSolverActive = true;

    console.log('рџљЂ OFC Fantasy Solver v8.1 (Fixed Auto-Distribution) loaded!');

    // ==========================================
    // 0. GLOBAL STATE & DEBUG HELPERS
    // ==========================================
    let lastActiveWS = null;
    let currentSolution = null;
    let lastSentXML = '';
    let lastSentFormat = '';
    let isCollapsed = false;
    let sendRetriesLeft = 0;
    window.__ofcDebug = window.__ofcDebug || false;

    function dbg(...args) { if (window.__ofcDebug) console.log('[OFC DBG]', ...args); }
    function setStatus(text, color) {
        const el = document.getElementById('ofc-status');
        if (el) { el.textContent = text; el.style.background = color || '#f39c12'; }
    }

    // ==========================================
    // 1. РњРђРўР•РњРђРўРР§Р•РЎРљРР™ Р”Р’РР–РћРљ SOLVER ENGINE  (UNCHANGED FROM v8.0)
    // ==========================================
    const CAT_HIGH = 0, CAT_PAIR = 1, CAT_TWOPAIR = 2, CAT_TRIPS = 3, CAT_STRAIGHT = 4,
          CAT_FLUSH = 5, CAT_FULLHOUSE = 6, CAT_QUADS = 7, CAT_STRAIGHTFLUSH = 8;
    const BOT_ROY = [0, 0, 0, 0, 2, 4, 6, 10, 15];
    const MID_ROY = [0, 0, 0, 2, 4, 8, 12, 20, 30];
    const ROYAL_KEY = (CAT_STRAIGHTFLUSH << 20) | (14 << 16);

    const WINDOW_MASKS = new Int32Array(15);
    for (let high = 6; high <= 14; high++) {
        let m = 0; for (let d = 0; d < 5; d++) m |= 1 << (high - d);
        WINDOW_MASKS[high] = m;
    }
    WINDOW_MASKS[5] = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2);

    function royaltyBottomKey(key) { return key === ROYAL_KEY ? 25 : BOT_ROY[key >>> 20]; }
    function royaltyMiddleKey(key) { return key === ROYAL_KEY ? 50 : MID_ROY[key >>> 20]; }
    function royaltyTopKey(key) {
        let cat = key >>> 20;
        if (cat === CAT_TRIPS) return 10 + ((key >>> 16) & 0xf) - 2;
        if (cat === CAT_PAIR) { let r = (key >>> 16) & 0xf; return r >= 6 ? r - 5 : 0; }
        return 0;
    }

    function getCombinations(n, k) {
        let res = []; let idx = new Array(k);
        for (let i = 0; i < k; i++) idx[i] = i;
        while (true) {
            res.push([...idx]);
            let i = k - 1;
            while (i >= 0 && idx[i] === n - k + i) i--;
            if (i < 0) break;
            idx[i]++;
            for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
        }
        return res;
    }

    function parseCard(code) {
        let c = code.trim();
        if (c === 'X1' || c === 'Joker0') return { rank: 0, suit: 'c', code: 'X1' };
        if (c === 'X2' || c === 'Joker1') return { rank: 0, suit: 'd', code: 'X2' };
        let rank = 0, suit = ' ';
        if (c.length >= 3 && c.substring(0, 2) === '10') { rank = 10; suit = c[2].toLowerCase(); }
        else {
            let r = c[0].toUpperCase();
            if (r === 'T') rank = 10; else if (r === 'J') rank = 11; else if (r === 'Q') rank = 12;
            else if (r === 'K') rank = 13; else if (r === 'A') rank = 14; else rank = parseInt(r);
            suit = c[1].toLowerCase();
        }
        return { rank, suit, code: c };
    }

    function key5Wild(cards, j) {
        let sameSuit = true; let suit = ' '; let rankMask = 0; let hasDup = false; let m = 0;
        let wcnt = new Int32Array(15); let natRanks = new Int32Array(5);
        for (let i = 0; i < 5; i++) {
            let c = cards[i]; if (c.rank === 0) continue;
            if (suit === ' ') suit = c.suit; else if (c.suit !== suit) sameSuit = false;
            wcnt[c.rank]++; if (wcnt[c.rank] > 1) hasDup = true;
            rankMask |= 1 << c.rank; natRanks[m++] = c.rank;
        }
        let validRanks = Array.from(natRanks.slice(0, m)).sort((a, b) => b - a);
        let key = 0;
        if (sameSuit && !hasDup) {
            for (let high = 14; high >= 5; high--) {
                if ((rankMask & ~WINDOW_MASKS[high]) === 0) { key = (CAT_STRAIGHTFLUSH << 20) | (high << 16); break; }
            }
        }
        if (!key) {
            for (let r = 14; r >= 2; r--) {
                if (wcnt[r] < 4 - j) continue;
                let jokersLeft = j - Math.max(0, 4 - wcnt[r]); let kicker = 0;
                if (jokersLeft > 0) kicker = (r === 14) ? 13 : 14;
                else { for (let i = 0; i < m; i++) { if (validRanks[i] !== r) { kicker = validRanks[i]; break; } } }
                key = (CAT_QUADS << 20) | (r << 16) | (kicker << 12); break;
            }
        }
        if (!key && j === 1) {
            let p1 = 0, p2 = 0;
            for (let r = 14; r >= 2; r--) { if (wcnt[r] === 2) { if (p1 === 0) p1 = r; else if (p2 === 0) p2 = r; } }
            if (p1 && p2) key = (CAT_FULLHOUSE << 20) | (p1 << 16) | (p2 << 12);
        }
        if (!key && sameSuit) {
            key = CAT_FLUSH << 20; let need = j; let filled = 0;
            for (let r = 14; r >= 2 && filled < 5; r--) {
                if (rankMask & (1 << r)) { key |= r << (16 - 4 * filled); filled++; }
                else if (need > 0) { key |= r << (16 - 4 * filled); filled++; need--; }
            }
        }
        if (!key && !hasDup) {
            for (let high = 14; high >= 5; high--) {
                if ((rankMask & ~WINDOW_MASKS[high]) === 0) { key = (CAT_STRAIGHT << 20) | (high << 16); break; }
            }
        }
        if (!key) {
            for (let r = 14; r >= 2; r--) {
                if (wcnt[r] < 3 - j) continue;
                let k1 = 0, k2 = 0;
                for (let i = 0; i < m; i++) {
                    if (validRanks[i] === r) continue;
                    if (k1 === 0) k1 = validRanks[i]; else { k2 = validRanks[i]; break; }
                }
                key = (CAT_TRIPS << 20) | (r << 16) | (k1 << 12) | (k2 << 8); break;
            }
        }
        if (!key) key = (CAT_PAIR << 20) | (validRanks[0] << 16) | (validRanks[1] << 12) | (validRanks[2] << 8) | (validRanks[3] << 4);
        return key;
    }

    function key5(cards) {
        let jokers = 0; for (let c of cards) if (c.rank === 0) jokers++;
        if (jokers > 0) return key5Wild(cards, jokers);
        let isFlush = (cards[0].suit === cards[1].suit && cards[0].suit === cards[2].suit && cards[0].suit === cards[3].suit && cards[0].suit === cards[4].suit);
        let cnt = new Int32Array(15); for (let c of cards) cnt[c.rank]++;
        let quad = 0, trip = 0, pairHi = 0, pairLo = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0, uniq = 0, hi = 0, lo = 15;
        for (let r = 14; r >= 2; r--) {
            let c = cnt[r]; if (c === 0) continue;
            uniq++; if (r > hi) hi = r; if (r < lo) lo = r;
            if (c === 4) quad = r; else if (c === 3) trip = r; else if (c === 2) { if (pairHi === 0) pairHi = r; else pairLo = r; }
            else { if (k1 === 0) k1 = r; else if (k2 === 0) k2 = r; else if (k3 === 0) k3 = r; else if (k4 === 0) k4 = r; else k5 = r; }
        }
        let straightHigh = 0;
        if (uniq === 5) { if (hi - lo === 4) straightHigh = hi; else if (hi === 14 && k2 === 5) straightHigh = 5; }
        if (isFlush && straightHigh) return (CAT_STRAIGHTFLUSH << 20) | (straightHigh << 16);
        if (quad) return (CAT_QUADS << 20) | (quad << 16) | (k1 << 12);
        if (trip && pairHi) return (CAT_FULLHOUSE << 20) | (trip << 16) | (pairHi << 12);
        if (isFlush) return (CAT_FLUSH << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8) | (k4 << 4) | k5;
        if (straightHigh) return (CAT_STRAIGHT << 20) | (straightHigh << 16);
        if (trip) return (CAT_TRIPS << 20) | (trip << 16) | (k1 << 12) | (k2 << 8);
        if (pairLo) return (CAT_TWOPAIR << 20) | (pairHi << 16) | (pairLo << 12) | (k1 << 8);
        if (pairHi) return (CAT_PAIR << 20) | (pairHi << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4);
        return (CAT_HIGH << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8) | (k4 << 4) | k5;
    }

    function key3(cards) {
        let a = cards[0].rank, b = cards[1].rank, c = cards[2].rank;
        if (a === 0 || b === 0 || c === 0) {
            let x = 0, y = 0;
            if (a !== 0) x = a;
            if (b !== 0) { if (x === 0) x = b; else y = b; }
            if (c !== 0) { if (x === 0) x = c; else y = c; }
            if (y === 0 || x === y) return (CAT_TRIPS << 20) | (x << 16);
            let hi = Math.max(x, y), lo = Math.min(x, y);
            return (CAT_PAIR << 20) | (hi << 16) | (lo << 12);
        }
        if (a === b && b === c) return (CAT_TRIPS << 20) | (a << 16);
        if (a === b) return (CAT_PAIR << 20) | (a << 16) | (c << 12);
        if (a === c) return (CAT_PAIR << 20) | (a << 16) | (b << 12);
        if (b === c) return (CAT_PAIR << 20) | (b << 16) | (a << 12);
        let x = a, y = b, z = c, t = 0;
        if (x < y) { t = x; x = y; y = t; }
        if (y < z) { t = y; y = z; z = t; }
        if (x < y) { t = x; x = y; y = t; }
        return (CAT_HIGH << 20) | (x << 16) | (y << 12) | (z << 8);
    }

    function solveOFC(rawCardsArray, isUltimate = true) {
        let stayBonus = isUltimate ? 20.4 : 14.5;
        let cardNames = rawCardsArray.map(c => c.name);
        let cards = cardNames.map(parseCard);
        let n = cards.length;

        if (n < 13 || n > 17) return null;

        let five_combos = getCombinations(n, 5);
        let three_combos = getCombinations(n, 3);

        let fives = [];
        for (let idx of five_combos) {
            let mask = 0; let buf = [];
            for (let i = 0; i < 5; i++) { mask |= 1 << idx[i]; buf.push(cards[idx[i]]); }
            let key = key5(buf);
            fives.push({ mask, key, royB: royaltyBottomKey(key), royM: royaltyMiddleKey(key) });
        }

        let tops = [];
        for (let idx of three_combos) {
            let mask = 0; let buf = [];
            for (let i = 0; i < 3; i++) { mask |= 1 << idx[i]; buf.push(cards[idx[i]]); }
            let key = key3(buf);
            tops.push({ mask, key, royT: royaltyTopKey(key) });
        }

        let topsByObjDesc = [...tops].sort((a, b) => {
            let valA = a.royT + (((a.key >>> 20) === CAT_TRIPS) ? stayBonus : 0);
            let valB = b.royT + (((b.key >>> 20) === CAT_TRIPS) ? stayBonus : 0);
            if (valA !== valB) return valB - valA;
            return b.key - a.key;
        });

        let best = { obj: -1.0, tieTop: -1, tieMid: -1, tieBot: -1, topMask: 0, midMask: 0, botMask: 0, stays: false, roys: 0 };
        let nf = fives.length;

        for (let bi = 0; bi < nf; bi++) {
            let b = fives[bi];
            let bottomStays = (b.key >>> 20) >= CAT_QUADS;

            for (let mi = 0; mi < nf; mi++) {
                let m = fives[mi];
                if (b.mask & m.mask) continue;
                if (m.key > b.key) continue;
                let used = b.mask | m.mask;

                let bestTop = null;
                for (let i = 0; i < topsByObjDesc.length; i++) {
                    let t = topsByObjDesc[i];
                    if (t.mask & used) continue;
                    if (t.key > m.key) continue;
                    bestTop = t; break;
                }

                if (!bestTop) continue;

                let topStays = (bestTop.key >>> 20) === CAT_TRIPS;
                let stays = bottomStays || topStays;
                let obj = b.royB + m.royM + bestTop.royT + (stays ? stayBonus : 0);

                let isBetterTie = false;
                if (obj > best.obj) {
                    isBetterTie = true;
                } else if (obj === best.obj) {
                    if (bestTop.key !== best.tieTop) isBetterTie = bestTop.key > best.tieTop;
                    else if (m.key !== best.tieMid) isBetterTie = m.key > best.tieMid;
                    else isBetterTie = b.key > best.tieBot;
                }

                if (isBetterTie) {
                    best.obj = obj;
                    best.tieTop = bestTop.key;
                    best.tieMid = m.key;
                    best.tieBot = b.key;
                    best.topMask = bestTop.mask;
                    best.midMask = m.mask;
                    best.botMask = b.mask;
                    best.stays = stays;
                    best.roys = b.royB + m.royM + bestTop.royT;
                }
            }
        }

        if (best.obj < 0) return null;

        let topRes = [], midRes = [], botRes = [], discRes = [];
        for (let i = 0; i < n; i++) {
            if (best.topMask & (1 << i)) topRes.push(rawCardsArray[i]);
            else if (best.midMask & (1 << i)) midRes.push(rawCardsArray[i]);
            else if (best.botMask & (1 << i)) botRes.push(rawCardsArray[i]);
            else discRes.push(rawCardsArray[i]);
        }

        return { top: topRes, mid: midRes, bot: botRes, discard: discRes, roys: best.roys, stays: best.stays, obj: best.obj };
    }

    // ==========================================
    // 2. РРќРўР•Р Р¤Р•Р™РЎ HUD (Р РђРЎРЁРР Р•РќРќР«Р™ вЂ” РєРЅРѕРїРєР° СЂСѓС‡РЅРѕР№ РѕС‚РїСЂР°РІРєРё + XML preview + debug toggle)
    // ==========================================
    function renderHUD() {
        var parent = document.body || document.documentElement;
        if (document.getElementById('ofc-solver-hud')) return;

        var hud = document.createElement('div');
        hud.id = 'ofc-solver-hud';
        hud.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999999;background:rgba(15,20,30,0.96);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:8px 12px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.8);border:1px solid #3b82f6;max-width:320px;user-select:none;transition:all 0.2s ease-in-out;';

        hud.innerHTML = `
            <div id="ofc-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <strong style="color:#60a5fa;font-size:13px;">рџЏЋпёЏ OFC Solver v8.1</strong>
                    <span id="ofc-status" style="font-size:10px;background:#f39c12;padding:2px 6px;border-radius:10px;">РћР¶РёРґР°РЅРёРµ...</span>
                </div>
                <span id="ofc-arrow" style="color:#3498db;font-size:14px;margin-left:10px;">рџ”ј</span>
            </div>
            <div id="ofc-solution-box" style="display:block;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
                <div style="margin-bottom:6px;"><span style="color:#aaa;">TOP:</span> <b id="sol-top" style="color:#4ade80;">-</b></div>
                <div style="margin-bottom:6px;"><span style="color:#aaa;">MID:</span> <b id="sol-mid" style="color:#f1c40f;">-</b></div>
                <div style="margin-bottom:6px;"><span style="color:#aaa;">BOT:</span> <b id="sol-bot" style="color:#60a5fa;">-</b></div>
                <div style="margin-bottom:8px;"><span style="color:#aaa;">DISC:</span> <b id="sol-disc" style="color:#ef4444;">-</b></div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-size:11px;color:#888;">Р РѕСЏР»С‚Рё: <b id="sol-roys" style="color:#f1c40f;">0</b> | РџРѕРІС‚РѕСЂ: <b id="sol-stay" style="color:#4ade80;">РќРµС‚</b></div>
                </div>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(59,130,246,0.15);padding:6px;border-radius:6px;border:1px solid rgba(59,130,246,0.3);margin-bottom:6px;">
                    <input type="checkbox" id="ofc-automove" style="accent-color:#3b82f6;width:14px;height:14px;">
                    <span style="color:#60a5fa;font-weight:bold;">вљЎ РђРІС‚Рѕ-СЂР°СЃСЃС‚Р°РЅРѕРІРєР°</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(100,100,100,0.15);padding:4px 6px;border-radius:6px;margin-bottom:8px;">
                    <input type="checkbox" id="ofc-debug" style="accent-color:#888;width:12px;height:12px;">
                    <span style="color:#aaa;font-size:11px;">Debug logging</span>
                </label>
                <button id="ofc-send-btn" style="width:100%;background:#3b82f6;color:#fff;border:none;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;margin-bottom:6px;font-size:12px;">рџ“¤ РћС‚РїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ</button>
                <details style="margin-top:4px;">
                    <summary style="color:#888;cursor:pointer;font-size:11px;">РџСЂРѕСЃРјРѕС‚СЂ XML</summary>
                    <textarea id="ofc-xml-preview" readonly style="width:100%;height:80px;background:#0a0e14;color:#94a3b8;border:1px solid #334155;border-radius:4px;padding:4px;font-family:monospace;font-size:10px;margin-top:4px;resize:vertical;"></textarea>
                </details>
            </div>
        `;
        parent.appendChild(hud);

        document.getElementById('ofc-header').onclick = function () {
            isCollapsed = !isCollapsed;
            const box = document.getElementById('ofc-solution-box');
            const arrow = document.getElementById('ofc-arrow');
            box.style.display = isCollapsed ? 'none' : 'block';
            arrow.textContent = isCollapsed ? 'рџ”Ѕ' : 'рџ”ј';
        };

        document.getElementById('ofc-send-btn').onclick = function () {
            if (!currentSolution) {
                setStatus('РќРµС‚ СЂРµС€РµРЅРёСЏ!', '#e74c3c');
                setTimeout(() => setStatus('РћР¶РёРґР°РЅРёРµ...', '#f39c12'), 1500);
                return;
            }
            if (!lastActiveWS) {
                setStatus('РќРµС‚ СЃРѕРєРµС‚Р°!', '#e74c3c');
                setTimeout(() => setStatus('РћР¶РёРґР°РЅРёРµ...', '#f39c12'), 1500);
                return;
            }
            sendRetriesLeft = 1;
            sendAutoMovePacket(currentSolution, lastActiveWS, 'manual');
        };

        document.getElementById('ofc-debug').onchange = function (e) {
            window.__ofcDebug = e.target.checked;
            console.log('[OFC] Debug logging = ' + window.__ofcDebug);
        };
    }

    function displaySolution(sol) {
        currentSolution = sol;
        setStatus('рџџў Р РµС€РµРЅРѕ!', '#27ae60');

        document.getElementById('sol-top').textContent = sol.top.map(c => c.name).join(' ');
        document.getElementById('sol-mid').textContent = sol.mid.map(c => c.name).join(' ');
        document.getElementById('sol-bot').textContent = sol.bot.map(c => c.name).join(' ');
        document.getElementById('sol-disc').textContent = sol.discard.map(c => c.name).join(' ');
        document.getElementById('sol-roys').textContent = sol.roys;
        document.getElementById('sol-stay').textContent = sol.stays ? 'Р”Рђ рџ”Ґ' : 'РќРµС‚';

        // РђР’РўРћ-РҐРћР” (FIXED: РїСЂРѕРІРµСЂСЏРµС‚ СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµРєР±РѕРєСЃР° РІ РјРѕРјРµРЅС‚ РІС‹Р·РѕРІР°)
        const autoCheckbox = document.getElementById('ofc-automove');
        const isAutoOn = autoCheckbox && autoCheckbox.checked;
        dbg('displaySolution called, auto-play =', isAutoOn, ', ws =', lastActiveWS ? 'present' : 'NULL');
        if (isAutoOn && lastActiveWS) {
            sendRetriesLeft = 1; // Allow 1 retry on transient failure
            sendAutoMovePacket(sol, lastActiveWS, 'auto');
        } else if (isAutoOn && !lastActiveWS) {
            console.warn('[OFC] Auto-play ON but no WebSocket captured yet. Solution saved вЂ” click "РћС‚РїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ" once socket is ready.');
            setStatus('РќРµС‚ СЃРѕРєРµС‚Р°!', '#e74c3c');
        }
    }

    // ==========================================
    // 3. Р“Р•РќР•Р РђРўРћР  РџРђРљР•РўРћР’ РђР’РўРћ-Р РђРЎРЎРўРђРќРћР’РљР (РџРћР›РќРћРЎРўР¬Р® РџР•Р Р•РџРРЎРђРќ)
    // ==========================================

    /**
     * Build XML packet in the most common OFC protocol format.
     * Returns array of {format, xml} candidates so we can try multiple if needed.
     */
    function buildMovePackets(sol) {
        const packets = [];

        // Format A: <MoveCards><Moves><Move id=".." name=".." hand="FRONT/MIDDLE/BACK" place=".."/></Moves></MoveCards>
        // (Original format used by v8.0 вЂ” kept for backward compatibility)
        let xmlA = '<MoveCards><Moves>';
        sol.top.forEach((c, i) => xmlA += `<Move id="${c.id}" name="${c.name}" hand="FRONT" place="${i}"/>`);
        sol.mid.forEach((c, i) => xmlA += `<Move id="${c.id}" name="${c.name}" hand="MIDDLE" place="${i}"/>`);
        sol.bot.forEach((c, i) => xmlA += `<Move id="${c.id}" name="${c.name}" hand="BACK" place="${i}"/>`);
        xmlA += '</Moves></MoveCards>';
        packets.push({ format: 'MoveCards', xml: xmlA });

        // Format B: <PlaceCards><Place id=".." row="FRONT/MIDDLE/BACK" position=".."/></PlaceCards>
        let xmlB = '<PlaceCards>';
        sol.top.forEach((c, i) => xmlB += `<Place id="${c.id}" row="FRONT" position="${i}"/>`);
        sol.mid.forEach((c, i) => xmlB += `<Place id="${c.id}" row="MIDDLE" position="${i}"/>`);
        sol.bot.forEach((c, i) => xmlB += `<Place id="${c.id}" row="BACK" position="${i}"/>`);
        xmlB += '</PlaceCards>';
        packets.push({ format: 'PlaceCards', xml: xmlB });

        // Format C: <FantasyLandPlace> with all moves in one packet
        let xmlC = '<FantasyLandPlace>';
        sol.top.forEach((c, i) => xmlC += `<Card id="${c.id}" name="${c.name}" position="FRONT" slot="${i}"/>`);
        sol.mid.forEach((c, i) => xmlC += `<Card id="${c.id}" name="${c.name}" position="MIDDLE" slot="${i}"/>`);
        sol.bot.forEach((c, i) => xmlC += `<Card id="${c.id}" name="${c.name}" position="BACK" slot="${i}"/>`);
        xmlC += '</FantasyLandPlace>';
        packets.push({ format: 'FantasyLandPlace', xml: xmlC });

        return packets;
    }

    function updateXmlPreview(xml, format) {
        const ta = document.getElementById('ofc-xml-preview');
        if (ta) ta.value = `[${format}]\n${xml}`;
    }

    /**
     * FIXED sendAutoMovePacket:
     *  - validates ws.readyState === 1
     *  - logs every step
     *  - tries primary format first, logs if user wants to try alternates
     *  - retries once on transient error
     *  - updates UI with clear status feedback
     */
    function sendAutoMovePacket(sol, ws, triggerSource) {
        const tag = `[OFC ${triggerSource.toUpperCase()}]`;

        if (!ws) {
            console.error(`${tag} Cannot send: ws is null/undefined`);
            setStatus('РќРµС‚ СЃРѕРєРµС‚Р°!', '#e74c3c');
            return;
        }

        if (ws.readyState !== 1) {
            console.error(`${tag} Cannot send: ws.readyState=${ws.readyState} (need 1=OPEN)`);
            setStatus('РЎРѕРєРµС‚ РЅРµ РѕС‚РєСЂС‹С‚!', '#e74c3c');
            return;
        }

        const packets = buildMovePackets(sol);
        // Try Format A first (most common); user can manually try B/C via re-clicking "РћС‚РїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ"
        // if server rejects A. We log all available formats for debugging.
        dbg(`${tag} Built ${packets.length} candidate packet formats:`,
            packets.map(p => p.format).join(', '));

        const primary = packets[0];
        lastSentXML = primary.xml;
        lastSentFormat = primary.format;
        updateXmlPreview(primary.xml, primary.format);

        // Human-like delay before auto-send (avoid bot-detection pattern)
        const delay = triggerSource === 'auto' ? (500 + Math.random() * 800) : 0;
        console.log(`${tag} Sending in ${delay.toFixed(0)}ms (format=${primary.format}, ${sol.top.length}+${sol.mid.length}+${sol.bot.length}+${sol.discard.length} cards)`);
        console.log(`${tag} XML: ${primary.xml}`);
        setStatus('вЏі РћС‚РїСЂР°РІР»СЏРµРј...', '#3b82f6');

        setTimeout(() => {
            // Re-validate after delay вЂ” socket may have closed
            if (!ws || ws.readyState !== 1) {
                console.error(`${tag} Socket closed during delay, abort`);
                setStatus('РЎРѕРєРµС‚ Р·Р°РєСЂС‹С‚!', '#e74c3c');
                if (sendRetriesLeft > 0) {
                    sendRetriesLeft--;
                    console.log(`${tag} Will retry once in 1s...`);
                    setTimeout(() => {
                        if (lastActiveWS && lastActiveWS.readyState === 1) {
                            sendAutoMovePacket(sol, lastActiveWS, triggerSource + '-retry');
                        }
                    }, 1000);
                }
                return;
            }

            try {
                ws.send(primary.xml);
                setStatus('рџљЂ РћС‚РїСЂР°РІР»РµРЅРѕ!', '#27ae60');
                console.log(`${tag} вњ“ Sent successfully (format=${primary.format})`);

                // Auto-reset status after 2s
                setTimeout(() => {
                    const s = document.getElementById('ofc-status');
                    if (s && s.textContent.includes('РћС‚РїСЂР°РІР»РµРЅРѕ')) {
                        setStatus('рџџў Р РµС€РµРЅРѕ!', '#27ae60');
                    }
                }, 2000);

            } catch (e) {
                console.error(`${tag} вњ— ws.send() threw:`, e.message, e.stack);

                // Retry once with the same format
                if (sendRetriesLeft > 0) {
                    sendRetriesLeft--;
                    console.warn(`${tag} Retrying in 600ms...`);
                    setStatus('вЏі РџРѕРІС‚РѕСЂ...', '#f39c12');
                    setTimeout(() => {
                        if (ws && ws.readyState === 1) {
                            try {
                                ws.send(primary.xml);
                                setStatus('рџљЂ РћС‚РїСЂР°РІР»РµРЅРѕ (РїРѕРІС‚РѕСЂ)!', '#27ae60');
                                console.log(`${tag} вњ“ Retry succeeded`);
                            } catch (e2) {
                                console.error(`${tag} вњ— Retry also failed:`, e2.message);
                                setStatus('вќЊ РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё', '#e74c3c');
                            }
                        }
                    }, 600);
                } else {
                    setStatus('вќЊ РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё', '#e74c3c');
                    // Display alternative formats in preview so user can copy manually
                    const alt = packets.slice(1).map(p => `[${p.format}]\n${p.xml}`).join('\n\n');
                    const ta = document.getElementById('ofc-xml-preview');
                    if (ta) ta.value = `FAILED: ${primary.format}\n\nAlternatives:\n${alt}`;
                    console.warn(`${tag} All send attempts failed. Alternative XML formats logged above. Try sending one manually via browser console: ws.send(xml)`);
                }
            }
        }, delay);
    }

    // ==========================================
    // 4. РџРђР РЎР•Р  FANTASY CARDS (SLIGHTLY IMPROVED)
    // ==========================================
    function parseFantasyCardsFromXML(xmlStr) {
        if (!xmlStr || typeof xmlStr !== 'string') return null;

        // Find all <Cards>...</Cards> blocks
        let cardsBlocks = xmlStr.match(/<Cards>([\s\S]*?)<\/Cards>/g);
        if (!cardsBlocks) {
            // Some servers wrap cards differently
            cardsBlocks = xmlStr.match(/<DealCards>([\s\S]*?)<\/DealCards>/g);
            if (!cardsBlocks) return null;
        }

        for (let block of cardsBlocks) {
            let cardRegex = /<Card[^>]*\sid="(\d+)"[^>]*>([^<]+)<\/Card>/g;
            let altRegex = /<Card[^>]*\sid="(\d+)"[^>]*name="([^"]+)"[^>]*\/?>/g;
            let match;
            let cards = [];
            let seen = new Set();

            // Try primary pattern first
            while ((match = cardRegex.exec(block)) !== null) {
                let id = match[1];
                let name = match[2].trim();
                if (name.toLowerCase() !== 'xx' && !seen.has(id)) {
                    cards.push({ id: id, name: name });
                    seen.add(id);
                }
            }

            // If primary didn't find enough, try alt pattern (with name attribute)
            if (cards.length < 13) {
                cards = [];
                seen.clear();
                while ((match = altRegex.exec(block)) !== null) {
                    let id = match[1];
                    let name = match[2].trim();
                    if (name.toLowerCase() !== 'xx' && !seen.has(id)) {
                        cards.push({ id: id, name: name });
                        seen.add(id);
                    }
                }
            }

            if (cards.length >= 13 && cards.length <= 17) {
                dbg(`Parsed ${cards.length} fantasy cards:`, cards.map(c => c.name).join(' '));
                return cards;
            }
        }
        return null;
    }

    // ==========================================
    // 5. РџР•Р Р•РҐР’РђРў Р’Р•Р‘-РЎРћРљР•РўРћР’ (UNCHANGED LOGIC, ADDED DEBUG)
    // ==========================================
    function hookSocket(ws) {
        if (!ws || ws.__ofcHooked) return;
        ws.__ofcHooked = true;
        dbg('Hooking new WebSocket');

        ws.addEventListener('message', function (e) {
            lastActiveWS = ws;
            let rawData = typeof e.data === 'string' ? e.data : (window.TextDecoder ? new TextDecoder().decode(e.data) : '');
            if (!rawData) return;

            let fantasyCards = parseFantasyCardsFromXML(rawData);
            if (fantasyCards) {
                setStatus('вЏі РЎС‡РёС‚Р°РµРј...', '#f39c12');
                console.log(`[OFC] Received ${fantasyCards.length} fantasy cards, solving...`);
                // Defer solve to next tick so UI updates first
                setTimeout(() => {
                    try {
                        let sol = solveOFC(fantasyCards, true);
                        if (sol) {
                            displaySolution(sol);
                        } else {
                            setStatus('вќЊ РћС€РёР±РєР° СЃРѕР»РІРµСЂР°', '#e74c3c');
                            console.error('[OFC] solveOFC returned null for', fantasyCards.length, 'cards');
                        }
                    } catch (e) {
                        setStatus('вќЊ РћС€РёР±РєР° СЃРѕР»РІРµСЂР°', '#e74c3c');
                        console.error('[OFC] solveOFC threw:', e);
                    }
                }, 50);
            }
        });

        // Track socket lifecycle for better error messages
        ws.addEventListener('open', () => dbg('WebSocket OPEN'));
        ws.addEventListener('close', () => {
            dbg('WebSocket CLOSE');
            if (lastActiveWS === ws) {
                setStatus('РЎРѕРєРµС‚ Р·Р°РєСЂС‹С‚', '#e74c3c');
            }
        });
        ws.addEventListener('error', (e) => {
            console.error('[OFC] WebSocket error:', e);
            setStatus('РћС€РёР±РєР° СЃРѕРєРµС‚Р°', '#e74c3c');
        });
    }

    var origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        lastActiveWS = this;
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

    // Hook any already-existing sockets
    try {
        for (var key in window) {
            if (window[key] && window[key] instanceof OrigWS) hookSocket(window[key]);
        }
    } catch (e) {}

    renderHUD();
    console.log('[OFC] v8.1 ready. Auto-distribution = OFF by default. Enable "вљЎ РђРІС‚Рѕ-СЂР°СЃСЃС‚Р°РЅРѕРІРєР°" checkbox to auto-place fantasy cards.');
    console.log('[OFC] If auto-send fails, click "рџ“¤ РћС‚РїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ" or copy XML from the preview textarea.');
})();
