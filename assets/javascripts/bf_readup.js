// assets/javascripts/bf_readup.js
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
      keepalive: true, // <-- viktigt för beforeunload/turbo
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

    const ids = [];

    nodes.forEach(n => {
      const id = n.id;
      if (!id) return;

      if (id.startsWith("change-")) {
        ids.push(parseInt(id.replace("change-", ""), 10));
        return;
      }

      if (id.startsWith("journal-")) {
        const match = id.match(/^journal-(\d+)/);
        if (match) ids.push(parseInt(match[1], 10));
        return;
      }

      if (id.startsWith("note-")) {
        const parent = n.closest("[id^='change-']");
        if (parent) ids.push(parseInt(parent.id.replace("change-", ""), 10));
        return;
      }
    });

    if (!ids.length) return null;
    return Math.max(...ids);
  }

  //--------------------------------------------------------------
  // Huvudfunktion — körs när sidan laddas via Turbo eller DOM
  //--------------------------------------------------------------
  function initTracking() {
    const match = window.location.pathname.match(/(.*)\/issues\/(\d+)/);
    if (!match) return;

    const ROOT = window.BF_READUP_ROOT || (match[1] + "/");
    const issueId = parseInt(match[2], 10);
    if (!issueId) return;

    const interval = (window.BF_READUP_HEARTBEAT || 10) * 1000;
    const sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

    // ----------------------------------------------------------
    // Guard: hindra dubbla timers per issue
    // ----------------------------------------------------------
    window.BF_READUP_ACTIVE = window.BF_READUP_ACTIVE || {};
    if (window.BF_READUP_ACTIVE[issueId]) return;
    window.BF_READUP_ACTIVE[issueId] = { sessionId, pingTimer: null, root: ROOT };

    let attempts = 0;
    let latestJournal = null;

    function stopTracking() {
      const state = window.BF_READUP_ACTIVE?.[issueId];
      if (!state) return;

      if (state.pingTimer) {
        clearInterval(state.pingTimer);
        state.pingTimer = null;
      }

      // försök avsluta session (best effort)
      send(`${ROOT}bf_readup/exit`, {
        issue_id: issueId,
        session_id: sessionId
      });

      delete window.BF_READUP_ACTIVE[issueId];
    }

    function startTracking() {
      send(`${ROOT}bf_readup/enter`, {
        issue_id: issueId,
        session_id: sessionId,
        journal_id: latestJournal
      });

      const timer = setInterval(() => {
        const currentJournalId = extractLastJournalId();

        send(`${ROOT}bf_readup/ping`, {
          issue_id: issueId,
          session_id: sessionId,
          journal_id: currentJournalId
        });
      }, interval);

      window.BF_READUP_ACTIVE[issueId].pingTimer = timer;

      window.addEventListener("beforeunload", stopTracking, { once: true });
      document.addEventListener("turbo:before-cache", stopTracking, { once: true });
    }

    function tryDetect() {
      attempts++;
      latestJournal = extractLastJournalId();

      if (latestJournal !== null) {
        startTracking();
      } else if (attempts < 30) {
        setTimeout(tryDetect, 100);
      } else {
        startTracking();
      }
    }

    tryDetect();
  }

  document.addEventListener("turbo:load", initTracking);
  document.addEventListener("turbo:render", initTracking);
  document.addEventListener("turbo:frame-load", initTracking);
  document.addEventListener("DOMContentLoaded", initTracking);

})();