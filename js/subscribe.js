// Sends the Squarespace newsletter block to /api/subscribe instead of Squarespace.
// Listens in the capture phase so it runs before (and stops) Squarespace's own form handler.
(function () {
  document.querySelectorAll("form.newsletter-form").forEach(function (form) {
    // Honeypot field for bots, hidden from people and screen readers.
    var trap = document.createElement("input");
    trap.type = "text";
    trap.name = "website";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    form.appendChild(trap);

    var status = document.createElement("p");
    status.setAttribute("role", "status");
    status.style.cssText = "margin-top:1em;text-align:center";
    form.appendChild(status);
  });

  window.addEventListener("submit", function (e) {
    var form = e.target.closest && e.target.closest("form.newsletter-form");
    if (!form) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    var button = form.querySelector("button[type=submit]");
    var label = form.querySelector(".newsletter-form-button-label");
    var status = form.querySelector("p[role=status]");
    var oldLabel = label ? label.textContent : "";
    if (button) button.disabled = true;
    if (label) label.textContent = form.getAttribute("data-submitting-text") || "Submitting…";
    status.textContent = "";

    fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.elements.email.value,
        website: form.elements.website.value,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Something went wrong. Please try again later.");
        });
      })
      .then(function () {
        var body = form.querySelector(".newsletter-form-body");
        var thanks = form.querySelector(".form-submission-text");
        if (body) body.style.display = "none";
        if (thanks) thanks.classList.remove("hidden");
        else status.textContent = "Thank you!";
      })
      .catch(function (err) {
        status.textContent = err.message;
      })
      .finally(function () {
        if (button) button.disabled = false;
        if (label) label.textContent = oldLabel;
      });
  }, true);
})();
