//assets\javascripts\bf_readup.js
(function () {

    //--------------------------------------------------------------
    // Helper: CSRF-token
    //--------------------------------------------------------------
    const CSRF = document.querySelector('meta[name="csrf-token"]')?.content;

    //--------------------------------------------------------------
    // Helper: POST med CSRF
    //--------------------------------------------------------------
    function send(url, data) {
        return fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": CSRF
            },
            body: JSON.stringify(data || {})
        });
    }

    //--------------------------------------------------------------
    // Robust journal-detektering (Redmine 6)
    //--------------------------------------------------------------
    function extractLastJournalId() {
        const nodes = document.querySelectorAll(`
            #history [id^="change-"],
            #history [id^="journal-"],
            #history [id^="note-"]
        `);

        let ids = [];

        nodes.forEach(n => {
            const id = n.id;
            if (!id) return;

            // case 1: change-XXXX
            if (id.startsWith("change-")) {
                ids.push(parseInt(id.replace("change-", ""), 10));
                return;
            }

            // case 2: journal-XXXX-notes eller journal-XXXX-private_notes
            if (id.startsWith("journal-")) {
                const match = id.match(/^journal-(\d+)/);
                if (match) ids.push(parseInt(match[1], 10));
                return;
            }

            // case 3: note-XX → gå upp till parent change-XXXX om möjligt
            if (id.startsWith("note-")) {
                const parent = n.closest("[id^='change-']");
                if (parent) {
                    ids.push(parseInt(parent.id.replace("change-", ""), 10));
                }
                return;
            }
        });

        if (ids.length === 0) return null;
        return Math.max(...ids);
    }

    //--------------------------------------------------------------
    // Huvudfunktion — körs när sidan laddas via Turbo eller DOM
    //--------------------------------------------------------------
    function initTracking() {

        // Kontrollera om vi är på en issue-sida
        const match = window.location.pathname.match(/(.*)\/issues\/(\d+)/);
        if (!match) return;

        const ROOT = match[1] + "/";
        const issueId = parseInt(match[2], 10);
        const interval = (window.BF_READUP_HEARTBEAT || 10) * 1000;
        const sessionId = crypto.randomUUID();

        //----------------------------------------------------------
        // Försök läsa journal-id i Redmine (med retry pga Turbo)
        //----------------------------------------------------------
        let attempts = 0;
        let latestJournal = null;

        function tryDetect() {
            attempts++;

            latestJournal = extractLastJournalId();

            if (latestJournal !== null) {
                startTracking();
            } else if (attempts < 30) {   // ~ 3 sek retry
                setTimeout(tryDetect, 100);
            } else {
                startTracking();           // Kör ändå
            }
        }

        //----------------------------------------------------------
        // Enter + Ping + Exit
        //----------------------------------------------------------
        function startTracking() {

            send(`${ROOT}bf_readup/enter`, {
                issue_id: issueId,
                session_id: sessionId,
                journal_id: latestJournal   // OK att skicka null
            });

						const pingTimer = setInterval(() => {
								const currentJournalId = extractLastJournalId();

								send(`${ROOT}bf_readup/ping`, {
										issue_id: issueId,
										session_id: sessionId,
										journal_id: currentJournalId // <-- KRITISK
								});
						}, interval);

            window.addEventListener("beforeunload", () => {
                clearInterval(pingTimer);
                send(`${ROOT}bf_readup/exit`, {
                    issue_id: issueId,
                    session_id: sessionId
                });
            });
        }

        tryDetect();
    }

    //--------------------------------------------------------------
    // Koppla till Turbo + fallback
    //--------------------------------------------------------------
    document.addEventListener("turbo:load", initTracking);
    document.addEventListener("turbo:render", initTracking);
    document.addEventListener("turbo:frame-load", initTracking);
    document.addEventListener("DOMContentLoaded", initTracking);

})();
