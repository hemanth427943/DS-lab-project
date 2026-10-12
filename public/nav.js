const navToggle = document.querySelector(".nav-toggle");
const mainNav = document.querySelector(".main-nav");
const mobileNavBreakpoint = 840;

if (navToggle && mainNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  mainNav.querySelectorAll(".nav__item").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= mobileNavBreakpoint) {
        mainNav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  });
}
