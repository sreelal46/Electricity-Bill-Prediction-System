// Initialize Lucide icons
lucide.createIcons();

// Form elements
const form = document.getElementById("registrationForm");
const consumerNumber = document.getElementById("consumerNumber");
const name = document.getElementById("name");
const phoneNumber = document.getElementById("phoneNumber");
const email = document.getElementById("email");
const address = document.getElementById("address");
const approvedLoad = document.getElementById("approvedLoad");
const phaseType = document.getElementById("phaseType");
const submitBtn = document.getElementById("submitBtn");
const successMessage = document.getElementById("successMessage");
const errorAlert = document.getElementById("errorAlert");
const errorAlertText = document.getElementById("errorAlertText");

// Validation functions
function validateConsumerNumber(value) {
  if (!/^[0-9]+$/.test(value)) {
    return "Consumer number can only contain numbers";
  }
  if (!value || value.trim().length < 13) {
    return "Consumer number must be at least 13 characters";
  }
  return "";
}

function validateName(value) {
  if (!value || value.trim().length < 3) {
    return "Name must be at least 3 characters";
  }
  if (!/^[a-zA-Z\s]+$/.test(value)) {
    return "Name can only contain letters and spaces";
  }
  return "";
}

function validatePhoneNumber(value) {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length < 10) {
    return "Phone number must be at least 10 digits";
  }
  if (cleaned.length > 15) {
    return "Phone number is too long";
  }
  return "";
}

function validateEmail(value) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return "Please enter a valid email address";
  }
  return "";
}

function validateAddress(value) {
  if (!value || value.trim().length < 10) {
    return "Address must be at least 10 characters";
  }
  return "";
}

function validateApprovedLoad(value) {
  const load = parseFloat(value);
  if (isNaN(load) || load <= 0) {
    return "Approved load must be greater than 0";
  }
  if (load > 100) {
    return "Approved load seems unusually high";
  }
  return "";
}

function validatePhaseType(value) {
  if (!value || (value !== "SINGLE" && value !== "THREE")) {
    return "Please select a valid phase type";
  }
  return "";
}

// Show error
function showError(input, errorElement, message) {
  input.classList.add("error");
  input.classList.remove("success");
  errorElement.querySelector("span").textContent = message;
  errorElement.style.display = "flex";
  lucide.createIcons();
}

// Clear error
function clearError(input, errorElement) {
  input.classList.remove("error");
  errorElement.style.display = "none";
}

// Show success
function showSuccess(input) {
  input.classList.remove("error");
  input.classList.add("success");
}

// Real-time validation
consumerNumber.addEventListener("blur", function () {
  const error = validateConsumerNumber(this.value);
  const errorElement = document.getElementById("consumerNumberError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

name.addEventListener("blur", function () {
  const error = validateName(this.value);
  const errorElement = document.getElementById("nameError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

phoneNumber.addEventListener("blur", function () {
  const error = validatePhoneNumber(this.value);
  const errorElement = document.getElementById("phoneNumberError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

email.addEventListener("blur", function () {
  const error = validateEmail(this.value);
  const errorElement = document.getElementById("emailError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

address.addEventListener("blur", function () {
  const error = validateAddress(this.value);
  const errorElement = document.getElementById("addressError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

approvedLoad.addEventListener("blur", function () {
  const error = validateApprovedLoad(this.value);
  const errorElement = document.getElementById("approvedLoadError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

phaseType.addEventListener("change", function () {
  const error = validatePhaseType(this.value);
  const errorElement = document.getElementById("phaseTypeError");
  if (error) {
    showError(this, errorElement, error);
  } else {
    clearError(this, errorElement);
    if (this.value) showSuccess(this);
  }
});

// Clear error on input
[consumerNumber, name, phoneNumber, email, address, approvedLoad].forEach(
  (input) => {
    input.addEventListener("input", function () {
      const errorElement = document.getElementById(this.id + "Error");
      if (errorElement && errorElement.style.display !== "none") {
        clearError(this, errorElement);
      }
    });
  },
);

// Form submission
form.addEventListener("submit", async function (e) {
  e.preventDefault();

  // Hide previous alerts
  successMessage.classList.remove("show");
  errorAlert.classList.remove("show");

  // Validate all fields
  const errors = {
    consumerNumber: validateConsumerNumber(consumerNumber.value),
    name: validateName(name.value),
    phoneNumber: validatePhoneNumber(phoneNumber.value),
    email: validateEmail(email.value),
    address: validateAddress(address.value),
    approvedLoad: validateApprovedLoad(approvedLoad.value),
    phaseType: validatePhaseType(phaseType.value),
  };

  let hasError = false;

  // Show all errors
  Object.keys(errors).forEach((field) => {
    const errorElement = document.getElementById(field + "Error");
    const inputElement = document.getElementById(field);

    if (errors[field]) {
      showError(inputElement, errorElement, errors[field]);
      hasError = true;
    }
  });

  if (hasError) {
    return;
  }

  // Prepare form data
  const formData = {
    consumerNumber: consumerNumber.value.trim(),
    name: name.value.trim(),
    phoneNumber: phoneNumber.value.trim(),
    email: email.value.trim(),
    address: address.value.trim(),
    approvedLoad: parseFloat(approvedLoad.value),
    phaseType: phaseType.value,
  };

  console.log("Registering new user:", formData);

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner"></div> Registering...';

  try {
    // Make API call using axios
    const response = await axios.post("/admin/registration", formData);
    if (response.data.success) {
      // Show success message
      successMessage.classList.add("show");
      lucide.createIcons();

      // Reset form
      form.reset();
      [
        consumerNumber,
        name,
        phoneNumber,
        email,
        address,
        approvedLoad,
        phaseType,
      ].forEach((input) => {
        input.classList.remove("success");
      });

      // Redirect after 2 seconds
      setTimeout(() => {
        window.location.href = "/admin/users";
      }, 2000);
    }
  } catch (error) {
    console.error("Registration error:", error);

    // Show error message
    let errorMessage = "Registration failed. Please try again.";

    if (error.response) {
      // Server responded with error
      errorMessage =
        error.response.data.message ||
        error.response.data.error ||
        errorMessage;
    } else if (error.request) {
      // No response received
      errorMessage = "No response from server. Please check your connection.";
    }

    errorAlertText.textContent = errorMessage;
    errorAlert.classList.add("show");
    lucide.createIcons();
  } finally {
    // Re-enable submit button
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<i data-lucide="user-plus" style="width: 20px; height: 20px;"></i> Register User';
    lucide.createIcons();
  }
});
