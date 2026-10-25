// Toggle the phone hamburger menu.
(function () {
  var header = document.querySelector("header");
  var btn = header && header.querySelector(".menu-btn");
  if (!btn) return;

  function set(open) {
    header.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  btn.addEventListener("click", function () {
    set(!header.classList.contains("open"));
  });
  // Close after following an in-page link, on Escape, or on a tap outside.
  header.querySelectorAll("nav a").forEach(function (a) {
    a.addEventListener("click", function () { set(false); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") set(false);
  });
  document.addEventListener("click", function (e) {
    if (!header.contains(e.target)) set(false);
  });
})();
