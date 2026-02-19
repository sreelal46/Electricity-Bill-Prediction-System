// Get users data from data attributes
const usersDataElement = document.getElementById("usersData");
const hasUsers = usersDataElement.dataset.hasUsers === "true";
const usersCount = parseInt(usersDataElement.dataset.usersCount || "0");

console.log("📊 Users Data:", { hasUsers, usersCount });

// Initialize Lucide icons
lucide.createIcons();

// Function to copy user ID to clipboard
function copyUserId(button) {
  const userId = button.getAttribute("data-user-id");

  if (!userId) {
    console.error("No user ID found");
    return;
  }

  // Copy to clipboard
  navigator.clipboard
    .writeText(userId)
    .then(() => {
      // Show toast notification
      showCopyToast();

      // Change button appearance temporarily
      const originalHTML = button.innerHTML;
      button.classList.add("copied");
      button.innerHTML =
        '<i data-lucide="check" style="width: 14px; height: 14px;"></i><span class="badge-text">Copied!</span>';

      // Reinitialize Lucide icons
      if (typeof lucide !== "undefined") {
        lucide.createIcons();
      }

      // Reset button after 2 seconds
      setTimeout(() => {
        button.classList.remove("copied");
        button.innerHTML = originalHTML;
        if (typeof lucide !== "undefined") {
          lucide.createIcons();
        }
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy user ID:", err);
      alert("Failed to copy user ID. Please try again.");
    });
}

// Function to show toast notification
function showCopyToast() {
  const toast = document.getElementById("copyToast");

  // Show toast
  toast.classList.add("show");

  // Reinitialize Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // Hide toast after 2 seconds
  setTimeout(() => {
    toast.style.animation = "slideOutDown 0.3s ease-out";
    setTimeout(() => {
      toast.classList.remove("show");
      toast.style.animation = "";
    }, 300);
  }, 2000);
}

// Function to mark installation as complete
async function markInstallationComplete(button) {
  const userId = button.getAttribute("data-user-id");

  if (!userId) {
    showErrorToast("Invalid user ID");
    return;
  }

  // Save original button content
  const originalHTML = button.innerHTML;

  // Show loading state
  button.classList.add("loading");
  button.innerHTML = '<div class="spinner"></div><span>Processing...</span>';
  button.disabled = true;

  try {
    // Make PUT request using axios
    const response = await axios.put(`/admin/users/${userId}/mark-installed`);

    console.log("Installation update response:", response.data);

    // Check if request was successful
    if (response.data.success) {
      // Show success toast
      showSuccessToast("Installation marked as complete");

      // Wait a moment then reload the page to show updated status
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      // Show error toast with server message
      showErrorToast(
        response.data.message || "Failed to update installation status",
      );

      // Reset button
      button.classList.remove("loading");
      button.innerHTML = originalHTML;
      button.disabled = false;
      if (typeof lucide !== "undefined") {
        lucide.createIcons();
      }
    }
  } catch (error) {
    console.error("Installation update error:", error);

    // Determine error message
    let errorMessage = "Failed to update installation status";

    if (error.response) {
      // Server responded with error
      if (error.response.status === 404) {
        errorMessage = "User not found";
      } else if (error.response.status === 403) {
        errorMessage = "You do not have permission to perform this action";
      } else if (error.response.status === 500) {
        errorMessage = "Server error. Please try again later";
      } else {
        errorMessage =
          error.response.data.message ||
          error.response.data.error ||
          errorMessage;
      }
    } else if (error.request) {
      // No response received
      errorMessage = "No response from server. Please check your connection";
    }

    // Show error toast
    showErrorToast(errorMessage);

    // Reset button
    button.classList.remove("loading");
    button.innerHTML = originalHTML;
    button.disabled = false;
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

// Function to show success toast
function showSuccessToast(message = "Installation marked as complete") {
  const toast = document.getElementById("successToast");
  const messageElement = toast.querySelector(".toast-message");

  // Update message
  messageElement.textContent = message;

  // Show toast
  toast.classList.add("show");

  // Reinitialize Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // Hide after 3 seconds
  setTimeout(() => {
    toast.style.animation = "slideOutRight 0.3s ease-out";
    setTimeout(() => {
      toast.classList.remove("show");
      toast.style.animation = "";
    }, 300);
  }, 3000);
}

// Function to show error toast
function showErrorToast(message = "Failed to update installation status") {
  const toast = document.getElementById("errorToast");
  const messageElement = document.getElementById("errorToastMessage");

  // Update message
  messageElement.textContent = message;

  // Show toast
  toast.classList.add("show");

  // Reinitialize Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // Hide after 4 seconds (longer for errors)
  setTimeout(() => {
    toast.style.animation = "slideOutRight 0.3s ease-out";
    setTimeout(() => {
      toast.classList.remove("show");
      toast.style.animation = "";
    }, 300);
  }, 4000);
}
