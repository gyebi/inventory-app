// js/pages/login.js
import { loginWithEmail, setSessionUser } from "../services/authService.js";
import { getUserProfile } from "../services/userProfileService.js";



const form = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";

  try {
    const authUser = await loginWithEmail(email, password);
    const profile = await getUserProfile(authUser.uid);

    if (!profile.isActive) {
      throw new Error("This account has been deactivated");
    }

    setSessionUser(profile);

    alert(`Welcome ${profile.displayName}`);

    window.location.href = "/dashboard.html";
  } catch (error) {
    console.error("Login failed:", error);
    alert(error.message || "Login failed");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});
