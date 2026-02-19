// Initialize Lucide icons
if (typeof lucide !== "undefined") {
  lucide.createIcons();
}

// Form elements
const loginForm = document.getElementById("loginForm");
const consumerNumber = document.getElementById("consumerNumber");
const phone = document.getElementById("phone");
const submitBtn = document.getElementById("submitBtn");
const errorAlert = document.getElementById("errorAlert");
const errorAlertText = document.getElementById("errorAlertText");
const successAlert = document.getElementById("successAlert");

// Hide alerts initially
errorAlert.style.display = "none";
successAlert.style.display = "none";

// Validation functions
function validateConsumerNumber(value) {
  if (!value || value.trim().length < 4) {
    return "Consumer number must be at least 4 characters";
  }
  return "";
}

function validatePhone(value) {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length < 10) {
    return "Phone number must be at least 10 digits";
  }
  if (cleaned.length > 15) {
    return "Phone number is too long";
  }
  return "";
}

// Show field error
function showFieldError(input, errorElement, message) {
  input.classList.add("error");
  errorElement.querySelector("span").textContent = message;
  errorElement.style.display = "flex";
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// Clear field error
function clearFieldError(input, errorElement) {
  input.classList.remove("error");
  errorElement.style.display = "none";
}

// Show error alert
function showErrorAlert(message) {
  errorAlertText.textContent = message;
  errorAlert.style.display = "flex";
  successAlert.style.display = "none";
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// Show success alert
function showSuccessAlert() {
  successAlert.style.display = "flex";
  errorAlert.style.display = "none";
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// Hide all alerts
function hideAlerts() {
  errorAlert.style.display = "none";
  successAlert.style.display = "none";
}

// Real-time validation
consumerNumber.addEventListener("blur", function () {
  const error = validateConsumerNumber(this.value);
  const errorElement = document.getElementById("consumerNumberError");
  if (error) {
    showFieldError(this, errorElement, error);
  } else {
    clearFieldError(this, errorElement);
  }
});

phone.addEventListener("blur", function () {
  const error = validatePhone(this.value);
  const errorElement = document.getElementById("phoneError");
  if (error) {
    showFieldError(this, errorElement, error);
  } else {
    clearFieldError(this, errorElement);
  }
});

// Clear errors on input
consumerNumber.addEventListener("input", function () {
  const errorElement = document.getElementById("consumerNumberError");
  if (errorElement.style.display !== "none") {
    clearFieldError(this, errorElement);
  }
});

phone.addEventListener("input", function () {
  const errorElement = document.getElementById("phoneError");
  if (errorElement.style.display !== "none") {
    clearFieldError(this, errorElement);
  }
});

// Form submission
loginForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  // Hide previous alerts
  hideAlerts();

  // Validate fields
  const consumerError = validateConsumerNumber(consumerNumber.value);
  const phoneError = validatePhone(phone.value);

  let hasError = false;

  if (consumerError) {
    showFieldError(
      consumerNumber,
      document.getElementById("consumerNumberError"),
      consumerError,
    );
    hasError = true;
  }

  if (phoneError) {
    showFieldError(phone, document.getElementById("phoneError"), phoneError);
    hasError = true;
  }

  if (hasError) {
    return;
  }

  // Prepare form data
  const formData = {
    consumerNumber: consumerNumber.value.trim(),
    phone: phone.value.trim(),
  };

  console.log("Login attempt:", formData);

  // Save original button content
  const originalButtonHTML = submitBtn.innerHTML;

  // Disable button and show loading
  submitBtn.disabled = true;
  submitBtn.innerHTML =
    '<div class="spinner"></div><span style="margin-left: 0.5rem;">Signing in...</span>';

  try {
    // Make POST request using axios
    const response = await axios.post("/user/login", formData);

    // Check if login was successful
    if (response.data.success) {
      // Show success message
      showSuccessAlert();

      // Clear form
      loginForm.reset();

      // Redirect after 1.5 seconds
      setTimeout(() => {
        // Redirect to dashboard or home page
        window.location.href = response.data.redirectUrl || "/user/dashboard";
      }, 1500);
    } else {
      // Show error from server
      showErrorAlert(
        response.data.message || "Login failed. Please check your credentials.",
      );
    }
  } catch (error) {
    console.error("Login error:", error.response.data.message);

    // Handle different error types
    let errorMessage =
      error.response.data.message || "Login failed. Please try again.";
    // if (error.response) {
    //   // Server responded with error status
    //   if (error.response.status === 401) {
    //     errorMessage = 'Invalid consumer number or phone number.';
    //   } else if (error.response.status === 404) {
    //     errorMessage = 'User not found. Please check your credentials.';
    //   } else if (error.response.status === 500) {
    //     errorMessage = 'Server error. Please try again later.';
    //   } else if (error.response.status === 400) {
    //     errorMessage = error.response.data.message;
    //   } else {
    //     errorMessage = error.response.data.message || error.response.data.error || errorMessage;
    //   }
    // } else if (error.request) {
    //   // No response received
    //   errorMessage = 'No response from server. Please check your internet connection.';
    // } else {
    //   // Request setup error
    //   errorMessage = 'Request failed. Please try again.';
    // }

    showErrorAlert(errorMessage);
  } finally {
    // Re-enable button and restore original content
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalButtonHTML;
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
});
