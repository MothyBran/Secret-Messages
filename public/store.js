// store.js - Handhabt Shop-Logik und Status-Polling

const licenseMapping = {
  "1m": { name: "1 Monat Zugang", price: "1,99 €" },
  "3m": { name: "3 Monate Zugang", price: "4,49 €" },
  "12m": { name: "12 Monate Zugang", price: "14,99 €" },
  "unlimited": { name: "Unbegrenzter Zugang", price: "49,99 €" },
  "bundle_1m_2": { name: "2× 1 Monat Zugang", price: "3,79 €" },
  "bundle_3m_2": { name: "2× 3 Monate Zugang", price: "7,99 €" },
  "bundle_3m_5": { name: "5× 3 Monate Zugang", price: "19,99 €" },
  "bundle_1y_10": { name: "10× 12 Monate Zugang", price: "129,99 €" }
};

document.addEventListener("DOMContentLoaded", () => {
  // 1. URL Parameter prüfen
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session_id");
  const success = urlParams.get("success");

  // 2. Modus entscheiden: Shop oder Status?
  if (sessionId && success) {
    // -> STATUS MODUS (Nach Kauf)
    switchToStatusMode(sessionId);
  } else {
    // -> SHOP MODUS (Normal)
    initializeShop();
  }

  // Event Listeners für Modal
  document.getElementById("closeModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("confirmPurchaseBtn")?.addEventListener("click", confirmPurchase);
});

// =======================================================
// SHOP LOGIK
// =======================================================

function initializeShop() {
  // Standard-Shop anzeigen
  document.getElementById("shop-view").style.display = "block";
  document.getElementById("payment-status-section").style.display = "none";

  // Buttons initialisieren
  const buttons = document.querySelectorAll(".license-btn");
  buttons.forEach(btn => {
    const plan = btn.dataset.plan;
    if (plan) {
      btn.addEventListener("click", () => showModal(plan));
    }
  });
}

function showModal(plan) {
  const modal = document.getElementById("modalOverlay");
  const planText = document.getElementById("modalPlan");
  const priceText = document.getElementById("modalPrice");
  const emailInput = document.getElementById("emailInput");

  const license = licenseMapping[plan];
  if (!license) return alert("Fehler: Unbekannter Lizenztyp.");

  modal.dataset.selectedPlan = plan;
  planText.textContent = license.name;
  priceText.textContent = license.price;
  emailInput.value = ""; // Reset
  emailInput.focus();
  
  modal.style.display = "block";
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
}

async function confirmPurchase() {
  const modal = document.getElementById("modalOverlay");
  const plan = modal?.dataset.selectedPlan;
  const emailInput = document.getElementById("emailInput");
  const btn = document.getElementById("confirmPurchaseBtn");

  const email = emailInput?.value?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Bitte geben Sie eine gültige E-Mail-Adresse ein.");
    return;
  }

  // Button sperren (Loading)
  const originalText = btn.innerText;
  btn.innerText = "⏳ Verbindung zu Stripe...";
  btn.disabled = true;

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_type: plan, customer_email: email })
    });

    const data = await response.json();
    if (data.success && data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      throw new Error(data.error || "Keine URL erhalten");
    }

  } catch (err) {
    console.error("Zahlungsfehler:", err);
    alert("Fehler beim Starten der Zahlung: " + err.message);
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// =======================================================
// STATUS / POLLING LOGIK (Webhook Check)
// =======================================================

function switchToStatusMode(sessionId) {
  // Shop ausblenden, Status einblenden
  document.getElementById("shop-view").style.display = "none";
  const statusSection = document.getElementById("payment-status-section");
  statusSection.style.display = "block";

  // Polling starten
  pollPaymentStatus(sessionId);
}

async function pollPaymentStatus(sessionId) {
  const processingDiv = document.getElementById("status-processing");
  const successDiv = document.getElementById("status-success");
  const errorDiv = document.getElementById("status-error");
  const errorMsg = document.getElementById("error-message");
  const keysArea = document.getElementById("keys-output-area");

  let attempts = 0;
  const maxAttempts = 40; // ca. 80 Sekunden warten (40 * 2s)

  const check = async () => {
    attempts++;
    console.log(`📡 Prüfe Zahlungsstatus (Versuch ${attempts})...`);

    try {
      const res = await fetch(`/api/order-status?session_id=${sessionId}`);
      const data = await res.json();

      if (data.success && data.status === 'completed') {
        // --- ERFOLG ---
        processingDiv.style.display = "none";
        successDiv.style.display = "block";
        
        // Keys rendern
        if (data.keys && data.keys.length > 0) {
           renderKeys(data.keys, keysArea);
        } else {
           keysArea.innerHTML = "<p>Keine Keys gefunden (Fehler?)</p>";
        }
        return; // Polling beenden

      } else if (data.status === 'processing' || !data.status) {
        // --- NOCH WARTEN ---
        if (attempts < maxAttempts) {
           setTimeout(check, 2000); // In 2 Sekunden nochmal
        } else {
           throw new Error("Zeitüberschreitung: Zahlung wurde nicht rechtzeitig bestätigt.");
        }

      } else {
        // --- FEHLER ---
        throw new Error("Server meldet Status: " + data.status);
      }

    } catch (err) {
      console.error("Polling Fehler:", err);
      processingDiv.style.display = "none";
      errorDiv.style.display = "block";
      errorMsg.textContent = err.message || "Verbindungsfehler.";
    }
  };

  // Start
  check();
}

function renderKeys(keys, container) {
  let html = "";
  keys.forEach(key => {
    html += `
      <div class="key-display">
        ${key}
        <br>
        <button class="copy-btn" onclick="copyKey(this, '${key}')">🔗 KOPIEREN</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

// Hilfsfunktion für den Copy-Button im HTML String
window.copyKey = function(btn, key) {
  navigator.clipboard.writeText(key).then(() => {
    const originalText = btn.innerText;
    btn.innerText = "✔️ KOPIERT!";
    btn.style.color = "white";
    btn.style.borderColor = "white";
    
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.color = "";
        btn.style.borderColor = "";
    }, 2000);
  }).catch(err => {
    console.error('Copy failed', err);
    alert('Konnte Key nicht kopieren.');
  });
};
