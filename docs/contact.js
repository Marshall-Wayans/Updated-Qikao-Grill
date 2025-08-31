// ✅ Hamburger Menu
const hamburger = document.querySelector(".hamburger");
const navLinks = document.querySelector(".nav-links");

hamburger.addEventListener("click", () => {
  navLinks.classList.toggle("show");
});

// ✅ Theme Toggle
const themeToggle = document.getElementById("theme-toggle");
const body = document.body;

// Save theme preference
if (localStorage.getItem("theme") === "dark") {
  body.classList.add("dark");
  themeToggle.checked = true;
}

themeToggle.addEventListener("change", () => {
  body.classList.toggle("dark");
  localStorage.setItem("theme", body.classList.contains("dark") ? "dark" : "light");
});

// ✅ WhatsApp Integration
document.getElementById("contact-form").addEventListener("submit", function(e){
  e.preventDefault();
  
  let name = document.getElementById("name").value;
  let phone = document.getElementById("phone").value;
  let email = document.getElementById("email").value;
  let message = document.getElementById("message").value;

  let whatsappNumber = "254704683150"; // Your WhatsApp number

  let url = `https://wa.me/${whatsappNumber}?text=
    Name: ${encodeURIComponent(name)}%0A
    Phone: ${encodeURIComponent(phone)}%0A
    Email: ${encodeURIComponent(email)}%0A
    Message: ${encodeURIComponent(message)}`;

  window.open(url, "_blank");
});
    