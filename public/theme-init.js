// Apply the explicit preference before rendering; never depend on the OS theme.
(() => {
  let theme = "light";
  try { if (localStorage.getItem("ffp_theme") === "dark") theme = "dark"; }
  catch { /* Storage can be blocked; keep the original white default. */ }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
