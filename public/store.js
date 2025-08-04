// store.js

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
  // Lizenz-Buttons
  const buttons = document.querySelectorAll(".license-btn");
  buttons.forEach(btn => {
    const plan = btn.dataset.plan;
    if (plan) {
      btn.addEventListener("click", () => showModal(plan));
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session_id");
  
  if (sessionId) {
    showLoadingOverlay("🔐 Zahlung wird geprüft...");
    fetch("/api/confirm-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId })
    }).then(res => res.json()).then(data => {
      hideLoadingOverlay();
      if (data.success && data.keys?.length) {
        showKeyResult(data.keys, data.expires_at);
      } else {
        alert("Zahlung nicht bestätigt.");
      }
    });
  }

  // Modal-Buttons
  document.getElementById("closeModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("confirmPurchaseBtn")?.addEventListener("click", confirmPurchase);
});

function showModal(plan) {
  const modal = document.getElementById("modalOverlay");
  const planText = document.getElementById("modalPlan");
  const priceText = document.getElementById("modalPrice");

  const license = licenseMapping[plan];
  if (!license) {
    alert("Unbekannter Lizenztyp.");
    return;
  }

  modal.dataset.selectedPlan = plan;
  planText.textContent = `🔐 Lizenz: ${license.name}`;
  priceText.textContent = `💶 Preis: ${license.price}`;
  modal.style.display = "block";
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
}

async function confirmPurchase() {
  const modal = document.getElementById("modalOverlay");
  const plan = modal?.dataset.selectedPlan;

  console.log("🧪 Plan gewählt:", plan);
  
  closeModal();

  const email = document.getElementById("emailInput")?.value?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Ungültige E-Mail-Adresse.");
    return;
  }

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_type: plan, customer_email: email })
    });

    const data = await response.json();
    if (!data.success || !data.checkout_url) {
      alert("Fehler beim Erstellen der Checkout-Sitzung.");
      return;
    }

    window.location.href = data.checkout_url;
  } catch (err) {
    console.error("Zahlungsfehler:", err);
    alert("Fehler beim Start der Zahlung.");
  }
}

function showLoadingOverlay(text = "Bitte warten...") {
  const overlay = document.createElement("div");
  overlay.id = "paymentOverlay";
  overlay.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:black;display:flex;align-items:center;justify-content:center;color:lime;font-size:1.2rem;z-index:2000;font-family:'Courier New', monospace;";
  overlay.innerHTML = `<div><span class="spinner"></span><br>${text}</div>`;
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("paymentOverlay");
  if (overlay) overlay.remove();
}

function showKeyResult(keys = [], expiresAt = null) {
  // Vorherige Inhalte entfernen
  document.body.innerHTML = "";

  const box = document.createElement("div");
  box.style = "max-width:600px;margin:80px auto;background:#000;padding:30px;border:1px solid lime;color:lime;text-align:center;box-shadow:0 0 15px lime;font-family:'Courier New', monospace;";

  const keysHTML = keys.map((k, i) => `
    <div style="margin: 10px 0;">
      <code style="font-size:1.4rem;">${k}</code><br>
      <button class="copy-button" data-key="${k}" style="margin-top:5px;padding:5px 10px;border:1px solid lime;background:black;color:lime;cursor:pointer;">🔗 Key kopieren</button>
    </div>
  `).join("");

  box.innerHTML = `
    <h2>✅ Zahlung erfolgreich!</h2>
    <p>Hier ist dein Lizenz-Key${keys.length > 1 ? 's' : ''}:</p>
    ${keysHTML}
    <div id="copy-msg" style="margin-top:10px;opacity:0;transition:opacity 0.5s ease;color:#9f9;">✔️ Lizenz-Key kopiert!</div>
    <p style="margin-top:20px;"><strong>⚠️ Wichtig:</strong> Bitte kopiere den Key jetzt und bewahre ihn sicher auf. Nach der Aktivierung ist er mit deinem Benutzerkonto verknüpft und kann <u>nicht erneut angezeigt</u> werden.</p>
    ${expiresAt ? `<p>⏳ Gültig bis: <strong>${new Date(expiresAt).toLocaleDateString("de-DE")}</strong></p>` : `<p>♾️ Unbegrenzte Gültigkeit</p>`}
    <button id="backBtn" style="margin-top:30px;padding:10px 20px;border:1px solid lime;background:black;color:lime;cursor:pointer;">⬅️ Zurück zum Shop</button>
  `;

  document.body.appendChild(box);

  // Copy-Buttons aktivieren
  document.querySelectorAll(".copy-button").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-key");
      navigator.clipboard.writeText(key).then(() => {
        const msg = document.getElementById("copy-msg");
        msg.innerText = "✔️ Lizenz-Key kopiert!";
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 2000);
      });
    });
  });

  // Zurück-zum-Shop-Button
  document.getElementById("backBtn")?.addEventListener("click", () => {
    window.location.href = "store.html";
  });
}
