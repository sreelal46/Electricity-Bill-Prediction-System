// Initialize Lucide icons
lucide.createIcons();

// Form elements
const loginForm = document.getElementById("adminLoginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submitBtn");
const successAlert = document.getElementById("successAlert");
const errorAlert = document.getElementById("errorAlert");
const errorAlertText = document.getElementById("errorAlertText");

// Validation functions
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return "Please enter a valid email address";
  }
  return "";
}

function validatePassword(password) {
  if (!password || password.length < 6) {
    return "Password must be at least 6 characters";
  }
  return "";
}

// Show field error
function showFieldError(input, errorElement, message) {
  input.classList.add("error");
  errorElement.querySelector("span").textContent = message;
  errorElement.classList.add("show");
  lucide.createIcons();
}

// Clear field error
function clearFieldError(input, errorElement) {
  input.classList.remove("error");
  errorElement.classList.remove("show");
}

// Show success alert
function showSuccessAlert() {
  successAlert.classList.add("show");
  errorAlert.classList.remove("show");
  lucide.createIcons();
}

// Show error alert
function showErrorAlert(message) {
  errorAlertText.textContent = message;
  errorAlert.classList.add("show");
  successAlert.classList.remove("show");
  lucide.createIcons();
}

// Hide all alerts
function hideAlerts() {
  successAlert.classList.remove("show");
  errorAlert.classList.remove("show");
}

// Real-time validation
emailInput.addEventListener("blur", function () {
  const error = validateEmail(this.value);
  const errorElement = document.getElementById("emailError");
  if (error) {
    showFieldError(this, errorElement, error);
  } else {
    clearFieldError(this, errorElement);
  }
});

passwordInput.addEventListener("blur", function () {
  const error = validatePassword(this.value);
  const errorElement = document.getElementById("passwordError");
  if (error) {
    showFieldError(this, errorElement, error);
  } else {
    clearFieldError(this, errorElement);
  }
});

// Clear errors on input
emailInput.addEventListener("input", function () {
  const errorElement = document.getElementById("emailError");
  if (errorElement.classList.contains("show")) {
    clearFieldError(this, errorElement);
  }
});

passwordInput.addEventListener("input", function () {
  const errorElement = document.getElementById("passwordError");
  if (errorElement.classList.contains("show")) {
    clearFieldError(this, errorElement);
  }
});

// Form submission
loginForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  // Hide previous alerts
  hideAlerts();

  // Validate fields
  const emailError = validateEmail(emailInput.value);
  const passwordError = validatePassword(passwordInput.value);

  let hasError = false;

  if (emailError) {
    showFieldError(
      emailInput,
      document.getElementById("emailError"),
      emailError,
    );
    hasError = true;
  }

  if (passwordError) {
    showFieldError(
      passwordInput,
      document.getElementById("passwordError"),
      passwordError,
    );
    hasError = true;
  }

  if (hasError) {
    return;
  }

  // Prepare form data
  const formData = {
    email: emailInput.value.trim(),
    password: passwordInput.value,
  };

  console.log("Admin login attempt:", { email: formData.email });

  // Save original button content
  const originalButtonHTML = submitBtn.innerHTML;

  // Disable button and show loading
  submitBtn.disabled = true;
  submitBtn.innerHTML =
    '<div class="spinner"></div><span style="margin-left: 0.5rem;">Signing in...</span>';

  try {
    // Make POST request using axios
    const response = await axios.post("/admin/login", formData);

    console.log("Login response:", response.data);

    // Check if login was successful
    if (response.data.success) {
      // Show success message
      showSuccessAlert();

      // Clear form
      loginForm.reset();

      // Redirect after 1.5 seconds
      setTimeout(() => {
        window.location.href = response.data.redirectUrl || "/admin/dashboard";
      }, 1500);
    } else {
      // Show error from server
      showErrorAlert(
        response.data.message || "Login failed. Please check your credentials.",
      );

      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalButtonHTML;
      lucide.createIcons();
    }
  } catch (error) {
    console.error("Login error:", error);

    // Handle different error types
    let errorMessage = "Login failed. Please try again.";

    if (error.response) {
      // Server responded with error status
      if (error.response.status === 401) {
        errorMessage =
          "Invalid email or password. Please check your credentials.";
      } else if (error.response.status === 403) {
        errorMessage = "Access denied. You do not have admin privileges.";
      } else if (error.response.status === 429) {
        errorMessage = "Too many login attempts. Please try again later.";
      } else if (error.response.status === 500) {
        errorMessage = "Server error. Please try again later.";
      } else {
        errorMessage =
          error.response.data.message ||
          error.response.data.error ||
          errorMessage;
      }
    } else if (error.request) {
      // No response received
      errorMessage =
        "No response from server. Please check your internet connection.";
    } else {
      // Request setup error
      errorMessage = "Request failed. Please try again.";
    }

    showErrorAlert(errorMessage);

    // Re-enable button and restore original content
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalButtonHTML;
    lucide.createIcons();
  }
});
