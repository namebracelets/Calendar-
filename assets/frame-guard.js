// Refuse to show the admin page inside another site's frame (clickjacking). GitHub Pages can't send the
// X-Frame-Options or frame-ancestors header that would block it, so the page checks for itself.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch { /* a cross-site frame: the page just stays hidden */ }
}
